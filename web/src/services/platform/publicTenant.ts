import { request } from "@umijs/max";

export interface PublicTenantBranding {
  name?: string | null;
  loginLogoUrl?: string | null;
  loginTitle?: string | null;
  loginSubtitle?: string | null;
}

/** 按域名查询登录页品牌信息（公开，未登录可访问） */
export async function getTenantBrandingByDomain(host: string, options?: { [key: string]: any }) {
  return request<PublicTenantBranding | null>("/app/public/tenants/by-domain", {
    method: "GET",
    params: { host },
    skipErrorHandler: true,
    ...(options || {}),
  });
}
