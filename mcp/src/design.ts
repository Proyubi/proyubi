/**
 * pm-mcp Design Studio tools — 案件の白板（Excalidraw 場面）と .pen 原稿を読み書きする。
 * 保存先は Proyubi server（/internal/pm/designs）。公共の Excalidraw MCP / OpenPencil MCP には保存しない。
 *
 * - 書き込み・読み込みとも MCP セッションのユーザー（X-User-Id）必須。無人の租户キーでは呼ばない。
 * - 既存デザインの保存は expectedRevision 必須。サーバの CAS で 409 になったらエラーで返す（上書きしない）。
 * - HTTP モードはローカルファイルを一切扱わない。stdio モードだけ、PM_DESIGN_ROOT 配下（realpath 検証、
 *   シンボリックリンク拒否、拡張子 .excalidraw/.pen、10MB 以下、原子的書き込み）で取り込み / 書き出しできる。
 *   Git の pull / commit / push はしない（ファイルを置く・読むだけ）。
 * 設計：work/design-studio/requirements.md §4.5 / §4.6
 */
import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpDesign, PmApiClient } from "./core.js";

/** サーバ（proyubi.pm.design.max-bytes）と同じ上限 */
const DESIGN_MAX_BYTES = 10 * 1024 * 1024;
/** .pen 原文の上限（proyubi.pm.design.max-pen-bytes） */
const PEN_MAX_BYTES = 32 * 1024 * 1024;
/** JSON 引数で直接渡す場合の上限（モデルが出力・転送する量を抑える） */
const DESIGN_INLINE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_ELEMENTS = 5000;
const FILE_EXTS = [".excalidraw", ".pen"];
const FORBIDDEN_TYPES = ["embeddable", "iframe"];

export interface DesignToolOptions {
  /** stdio だけ true */
  allowLocalFiles?: boolean;
  /** stdio のファイル取り込み / 書き出しを許可するルート（PM_DESIGN_ROOT）。未設定ならファイル操作不可 */
  designRoot?: string;
}

// ===== schemas =====

const uuid = z.string().uuid();

const sceneShape = z
  .object({
    elements: z
      .array(z.record(z.string(), z.unknown()))
      .max(MAX_ELEMENTS)
      .describe(
        "Excalidraw elements (rectangle / diamond / ellipse / text / arrow / line / image …). Arrows connect shapes via startBinding/endBinding {elementId} and the shapes list the arrow in boundElements.",
      ),
    appState: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Optional view settings (viewBackgroundColor, gridSize …). Transient state is dropped by the server."),
    files: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Image data keyed by fileId ({mimeType, dataURL: 'data:image/png;base64,…'}). When updating, you may omit images you did not change — stored images are carried over.",
      ),
  })
  .passthrough();

const sourceShape = z
  .object({
    repo: z.string().max(500).optional().describe("Repository identifier WITHOUT credentials."),
    ref: z.string().max(500).optional().describe("Branch / ref."),
    path: z.string().max(500).optional().describe("Path of the file inside the repository (relative)."),
    commitSha: z.string().regex(/^[0-9a-fA-F]{4,64}$/).optional(),
  })
  .describe("Git origin metadata (manual sync only; nothing is pulled or pushed).");

const listDesignsShape = {
  projectId: uuid.optional().describe("List designs of a project."),
  taskId: uuid.optional().describe("List designs linked to a task (takes precedence)."),
};

const getDesignShape = {
    designId: uuid.describe("Design id (from pm_list_designs)."),
    revision: z.number().int().min(1).optional().describe("Read an older revision (default: latest)."),
    includeImages: z
      .boolean()
      .optional()
      .describe("Whiteboards: include image dataURLs (large). Default false — images are listed but their data omitted."),
  exportTo: z
    .string()
    .max(1000)
    .optional()
    .describe(
      "stdio only: write the original file (.excalidraw / .pen) under PM_DESIGN_ROOT (relative path) plus a <file>.design.json manifest holding revision / sha256 / source hash for re-import.",
    ),
};

