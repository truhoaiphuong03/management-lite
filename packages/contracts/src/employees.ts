export type EmploymentStatus = 'invited' | 'active' | 'suspended' | 'archived';
export type EmployeeMemberRole = 'owner' | 'admin' | 'staff';

export type EmployeeSubPermission =
  | 'attendance:review'
  | 'work:manage'
  | 'employees:manage'
  | 'accounts:manage'
  | 'payroll:manage'
  | 'finance:manage';

export interface EmployeeUserData {
  id: string;
  username: string;
  email: string;
  status: string;
  role?: EmployeeMemberRole | undefined;
  sub_permissions?: EmployeeSubPermission[] | undefined;
  email_verified?: boolean | undefined;
}

export interface EmployeeData {
  id: string;
  workspace_id: string;
  user_id: string | null;
  employee_code: string;
  full_name: string;
  role?: EmployeeMemberRole | undefined;
  sub_permissions?: EmployeeSubPermission[] | undefined;
  phone?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  national_id?: string | null;
  address?: string | null;
  position_title?: string | null;
  emergency_contact?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_account_holder?: string | null;
  employment_status: EmploymentStatus;
  is_payroll_eligible: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  user?: EmployeeUserData | null;
}

export interface CreateEmployeeRequestBody {
  employee_code?: string;
  full_name: string;
  email: string;
  username?: string;
  password?: string | null;
  role?: 'staff' | 'admin';
  sub_role?: 'staff' | 'admin';
  sub_permissions?: EmployeeSubPermission[];
  phone?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  national_id?: string | null;
  address?: string | null;
  position_title?: string | null;
  emergency_contact?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_account_holder?: string | null;
}

export interface CreateEmployeeResponseData {
  id: string;
  user_id?: string;
  employee_code: string;
  full_name: string;
  employment_status: EmploymentStatus;
  version: number;
  invite_token?: string;
}

export interface UpdateEmployeeRequestBody {
  full_name?: string;
  username?: string | null;
  email?: string | null;
  password?: string | null;
  role?: EmployeeMemberRole;
  sub_permissions?: EmployeeSubPermission[];
  is_payroll_eligible?: boolean;
  phone?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  national_id?: string | null;
  address?: string | null;
  position_title?: string | null;
  emergency_contact?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_account_holder?: string | null;
}

export interface SuspendEmployeeRequestBody {
  reason: string;
}

export interface ReactivateEmployeeRequestBody {
  reason: string;
}

export interface ActivationStatusResponseData {
  activation_status: string;
  invite_status: string;
  expires_at?: string | null;
}
