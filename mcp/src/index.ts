#!/usr/bin/env node
/**
 * pm-mcp (stdio entry) — for LOCAL use by developer clients (Claude Code, Cursor,
 * Claude Desktop local-server config). The client launches this process and
 * talks over stdin/stdout. A single tenant is fixed via env.
 *
 * For the PUBLIC remote deployment (ChatGPT / Claude custom connectors, one URL
 * per user), see http.ts instead — that path is what non-developers use.
 *
 * Auth to pm-api is header based: X-Api-Key + X-Tenant-Id.
 * Config is read entirely from environment variables (validated on startup).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  type ApiConfig,
  PmApiClient,
  buildServer,
  verifyUserScope,
} from "./core.js";

function loadStdioConfig(): {
  api: ApiConfig;
  tenantId: string;
  userId?: string;
} {
  const baseUrl = process.env.PM_API_BASE_URL;
  const apiKey = process.env.PM_INTERNAL_API_KEY;
  const tenantId = process.env.PM_DEFAULT_TENANT_ID;
  // Optional: the human this local server acts as. Only bug filing needs it
  // (起票者 is a NOT NULL column); every other tool works without it.
  const userId = process.env.PM_DEFAULT_USER_ID;

  const missing: string[] = [];
  if (!baseUrl) missing.push("PM_API_BASE_URL");
  if (!apiKey) missing.push("PM_INTERNAL_API_KEY");
  if (!tenantId) missing.push("PM_DEFAULT_TENANT_ID");
  if (missing.length > 0) {
    console.error(
      `[pm-mcp] Missing required environment variable(s): ${missing.join(", ")}`,
    );
    process.exit(1);
  }

  return {
    // strip a single trailing slash so path joins stay clean
    api: { baseUrl: baseUrl!.replace(/\/+$/, ""), apiKey: apiKey! },
    tenantId: tenantId!,
    userId: userId?.trim() || undefined,
  };
}

async function main() {
  const { api, tenantId, userId } = loadStdioConfig();
  // 設定ミスを静かに通さない: 誤った ID だと owner でも「所属チーム 0 件の member」に
  // 降格し、project 系が軒並み 404 になる。落とすべきは起動時であって呼び出し時ではない。
  if (userId) {
    await verifyUserScope(api, tenantId, userId);
  }
  const client = new PmApiClient(api, tenantId, userId);
  // PM_DESIGN_ROOT：デザインの取り込み / 書き出しを許すディレクトリ（例：リポジトリの作業コピー）。
  // 未設定ならデザインのファイル操作は拒否（scene / contentBase64 の直接渡しは可）。
  const designRoot = process.env.PM_DESIGN_ROOT?.trim() || undefined;
  const server = buildServer(client, { allowLocalFiles: true, designRoot });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe; stdout is the MCP channel.
  console.error("[pm-mcp] stdio server started");
}

main().catch((err) => {
  console.error("[pm-mcp] fatal:", err);
  process.exit(1);
});
