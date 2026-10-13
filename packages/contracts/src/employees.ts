export type EmploymentStatus = 'invited' | 'active' | 'suspended' | 'archived';

export interface EmployeeUserData {
  id: string;
  username: string;
  email: string;
  status: string;
}

export interface EmployeeData {
  id: string;
  workspace_id: string;
  user_id: string | null;
  employee_code: string;
  full_name: string;
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
  role?: 'staff' | 'admin';
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
  is_payroll_eligible?: boolean;
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
