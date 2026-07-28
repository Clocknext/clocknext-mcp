import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  dts: false,
  // Bundle ALL deps into a single self-contained file so it runs with just
  // `node dist/index.js` — no node_modules. Required for the Claude Code plugin
  // (the plugin cache does not run `npm install`) and for a clean npx bin.
  noExternal: [/.*/],
  // Make the built entry directly executable as the `clocknext-mcp` bin.
  banner: { js: "#!/usr/bin/env node" },
});
