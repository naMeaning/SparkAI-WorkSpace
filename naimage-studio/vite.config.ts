import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const studioIconPlugin: Plugin = {
  name: "naimage-build-icon",
  apply: "build" as const,
  buildStart() {
    this.emitFile({
      type: "asset",
      fileName: "naimage.png",
      source: readFileSync(new URL("./public/naimage.png", import.meta.url))
    });
  }
};

export default defineConfig(({ command, mode }) => ({
  base: "./",
  plugins: [react(), studioIconPlugin],
  define: {
    __NAIMAGE_AIDEBUG__: JSON.stringify(command === "serve"),
    __NAIMAGE_PERF_PROBE__: JSON.stringify(command === "build" && mode === "performance")
  },
  build: {
    copyPublicDir: false,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");
          if ([
            "/src/core.ts",
            "/src/ui.tsx",
            "/src/image-container-spec.ts",
            "/src/image-container-graph.ts",
            "/src/image-container.ts",
            "/src/paste-blocks.ts",
            "/src/settings-persistence.ts"
          ].some((suffix) => normalizedId.endsWith(suffix))) return "studio-shared";
          if (normalizedId.includes("/src/ui/")) return "studio-shared";
          if (/\/lucide-react\/dist\/esm\/icons\/(?:check|image|rotate-ccw|send|shield|trash-2|workflow)\.js$/.test(normalizedId)) {
            return "studio-shared";
          }
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
}));
