const REMOTE_ASSET_PROTOCOL = "naimage-asset:";
const REMOTE_ASSET_HOST = "remote";

export function remoteAssetDisplaySource(value: unknown) {
  const source = typeof value === "string" ? value.trim() : "";
  if (!/^https?:\/\//i.test(source)) return source;
  return `${REMOTE_ASSET_PROTOCOL}//${REMOTE_ASSET_HOST}/${encodeURIComponent(source)}`;
}
