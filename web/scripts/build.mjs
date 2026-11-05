import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(webRoot, "../frontend/vendor/workspace-shell");
const expectedOutputRoot = resolve(webRoot, "../frontend/vendor/workspace-shell");
if (outputRoot !== expectedOutputRoot) throw new Error("Unexpected workspace shell output path");

const sourceFiles = [
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "scripts/build.mjs",
  "src/index.tsx",
  "src/header-settings.tsx",
  "src/guest-access.tsx",
  "src/translation.tsx",
  "src/flow-reading.tsx",
  "src/flow-sentences.ts",
  "src/source-preparation.tsx"
];
const runtimePackages = ["react", "react-dom", "scheduler"];

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
  configFile: resolve(webRoot, "vite.config.ts"),
  mode: "production"
});

const packageJson = JSON.parse(await readFile(resolve(webRoot, "package.json"), "utf8"));
const lockBytes = await readFile(resolve(webRoot, "package-lock.json"));
const sourceSha256 = {};
for (const path of sourceFiles) {
  sourceSha256[path] = sha256(await readFile(checkedPath(webRoot, path)));
}

const licenses = [];
const versions = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies
};
for (const name of runtimePackages) {
  const packageRoot = resolve(webRoot, "node_modules", ...name.split("/"));
  const metadata = JSON.parse(await readFile(checkedPath(packageRoot, "package.json"), "utf8"));
  const license = await readFile(checkedPath(packageRoot, "LICENSE"), "utf8");
  versions[name] = metadata.version;
  licenses.push(`${name}@${metadata.version}\n${license.trimEnd()}\n`);
}

await mkdir(outputRoot, { recursive: true });
const licenseName = "THIRD-PARTY-LICENSES.txt";
await writeFile(outputPath(licenseName), `${licenses.join("\n")}\n`, "utf8");

const files = {};
for (const name of ["workspace-shell.js", licenseName]) {
  const bytes = await readFile(outputPath(name));
  files[name] = { byte_size: bytes.byteLength, sha256: sha256(bytes) };
}
const manifest = {
  packages: versions,
  package_lock_sha256: sha256(lockBytes),
  source_sha256: sourceSha256,
  files
};
await writeFile(outputPath("manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
