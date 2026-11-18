import { request } from "@umijs/max";

/** 获取 Bootstrap 数据 GET /app/bootstrap/pm-web-jp（菜单读 app_code=pm-web-jp） */
export async function getBootstrapData() {
  return request<API.BootstrapData>("/app/bootstrap/pm-web-jp", {
    method: "GET",
  });
}
