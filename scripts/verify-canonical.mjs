import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const root = new URL('../docs/canonical/', import.meta.url);
const bytes = readFileSync(new URL('manifest.json', root));
const hash = (data) => createHash('sha256').update(data).digest('hex');
if (
  hash(bytes) !==
  'b3893a826e359a95b0a8fa0a8a15dfc4c2109f43c011284e06898c969830b436'
)
  throw new Error('Canonical manifest changed');
const manifest = JSON.parse(bytes);
if (manifest.version !== '0.1.0-doc.19')
  throw new Error('Wrong canonical version');
for (const [path, expected] of Object.entries(manifest.documents)) {
  if (hash(readFileSync(new URL(path, root))) !== expected)
    throw new Error(`Canonical mismatch: ${path}`);
}
console.log(
  `Canonical PASS: ${manifest.version}, ${Object.keys(manifest.documents).length} document hashes`,
);
