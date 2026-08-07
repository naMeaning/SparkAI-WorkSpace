#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${SCRIPT_DIR}/runtime"
manifest="${1:-${RUNTIME_DIR}/releases/desktop-release.json}"
release_dir="${2:-${RUNTIME_DIR}/releases}"
public_key="${3:-${SCRIPT_DIR}/releases/update-public-key.pem}"

for command_name in openssl python3; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "missing command: $command_name" >&2
    exit 1
  fi
done

if [[ ! -f "$manifest" ]]; then
  echo "missing desktop release manifest: $manifest" >&2
  exit 1
fi
if [[ ! -d "$release_dir" ]]; then
  echo "missing desktop release directory: $release_dir" >&2
  exit 1
fi
if [[ ! -f "$public_key" ]]; then
  echo "missing desktop release verification key: $public_key" >&2
  exit 1
fi

verification_dir="$(mktemp -d "${TMPDIR:-/tmp}/naimage-release-verify.XXXXXX")"
trap 'rm -rf "$verification_dir"' EXIT
canonical_payload="${verification_dir}/canonical-release.json"
signature_file="${verification_dir}/signature.bin"

python3 - "$manifest" "$release_dir" "$canonical_payload" "$signature_file" <<'PY'
import base64
import binascii
import hashlib
import json
import os
import re
import sys
from datetime import datetime

manifest_path, release_dir, canonical_payload_path, signature_path = sys.argv[1:]
with open(manifest_path, "r", encoding="utf-8") as handle:
    manifest = json.load(handle)

if not isinstance(manifest, dict):
    raise SystemExit("desktop release manifest must be a JSON object")

allowed_fields = {
    "schema_version",
    "product",
    "channel",
    "version",
    "published_at",
    "minimum_version",
    "compatibility",
    "notes",
    "restart",
    "installer",
    "signature",
}
unknown_fields = sorted(set(manifest) - allowed_fields)
if unknown_fields:
    raise SystemExit(f"desktop release manifest has unknown fields: {', '.join(unknown_fields)}")
product = str(manifest.get("product") or "").strip()
if manifest.get("schema_version") != 1:
    raise SystemExit("invalid desktop release manifest identity")
if manifest.get("channel") != "stable":
    raise SystemExit("desktop release manifest must use the stable channel")

semver_pattern = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
version = manifest.get("version")
minimum_version = manifest.get("minimum_version")
if not isinstance(version, str) or not semver_pattern.fullmatch(version.strip()):
    raise SystemExit("invalid desktop release version")
if not isinstance(minimum_version, str) or not semver_pattern.fullmatch(minimum_version.strip()):
    raise SystemExit("invalid desktop minimum version")
version = version.strip()
minimum_version = minimum_version.strip()
version_core = tuple(int(item) for item in re.split(r"[-+]", version, maxsplit=1)[0].split("."))
if product != "naimage-studio":
    raise SystemExit("desktop release manifest product must be naimage-studio")

published_at = manifest.get("published_at")
if not isinstance(published_at, str) or not published_at.strip():
    raise SystemExit("desktop release manifest is missing published_at")
try:
    parsed_published_at = datetime.fromisoformat(published_at.strip().replace("Z", "+00:00"))
except ValueError as error:
    raise SystemExit("invalid desktop release published_at") from error
if parsed_published_at.tzinfo is None:
    raise SystemExit("desktop release published_at must include a timezone")

compatibility = manifest.get("compatibility")
if not isinstance(compatibility, str) or not compatibility.strip() or len(compatibility.strip()) > 128:
    raise SystemExit("invalid desktop release compatibility")
compatibility = compatibility.strip()

notes = manifest.get("notes")
if not isinstance(notes, list) or len(notes) > 12:
    raise SystemExit("desktop release notes must be a list of at most 12 items")
canonical_notes = []
for note in notes:
    if not isinstance(note, str):
        raise SystemExit("desktop release notes must contain only strings")
    cleaned_note = note.strip()
    if cleaned_note:
        canonical_notes.append(cleaned_note)

signature = manifest.get("signature")
if not isinstance(signature, str) or not signature.strip():
    raise SystemExit("desktop release manifest is unsigned")
try:
    signature_bytes = base64.b64decode(signature.strip(), validate=True)
except (ValueError, binascii.Error) as error:
    raise SystemExit("desktop release manifest signature is not valid base64") from error
if len(signature_bytes) != 64:
    raise SystemExit("desktop release manifest signature has an invalid length")

canonical_artifacts = {}

for kind in ("installer", "restart"):
    artifact = manifest.get(kind)
    if kind == "restart" and not artifact:
        canonical_artifacts[kind] = None
        continue
    if not isinstance(artifact, dict):
        raise SystemExit(f"desktop release manifest is missing {kind}")
    if set(artifact) != {"filename", "sha256", "size"}:
        raise SystemExit(f"desktop release manifest has invalid {kind} fields")
    filename = str(artifact.get("filename") or "").strip()
    expected = str(artifact.get("sha256") or "").strip().lower()
    size_value = artifact.get("size")
    if isinstance(size_value, bool) or not isinstance(size_value, int):
        raise SystemExit(f"invalid {kind} size")
    expected_size = size_value
    if not filename or os.path.basename(filename) != filename:
        raise SystemExit(f"invalid {kind} filename")
    if kind == "installer":
        if version_core >= (1, 0, 9):
            canonical_filename = f"SparkAI-WorkSpace-Unrestricted-Setup-{version}-x64.exe"
        else:
            canonical_filename = f"naimage-Setup-{version}-x64.exe"
    else:
        canonical_filename = f"naimage-Restart-Update-{version}-x64.asar"
    if filename != canonical_filename:
        raise SystemExit(f"unexpected {kind} filename: {filename}")
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise SystemExit(f"invalid {kind} SHA-256")
    if expected_size <= 0:
        raise SystemExit(f"invalid {kind} size")
    path = os.path.join(release_dir, filename)
    if not os.path.isfile(path) or os.path.islink(path):
        raise SystemExit(f"missing {kind}: {path}")
    actual_size = os.path.getsize(path)
    if actual_size != expected_size:
        raise SystemExit(f"{kind} size mismatch: expected={expected_size} actual={actual_size}")
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    actual = digest.hexdigest()
    if actual != expected:
        raise SystemExit(f"{kind} checksum mismatch: expected={expected} actual={actual}")
    canonical_artifacts[kind] = {
        "filename": filename,
        "sha256": expected,
        "size": expected_size,
    }
    print(f"{kind} verified: {filename} sha256={actual}")

canonical_manifest = {
    "schema_version": 1,
    "product": product,
    "channel": "stable",
    "version": version,
    "published_at": published_at.strip(),
    "minimum_version": minimum_version,
    "compatibility": compatibility,
    "notes": canonical_notes,
    "restart": canonical_artifacts["restart"],
    "installer": canonical_artifacts["installer"],
}
with open(canonical_payload_path, "wb") as handle:
    handle.write(json.dumps(canonical_manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
with open(signature_path, "wb") as handle:
    handle.write(signature_bytes)
PY

if ! openssl pkeyutl \
  -verify \
  -pubin \
  -inkey "$public_key" \
  -rawin \
  -in "$canonical_payload" \
  -sigfile "$signature_file" >/dev/null; then
  echo "desktop release manifest signature verification failed" >&2
  exit 1
fi

echo "desktop release signature verified"
