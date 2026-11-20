export type WebCustomerStatus = 'active' | 'blocked';

export interface WebCustomerProfile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  status: WebCustomerStatus;
  consent_version: string;
  consent_at: string;
  signup_ref: string | null;
  signup_utm: Record<string, string>;
  signup_landing: string | null;
  created_at: string;
  last_login_at: string;
}

export interface WebCustomerGoogleLoginRequestBody {
  credential: string;
  consent?: boolean | undefined;
  ref?: string | null | undefined;
  utm?: Record<string, unknown> | null | undefined;
  landing?: string | null | undefined;
}

export interface WebCustomerAuthResponseData {
  customer: WebCustomerProfile;
  csrf_token: string;
}

export interface WebCustomerLogoutResponseData {
  logged_out: true;
}

export interface WebCustomerDeleteResponseData {
  deleted: true;
}

export interface WebCustomerSessionMetadata {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  created_ip: string | null;
  user_agent: string | null;
}

export interface WebCustomerAccountExportData {
  exported_at: string;
  customer: WebCustomerProfile;
  sessions: WebCustomerSessionMetadata[];
}
