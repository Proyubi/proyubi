import { request } from "@umijs/max";

/** 获取团队成员列表 GET /app/team/members */
export async function getTeamMembers() {
  return request<API.TeamMember[]>("/app/team/members", { method: "GET" });
}

/** 获取团队名（租户名） GET /app/team/tenant */
export async function getTeamName() {
  return request<{ name: string }>("/app/team/tenant", { method: "GET" });
}

/** 修改团队名（租户名，仅 owner） PUT /app/team/tenant */
export async function updateTeamName(name: string) {
  return request<void>("/app/team/tenant", {
    method: "PUT",
    data: { name },
  });
}

/** 编辑成员信息 PUT /app/team/members/:id */
export async function updateTeamMember(
  id: string,
  body: { displayName?: string; role: string }
) {
  return request<void>(`/app/team/members/${id}`, {
    method: "PUT",
    data: body,
  });
}

/** 移除成员 DELETE /app/team/members/:id */
export async function removeTeamMember(id: string) {
  return request<void>(`/app/team/members/${id}`, { method: "DELETE" });
}

/** 启用/禁用成员 PUT /app/team/members/:id/toggle */
export async function toggleTeamMember(id: string) {
  return request<void>(`/app/team/members/${id}/toggle`, { method: "PUT" });
}

/** 获取可分配权限列表 GET /app/team/assignable-permissions */
export async function getAssignablePermissions() {
  return request<API.PermissionModule[]>("/app/team/assignable-permissions", {
    method: "GET",
  });
}

/** 获取成员权限 GET /app/team/members/:id/permissions */
export async function getMemberPermissions(id: string) {
  return request<API.MemberPermissions>(`/app/team/members/${id}/permissions`, {
    method: "GET",
  });
}

/** 更新成员权限 PUT /app/team/members/:id/permissions */
export async function updateMemberPermissions(
  id: string,
  body: { permissions: string[] | null }
) {
  return request<void>(`/app/team/members/${id}/permissions`, {
    method: "PUT",
    data: body,
  });
}

// ============================================================
// 团队（子团队 / platform_team）管理 (/app/team/teams)
// ============================================================

/** 团队列表（含成员数、是否默认、canCreateMore） GET /app/team/teams */
export async function listTeams() {
  return request<API.Team[]>("/app/team/teams", { method: "GET" });
}

/** 新建团队（仅 owner，套餐门控 PRO/TRIAL） POST /app/team/teams */
export async function createTeam(body: { name: string; color?: string }) {
  return request<API.Team>("/app/team/teams", { method: "POST", data: body });
}

/** 改名/改色 PUT /app/team/teams/:id */
export async function updateTeam(
  id: string,
  body: { name: string; color?: string }
) {
  return request<void>(`/app/team/teams/${id}`, { method: "PUT", data: body });
}

/** 删除团队（默认/非空团队不可删） DELETE /app/team/teams/:id */
export async function deleteTeam(id: string) {
  return request<void>(`/app/team/teams/${id}`, { method: "DELETE" });
}

/** 团队成员列表 GET /app/team/teams/:id/members */
export async function getTeamGroupMembers(id: string) {
  return request<API.TeamMemberRef[]>(`/app/team/teams/${id}/members`, {
    method: "GET",
  });
}

/** 全量设置团队成员（差量增删，仅 owner） PUT /app/team/teams/:id/members */
export async function setTeamGroupMembers(id: string, userIds: string[]) {
  return request<void>(`/app/team/teams/${id}/members`, {
    method: "PUT",
    data: { userIds },
  });
}
