import { request } from "@umijs/max";

/**
 * 请求邮箱验证码（注册/登录共用）
 * POST /app/auth/email/request-code
 */
export async function requestEmailCode(body: { email: string }) {
  return request<void>("/app/auth/email/request-code", {
    method: "POST",
    data: body,
    // 登录页用自己的 Alert 展示错误，跳过全局 message.error 避免重复提示
    skipErrorHandler: true,
  });
}

/**
 * 校验验证码并登录（账号不存在时自动创建）
 * POST /app/auth/email/verify
 */
export async function verifyEmailCode(body: { email: string; code: string }) {
  return request<{ token: string; loginId: string }>("/app/auth/email/verify", {
    method: "POST",
    data: body,
    skipErrorHandler: true,
  });
}

/**
 * 用户名 + 密码登录
 * POST /app/auth/login
 */
export async function loginWithPassword(body: {
  username: string;
  password: string;
}) {
  return request<{
    token: string;
    loginId: string;
    forcePasswordChange?: boolean;
  }>("/app/auth/login", {
    method: "POST",
    data: body,
    skipErrorHandler: true,
  });
}

/** 获取当前用户信息 GET /app/auth/me */
export async function getCurrentUser(options?: { [key: string]: any }) {
  return request<API.CurrentUser>("/app/auth/me", {
    method: "GET",
    ...(options || {}),
  });
}

/** 更新个人资料（表示名等） PUT /app/auth/profile */
export async function updateProfile(body: { displayName?: string | null }) {
  return request<void>("/app/auth/profile", {
    method: "PUT",
    data: body,
  });
}

/** 登出 POST /app/auth/logout */
export async function logout() {
  return request<void>("/app/auth/logout", {
    method: "POST",
  });
}

/**
 * 注销账户 POST /app/auth/delete-account
 *
 * 验证方式二选一：
 * - 有密码用户（旧 username 流）：传 password
 * - 邮箱/OAuth 用户：传 emailConfirmation（== 账号绑定的邮箱）
 */
export async function deleteAccount(body: {
  password?: string;
  emailConfirmation?: string;
}) {
  return request<void>("/app/auth/delete-account", {
    method: "POST",
    data: body,
  });
}

/** 撤销注销（恢复账户） POST /app/auth/cancel-deletion */
export async function cancelDeletion(body: {
  password?: string;
  emailConfirmation?: string;
}) {
  return request<void>("/app/auth/cancel-deletion", {
    method: "POST",
    data: body,
  });
}
