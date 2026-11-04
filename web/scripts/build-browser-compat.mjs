import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(webRoot, "../frontend/vendor/browser-compat");
const expectedOutputRoot = resolve(webRoot, "../frontend/vendor/browser-compat");
if (outputRoot !== expectedOutputRoot) throw new Error("Unexpected browser compatibility output path");

const sourceFiles = [
  "package.json",
  "scripts/build-browser-compat.mjs",
  "src/browser-compat.ts"
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function checkedPath(base, path) {
  const resolved = resolve(base, path);
  const rel = relative(base, resolved);
  if (!rel || rel.startsWith("..") || resolve(base, rel) !== resolved) {
    throw new Error(`Path escapes its allowed root: ${path}`);
  }
  return resolved;
}

function outputPath(name) {
  if (name.includes("/") || name.includes("\\")) throw new Error(`Unexpected output name: ${name}`);
  return checkedPath(outputRoot, name);
}

await build({
  configFile: false,
  root: webRoot,
  publicDir: false,
  mode: "production",
  build: {
    target: "es2015",
    outDir: outputRoot,
    emptyOutDir: false,
    copyPublicDir: false,
    sourcemap: false,
    minify: true,
    lib: {
      entry: checkedPath(webRoot, "src/browser-compat.ts"),
      formats: ["es"],
      fileName: () => "browser-compat.js"
    }
  }
});

const packageJson = JSON.parse(await readFile(resolve(webRoot, "package.json"), "utf8"));
const coreJsVersion = packageJson.dependencies["core-js"];
if (coreJsVersion !== "3.50.0") throw new Error(`Unexpected core-js version: ${coreJsVersion}`);

const lockBytes = await readFile(resolve(webRoot, "package-lock.json"));
const lock = JSON.parse(lockBytes.toString("utf8"));
if (lock.packages["node_modules/core-js"]?.version !== coreJsVersion) {
  throw new Error("package-lock.json does not pin the expected core-js version");
}

const packageRoot = resolve(webRoot, "node_modules/core-js");
const metadata = JSON.parse(await readFile(checkedPath(packageRoot, "package.json"), "utf8"));
if (metadata.version !== coreJsVersion) throw new Error(`Installed core-js version is ${metadata.version}`);

const sourceSha256 = {};
for (const path of sourceFiles) {
  sourceSha256[path] = sha256(await readFile(checkedPath(webRoot, path)));
}

await mkdir(outputRoot, { recursive: true });
await writeFile(outputPath("LICENSE"), await readFile(checkedPath(packageRoot, "LICENSE")));

const files = {};
for (const name of ["browser-compat.js", "LICENSE"]) {
  const bytes = await readFile(outputPath(name));
  files[name] = { byte_size: bytes.byteLength, sha256: sha256(bytes) };
}
const manifest = {
  packages: { "core-js": coreJsVersion },
  package_lock_sha256: sha256(lockBytes),
  source_sha256: sourceSha256,
  files
};
await writeFile(outputPath("manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
