#!/usr/bin/env node
/**
 * pm-mcp (HTTP entry) — the PUBLIC remote deployment. This is what a
 * non-developer uses: they paste ONE URL into ChatGPT (Developer Mode) or a
 * Claude custom connector; no local process, no Node, no JSON editing.
 *
 * Transport: MCP Streamable HTTP, stateless (a fresh server per request).
 * Auth: a per-user token carried IN THE URL PATH — `/t/<token>/mcp`. The token
 * maps to a tenant id, so each user's URL is scoped to their tenant and can be
 * revoked individually. (URL-embedded tokens are the lowest common denominator
 * that BOTH ChatGPT and Claude connectors accept with a plain paste — no OAuth.)
 *
 * Token resolution (token -> tenant), in order:
 *   1. Static env registry PM_MCP_TOKENS / PM_MCP_TOKENS_FILE (optional; handy
 *      for local testing or pinning a few tokens).
 *   2. The backend: GET /internal/pm/mcp/resolve?token=... — the real per-user
 *      tokens issued from the "設定 → MCP設定" page live in the DB, so this is
 *      the primary path in production. Cached briefly to avoid a lookup per call.
 *
 * pm-api itself is reached with the shared X-Api-Key + the resolved X-Tenant-Id,
 * exactly like the stdio path.
 */
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { type ApiConfig, PmApiClient, buildServer } from "./core.js";

// pm-api's InternalApiKeyInterceptor requires a valid X-Tenant-Id on every
// /internal/** call. For token resolution we don't know the tenant yet, so we
// send this placeholder just to pass the guard; the resolve endpoint ignores it
// and looks the token up globally.
const PLACEHOLDER_TENANT = "00000000-0000-0000-0000-000000000000";
const RESOLVE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

// ===== Optional static token registry =====

interface TokenEntry {
  tenantId: string;
  userId?: string; // 起票者 for bug filing; DB tokens always carry one
  label?: string; // human label for logs, e.g. "田中"
}

interface HttpConfig {
  api: ApiConfig;
  port: number;
  tokens: Map<string, TokenEntry>; // static, optional (DB is the primary source)
}

/**
 * Load the OPTIONAL static token registry from PM_MCP_TOKENS_FILE (a JSON file)
 * or PM_MCP_TOKENS (inline JSON): [{ "token", "tenantId", "label" }].
 * Absent/empty is fine — real per-user tokens are resolved from the backend DB.
 */
function loadStaticTokens(): Map<string, TokenEntry> {
  const file = process.env.PM_MCP_TOKENS_FILE?.trim();
  const inline = process.env.PM_MCP_TOKENS?.trim();
  const map = new Map<string, TokenEntry>();

  let raw: string | undefined;
  if (file) {
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      console.error(`[pm-mcp] cannot read PM_MCP_TOKENS_FILE=${file}:`, err);
      process.exit(1);
    }
  } else if (inline) {
    raw = inline;
  }
  if (!raw) return map; // none configured — rely on DB resolution

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[pm-mcp] token registry is not valid JSON:", err);
    process.exit(1);
  }
  if (!Array.isArray(parsed)) {
    console.error("[pm-mcp] token registry must be a JSON array");
    process.exit(1);
  }
  for (const item of parsed) {
    const e = item as {
      token?: unknown;
      tenantId?: unknown;
      userId?: unknown;
      label?: unknown;
    };
    if (typeof e.token !== "string" || typeof e.tenantId !== "string") {
      console.error(
        "[pm-mcp] each token entry needs `token` and `tenantId`:",
        item,
      );
      process.exit(1);
    }
    map.set(e.token, {
      tenantId: e.tenantId,
      userId: typeof e.userId === "string" ? e.userId : undefined,
      label: typeof e.label === "string" ? e.label : undefined,
    });
  }
  return map;
}

