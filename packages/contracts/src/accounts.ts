/**
 * @management-lite/contracts - accounts
 * Types and DTOs for Managed Accounts & Secrets (ACC-01 V0.1 / V0.2)
 * Canonical references: 02_MODULE_REGISTRY.md, 18_SEC02_SECURITY_ARCHITECTURE.md,
 * 20_DBREADY_TABLES_AND_COLUMNS.md, 25_APIREADY_ENDPOINT_MATRIX.md, 36_APISYNC_NORMATIVE_CONTRACTS.md
 */

export type AccountPlatform =
  'tiktok' | 'gmail' | 'ai' | 'pm' | 'other' | string;

export type AccountStatus = 'active' | 'archived';

export type AccountSecretType =
  'password' | 'api_key' | 'recovery_code' | 'totp_secret' | string;

export interface ManagedAccountData {
  id: string;
  workspace_id: string;
  platform: AccountPlatform;
  username?: string | null | undefined;
  platform_account_id?: string | null | undefined;
  status: AccountStatus;
  notes?: string | null | undefined;
  version: number;
  created_at: string; // ISO 8601 UTC
  updated_at?: string | null | undefined;
}

export interface ManagedAccountDetailData extends ManagedAccountData {
  has_secret?: boolean | undefined;
  secret_types?: AccountSecretType[] | undefined;
}

export interface CreateAccountRequest {
  platform: AccountPlatform;
  username?: string | null | undefined;
  platform_account_id?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface UpdateAccountRequest {
  username?: string | null | undefined;
  platform_account_id?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface ArchiveAccountRequest {
  reason?: string | null | undefined;
}

export interface PutAccountSecretRequest {
  secret_type: AccountSecretType;
  secret_value: string;
  reauth_proof: string;
}

export interface PutAccountSecretResponseData {
  secret_version: number;
  updated_at: string;
}

export interface RevealAccountSecretRequest {
  secret_type: AccountSecretType;
  reauth_proof: string;
}

export interface RevealAccountSecretResponseData {
  secret_value: string;
}

export interface AccountListResponseData {
  items: ManagedAccountData[];
  total: number;
}
