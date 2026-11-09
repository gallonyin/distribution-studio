import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("dist-electron", { recursive: true });
copyFileSync("electron/toolbar.html", "dist-electron/toolbar.html");
await build({
  entryPoints: ["electron/toolbar-preload.ts"],
  outfile: "dist-electron/toolbar-preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
await build({
  entryPoints: ["electron/main.ts"],
  outfile: "dist-electron/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
});
await build({
  entryPoints: ["electron/preload.ts"],
  outfile: "dist-electron/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
await build({
  entryPoints: ["electron/inject.ts"],
  outfile: "dist-electron/inject.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "StudioAdapter",
});
