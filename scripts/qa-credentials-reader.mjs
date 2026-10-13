import { parseEnv } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

export const DEFAULT_QA_CREDENTIALS_FILE = '.env.qa-credentials.local';

/**
 * Authoritative Acceptance Actor Definitions.
 * Strict RBAC & Tenant context binding:
 * - Acceptance Owner = admin (2a565b98-868c-4d8b-821e-fdd9da94dacc)
 * - Acceptance Staff = staff (13b98f3e-5292-4d9f-a91f-517d2b98c17d)
 */
export const ACCEPTANCE_ACTORS = Object.freeze({
  OWNER: Object.freeze({
    id: '2a565b98-868c-4d8b-821e-fdd9da94dacc',
    identifier: 'admin',
    credentialKey: 'ADMIN_PASSWORD',
  }),
  STAFF: Object.freeze({
    id: '13b98f3e-5292-4d9f-a91f-517d2b98c17d',
    identifier: 'staff',
    credentialKey: 'STAFF_PASSWORD',
  }),
});

/**
 * Loads and parses QA credentials exclusively using standard node:util.parseEnv.
 * Precedence Rule:
 *   The explicit QA credentials file is the MANDATORY source of truth for acceptance.
 *   Process environment variables (process.env) are NEVER silently used to override
 *   or substitute for credentials.
 * Fail-Closed Rule:
 *   Missing file, corrupted file, or missing/empty required keys immediately throw
 *   an error and abort execution.
 *
 * @param {string} [filePath=DEFAULT_QA_CREDENTIALS_FILE] - Path to the QA credentials file.
 * @param {object} [options={}] - Options object.
 * @param {string[]} [options.requiredKeys=[]] - Array of required keys that must be non-empty strings.
 * @returns {Record<string, string>} Parsed key-value map.
 */
export function loadQaCredentials(
  filePath = DEFAULT_QA_CREDENTIALS_FILE,
  options = {},
) {
  const targetPath = isAbsolute(filePath)
    ? filePath
    : resolve(PROJECT_ROOT, filePath);

  if (!existsSync(targetPath)) {
    throw new Error(
      `[QA Credentials Error] Explicit QA credentials file not found: ${targetPath}. Source file is mandatory for acceptance.`,
    );
  }

  const raw = readFileSync(targetPath, 'utf8');
  let env;
  try {
    env = parseEnv(raw);
  } catch (err) {
    throw new Error(
      `[QA Credentials Error] Failed to parse QA credentials file at ${targetPath}: ${err.message}`,
    );
  }

  if (options.requiredKeys && Array.isArray(options.requiredKeys)) {
    for (const key of options.requiredKeys) {
      const val = env[key];
      if (typeof val !== 'string' || val.trim() === '') {
        throw new Error(
          `[QA Credentials Error] Missing or empty required credential key "${key}" in ${targetPath}. Fail-closed.`,
        );
      }
    }
  }

  return env;
}

/**
 * Obtains exact Acceptance Owner credentials (admin).
 * Enforces exact actor identity and fail-closed validation.
 * No fallback to 'owner', no fallback to hardcoded passwords.
 *
 * @param {string} [filePath=DEFAULT_QA_CREDENTIALS_FILE]
 * @returns {{ id: string, identifier: string, password: string }}
 */
export function getAcceptanceOwnerCredentials(
  filePath = DEFAULT_QA_CREDENTIALS_FILE,
) {
  const env = loadQaCredentials(filePath, {
    requiredKeys: [ACCEPTANCE_ACTORS.OWNER.credentialKey],
  });

  return {
    id: ACCEPTANCE_ACTORS.OWNER.id,
    identifier: ACCEPTANCE_ACTORS.OWNER.identifier,
    password: env[ACCEPTANCE_ACTORS.OWNER.credentialKey],
  };
}

/**
 * Obtains exact Acceptance Staff credentials (staff).
 * Enforces exact actor identity and fail-closed validation.
 * No fallback to hardcoded passwords or alternative accounts.
 *
 * @param {string} [filePath=DEFAULT_QA_CREDENTIALS_FILE]
 * @returns {{ id: string, identifier: string, password: string }}
 */
export function getAcceptanceStaffCredentials(
  filePath = DEFAULT_QA_CREDENTIALS_FILE,
) {
  const env = loadQaCredentials(filePath, {
    requiredKeys: [ACCEPTANCE_ACTORS.STAFF.credentialKey],
  });

  return {
    id: ACCEPTANCE_ACTORS.STAFF.id,
    identifier: ACCEPTANCE_ACTORS.STAFF.identifier,
    password: env[ACCEPTANCE_ACTORS.STAFF.credentialKey],
  };
}
