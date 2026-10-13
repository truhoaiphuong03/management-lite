/** Server-local AI contract. No HTTP exposure or shared FIN contract change. */
export const RECEIPT_FIELDS = [
  'amount',
  'currency',
  'date',
  'time',
  'merchant',
  'description',
  'direction',
  'categoryId',
] as const;
export type ReceiptField = (typeof RECEIPT_FIELDS)[number];
export interface Observation {
  value: string | null;
  /** Short visible excerpt supporting the value, never an instruction. */
  evidence: string | null;
}
export interface ReceiptDraft {
  fields: Record<ReceiptField, Observation>;
  uncertainties: {
    field: ReceiptField;
    reason: 'missing' | 'unreadable' | 'ambiguous';
  }[];
}
export interface ReceiptInput {
  image: { mimeType: 'image/png' | 'image/jpeg'; bytes: Uint8Array };
  context: {
    categories: { id: string; name: string; direction: 'income' | 'expense' }[];
  };
}
export interface OwnerPrincipal {
  userId: string;
  workspaceId: string;
  role: 'owner';
}
/** Must resolve CURRENT trusted session server-side. Never derive from body/headers alone. */
export type AuthorizeOwner<C> = (
  context: C,
  signal: AbortSignal,
) => Promise<OwnerPrincipal | null>;
export interface AiProvider {
  extractReceipt(input: ReceiptInput, signal: AbortSignal): Promise<unknown>;
}
export type AiErrorCode =
  | 'AI_UNAUTHORIZED'
  | 'AI_INVALID_INPUT'
  | 'AI_INVALID_OUTPUT'
  | 'AI_NOT_CONFIGURED'
  | 'AI_RATE_LIMITED'
  | 'AI_BUSY'
  | 'AI_TIMEOUT'
  | 'AI_CANCELLED'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_PROVIDER_REJECTED';
export class AiCoreError extends Error {
  constructor(public readonly code: AiErrorCode) {
    super(code);
    this.name = 'AiCoreError';
  }
}

const observation = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'evidence'],
  properties: {
    value: { type: ['string', 'null'] },
    evidence: { type: ['string', 'null'] },
  },
};
export const RECEIPT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['fields', 'uncertainties'],
  properties: {
    fields: {
      type: 'object',
      additionalProperties: false,
      required: [...RECEIPT_FIELDS],
      properties: Object.fromEntries(
        RECEIPT_FIELDS.map((field) => [field, observation]),
      ),
    },
    uncertainties: {
      type: 'array',
      maxItems: RECEIPT_FIELDS.length,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'reason'],
        properties: {
          field: { type: 'string', enum: [...RECEIPT_FIELDS] },
          reason: {
            type: 'string',
            enum: ['missing', 'unreadable', 'ambiguous'],
          },
        },
      },
    },
  },
};
