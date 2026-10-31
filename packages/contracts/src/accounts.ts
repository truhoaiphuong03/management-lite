/**
 * V0.6 ACC-ECOSYSTEM — Managed Accounts & Secrets Vault Contracts (C05 / SEC-02)
 */

export type AccountPlatform =
  | 'tiktok'
  | 'gmail'
  | 'facebook'
  | 'youtube'
  | 'authenticator'
  | 'recovery'
  | 'ai'
  | 'pm'
  | 'other';

export type AccountStatus = 'active' | 'archived';

export type AccountHealthStatus = 'healthy' | 'verify_required' | 'locked';

export type AccountSecretType =
  | 'password'
  | 'api_key'
  | 'recovery_code'
  | 'totp_secret'
  | 'two_fa_secret'
  | 'email_password';

export interface LinkedAccountSummary {
  id: string;
  platform: AccountPlatform;
  username: string | null;
  platform_account_id: string | null;
  status: AccountStatus;
  health_status?: AccountHealthStatus | undefined;
}

export interface PhoneUsageSummary {
  phone_number: string;
  phone_note: string | null;
  gmail_count: number;
  total_count: number;
  accounts: LinkedAccountSummary[];
}

export interface SecretHistoryMetadata {
  id: string;
  secret_type: AccountSecretType;
  secret_version: number;
  archived_at: string;
}

/**
 * Metadata-only representation of a Managed Account.
 * NEVER includes secret values, hashes, ciphertexts, or nonces.
 */
export interface ManagedAccountData {
  id: string;
  workspace_id: string;
  platform: AccountPlatform;
  platform_account_id: string | null;
  username: string | null;
  recovery_email: string | null;
  account_group: string | null;
  assigned_employee_id: string | null;
  assigned_employee_name: string | null;
  assigned_employee_code: string | null;
  status: AccountStatus;
  health_status?: AccountHealthStatus | undefined;
  phone_number?: string | null | undefined;
  phone_note?: string | null | undefined;
  phone_gmail_count?: number | undefined;
  phone_total_count?: number | undefined;
  parent_account_id?: string | null | undefined;
  parent_account_username?: string | null | undefined;
  parent_account_platform?: AccountPlatform | null | undefined;
  recovery_account_id?: string | null | undefined;
  recovery_account_username?: string | null | undefined;
  authenticator_account_id?: string | null | undefined;
  authenticator_account_username?: string | null | undefined;
  child_count?: number | undefined;
  child_platforms?: AccountPlatform[] | undefined;
  child_accounts?: LinkedAccountSummary[] | undefined;
  notes: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

/**
 * Detail representation of a Managed Account.
 * Includes boolean indicator `has_secret` and list of `secret_types` configured,
 * but NEVER the secret values themselves.
 */
export interface ManagedAccountDetailData extends ManagedAccountData {
  has_secret?: boolean | undefined;
  secret_types?: AccountSecretType[] | undefined;
  secret_history?: SecretHistoryMetadata[] | undefined;
  protected_accounts?: LinkedAccountSummary[] | undefined;
  same_phone_accounts?: LinkedAccountSummary[] | undefined;
}

export interface AccountListResponseData {
  items: ManagedAccountData[];
  total: number;
  phone_summaries?: PhoneUsageSummary[] | undefined;
}

export interface InitialSecretInput {
  secret_type: AccountSecretType;
  secret_value: string;
}

export interface CreateAccountRequest {
  platform: AccountPlatform;
  username?: string | null | undefined;
  platform_account_id?: string | null | undefined;
  recovery_email?: string | null | undefined;
  account_group?: string | null | undefined;
  assigned_employee_id?: string | null | undefined;
  status?: AccountStatus | undefined;
  health_status?: AccountHealthStatus | undefined;
  phone_number?: string | null | undefined;
  phone_note?: string | null | undefined;
  parent_account_id?: string | null | undefined;
  recovery_account_id?: string | null | undefined;
  authenticator_account_id?: string | null | undefined;
  create_child_platforms?: AccountPlatform[] | undefined;
  notes?: string | null | undefined;
  initial_secrets?: InitialSecretInput[] | undefined;
}

export interface UpdateAccountRequest {
  username?: string | null | undefined;
  platform_account_id?: string | null | undefined;
  recovery_email?: string | null | undefined;
  account_group?: string | null | undefined;
  assigned_employee_id?: string | null | undefined;
  status?: AccountStatus | undefined;
  health_status?: AccountHealthStatus | undefined;
  phone_number?: string | null | undefined;
  phone_note?: string | null | undefined;
  parent_account_id?: string | null | undefined;
  recovery_account_id?: string | null | undefined;
  authenticator_account_id?: string | null | undefined;
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
  history_id?: string | null | undefined;
}

export interface RevealAccountSecretResponseData {
  secret_value: string;
}
