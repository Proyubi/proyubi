import { request } from "@umijs/max";

/** 当前用户的 MCP 个人连接信息（/app/pm/mcp/connection 返回，已由 request 拆封 R<T>）。 */
export interface McpConnection {
  /** 完整连接 URL：{baseUrl}/t/{token}/mcp —— 用户贴到 ChatGPT/Claude 的就是它 */
  url: string;
  /** 内嵌的个人令牌（一般不单独展示，展示 url 即可） */
  token: string;
  /** 公开服务基址 */
  baseUrl: string;
  /** 令牌创建时间 */
  createdAt?: string;
}

/** 取得（无则后端懒生成）当前登录用户的 MCP 连接 URL。 */
export async function getMcpConnection() {
  return request<McpConnection>("/app/pm/mcp/connection", { method: "GET" });
}

/** 重置：旧 URL 立即失效，返回新 URL。 */
export async function regenerateMcpConnection() {
  return request<McpConnection>("/app/pm/mcp/connection/regenerate", {
    method: "POST",
  });
}