const saveDesignShape = {
    designId: uuid.optional().describe("Existing design → save a NEW REVISION (requires expectedRevision)."),
    expectedRevision: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("The currentRevision you read with pm_get_design. If someone saved in between, the call fails with 409 — re-read and retry; never guess."),
    projectId: uuid.optional().describe("New design: project to create it in."),
    taskId: uuid.optional().describe("New design: link to a task of the same project."),
    title: z.string().max(200).optional(),
    format: z.enum(["excalidraw", "pen"]).optional().describe("New design only. Default 'excalidraw'."),
    scene: sceneShape.optional().describe("Whiteboard content (excalidraw)."),
    contentBase64: z
      .string()
      .max(Math.ceil((DESIGN_INLINE_MAX_BYTES * 4) / 3))
      .optional()
      .describe(".pen original bytes as base64 (≤ 2MB inline)."),
    filePath: z
      .string()
      .max(1000)
      .optional()
      .describe("stdio only: read the content from a .excalidraw / .pen file under PM_DESIGN_ROOT (relative path)."),
    note: z.string().max(500).optional().describe("What changed in this revision."),
    source: sourceShape.optional(),
    baseSourceHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional()
      .describe("Re-import from Git: source.hash from the exported manifest. If Proyubi recorded a different source since, the call fails with 409."),
};

const listCommentsShape = {
  designId: uuid,
  revision: z.number().int().min(1).optional().describe("Only comments on this revision."),
};

const addCommentShape = {
  designId: uuid,
  revision: z.number().int().min(1).optional().describe("Revision to comment on (default: latest)."),
  nodeId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Screen design (.pen) only: the frame (screen) the comment is about, from pm_list_design_frames. Omit for a comment on the whole revision."),
  body: z.string().min(1).max(4000).describe("Plain-text review comment."),
};

const frameShape = {
  designId: uuid.describe("A screen design (.pen) from pm_list_designs (format = pen)."),
  nodeId: z.string().min(1).max(200).describe("Frame (screen) id from pm_list_design_frames."),
};

const FRAME_STATUSES = ["draft", "review", "changes", "approved"] as const;

// ===== helpers =====

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown) {
  const text = err instanceof Error ? err.message : String(err);
  return { isError: true as const, content: [{ type: "text" as const, text }] };
}

function requireUser(client: PmApiClient) {
  if (!client.hasUser()) {
    throw new Error(
      "Design tools need a signed-in user (X-User-Id). In stdio mode set PM_DEFAULT_USER_ID (platform_tenant_user.id); a tenant-wide API key alone is refused.",
    );
  }
}

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function summarize(d: McpDesign) {
  const x = d.design;
  return {
    designId: x.id,
    title: x.title,
    format: x.format,
    revision: x.currentRevision,
    project: x.projectName,
    task: x.taskName,
    sha256: x.revision?.sha256,
    source: x.source,
    updatedBy: x.updatedByName,
    updatedAt: x.updatedAt,
    appUrl: d.appUrl,
  };
}

/** サーバと同じ規則の事前検証（送る前に直せるエラーを返す）。 */
function checkScene(scene: { elements: Record<string, unknown>[] }) {
  for (const el of scene.elements) {
    if (typeof el.id !== "string" || typeof el.type !== "string") {
      throw new Error("Every element needs string id and type.");
    }
    if (FORBIDDEN_TYPES.includes(el.type)) {
      throw new Error(`Element type '${el.type}' (embeddable / iframe) cannot be saved.`);
    }
  }
}

/** 画像本体を省いた場面（モデルに返す用） */
function withoutImageData(scene: { files?: Record<string, unknown> }) {
  const files: Record<string, unknown> = {};
  for (const [id, f] of Object.entries(scene.files ?? {})) {
    const { dataURL, ...rest } = (f ?? {}) as Record<string, unknown>;
    files[id] = {
      ...rest,
      omitted: true,
      bytes: typeof dataURL === "string" ? dataURL.length : 0,
    };
  }
  return { ...scene, files };
}

/** 更新時、モデルが省いた（dataURL の無い）画像を保存済みの修訂から引き継ぐ */
function carryOverImages(
  scene: { elements: Record<string, unknown>[]; files?: Record<string, unknown> },
  stored: { files?: Record<string, unknown> },
) {
  const files: Record<string, unknown> = { ...(scene.files ?? {}) };
  for (const el of scene.elements) {
    if (el.type !== "image" || typeof el.fileId !== "string") continue;
    const cur = files[el.fileId] as Record<string, unknown> | undefined;
    if (cur && typeof cur.dataURL === "string") continue;
    const prev = stored.files?.[el.fileId];
    if (prev) files[el.fileId] = prev;
  }
  return { ...scene, files };
}

