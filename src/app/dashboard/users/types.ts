// Mirrors UserOut from the backend for standard user accounts (role is
// always "User"). Follows the same shape as Editor in ../editors/types.ts.
//
// `role` is a plain string, matching UserOut.role in schemas.py — not an
// object. `created_at` is required and expected to be a real ISO date
// string from the API.
export interface User {
  user_id: string;
  name: string;
  username: string;
  email?: string | null;
  is_active: boolean;
  created_at: string; // ISO date
  role: string;
  permissions: string[];
}

// Mirrors a UserCreateRequest — role is NOT sent, the backend always
// creates the account under the "User" role.
export interface CreateUserPayload {
  name: string;
  username: string;
  password: string;
  email?: string;
}

// Mirrors a UserUpdateRequest — for editing name/email only. Username and
// role are not editable here.
export interface UpdateUserPayload {
  name: string;
  email?: string;
}

// Mirrors PasswordResetRequest.
export interface ResetPasswordPayload {
  new_password: string;
}