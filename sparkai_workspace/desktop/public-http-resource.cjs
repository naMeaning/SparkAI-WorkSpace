"use strict";

const dns = require("node:dns");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 5;

function publicHttpError(message, code, details = {}) {
  const error = new Error(String(message || "The remote resource could not be downloaded."));
  error.code = code;
  Object.assign(error, details);
  return error;
}

function normalizedIpLiteral(value) {
  const source = String(value || "").trim();
  return source.startsWith("[") && source.endsWith("]") ? source.slice(1, -1) : source;
}

function ipv4Number(address) {
  if (net.isIP(address) !== 4) return null;
  return address.split(".").reduce((value, part) => (value * 256) + Number(part), 0) >>> 0;
}

const BLOCKED_IPV4_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
].map(([base, prefix]) => ({ base: ipv4Number(base), prefix }));

function ipv4MatchesRange(value, range) {
  if (range.prefix === 0) return true;
  const shift = 32 - range.prefix;
  return (value >>> shift) === (range.base >>> shift);
}

function parseIpv6Words(address) {
  let source = normalizedIpLiteral(address).toLowerCase();
  if (net.isIP(source) !== 6 || source.includes("%")) return null;
  if (source.includes(".")) {
    const separator = source.lastIndexOf(":");
    const tail = source.slice(separator + 1);
    const value = ipv4Number(tail);
    if (value === null) return null;
    source = `${source.slice(0, separator)}:${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const words = [
    ...left.map((part) => Number.parseInt(part, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map((part) => Number.parseInt(part, 16))
  ];
  return words.length === 8 && words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
    ? words
    : null;
}

function ipv6PrefixMatches(words, prefixWords, prefixLength) {
  let remaining = prefixLength;
  for (let index = 0; index < 8 && remaining > 0; index += 1) {
    const bits = Math.min(remaining, 16);
    const mask = bits === 16 ? 0xffff : (0xffff << (16 - bits)) & 0xffff;
    if ((words[index] & mask) !== (prefixWords[index] & mask)) return false;
    remaining -= bits;
  }
  return true;
}

function mappedIpv4Number(words) {
  if (!words || words.length !== 8) return null;
  if (words.slice(0, 5).some((word) => word !== 0) || words[5] !== 0xffff) return null;
  return ((words[6] << 16) | words[7]) >>> 0;
}

function isPublicIpv4Number(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff &&
    !BLOCKED_IPV4_RANGES.some((range) => ipv4MatchesRange(value, range));
}

const BLOCKED_GLOBAL_IPV6_RANGES = [
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20]
].map(([base, prefix]) => ({ words: parseIpv6Words(base), prefix }));

function isPublicIpAddress(address) {
  const normalized = normalizedIpLiteral(address);
  const family = net.isIP(normalized);
  if (family === 4) {
    const value = ipv4Number(normalized);
    return value !== null && isPublicIpv4Number(value);
  }
  if (family !== 6) return false;
  const words = parseIpv6Words(normalized);
  if (!words) return false;
  const mapped = mappedIpv4Number(words);
  if (mapped !== null) return isPublicIpv4Number(mapped);
  // IANA currently allocates global unicast IPv6 from 2000::/3. Restricting
  // downloads to that range excludes loopback, ULA, link-local and multicast.
  if ((words[0] & 0xe000) !== 0x2000) return false;
  return !BLOCKED_GLOBAL_IPV6_RANGES.some((range) => ipv6PrefixMatches(words, range.words, range.prefix));
}

function canonicalIpAddressKey(address) {
  const normalized = normalizedIpLiteral(address);
  const family = net.isIP(normalized);
  if (family === 4) return `4:${ipv4Number(normalized)}`;
  if (family !== 6) return "";
  const words = parseIpv6Words(normalized);
  if (!words) return "";
  const mapped = mappedIpv4Number(words);
  if (mapped !== null) return `4:${mapped}`;
  return `6:${words.map((word) => word.toString(16).padStart(4, "0")).join("")}`;
}

function parsePublicHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw publicHttpError("远程图片 URL 无效。", "NAIMAGE_REMOTE_URL_INVALID");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw publicHttpError("远程图片地址必须使用 HTTP 或 HTTPS。", "NAIMAGE_REMOTE_URL_PROTOCOL");
  }
  if (parsed.username || parsed.password) {
    throw publicHttpError("远程图片地址不能包含用户名或密码。", "NAIMAGE_REMOTE_URL_CREDENTIALS");
  }
  if (!parsed.hostname) throw publicHttpError("远程图片 URL 缺少主机名。", "NAIMAGE_REMOTE_URL_HOST");
  return parsed;
}

function isExplicitlyLocalHostname(hostname) {
  const normalized = normalizedIpLiteral(hostname).replace(/\.$/, "").toLowerCase();
  return normalized === "localhost" || normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") || normalized.endsWith(".internal") ||
    normalized.endsWith(".lan") || normalized.endsWith(".home.arpa");
}

function abortIfNeeded(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : publicHttpError("远程图片下载已取消。", "NAIMAGE_REMOTE_DOWNLOAD_ABORTED");
}

async function resolvePublicHttpTarget(value, options = {}) {
  abortIfNeeded(options.signal);
  const url = value instanceof URL ? parsePublicHttpUrl(value.toString()) : parsePublicHttpUrl(value);
  const hostname = normalizedIpLiteral(url.hostname);
  if (isExplicitlyLocalHostname(hostname)) {
    throw publicHttpError("远程图片指向本机或私有网络，已拒绝下载。", "NAIMAGE_REMOTE_ADDRESS_BLOCKED");
  }
  const literalFamily = net.isIP(hostname);
  let records;
  if (literalFamily) {
    records = [{ address: hostname, family: literalFamily }];
  } else {
    const lookup = typeof options.lookup === "function"
      ? options.lookup
      : (name, lookupOptions) => dns.promises.lookup(name, lookupOptions);
    try {
      const result = await lookup(hostname, { all: true, verbatim: true });
      records = Array.isArray(result) ? result : result ? [result] : [];
    } catch (error) {
      throw publicHttpError("远程图片域名解析失败。", "NAIMAGE_REMOTE_DNS_FAILED", { cause: error });
    }
  }
  abortIfNeeded(options.signal);
  const addresses = [];
  const seen = new Set();
  for (const record of records || []) {
    const address = normalizedIpLiteral(record?.address);
    const family = Number(record?.family) || net.isIP(address);
    if ((family !== 4 && family !== 6) || net.isIP(address) !== family || !isPublicIpAddress(address)) {
      throw publicHttpError("远程图片指向本机、私有或保留网络，已拒绝下载。", "NAIMAGE_REMOTE_ADDRESS_BLOCKED");
    }
    const key = `${family}:${address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push({ address, family });
  }
  if (!addresses.length) {
    throw publicHttpError("远程图片域名没有可用的公网地址。", "NAIMAGE_REMOTE_DNS_EMPTY");
  }
  return { url, addresses };
}

function pinnedLookup(addresses) {
  const verified = addresses.map((record) => ({ address: record.address, family: record.family }));
  return (_hostname, lookupOptions, callback) => {
    const options = typeof lookupOptions === "number" ? { family: lookupOptions } : (lookupOptions || {});
    const family = Number(options.family) || 0;
    const candidates = family ? verified.filter((record) => record.family === family) : verified;
    process.nextTick(() => {
      if (!candidates.length) {
        const error = new Error("No verified address matches the requested family.");
        error.code = "EAI_ADDRFAMILY";
        callback(error);
      } else if (options.all) {
        callback(null, candidates.map((record) => ({ ...record })));
      } else {
        callback(null, candidates[0].address, candidates[0].family);
      }
    });
  };
}

function responseHeader(response, name) {
  const value = response?.headers?.[String(name || "").toLowerCase()];
  return Array.isArray(value) ? value[0] : value === undefined ? "" : String(value);
}

function assertApprovedSocketAddress(socket, approvedAddressKeys) {
  const address = normalizedIpLiteral(socket?.remoteAddress);
  const key = canonicalIpAddressKey(address);
  if (!key || !approvedAddressKeys.has(key) || !isPublicIpAddress(address)) {
    throw publicHttpError(
      "远程图片连接到未获批准的网络地址，已中止下载。",
      "NAIMAGE_REMOTE_SOCKET_ADDRESS_MISMATCH"
    );
  }
}

function requestPublicTarget(target, options = {}) {
  return new Promise((resolve, reject) => {
    abortIfNeeded(options.signal);
    const approvedAddressKeys = new Set(target.addresses.map((record) => canonicalIpAddressKey(record.address)));
    const requestOptions = {
      method: "GET",
      headers: {
        accept: String(options.accept || "image/png,image/jpeg,image/webp,*/*;q=0.1").slice(0, 512),
        "accept-encoding": "identity"
      },
      agent: false,
      lookup: pinnedLookup(target.addresses),
      signal: options.signal
    };
    const requester = typeof options.request === "function"
      ? options.request
      : (url, requestConfig, onResponse) => (url.protocol === "https:" ? https : http).request(url, requestConfig, onResponse);
    let request;
    try {
      request = requester(target.url, requestOptions, (response) => {
        try {
          assertApprovedSocketAddress(response?.socket, approvedAddressKeys);
          resolve(response);
        } catch (error) {
          response?.destroy?.();
          reject(error);
        }
      });
    } catch (error) {
      reject(error);
      return;
    }
    request.once("error", reject);
    request.on("socket", (socket) => {
      const verify = () => {
        try {
          assertApprovedSocketAddress(socket, approvedAddressKeys);
        } catch (error) {
          request.destroy?.();
          reject(error);
        }
      };
      if (socket?.connecting === false && socket?.remoteAddress) verify();
      else {
        socket?.once?.("connect", verify);
        socket?.once?.("secureConnect", verify);
      }
    });
    request.end();
  });
}

async function responseBodyBuffer(response, maxBytes) {
  const rawLength = responseHeader(response, "content-length").trim();
  const contentLength = /^\d+$/.test(rawLength) ? Number(rawLength) : 0;
  if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) {
    response.destroy();
    throw publicHttpError("远程图片超过允许的大小，已取消下载。", "NAIMAGE_REMOTE_RESPONSE_TOO_LARGE");
  }
  const chunks = [];
  let received = 0;
  for await (const value of response) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    received += chunk.length;
    if (received > maxBytes) {
      response.destroy();
      throw publicHttpError("远程图片超过允许的大小，已取消下载。", "NAIMAGE_REMOTE_RESPONSE_TOO_LARGE");
    }
    chunks.push(chunk);
  }
  if (received <= 0) throw publicHttpError("远程图片数据为空。", "NAIMAGE_REMOTE_RESPONSE_EMPTY");
  return Buffer.concat(chunks, received);
}

