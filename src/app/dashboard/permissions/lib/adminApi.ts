import { BASE_URL } from "@/config/api";

export type Permission = {
  permission_id: string;
  name: string;
  description: string | null;
};

export type Role = {
  role_id: string;
  name: string;
  description: string | null;
};

export type RoleWithPermissions = Role & {
  permissions: Permission[];
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: "include", // send the auth cookies your backend expects
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    let detail = res.statusText || "Something went wrong";
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // response wasn't JSON, keep the fallback message
    }
    throw new Error(detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---- Roles ----
export const listRoles = () => request<RoleWithPermissions[]>("/superadmin/roles");

export const createRole = (data: { name: string; description?: string }) =>
  request<Role>("/superadmin/roles", { method: "POST", body: JSON.stringify(data) });

export const updateRole = (
  roleId: string,
  data: { name?: string; description?: string }
) =>
  request<Role>(`/superadmin/roles/${roleId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const deleteRole = (roleId: string) =>
  request<void>(`/superadmin/roles/${roleId}`, { method: "DELETE" });

// ---- Permissions ----
export const listPermissions = () => request<Permission[]>("/superadmin/permissions");

export const createPermission = (data: { name: string; description?: string }) =>
  request<Permission>("/superadmin/permissions", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updatePermission = (
  permissionId: string,
  data: { name?: string; description?: string }
) =>
  request<Permission>(`/superadmin/permissions/${permissionId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const deletePermission = (permissionId: string) =>
  request<void>(`/superadmin/permissions/${permissionId}`, { method: "DELETE" });

// ---- Role <-> Permission assignment ----
export const syncRolePermissions = (roleId: string, permissionIds: string[]) =>
  request<Permission[]>(`/superadmin/roles/${roleId}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ permission_ids: permissionIds }),
  });