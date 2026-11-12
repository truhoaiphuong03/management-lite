/**
 * Canonical Application Version Source
 * Management Lite Single Source of Truth
 */
export const SYSTEM_NAME = 'Management Lite';
export const SYSTEM_VERSION = '0.9.22';
export const SYSTEM_COMMIT = '18fc733';
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

export interface ReleaseNoteItem {
  version: string;
  commit: string;
  released_at: string;
  summary: string;
  added: string[];
  improved: string[];
  fixed: string[];
}

export interface ReleaseHistoryEntry extends ReleaseNoteItem {
  is_current: boolean;
}

export { RELEASE_NOTES_CATALOG } from './release-notes-catalog.js';
