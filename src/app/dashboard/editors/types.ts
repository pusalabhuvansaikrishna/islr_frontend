// Mirrors UserOut from the backend for editor accounts (role is always "Editor").
//
// `role` is a plain string, matching UserOut.role in schemas.py — not an
// object. `created_at` is now correctly required: UserOut and user_to_out()
// were updated to include it, so the API actually sends a real ISO date.
export interface Editor {
  user_id: string;
  name: string;
  username: string;
  email?: string | null;
  is_active: boolean;
  created_at: string; // ISO date
  role: string;
  permissions: string[];
}

// Mirrors EditorCreateRequest — role is NOT sent, the backend always
// creates the account under the "Editor" role.
export interface CreateEditorPayload {
  name: string;
  username: string;
  password: string;
  email?: string;
}

// Mirrors PasswordResetRequest.
export interface ResetPasswordPayload {
  new_password: string;
}