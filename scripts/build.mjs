import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const isDev = process.argv.includes("--dev");

const buildDir = path.resolve("build");
const addonDir = path.resolve("addon");

// Clean build directory
if (fs.existsSync(buildDir)) {
  fs.rmSync(buildDir, { recursive: true });
}
fs.mkdirSync(buildDir, { recursive: true });

// Bundle TypeScript source
await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "build/addon/content/index.js",
  format: "iife",
  globalName: "LLMMetadata",
  target: "firefox115",
  platform: "browser",
  sourcemap: isDev,
  minify: !isDev,
  define: {
    "process.env.NODE_ENV": isDev ? '"development"' : '"production"',
  },
  external: [],
});

// Copy addon directory to build
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDirSync(addonDir, path.join(buildDir, "addon"));

// Read manifest for version info
const manifest = JSON.parse(
  fs.readFileSync(path.join(addonDir, "manifest.json"), "utf-8")
);

// Create install.rdf is not needed for Zotero 7 (manifest.json is used)
// Build XPI
const xpiName = `llm-metadata-extractor-${manifest.version}.xpi`;
const xpiPath = path.join(buildDir, xpiName);

// Create XPI (zip) from the addon build directory
const addonBuildDir = path.join(buildDir, "addon");
try {
  execSync(`cd "${addonBuildDir}" && zip -r "${xpiPath}" .`, {
    stdio: "pipe",
  });
  console.log(`Built: ${xpiPath}`);
} catch (e) {
  console.log("Note: zip command not available, skipping XPI packaging.");
  console.log(`Built to: ${addonBuildDir}`);
}

if (isDev) {
  console.log("Dev mode: watching for changes...");
  const ctx = await esbuild.context({
    entryPoints: ["src/index.ts"],
    bundle: true,
    outfile: "build/addon/content/index.js",
    format: "iife",
    globalName: "LLMMetadata",
    target: "firefox115",
    platform: "browser",
    sourcemap: true,
  });
  await ctx.watch();
}
