const desktopReleaseSchemaVersion = 1;
const desktopReleaseProduct = "iiimage-studio";

function cleanArtifact(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    filename: String(source.filename || "").trim(),
    sha256: String(source.sha256 || "").trim().toLowerCase(),
    size: Math.max(0, Math.floor(Number(source.size) || 0))
  };
}

function canonicalDesktopRelease(value) {
  const source = value && typeof value === "object" ? value : {};
  const notes = Array.isArray(source.notes)
    ? source.notes.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12)
    : [];
  const payload = {
    schema_version: Number(source.schema_version) || desktopReleaseSchemaVersion,
    product: String(source.product || desktopReleaseProduct).trim(),
    channel: String(source.channel || "stable").trim(),
    version: String(source.version || source.latest_version || "").trim(),
    published_at: String(source.published_at || "").trim(),
    minimum_version: String(source.minimum_version || "").trim(),
    compatibility: String(source.compatibility || "").trim(),
    notes,
    restart: source.restart ? cleanArtifact(source.restart) : null,
    installer: cleanArtifact(source.installer)
  };
  return JSON.stringify(payload);
}

module.exports = {
  canonicalDesktopRelease,
  cleanArtifact,
  desktopReleaseProduct,
  desktopReleaseSchemaVersion
};