function loadHttpConfig(): HttpConfig {
  const baseUrl = process.env.PM_API_BASE_URL;
  const apiKey = process.env.PM_INTERNAL_API_KEY;

  const missing: string[] = [];
  if (!baseUrl) missing.push("PM_API_BASE_URL");
  if (!apiKey) missing.push("PM_INTERNAL_API_KEY");
  if (missing.length > 0) {
    console.error(
      `[pm-mcp] Missing required environment variable(s): ${missing.join(", ")}`,
    );
    process.exit(1);
  }

  return {
    api: { baseUrl: baseUrl!.replace(/\/+$/, ""), apiKey: apiKey! },
    port: Number.parseInt(process.env.PORT ?? "8080", 10),
    tokens: loadStaticTokens(),
  };
}

// ===== Token -> tenant resolver =====

interface Resolved {
  tenantId: string;
  userId?: string;
  label?: string;
}

class TokenResolver {
  private cache = new Map<
    string,
    { value: Resolved | null; expires: number }
  >();

  constructor(private readonly cfg: HttpConfig) {}

  /** Resolve a URL token to a tenant, or null if unknown/invalid. */
  async resolve(token: string, now: number): Promise<Resolved | null> {
    // 1. static env registry (exact, no expiry)
    const stat = this.cfg.tokens.get(token);
    if (stat)
      return {
        tenantId: stat.tenantId,
        userId: stat.userId,
        label: stat.label,
      };

    // 2. short-lived cache of DB lookups (caches negatives too, to blunt abuse)
    const hit = this.cache.get(token);
    if (hit && hit.expires > now) return hit.value;

    // 3. backend DB lookup via internal endpoint
    const value = await this.resolveViaApi(token);
    this.cache.set(token, { value, expires: now + RESOLVE_CACHE_TTL_MS });
    return value;
  }

  private async resolveViaApi(token: string): Promise<Resolved | null> {
    const url = `${this.cfg.api.baseUrl}/internal/pm/mcp/resolve?token=${encodeURIComponent(token)}`;
    let res: globalThis.Response;
    try {
      res = await fetch(url, {
        headers: {
          "X-Api-Key": this.cfg.api.apiKey,
          "X-Tenant-Id": PLACEHOLDER_TENANT,
        },
      });
    } catch (err) {
      console.error("[pm-mcp] resolve fetch failed:", err);
      return null;
    }
    if (!res.ok) return null; // 401/4xx => invalid token
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return null;
    }
    // pm-api R<T> envelope: { code, msg, data:{ tenantId, userId } }
    const env = body as {
      code?: number;
      data?: { tenantId?: string; userId?: string };
    };
    if (typeof env.code === "number" && env.code !== 0) return null;
    const tenantId = env.data?.tenantId;
    // userId identifies the human behind the token — pm-api needs it as the
    // 起票者 when this connection files a bug.
    return tenantId ? { tenantId, userId: env.data?.userId } : null;
  }
}

// ===== HTTP server =====

async function main() {
  const cfg = loadHttpConfig();
  const resolver = new TokenResolver(cfg);
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Liveness probe (used by docker healthcheck / edge). No auth.
  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true, tools: 21, staticTokens: cfg.tokens.size });
  });

  // The MCP endpoint. Token is the :token path segment.
  // Stateless: build a fresh server+transport per POST, tear down on close.
  app.post("/t/:token/mcp", async (req: Request, res: Response) => {
    let resolved: Resolved | null;
    try {
      resolved = await resolver.resolve(req.params.token, Date.now());
    } catch (err) {
      console.error("[pm-mcp] resolve error:", err);
      resolved = null;
    }
    if (!resolved) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Unauthorized: unknown or expired token",
        },
        id: null,
      });
      return;
    }

    const client = new PmApiClient(cfg.api, resolved.tenantId, resolved.userId);
    const server = buildServer(client);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(
        `[pm-mcp] request error (${resolved.label ?? resolved.tenantId}):`,
        err,
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Stateless deployment: no server-initiated stream / session teardown.
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  };
  app.get("/t/:token/mcp", methodNotAllowed);
  app.delete("/t/:token/mcp", methodNotAllowed);

  app.listen(cfg.port, () => {
    console.log(
      `[pm-mcp] HTTP server on :${cfg.port}; endpoint /t/<token>/mcp (static tokens: ${cfg.tokens.size}, DB resolve: on)`,
    );
  });
}

main().catch((err) => {
  console.error("[pm-mcp] fatal:", err);
  process.exit(1);
});