async function downloadPublicHttpBuffer(value, options = {}) {
  const maxBytes = Number(options.maxBytes);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("downloadPublicHttpBuffer requires a positive maxBytes limit.");
  }
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1, Math.round(Number(options.timeoutMs)))
    : DEFAULT_TIMEOUT_MS;
  const maxRedirects = Number.isSafeInteger(Number(options.maxRedirects))
    ? Math.max(0, Math.min(20, Number(options.maxRedirects)))
    : DEFAULT_MAX_REDIRECTS;
  const controller = new AbortController();
  const timeoutError = publicHttpError("远程图片下载超时。", "NAIMAGE_REMOTE_DOWNLOAD_TIMEOUT");
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  const download = async () => {
    let current = value;
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const target = await resolvePublicHttpTarget(current, { lookup: options.lookup, signal: controller.signal });
      const response = await requestPublicTarget(target, { request: options.request, signal: controller.signal });
      const status = Number(response?.statusCode || 0);
      const location = responseHeader(response, "location");
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.destroy();
        if (redirectCount >= maxRedirects) {
          throw publicHttpError("远程图片重定向次数过多。", "NAIMAGE_REMOTE_REDIRECT_LIMIT");
        }
        try {
          current = new URL(location, target.url).toString();
        } catch {
          throw publicHttpError("远程图片返回了无效的重定向地址。", "NAIMAGE_REMOTE_REDIRECT_INVALID");
        }
        continue;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        throw publicHttpError(`远程图片下载失败（HTTP ${status || "unknown"}）。`, "NAIMAGE_REMOTE_HTTP_STATUS", { status });
      }
      return responseBodyBuffer(response, maxBytes);
    }
    throw publicHttpError("远程图片重定向次数过多。", "NAIMAGE_REMOTE_REDIRECT_LIMIT");
  };

  try {
    return await Promise.race([download(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

function createPublicHttpDownloadAdmission(options = {}) {
  const maxConcurrent = Number.isSafeInteger(Number(options.maxConcurrent))
    ? Math.max(1, Math.min(16, Number(options.maxConcurrent)))
    : 2;
  const maxQueued = Number.isSafeInteger(Number(options.maxQueued))
    ? Math.max(maxConcurrent, Math.min(2048, Number(options.maxQueued)))
    : 256;
  const execute = typeof options.download === "function" ? options.download : downloadPublicHttpBuffer;
  const queue = [];
  const inFlight = new Map();
  let active = 0;

  const pump = () => {
    while (active < maxConcurrent && queue.length) {
      const item = queue.shift();
      active += 1;
      Promise.resolve()
        .then(() => execute(item.value, item.options))
        .then(item.resolve, item.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  const download = (value, downloadOptions = {}) => {
    const key = `${String(value || "")}\n${Number(downloadOptions.maxBytes) || 0}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    if (queue.length >= maxQueued) {
      return Promise.reject(publicHttpError(
        "远程图片下载队列已满，请稍后重试。",
        "NAIMAGE_REMOTE_DOWNLOAD_QUEUE_FULL"
      ));
    }
    const promise = new Promise((resolve, reject) => {
      queue.push({ value, options: downloadOptions, resolve, reject });
      pump();
    });
    inFlight.set(key, promise);
    promise.then(
      () => inFlight.delete(key),
      () => inFlight.delete(key)
    );
    return promise;
  };

  return {
    download,
    snapshot() {
      return {
        active,
        queued: queue.length,
        inFlight: inFlight.size,
        maxConcurrent,
        maxQueued
      };
    }
  };
}

module.exports = {
  createPublicHttpDownloadAdmission,
  downloadPublicHttpBuffer,
  isPublicIpAddress,
  parsePublicHttpUrl,
  requestPublicHttpTarget: requestPublicTarget,
  resolvePublicHttpTarget
};
