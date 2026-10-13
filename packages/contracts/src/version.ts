/**
 * Canonical Application Version Source
 * Management Lite Single Source of Truth
 */
export const SYSTEM_NAME = 'Management Lite';
export const SYSTEM_VERSION = '0.1.0-dev';
export const SYSTEM_COMMIT = 'ab7500c';
export const SYSTEM_ENV = 'staging';

export interface SystemInfo {
  name: string;
  version: string;
  commit: string;
  environment: string;
}

export const getSystemInfo = (): SystemInfo => ({
  name: SYSTEM_NAME,
  version: SYSTEM_VERSION,
  commit: SYSTEM_COMMIT,
  environment: SYSTEM_ENV,
});
