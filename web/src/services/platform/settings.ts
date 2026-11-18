import { request } from "@umijs/max";

/** 获取租户设置 GET /app/settings */
export async function getSettings() {
  return request<API.TenantSettings>("/app/settings", { method: "GET" });
}

/** 更新租户设置 PUT /app/settings */
export async function updateSettings(body: Partial<API.TenantSettings>) {
  return request<API.TenantSettings>("/app/settings", {
    method: "PUT",
    data: body,
  });
}

/**
 * 请求修改密码的邮箱验证码（发送到当前登录用户绑定邮箱）
 * POST /app/auth/password/request-code
 */
export async function requestPasswordChangeCode() {
  return request<void>("/app/auth/password/request-code", { method: "POST" });
}

/**
 * 修改 / 首次设置密码 PUT /app/auth/password（仅需邮箱验证码，无需旧密码）
 *
 * 邮箱验证码本身已经证明了邮箱归属，所以不再要求填写当前密码 —— Google 注册的
 * 账号本来就没有密码，要求旧密码会让它永远改不了密码。「已有密码」和「无密码」
 * 走同一个接口，后端按 loginId 直接覆盖密码哈希。
 */
export async function changePassword(body: {
  newPassword: string;
  code: string;
}) {
  return request<void>("/app/auth/password", { method: "PUT", data: body });
}

/** 上传/更换 App 图标 POST /app/settings/app-icon */
export async function uploadAppIcon(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return request<string>("/app/settings/app-icon", {
    method: "POST",
    data: formData,
    requestType: "form",
  });
}

/** 删除 App 图标 DELETE /app/settings/app-icon */
export async function deleteAppIcon() {
  return request<void>("/app/settings/app-icon", { method: "DELETE" });
}
