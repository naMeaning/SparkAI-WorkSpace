import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../..");
const buildDir = join(projectRoot, "build");
const iconSource = join(projectRoot, "public", "naimage.png");
const windowsIconSource = join(projectRoot, "assets", "windows", "naimage.ico");

mkdirSync(buildDir, { recursive: true });

function encodeBmp(rgb, width, height, channels) {
  const rowBytes = width * 3;
  const stride = Math.ceil(rowBytes / 4) * 4;
  const pixelBytes = stride * height;
  const output = Buffer.alloc(54 + pixelBytes);
  output.write("BM", 0, 2, "ascii");
  output.writeUInt32LE(output.length, 2);
  output.writeUInt32LE(54, 10);
  output.writeUInt32LE(40, 14);
  output.writeInt32LE(width, 18);
  output.writeInt32LE(height, 22);
  output.writeUInt16LE(1, 26);
  output.writeUInt16LE(24, 28);
  output.writeUInt32LE(pixelBytes, 34);
  output.writeInt32LE(3780, 38);
  output.writeInt32LE(3780, 42);

  for (let targetY = 0; targetY < height; targetY += 1) {
    const sourceY = height - targetY - 1;
    const sourceRow = sourceY * width * channels;
    const targetRow = 54 + targetY * stride;
    for (let x = 0; x < width; x += 1) {
      const source = sourceRow + x * channels;
      const target = targetRow + x * 3;
      output[target] = rgb[source + 2];
      output[target + 1] = rgb[source + 1];
      output[target + 2] = rgb[source];
    }
  }
  return output;
}

async function svgToBmp(svg, width, height, destination) {
  const { data, info } = await sharp(Buffer.from(svg))
    .resize(width, height, { fit: "fill" })
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  writeFileSync(destination, encodeBmp(data, width, height, info.channels));
}

const iconDataUrl = `data:image/png;base64,${readFileSync(iconSource).toString("base64")}`;
const sidebarSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#07131c"/>
      <stop offset="0.54" stop-color="#0a2835"/>
      <stop offset="1" stop-color="#0f4b43"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.78" cy="0.12" r="0.82">
      <stop offset="0" stop-color="#50e7ca" stop-opacity="0.40"/>
      <stop offset="1" stop-color="#42d8bc" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4ee4c6"/>
      <stop offset="1" stop-color="#54a8ff"/>
    </linearGradient>
  </defs>
  <rect width="164" height="314" fill="url(#bg)"/>
  <rect width="164" height="314" fill="url(#glow)"/>
  <g opacity="0.13" stroke="#91f1e2" stroke-width="0.75">
    <path d="M-22 230 C34 176 96 272 190 194" fill="none"/>
    <path d="M-14 252 C46 198 108 288 188 218" fill="none"/>
    <path d="M-8 274 C58 222 118 300 184 244" fill="none"/>
  </g>
  <circle cx="140" cy="20" r="58" fill="#54a8ff" opacity="0.09"/>
  <rect x="16" y="18" width="132" height="278" rx="18" fill="none" stroke="#b7fff2" stroke-opacity="0.11"/>
  <image href="${iconDataUrl}" x="38" y="30" width="88" height="88"/>
  <text x="18" y="150" fill="#f4fffc" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="18" font-weight="720">naimage</text>
  <rect x="18" y="164" width="68" height="3" rx="1.5" fill="url(#line)"/>
  <text x="18" y="190" fill="#d9f7f1" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="10.5" font-weight="600">一句话，交付一组图</text>
  <text x="18" y="215" fill="#9ecbc5" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="8.7">Single Agent</text>
  <text x="18" y="231" fill="#9ecbc5" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="8.7">Infinite Canvas</text>
  <text x="18" y="247" fill="#9ecbc5" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="8.7">Layered Delivery</text>
  <circle cx="20" cy="276" r="2.5" fill="#4ee4c6"/>
  <text x="28" y="279" fill="#7fa9a5" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="7.6">Aieyra AI Workspace</text>
</svg>`;

const headerSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <defs>
    <linearGradient id="header" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f7fbfa"/>
      <stop offset="1" stop-color="#e7f7f3"/>
    </linearGradient>
  </defs>
  <rect width="150" height="57" fill="url(#header)"/>
  <circle cx="130" cy="7" r="46" fill="#43d9bd" opacity="0.12"/>
  <text x="12" y="23" fill="#0c2a37" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="12.5" font-weight="720">naimage</text>
  <text x="12" y="40" fill="#4b706f" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="7.6">Single-Agent AI image workspace</text>
  <rect x="12" y="47" width="54" height="2" rx="1" fill="#43d9bd"/>
  <image href="${iconDataUrl}" x="106" y="9" width="39" height="39"/>
</svg>`;

copyFileSync(windowsIconSource, join(buildDir, "naimage.ico"));
await Promise.all([
  svgToBmp(sidebarSvg, 164, 314, join(buildDir, "installer-sidebar.bmp")),
  svgToBmp(headerSvg, 150, 57, join(buildDir, "installer-header.bmp"))
]);

console.log(JSON.stringify({
  icon: join(buildDir, "naimage.ico"),
  sidebar: join(buildDir, "installer-sidebar.bmp"),
  header: join(buildDir, "installer-header.bmp")
}, null, 2));
