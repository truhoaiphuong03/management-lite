export type UserRole = 'owner' | 'staff';

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
}

export interface LoginResponseData {
  user: AuthUserData;
  active_workspace: ActiveWorkspaceData;
  session_expires_at: string;
  csrf_token: string;
}

export interface AuthMeResponseData {
  user: AuthUserData;
  active_workspace: ActiveWorkspaceData;
  permissions: string[];
  memberships: WorkspaceMembershipSummary[];
  csrf_token?: string | undefined;
}

export interface ChangePasswordRequestBody {
  current_password: string;
  new_password: string;
}

export interface ChangePasswordResponseData {
  message: string;
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
