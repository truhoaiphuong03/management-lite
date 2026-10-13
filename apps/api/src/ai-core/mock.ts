import type { AiProvider, ReceiptDraft } from './contract.js';
import { RECEIPT_FIELDS } from './contract.js';
/** Deterministic empty extraction. No environment, fetch, filesystem or persistence. */
export class MockAiProvider implements AiProvider {
  constructor(
    private readonly output: unknown = {
      fields: Object.fromEntries(
        RECEIPT_FIELDS.map((field) => [field, { value: null, evidence: null }]),
      ) as ReceiptDraft['fields'],
      uncertainties: RECEIPT_FIELDS.map((field) => ({
        field,
        reason: 'unreadable',
      })),
    } satisfies ReceiptDraft,
  ) {}
  async extractReceipt(): Promise<unknown> {
    return structuredClone(this.output);
  }
}
