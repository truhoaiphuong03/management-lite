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
  health_status?: AccountHealthStatus;
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
  health_status?: AccountHealthStatus;
  phone_number?: string | null;
  phone_note?: string | null;
  phone_gmail_count?: number;
  phone_total_count?: number;
  parent_account_id?: string | null;
  parent_account_username?: string | null;
  parent_account_platform?: AccountPlatform | null;
  recovery_account_id?: string | null;
  recovery_account_username?: string | null;
  authenticator_account_id?: string | null;
  authenticator_account_username?: string | null;
  child_accounts?: LinkedAccountSummary[];
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
  has_secret: boolean;
  secret_types: AccountSecretType[];
  secret_history?: SecretHistoryMetadata[];
  protected_accounts?: LinkedAccountSummary[];
  same_phone_accounts?: LinkedAccountSummary[];
}

export interface AccountListResponseData {
  items: ManagedAccountData[];
  total: number;
  phone_summaries?: PhoneUsageSummary[];
}

export interface InitialSecretInput {
  secret_type: AccountSecretType;
  secret_value: string;
}

export interface CreateAccountRequest {
  platform: AccountPlatform;
  username?: string | null;
  platform_account_id?: string | null;
  recovery_email?: string | null;
  account_group?: string | null;
  assigned_employee_id?: string | null;
  status?: AccountStatus;
  health_status?: AccountHealthStatus;
  phone_number?: string | null;
  phone_note?: string | null;
  parent_account_id?: string | null;
  recovery_account_id?: string | null;
  authenticator_account_id?: string | null;
  create_child_platforms?: AccountPlatform[];
  notes?: string | null;
  initial_secrets?: InitialSecretInput[];
}

export interface UpdateAccountRequest {
  username?: string | null;
  platform_account_id?: string | null;
  recovery_email?: string | null;
  account_group?: string | null;
  assigned_employee_id?: string | null;
  status?: AccountStatus;
  health_status?: AccountHealthStatus;
  phone_number?: string | null;
  phone_note?: string | null;
  parent_account_id?: string | null;
  recovery_account_id?: string | null;
  authenticator_account_id?: string | null;
  notes?: string | null;
}

export interface ArchiveAccountRequest {
  reason?: string | null;
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
  history_id?: string | null;
}

export interface RevealAccountSecretResponseData {
  secret_value: string;
}
