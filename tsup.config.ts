import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  dts: false,
  // Make the built entry directly executable as the `clocknext-mcp` bin.
  banner: { js: "#!/usr/bin/env node" },
});
