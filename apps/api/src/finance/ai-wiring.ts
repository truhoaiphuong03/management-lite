import {
  AiCore,
  GeminiProvider,
  loadGeminiConfig,
  type AiProvider,
} from '../ai-core/index.js';
import type { FinAiContext, FinanceService } from './service.js';

export interface AiWiringLogger {
  warn(message: string): void;
}
/**
 * Builds the single process-wide AI Core for FIN, or `undefined` when Gemini is not configured.
 * Secrets arrive only through the explicit `env` argument and are never logged. An absent or
 * invalid configuration never prevents manual FIN from starting: "Đọc bằng AI" reports
 * `unavailable` instead. FIN never builds a second provider: this uses AI Core's own.
 */
export function createFinanceAiCore(
  env: Readonly<Record<string, string | undefined>>,
  authorize: FinanceService['aiAuthorizer'],
  logger: AiWiringLogger = console,
  provider?: AiProvider,
): AiCore<FinAiContext> | undefined {
  if (!provider && !env['GEMINI_API_KEY'] && !env['GEMINI_MODEL'])
    return undefined; // not configured: manual FIN only
  try {
    if (provider) return new AiCore<FinAiContext>(provider, authorize);
    const config = loadGeminiConfig(env);
    return new AiCore<FinAiContext>(
      new GeminiProvider(config),
      authorize,
      config.timeoutMs,
    );
  } catch {
    logger.warn(
      'FIN AI disabled: Gemini configuration is invalid (manual entry unaffected)',
    );
    return undefined;
  }
}
