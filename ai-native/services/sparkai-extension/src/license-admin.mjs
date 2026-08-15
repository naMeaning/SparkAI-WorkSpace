function argument(name, fallback = "") {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function numberArgument(name, fallback) {
  const value = Number(argument(name, String(fallback)));
  if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer.`);
  return value;
}

const command = process.argv[2];
const baseUrl = String(process.env.SPARKAI_EXTENSION_URL || "").replace(/\/+$/, "");
const adminToken = String(process.env.SPARKAI_EXTENSION_ADMIN_TOKEN || "").trim();
if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) throw new Error("Set SPARKAI_EXTENSION_URL to the public HTTPS extension origin.");
if (adminToken.length < 32) throw new Error("Set SPARKAI_EXTENSION_ADMIN_TOKEN to the deployed admin token.");

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${adminToken}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
  return payload.data;
}

if (command === "create") {
  const data = await request("/api/naimage/license/admin/codes", {
    method: "POST",
    body: JSON.stringify({
      name: argument("name", "SparkAI Pro"),
      count: numberArgument("count", 1),
      plan: "pro",
      valid_days: numberArgument("valid-days", 0),
      max_activations: numberArgument("max-devices", 3),
      expired_time: numberArgument("expires-at", 0)
    })
  });
  console.log(JSON.stringify(data, null, 2));
} else if (command === "list") {
  const data = await request(`/api/naimage/license/admin/codes?page=${numberArgument("page", 1)}&size=${numberArgument("size", 20)}`);
  console.log(JSON.stringify(data, null, 2));
} else if (command === "disable") {
  const id = numberArgument("id", 0);
  if (id < 1) throw new Error("disable requires --id <code id>.");
  const data = await request(`/api/naimage/license/admin/codes/${id}/disable`, { method: "POST" });
  console.log(JSON.stringify(data, null, 2));
} else {
  console.log("Usage: license-admin.mjs <create|list|disable> [options]");
  process.exitCode = 1;
}
