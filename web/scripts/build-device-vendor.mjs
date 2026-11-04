import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(webRoot, "../frontend/vendor/device-storage");
const expectedOutputRoot = resolve(webRoot, "../frontend/vendor/device-storage");
if (outputRoot !== expectedOutputRoot) throw new Error("Unexpected device storage output path");
const sourceFiles = ["package.json", "scripts/build-device-vendor.mjs", "src/device-vendor.ts"];
const expected = { idb: "8.0.4", fflate: "0.8.3" };

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function checkedPath(base, path) {
  const resolved = resolve(base, path);
  const rel = relative(base, resolved);
  if (!rel || rel.startsWith("..") || resolve(base, rel) !== resolved) throw new Error(`Path escapes its allowed root: ${path}`);
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
    target: "es2022",
    outDir: outputRoot,
    emptyOutDir: false,
    copyPublicDir: false,
    sourcemap: false,
    minify: true,
    lib: { entry: checkedPath(webRoot, "src/device-vendor.ts"), formats: ["es"], fileName: () => "device-storage.js" }
  }
});

const packageJson = JSON.parse(await readFile(resolve(webRoot, "package.json"), "utf8"));
const lockBytes = await readFile(resolve(webRoot, "package-lock.json"));
const lock = JSON.parse(lockBytes.toString("utf8"));
const licenses = [];
for (const [name, version] of Object.entries(expected)) {
  if (packageJson.dependencies[name] !== version) throw new Error(`Unexpected ${name} version: ${packageJson.dependencies[name]}`);
  if (lock.packages[`node_modules/${name}`]?.version !== version) throw new Error(`package-lock.json does not pin ${name}@${version}`);
  const packageRoot = resolve(webRoot, "node_modules", name);
  const metadata = JSON.parse(await readFile(checkedPath(packageRoot, "package.json"), "utf8"));
  if (metadata.version !== version) throw new Error(`Installed ${name} version is ${metadata.version}`);
  licenses.push(`${name}@${version}\n${(await readFile(checkedPath(packageRoot, "LICENSE"), "utf8")).trimEnd()}\n`);
}
const sourceSha256 = {};
for (const path of sourceFiles) sourceSha256[path] = sha256(await readFile(checkedPath(webRoot, path)));
await mkdir(outputRoot, { recursive: true });
const licenseName = "THIRD-PARTY-LICENSES.txt";
await writeFile(outputPath(licenseName), `${licenses.join("\n")}\n`, "utf8");
const files = {};
for (const name of ["device-storage.js", licenseName]) {
  const bytes = await readFile(outputPath(name));
  files[name] = { byte_size: bytes.byteLength, sha256: sha256(bytes) };
}
const manifest = { packages: expected, package_lock_sha256: sha256(lockBytes), source_sha256: sourceSha256, files };
await writeFile(outputPath("manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
