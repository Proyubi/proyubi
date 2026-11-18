import { request } from "@umijs/max";

// ============================================================
// owner 侧 (/app/team/invitations)
// ============================================================

/** 列出本租户邀请，可按 status 过滤 */
export async function listInvitations(params?: { status?: string }) {
  return request<API.Invitation[]>("/app/team/invitations", {
    method: "GET",
    params,
  });
}

/** 检查邮箱是否可邀请（accountExists / alreadyMember / 是否已 pending） */
export async function checkInvitationEmail(email: string) {
  return request<API.Invitation>("/app/team/invitations/check", {
    method: "GET",
    params: { email },
  });
}

/** 创建邀请 */
export async function createInvitation(body: {
  email: string;
  displayName?: string;
  permissions?: string[];
  message?: string;
  /** 目标团队（PRO/TRIAL 多选；FREE 忽略→默认团队） */
  teamIds?: string[];
}) {
  return request<API.Invitation>("/app/team/invitations", {
    method: "POST",
    data: body,
  });
}

/** 撤销 pending 邀请 */
export async function revokeInvitation(id: string) {
  return request<void>(`/app/team/invitations/${id}`, { method: "DELETE" });
}

/** 重发邀请（刷新过期时间 + 重发邮件） */
export async function resendInvitation(id: string) {
  return request<API.Invitation>(`/app/team/invitations/${id}/resend`, {
    method: "POST",
  });
}

// ============================================================
// 被邀请人侧 (/app/invitations)
// ============================================================

/** 当前账号的待处理邀请列表 */
export async function getInvitationInbox() {
  return request<API.Invitation[]>("/app/invitations/inbox", { method: "GET" });
}

/** 接受邀请 */
export async function acceptInvitation(id: string) {
  return request<API.InvitationAcceptResult>(`/app/invitations/${id}/accept`, {
    method: "POST",
  });
}

/** 拒绝邀请 */
export async function declineInvitation(id: string) {
  return request<void>(`/app/invitations/${id}/decline`, { method: "POST" });
}

// ============================================================
// 邮件深链：凭 token 预览 / 接受（/invitations/accept?token=）
// ============================================================

/** 邀请预览（公开，无需登录）。status: pending|accepted|declined|revoked|expired */
export interface InvitationPreview {
  tenantName?: string;
  inviterName?: string;
  email?: string;
  role?: string;
  status?: string;
  message?: string;
  expiresAt?: string;
}

/** 凭 token 预览邀请（公开接口，自行处理无效/过期，不弹全局错误） */
export async function getInvitationByToken(token: string) {
  return request<InvitationPreview>("/app/public/invitations/by-token", {
    method: "GET",
    params: { token },
    skipErrorHandler: true,
  });
}

/** 凭 token 接受邀请（需登录；当前账号邮箱须与被邀请邮箱一致） */
export async function acceptInvitationByToken(token: string) {
  return request<API.InvitationAcceptResult>(
    "/app/invitations/accept-by-token",
    { method: "POST", data: { token } }
  );
}

// ============================================================
// 团队切换 (/app/auth/switch-team)
// ============================================================

/** 切换当前团队（同账号 multi-tenant） */
export async function switchTeam(tenantUserId: string) {
  return request<API.CurrentUser>("/app/auth/switch-team", {
    method: "POST",
    data: { tenantUserId },
  });
}
