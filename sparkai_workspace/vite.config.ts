import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
type SymbolCompactionPlugin = Plugin & { api: { plan: unknown } };
type PostcssCompactionPlugin = { postcssPlugin: string; Once(root: unknown): void };
const { createPostcssSymbolCompactionPlugin, createProductionSymbolCompactionPlugin, transformCode } = require("./scripts/production-symbol-compaction.cjs") as {
  createPostcssSymbolCompactionPlugin: (plan: unknown) => PostcssCompactionPlugin;
  createProductionSymbolCompactionPlugin: (projectRoot: string) => SymbolCompactionPlugin;
  transformCode: (code: string, plan: unknown, filePath?: string) => string;
};
const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const { ACCESS_POLICY_FILENAME, buildAccessPolicy } = require("./runtime/access-variant.cjs") as {
  ACCESS_POLICY_FILENAME: string;
  buildAccessPolicy: (environment?: NodeJS.ProcessEnv) => Record<string, unknown>;
};
const buildAccessPolicyValue = buildAccessPolicy(process.env);

const createStudioIconPlugin = (symbolPlan?: unknown): Plugin => ({
  name: "naimage-build-icon",
  apply: "build" as const,
  buildStart() {
    this.emitFile({
      type: "asset",
      fileName: "naimage.png",
      source: readFileSync(new URL("./public/naimage.png", import.meta.url))
    });
    this.emitFile({
      type: "asset",
      fileName: "glass-theme-bootstrap.js",
      source: symbolPlan
        ? transformCode(
          readFileSync(new URL("./public/glass-theme-bootstrap.js", import.meta.url), "utf8"),
          symbolPlan,
          "public/glass-theme-bootstrap.js"
        )
        : readFileSync(new URL("./public/glass-theme-bootstrap.js", import.meta.url))
    });
  }
});

const compactBuildHtmlPlugin: Plugin = {
  name: "naimage-compact-build-html",
  apply: "build" as const,
  enforce: "post" as const,
  transformIndexHtml(html) {
    return html
      .replace(/<!--[^]*?-->/g, "")
      .replace(/<style>([^]*?)<\/style>/g, (_match, css: string) => `<style>${css
        .replace(/\s+/g, " ")
        .replace(/\s*([{}:;,])\s*/g, "$1")
        .trim()}</style>`)
      .replace(/>\s+</g, "><")
      .trim();
  }
};

const accessPolicyPlugin: Plugin = {
  name: "sparkai-access-policy",
  apply: "build" as const,
  buildStart() {
    this.emitFile({
      type: "asset",
      fileName: ACCESS_POLICY_FILENAME,
      source: `${JSON.stringify(buildAccessPolicyValue, null, 2)}\n`
    });
  }
};

export default defineConfig(({ command, mode }) => {
  const symbolCompactionPlugin = command === "build"
    ? createProductionSymbolCompactionPlugin(projectRoot)
    : null;
  return ({
  base: "./",
  plugins: [
    symbolCompactionPlugin,
    react(),
    createStudioIconPlugin(symbolCompactionPlugin?.api.plan),
    accessPolicyPlugin,
    compactBuildHtmlPlugin
  ].filter(Boolean) as Plugin[],
  define: {
    __NAIMAGE_AIDEBUG__: JSON.stringify(command === "serve"),
    __NAIMAGE_PERF_PROBE__: JSON.stringify(command === "build" && mode === "performance"),
    __SPARKAI_ACCESS_POLICY__: JSON.stringify(buildAccessPolicyValue)
  },
  build: {
    // Packaged builds run on Electron 42's Chromium runtime. Targeting that
    // runtime avoids shipping legacy JS transforms and CSS prefixes that the
    // desktop/web support floor never executes.
    target: "chrome138",
    cssTarget: "chrome138",
    cssMinify: "lightningcss",
    minify: "terser",
    terserOptions: {
      ecma: 2020,
      module: true,
      compress: {
        passes: 4,
        toplevel: true,
        keep_fargs: false,
        booleans_as_integers: true,
        drop_console: true,
        drop_debugger: true
      },
      mangle: { toplevel: true },
      format: { comments: false }
    },
    copyPublicDir: false,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");
          // The barrel must remain a natural async boundary. Assigning it to a
          // manual chunk also captures dependencies and pushes dialogs back
          // into the initial renderer graph.
          if (normalizedId.endsWith("/src/studio-dialogs.ts")) return undefined;
          return undefined;
        },
        minify: {
          compress: {
            maxIterations: 3,
            target: "es2022",
            dropConsole: true,
            dropDebugger: true
          },
          mangle: {
            toplevel: true
          },
          codegen: {
            removeWhitespace: true,
            legalComments: "none"
          }
        }
      }
    }
  },
  css: symbolCompactionPlugin ? {
    postcss: {
      plugins: [createPostcssSymbolCompactionPlugin(symbolCompactionPlugin.api.plan)]
    }
  } : undefined,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/.diagnostics/**", "**/config/**", "**/output/**"]
    },
    proxy: {
      "/__naimage_new_api": {
        target: "http://127.0.0.1:17860",
        changeOrigin: true,
        secure: false,
        cookieDomainRewrite: "",
        cookiePathRewrite: "/",
        rewrite: (path: string) => path.replace(/^\/__naimage_new_api/, "")
      }
    }
  }
  });
});