// ===== controlled local files (stdio only) =====

class DesignFiles {
  constructor(private readonly root: string) {}

  static async create(root: string | undefined): Promise<DesignFiles | null> {
    if (!root) return null;
    return new DesignFiles(await realpath(resolve(root)));
  }

  private inside(p: string) {
    const rel = relative(this.root, p);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  }

  private target(p: string): string {
    const ext = extname(p).toLowerCase();
    if (!FILE_EXTS.includes(ext)) {
      throw new Error(`Only ${FILE_EXTS.join(" / ")} files are allowed (got '${ext || p}').`);
    }
    const abs = resolve(this.root, p);
    if (!this.inside(abs)) {
      throw new Error(`Path is outside PM_DESIGN_ROOT (${this.root}): ${p}`);
    }
    return abs;
  }

  async read(p: string): Promise<{ abs: string; bytes: Buffer; format: "excalidraw" | "pen" }> {
    const abs = this.target(p);
    const real = await realpath(abs);
    if (!this.inside(real)) {
      throw new Error(`Path resolves outside PM_DESIGN_ROOT (symlink?): ${p}`);
    }
    const st = await stat(real);
    if (!st.isFile()) throw new Error(`Not a file: ${p}`);
    const format = extname(abs).toLowerCase() === ".pen" ? "pen" : "excalidraw";
    const limit = format === "pen" ? PEN_MAX_BYTES : DESIGN_MAX_BYTES;
    if (st.size > limit) {
      throw new Error(`File is ${(st.size / 1024 / 1024).toFixed(1)}MB; the limit is ${limit / 1024 / 1024}MB.`);
    }
    return { abs: real, bytes: await readFile(real), format };
  }

  /** 原子的書き込み：同じディレクトリの一時ファイルに書いて rename。既存のシンボリックリンクは上書きしない */
  async write(p: string, data: Buffer | string): Promise<string> {
    return this.writeAt(this.target(p), data);
  }

  /** 設計ファイル p の隣に <p>.design.json（取り込み直し用マニフェスト）を書く */
  async writeSidecar(p: string, data: string): Promise<string> {
    return this.writeAt(`${this.target(p)}.design.json`, data);
  }

