import esbuild from "esbuild";
import { readFileSync } from "node:fs";

const watch = process.argv.includes("--watch");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  minify: false,
  logLevel: "info",
  define: {
    __EXT_VERSION__: JSON.stringify(pkg.version),
  },
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
