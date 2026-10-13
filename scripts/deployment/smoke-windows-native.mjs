// Offline native dependency proof. No database, account or provider calls.
import assert from 'node:assert/strict';
if (
  process.platform !== 'win32' ||
  process.arch !== 'x64' ||
  process.versions.node !== '22.14.0'
)
  throw new Error('Windows x64 Node 22.14.0 required');
const { hash, verify } = await import('@node-rs/argon2');
const { default: sharp } = await import('sharp');
const fixture = 'public-synthetic-native-smoke-fixture';
assert.equal(await verify(await hash(fixture), fixture), true);
const png = await sharp({
  create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
})
  .png()
  .toBuffer();
assert.equal((await sharp(png).metadata()).width, 1);
console.log('PASS Windows native Argon2 + sharp; no database access');
