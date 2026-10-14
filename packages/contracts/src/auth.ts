export type UserRole = 'owner' | 'admin' | 'staff';

export interface AuthUserData {
  id: string;
  username: string;
  email: string;
}

export interface ActiveWorkspaceData {
  id: string;
  name: string;
  timezone: string;
  role: UserRole;
}

export interface WorkspaceMembershipSummary {
  workspace_id: string;
  workspace_name: string;
  role: UserRole;
  status: string;
}

export interface LoginRequestBody {
  identifier: string;
  password: string;
  remember_me?: boolean | undefined;
}

export interface LoginResponseData {
  user: AuthUserData;
  active_workspace: ActiveWorkspaceData;
  session_expires_at: string;
  csrf_token: string;
  remember_me?: boolean | undefined;
}

export interface AuthMeResponseData {
  user: AuthUserData;
  active_workspace: ActiveWorkspaceData;
  permissions: string[];
  memberships: WorkspaceMembershipSummary[];
  csrf_token?: string | undefined;
  session_expires_at?: string | undefined;
  remember_me?: boolean | undefined;
}

export interface ChangePasswordRequestBody {
  current_password?: string;
  new_password?: string;
  confirm_password?: string;
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

export interface ChangePasswordResponseData {
  message: string;
  csrf_token?: string | undefined;
}

export type ReauthAction = 'secret_write' | 'secret_reveal';

export interface ReauthRequestBody {
  password: string;
  action: ReauthAction;
  account_id: string;
}

export interface ReauthResponseData {
  reauth_proof: string;
  expires_at: string;
}
