import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;
export type ReceiptMime = 'image/jpeg' | 'image/png';
export type ReceiptRejection =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'TYPE_MISMATCH'
  | 'MALFORMED_IMAGE';
export type ReceiptCheck =
  | {
      ok: true;
      mime: ReceiptMime;
      ext: 'jpg' | 'png';
      sha256: string;
      size: number;
    }
  | { ok: false; reason: ReceiptRejection };
const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
} as const;
const ascii = (b: Uint8Array, s: number, e: number) =>
  String.fromCharCode(...b.slice(s, e));
function sniff(b: Uint8Array): ReceiptMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return 'image/jpeg';
  if (
    b.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)
  )
    return 'image/png';
  return null;
}
/** Lightweight structural check; it is not a full decoder. */
function wellFormed(b: Uint8Array, mime: ReceiptMime): boolean {
  if (mime === 'image/jpeg')
    return b.length > 4 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
  if (mime === 'image/png')
    return (
      b.length >= 45 &&
      ascii(b, 12, 16) === 'IHDR' &&
      ascii(b, b.length - 8, b.length - 4) === 'IEND'
    );
  return false;
}
/** Server-side authority: the declared Content-Type is only compared, never trusted. */
export function validateReceiptUpload(
  bytes: Uint8Array,
  declaredType?: string,
): ReceiptCheck {
  if (bytes.length === 0) return { ok: false, reason: 'EMPTY' };
  if (bytes.length > RECEIPT_MAX_BYTES)
    return { ok: false, reason: 'TOO_LARGE' };
  const mime = sniff(bytes);
  if (!mime) return { ok: false, reason: 'UNSUPPORTED_TYPE' };
  if (
    declaredType !== undefined &&
    declaredType.split(';')[0]!.trim().toLowerCase() !== mime
  )
    return { ok: false, reason: 'TYPE_MISMATCH' };
  if (!wellFormed(bytes, mime)) return { ok: false, reason: 'MALFORMED_IMAGE' };
  return {
    ok: true,
    mime,
    ext: EXT[mime],
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REL = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}\.(jpg|png)$/;
export class ReceiptStoreError extends Error {
  constructor(public code: 'BAD_ROOT' | 'BAD_ID' | 'BAD_PATH' | 'NOT_FOUND') {
    super(code);
  }
}
/**
 * Private, content-addressed receipt storage on a local filesystem. The root must be absolute,
 * outside every forbidden (e.g. public web) root; directories are 0700 and files 0600.
 */
export class ReceiptStore {
  readonly root: string;
  constructor(root: string, forbiddenRoots: readonly string[] = []) {
    if (!isAbsolute(root)) throw new ReceiptStoreError('BAD_ROOT');
    this.root = resolve(root);
    for (const f of forbiddenRoots) {
      const rel = relative(resolve(f), this.root);
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))
        throw new ReceiptStoreError('BAD_ROOT');
    }
  }
  private abs(rel: string): string {
    if (!REL.test(rel)) throw new ReceiptStoreError('BAD_PATH');
    const p = resolve(this.root, rel);
    if (!p.startsWith(this.root + sep)) throw new ReceiptStoreError('BAD_PATH');
    return p;
  }
  relPath(
    workspaceId: string,
    ownerId: string,
    c: { sha256: string; ext: string },
  ): string {
    if (!UUID.test(workspaceId) || !UUID.test(ownerId))
      throw new ReceiptStoreError('BAD_ID');
    return `${workspaceId}/${ownerId}/${c.sha256}.${c.ext}`;
  }
  /** Atomic write (temp + fsync + rename). An identical existing file is left untouched. */
  async put(rel: string, bytes: Uint8Array): Promise<{ created: boolean }> {
    const target = this.abs(rel);
    try {
      if ((await stat(target)).size === bytes.length) return { created: false };
    } catch {
      /* not present */
    }
    const dir = resolve(target, '..');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = join(dir, `.${randomUUID()}.tmp`);
    const fh = await open(tmp, 'wx', 0o600);
    try {
      await fh.writeFile(bytes);
      await fh.sync();
    } catch (e) {
      await fh.close();
      await rm(tmp, { force: true });
      throw e;
    }
    await fh.close();
    await rename(tmp, target);
    return { created: true };
  }
  async get(rel: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(this.abs(rel)));
    } catch (e) {
      if (e instanceof ReceiptStoreError) throw e;
      throw new ReceiptStoreError('NOT_FOUND');
    }
  }
  /** Stored keys (ws/owner/sha.ext), at most `limit`; temp and foreign names are ignored. */
  async list(limit: number): Promise<string[]> {
    const out: string[] = [];
    const dirs = async (p: string) => {
      try {
        return await readdir(p, { withFileTypes: true });
      } catch {
        return [];
      }
    };
    for (const ws of await dirs(this.root)) {
      if (!ws.isDirectory() || !UUID.test(ws.name)) continue;
      for (const owner of await dirs(join(this.root, ws.name))) {
        if (!owner.isDirectory() || !UUID.test(owner.name)) continue;
        for (const f of await dirs(join(this.root, ws.name, owner.name))) {
          const rel = `${ws.name}/${owner.name}/${f.name}`;
          if (f.isFile() && REL.test(rel)) out.push(rel);
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  }
  async delete(rel: string): Promise<void> {
    await rm(this.abs(rel), { force: true });
  }
}
