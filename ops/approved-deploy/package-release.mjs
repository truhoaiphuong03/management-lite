// CI packaging only. No deployment, migration, secret copying or server access.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import { digest, inventory } from "./deploy-core.mjs";
const root = process.cwd(),
  sha = process.env.RELEASE_COMMIT;
if (!/^[a-f0-9]{40}$/.test(sha || ""))
  throw Error("EXACT_RELEASE_COMMIT_REQUIRED");
if (
  cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !==
  sha
)
  throw Error("CHECKOUT_COMMIT_MISMATCH");
const output = path.join(root, "release-output");
if (fs.existsSync(output)) throw Error("OUTPUT_EXISTS");
const payload = path.join(output, "payload");
fs.mkdirSync(payload, { recursive: true });
for (const [source, dest] of [
  ["dist", "dist"],
  ["apps/web/dist", "web"],
])
  fs.cpSync(path.join(root, source), path.join(payload, dest), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
// Use the committed lockfile; exclude workspace links and dev-only dependencies.
const lock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);
for (const [rel, meta] of Object.entries(lock.packages).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  if (
    !rel.startsWith("node_modules/") ||
    meta.dev === true ||
    meta.link === true
  )
    continue;
  const from = path.join(root, rel),
    to = path.join(payload, rel);
  if (!fs.existsSync(from)) {
    if (meta.optional === true) continue;
    throw Error("RUNTIME_DEPENDENCY_MISSING");
  }
  if (!fs.existsSync(to))
    fs.cpSync(from, to, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
}
fs.writeFileSync(
  path.join(payload, "package.json"),
  JSON.stringify({ type: "module", private: true }),
);
const schemaSHA256 = digest(
  fs.readFileSync(
    path.join(root, "dist/packages/database/src/migrations/catalog.js"),
  ),
);
const files = inventory(payload);
const manifest = {
  repository: "truhoaiphuong03/management-lite",
  repositoryId: 1410248474,
  commit: sha,
  schemaSHA256,
  migration: "none",
  files,
};
fs.writeFileSync(
  path.join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  JSON.stringify({
    commit: sha,
    schemaSHA256,
    files: files.length,
    output: "release-output",
  }),
);