  private async writeAt(abs: string, data: Buffer | string): Promise<string> {
    const dir = dirname(abs);
    await mkdir(dir, { recursive: true });
    const realDir = await realpath(dir);
    if (realDir !== this.root && !this.inside(realDir)) {
      throw new Error(`Directory resolves outside PM_DESIGN_ROOT (symlink?): ${abs}`);
    }
    const dest = join(realDir, basename(abs));
    const existing = await lstat(dest).catch(() => null);
    if (existing?.isSymbolicLink()) {
      throw new Error(`Refusing to overwrite a symlink: ${abs}`);
    }
    const tmp = join(realDir, `.${basename(abs)}.${randomBytes(6).toString("hex")}.tmp`);
    try {
      await writeFile(tmp, data, { flag: "wx" });
      await rename(tmp, dest);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    return dest;
  }
}

// ===== registration =====

export function registerDesignTools(
  server: McpServer,
  client: PmApiClient,
  opts: DesignToolOptions = {},
) {
  const filesAllowed = !!opts.allowLocalFiles;
  let filesPromise: Promise<DesignFiles | null> | null = null;
  const files = async (): Promise<DesignFiles> => {
    if (!filesAllowed) {
      throw new Error("Local files are only available when pm-mcp runs locally (stdio). Pass scene / contentBase64 instead.");
    }
    filesPromise ??= DesignFiles.create(opts.designRoot);
    const f = await filesPromise;
    if (!f) {
      throw new Error("Set PM_DESIGN_ROOT (a directory such as your repo checkout) to import / export design files.");
    }
    return f;
  };

  server.registerTool(
    "pm_list_designs",
    {
      title: "List PM designs (whiteboards / .pen)",
      description:
        "List Design Studio assets of a project or task: Excalidraw whiteboards (flows with screenshots, sticky notes, arrows) and .pen source files. Returns designId, format, current revision and appUrl (open in PM).",
      inputSchema: listDesignsShape,
    },
    async ({ projectId, taskId }) => {
      try {
        requireUser(client);
        if (!projectId && !taskId) throw new Error("Pass projectId or taskId.");
        return jsonResult((await client.listDesigns({ projectId, taskId })).map(summarize));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_get_design",
    {
      title: "Read a PM design",
      description:
        "Read the latest (or a given) revision of a design. Whiteboards return `scene` (elements / appState / files) — image data is omitted unless includeImages=true. .pen returns metadata only (original bytes are opaque; " +
        (filesAllowed ? "use exportTo to write the file under PM_DESIGN_ROOT). " : "download it from appUrl). ") +
        "Keep `currentRevision`: pass it as expectedRevision to pm_save_design.",
      inputSchema: getDesignShape,
    },
    async (args: { designId: string; revision?: number; includeImages?: boolean; exportTo?: string }) => {
      try {
        requireUser(client);
        if (args.exportTo !== undefined) await files(); // HTTP / ルート未設定はここで拒否
        const d = await client.getDesign(args.designId, args.revision);
        const x = d.design;
        const rev = x.revision?.revision ?? x.currentRevision;
        const out: Record<string, unknown> = {
          ...summarize(d),
          currentRevision: x.currentRevision,
          shownRevision: rev,
          sizeBytes: x.revision?.sizeBytes,
          revisions: x.revisions?.map((r) => r.revision),
        };
        if (x.format === "excalidraw" && x.content !== undefined) {
          const scene = JSON.parse(x.content);
          out.scene = args.includeImages ? scene : withoutImageData(scene);
        }
        if (args.exportTo !== undefined) {
          const f = await files();
          const bytes =
            x.format === "pen"
              ? Buffer.from(x.content ?? "", "base64")
              : Buffer.from(x.content ?? "", "utf8");
          const dest = await f.write(args.exportTo, bytes);
          const manifest = {
            kind: "pullcord-design",
            designId: x.id,
            projectId: x.projectId,
            title: x.title,
            format: x.format,
            revision: rev,
            sha256: x.revision?.sha256 ?? sha256(bytes),
            sizeBytes: bytes.length,
            source: x.source ?? null,
            exportedAt: new Date().toISOString(),
          };
          await f.writeSidecar(args.exportTo, JSON.stringify(manifest, null, 2));
          out.exportedTo = dest;
          out.manifest = manifest;
        }
        return jsonResult(out);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_save_design",
    {
      title: "Create or update a PM design",
      description:
        "Create a design (projectId [+ taskId], format excalidraw by default) or save a NEW REVISION of an existing one (designId + expectedRevision from pm_get_design). " +
        "Whiteboards: pass `scene` ({elements, appState?, files?}); build flows with rectangles / diamonds / text and arrows bound via startBinding/endBinding; a sticky note is a filled rectangle with a bound text (containerId). " +
        ".pen: pass contentBase64" +
        (filesAllowed ? " or filePath (under PM_DESIGN_ROOT). " : ". ") +
        "On 409 someone else saved first: re-read with pm_get_design, re-apply your change, save again — do not overwrite blindly. Returns the new revision and appUrl.",
      inputSchema: saveDesignShape,
    },
    async (args: {
      designId?: string;
      expectedRevision?: number;
      projectId?: string;
      taskId?: string;
      title?: string;
      format?: "excalidraw" | "pen";
      scene?: { elements: Record<string, unknown>[]; appState?: Record<string, unknown>; files?: Record<string, unknown> };
      contentBase64?: string;
      filePath?: string;
      note?: string;
      source?: Record<string, string | undefined>;
      baseSourceHash?: string;
    }) => {
      try {
        requireUser(client);
        const given = [args.scene, args.contentBase64, args.filePath].filter((v) => v !== undefined).length;
        if (given !== 1) {
          throw new Error("Pass exactly one of scene / contentBase64" + (filesAllowed ? " / filePath." : "."));
        }
        if (args.designId && args.expectedRevision === undefined) {
          throw new Error("expectedRevision is required when updating a design (read it with pm_get_design).");
        }
        if (!args.designId && !args.projectId) {
          throw new Error("Pass designId (update) or projectId (create).");
        }

        // 内容を決める
        let format: "excalidraw" | "pen" | undefined = args.format;
        let content: string | undefined;
        let contentBase64: string | undefined;
        let fileName: string | undefined;
        if (args.filePath !== undefined) {
          const read = await (await files()).read(args.filePath);
          format = format ?? read.format;
          fileName = basename(read.abs);
          if (read.format === "pen") contentBase64 = read.bytes.toString("base64");
          else {
            const scene = JSON.parse(read.bytes.toString("utf8"));
            if (!Array.isArray(scene?.elements)) throw new Error("The file is not an Excalidraw scene.");
            checkScene(scene);
            content = JSON.stringify(scene);
          }
        } else if (args.contentBase64 !== undefined) {
          format = format ?? "pen";
          contentBase64 = args.contentBase64;
        } else if (args.scene) {
          format = format ?? "excalidraw";
          checkScene(args.scene);
          let scene = args.scene;
          if (args.designId) {
            const stored = await client.getDesign(args.designId, args.expectedRevision);
            if (stored.design.content && stored.design.format === "excalidraw") {
              scene = carryOverImages(scene, JSON.parse(stored.design.content));
            }
          }
          content = JSON.stringify({ type: "excalidraw", version: 2, ...scene });
          if (Buffer.byteLength(content) > DESIGN_MAX_BYTES) {
            throw new Error("Scene is over 10MB (including images).");
          }
        }

        const common = {
          ...(content !== undefined ? { content } : {}),
          ...(contentBase64 !== undefined ? { contentBase64 } : {}),
          ...(fileName ? { fileName } : {}),
          ...(args.note ? { note: args.note } : {}),
          ...(args.source ? { source: args.source } : {}),
        };
        const d = args.designId
          ? await client.saveDesign(args.designId, {
              expectedRevision: args.expectedRevision,
              ...common,
              ...(args.baseSourceHash ? { baseSourceHash: args.baseSourceHash } : {}),
            })
          : await client.createDesign({
              projectId: args.projectId,
              ...(args.taskId ? { taskId: args.taskId } : {}),
              ...(args.title ? { title: args.title } : {}),
              format,
              ...common,
            });
        return jsonResult(summarize(d));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_list_design_comments",
    {
      title: "List design review comments",
      description: "Review comments on a design (all revisions, or one revision). Each has revision, author, body and resolved state.",
      inputSchema: listCommentsShape,
    },
    async ({ designId, revision }) => {
      try {
        requireUser(client);
        return jsonResult(await client.listDesignComments(designId, revision));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_add_design_comment",
    {
      title: "Add a design review comment",
      description:
        "Add a plain-text review comment to a revision of a design (default: latest). For a screen design (.pen) pass nodeId to comment on one screen. Signed as the MCP user (via=mcp).",
      inputSchema: addCommentShape,
    },
    async ({ designId, revision, nodeId, body }) => {
      try {
        requireUser(client);
        if (!body.trim()) throw new Error("body is empty.");
        return jsonResult(await client.addDesignComment(designId, { revision, elementId: nodeId, body }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_list_design_frames",
    {
      title: "List screens of a screen design (.pen)",
      description:
        "Screens (top-level frames) of a screen design (.pen) in source order: nodeId, name, reviewStatus (draft / review / changes / approved), linked tasks and open comment count. removed = not in the latest version (kept for history). Review status and task links are per screen and shared with every business-flow board that shows the screen.",
      inputSchema: { designId: frameShape.designId },
    },
    async ({ designId }) => {
      try {
        requireUser(client);
        return jsonResult(await client.listDesignFrames(designId));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_set_design_frame_status",
    {
      title: "Set a screen's review status",
      description:
        "Set the review status of one screen of a screen design (.pen): draft, review (waiting for review), changes (changes requested) or approved. Recorded as the MCP user.",
      inputSchema: { ...frameShape, status: z.enum(FRAME_STATUSES) },
    },
    async ({ designId, nodeId, status }) => {
      try {
        requireUser(client);
        return jsonResult(await client.setDesignFrameStatus(designId, nodeId, status));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "pm_link_design_frame_task",
    {
      title: "Link / unlink a task to a screen",
      description:
        "Link a task of the same project to one screen of a screen design (.pen), or unlink it (unlink: true). A screen can have several tasks; the task detail then lists the screen.",
      inputSchema: { ...frameShape, taskId: uuid, unlink: z.boolean().optional() },
    },
    async ({ designId, nodeId, taskId, unlink }) => {
      try {
        requireUser(client);
        return jsonResult(
          unlink
            ? await client.unlinkDesignFrameTask(designId, nodeId, taskId)
            : await client.linkDesignFrameTask(designId, nodeId, taskId),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
