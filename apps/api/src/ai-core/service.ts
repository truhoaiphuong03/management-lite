import { AiCoreError } from './contract.js';
import type {
  AiProvider,
  AuthorizeOwner,
  OwnerPrincipal,
  ReceiptDraft,
} from './contract.js';
import { validateReceiptInput, validateReceiptDraft } from './validation.js';
import { decodeReceiptImage } from './image.js';

/** One singleton per server process. Never instantiate per request. */
export class AiCoreService<C> {
  #provider: AiProvider;
  #authorize: AuthorizeOwner<C>;
  #buckets = new Map<string, { start: number; count: number }>();
  #active = 0;
  constructor(
    provider: AiProvider,
    authorizeOwner: AuthorizeOwner<C>,
    private readonly timeoutMs = 15000,
  ) {
    if (
      typeof authorizeOwner !== 'function' ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 10 ||
      timeoutMs > 30000
    )
      throw new AiCoreError('AI_NOT_CONFIGURED');
    this.#provider = provider;
    this.#authorize = authorizeOwner;
  }
  private async principal(
    context: C,
    signal: AbortSignal,
  ): Promise<OwnerPrincipal> {
    try {
      const p = await this.#authorize(context, signal);
      if (
        !p ||
        p.role !== 'owner' ||
        !/^[0-9a-f-]{36}$/i.test(p.userId) ||
        !/^[0-9a-f-]{36}$/i.test(p.workspaceId)
      )
        throw new Error();
      return { userId: p.userId, workspaceId: p.workspaceId, role: 'owner' };
    } catch {
      throw new AiCoreError('AI_UNAUTHORIZED');
    }
  }
  private admit(p: OwnerPrincipal): void {
    const now = Date.now();
    for (const [key, b] of this.#buckets)
      if (now - b.start >= 60000) this.#buckets.delete(key);
    const key = `${p.workspaceId}:${p.userId}`,
      b = this.#buckets.get(key);
    if (b && b.count >= 5) throw new AiCoreError('AI_RATE_LIMITED');
    if (!b && this.#buckets.size >= 1000) throw new AiCoreError('AI_BUSY');
    this.#buckets.set(key, {
      start: b?.start ?? now,
      count: (b?.count ?? 0) + 1,
    });
  }
  async extractReceipt(
    context: C,
    value: unknown,
    externalSignal?: AbortSignal,
  ): Promise<{ draft: ReceiptDraft; reviewRequired: true }> {
    const controller = new AbortController();
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, controller.signal])
      : controller.signal;
    let listener: (() => void) | undefined;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const aborted = new Promise<never>((_, reject) => {
      listener = () =>
        reject(
          new AiCoreError(
            externalSignal?.aborted ? 'AI_CANCELLED' : 'AI_TIMEOUT',
          ),
        );
      signal.addEventListener('abort', listener, { once: true });
    });
    const work = async () => {
      if (this.#active >= 2) throw new AiCoreError('AI_BUSY');
      this.#active++;
      try {
        if (signal.aborted) throw new AiCoreError('AI_CANCELLED');
        const input = validateReceiptInput(value);
        const owner = await this.principal(context, signal);
        signal.throwIfAborted();
        this.admit(owner);
        input.image = await decodeReceiptImage(input.image, signal);
        signal.throwIfAborted();
        const output = await this.#provider.extractReceipt(input, signal);
        signal.throwIfAborted();
        const draft = validateReceiptDraft(output, input);
        const current = await this.principal(context, signal);
        signal.throwIfAborted();
        if (
          owner.userId !== current.userId ||
          owner.workspaceId !== current.workspaceId
        )
          throw new AiCoreError('AI_UNAUTHORIZED');
        return { draft, reviewRequired: true as const };
      } finally {
        this.#active--;
      }
    };
    try {
      return await Promise.race([work(), aborted]);
    } catch (e) {
      if (signal.aborted)
        throw new AiCoreError(
          externalSignal?.aborted ? 'AI_CANCELLED' : 'AI_TIMEOUT',
        );
      if (e instanceof AiCoreError) throw e;
      throw new AiCoreError('AI_PROVIDER_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      if (listener) signal.removeEventListener('abort', listener);
    }
  }
}
