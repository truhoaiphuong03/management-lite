import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AiCoreError } from './contract.js';
import type { ReceiptInput } from './contract.js';

let active = 0;
/** Internal decoder boundary, not part of the public AI contract. */
export async function decodeReceiptImage(
  image: ReceiptInput['image'],
  signal: AbortSignal,
  options: {
    timeoutMs?: number;
    worker?: URL;
    onSpawn?: (pid: number) => void;
  } = {},
): Promise<ReceiptInput['image']> {
  if (signal.aborted) throw new AiCoreError('AI_CANCELLED');
  if (active >= 2) throw new AiCoreError('AI_BUSY');
  if (
    image.bytes.length > 4 * 1024 * 1024 ||
    !['image/png', 'image/jpeg'].includes(image.mimeType)
  )
    throw new AiCoreError('AI_INVALID_INPUT');
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--max-old-space-size=96',
          fileURLToPath(
            options.worker ?? new URL('./image-worker.js', import.meta.url),
          ),
          image.mimeType,
        ],
        {
          stdio: ['pipe', 'pipe', 'ignore'],
          env: { VIPS_CONCURRENCY: '1', UV_THREADPOOL_SIZE: '1' },
        },
      );
      const chunks: Buffer[] = [];
      let size = 0;
      let failure: AiCoreError | undefined;
      const stop = (code: ConstructorParameters<typeof AiCoreError>[0]) => {
        failure ??= new AiCoreError(code);
        child.kill('SIGKILL');
      };
      const abort = () => stop('AI_CANCELLED');
      const timer = setTimeout(
        () => stop('AI_TIMEOUT'),
        options.timeoutMs ?? 3000,
      );
      signal.addEventListener('abort', abort, { once: true });
      child.on('error', () => {
        failure ??= new AiCoreError('AI_NOT_CONFIGURED');
      });
      child.stdin.on('error', () => {
        /* child exit is handled by close */
      });
      child.stdout.on('data', (b: Buffer) => {
        size += b.length;
        if (size > 4 * 1024 * 1024) stop('AI_INVALID_INPUT');
        else chunks.push(b);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (failure) reject(failure);
        else if (code !== 0 || !size)
          reject(new AiCoreError('AI_INVALID_INPUT'));
        else
          resolve({ mimeType: image.mimeType, bytes: Buffer.concat(chunks) });
      });
      if (child.pid) options.onSpawn?.(child.pid);
      if (signal.aborted) abort();
      else child.stdin.end(image.bytes);
    });
  } finally {
    active--;
  }
}
