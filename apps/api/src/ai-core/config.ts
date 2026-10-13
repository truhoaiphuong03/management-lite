import { AiCoreError } from './contract.js';
export interface GeminiConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
}
/** Explicit env injection: does not read .env files or existing server config. */
export function loadGeminiConfig(
  env: Readonly<Record<string, string | undefined>>,
): GeminiConfig {
  const apiKey = env['GEMINI_API_KEY'],
    model = env['GEMINI_MODEL'];
  const timeout = env['AI_CORE_TIMEOUT_MS'] ?? '15000';
  if (
    !apiKey ||
    apiKey.length < 16 ||
    apiKey.length > 256 ||
    /\s|[^\x21-\x7e]/.test(apiKey) ||
    !model ||
    !/^gemini-[a-zA-Z0-9.-]{1,80}$/.test(model) ||
    !/^[0-9]+$/.test(timeout)
  )
    throw new AiCoreError('AI_NOT_CONFIGURED');
  const timeoutMs = Number(timeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000)
    throw new AiCoreError('AI_NOT_CONFIGURED');
  const result = { model, timeoutMs } as GeminiConfig;
  // Accidental JSON serialization does not disclose the key.
  Object.defineProperty(result, 'apiKey', { value: apiKey, enumerable: false });
  return Object.freeze(result);
}
