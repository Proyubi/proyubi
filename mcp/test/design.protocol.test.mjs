// pm-mcp Design Studio ツールの MCP プロトコル試験。
// SDK の Client を InMemoryTransport で buildServer() に繋ぎ、initialize → tools/list → tools/call を実際に通す。
// pm-api はこのファイル内の **ローカル mock HTTP サーバ**（/internal/pm/designs のみ、CAS と X-User-Id 必須を再現）。
// ⚠ これは実バックエンドとの端到端試験ではない（webapi / PostgreSQL は起動していない）。
//
// 実行：npm test（= npm run build && node --test test/）
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PmApiClient, buildServer } from "../dist/core.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const PROJECT = "33333333-3333-3333-3333-333333333333";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// ------------------------------------------------------------------ mock pm-api

const db = { designs: new Map(), comments: [], frames: new Map() };
const calls = [];

function sha(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function vo(d, rev) {
  const r = d.revisions.find((x) => x.revision === (rev ?? d.currentRevision));
  return {
    design: {
      id: d.id,
      projectId: d.projectId,
      title: d.title,
      format: d.format,
      currentRevision: d.currentRevision,
      source: d.sourceHash ? { path: d.sourcePath, hash: d.sourceHash } : undefined,
      revision: r && {
        revision: r.revision,
        encoding: r.encoding,
        sizeBytes: r.sizeBytes,
        sha256: r.sha256,
        via: r.via,
      },
      content: r?.content,
      revisions: d.revisions.map((x) => ({ revision: x.revision, via: x.via })),
    },
    appUrl: `https://pm.example/projects/${d.projectId}/designs?open=${d.id}`,
  };
}

function contentOf(format, body) {
  if (format === "pen") {
    const raw = Buffer.from(body.contentBase64, "base64");
    return { content: body.contentBase64, encoding: "base64", sizeBytes: raw.length, sha256: sha(raw) };
  }
  const json = body.content ?? '{"type":"excalidraw","elements":[],"appState":{},"files":{}}';
  JSON.parse(json);
  return { content: json, encoding: "json", sizeBytes: Buffer.byteLength(json), sha256: sha(json) };
}

const api = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : undefined;
  const url = new URL(req.url, "http://x");
  calls.push({ method: req.method, path: url.pathname, user: req.headers["x-user-id"] });
  const send = (data, code = 0, msg = "ok") => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ code, msg, data }));
  };
  if (req.headers["x-api-key"] !== "test-key" || req.headers["x-tenant-id"] !== TENANT) {
    res.statusCode = 401;
    return res.end("bad key");
  }
  if (!req.headers["x-user-id"]) return send(null, 401, "X-User-Id がありません");
  const parts = url.pathname.split("/").filter(Boolean); // internal pm designs :id ...
  const id = parts[3];
  const d = id ? db.designs.get(id) : undefined;
  if (id && !d) return send(null, 404, "デザインが存在しません");

  if (req.method === "GET" && parts.length === 3) {
    return send([...db.designs.values()].filter((x) => x.projectId === url.searchParams.get("projectId")).map((x) => {
      const v = vo(x).design;
      delete v.content;
      delete v.revisions;
      return { design: v, appUrl: vo(x).appUrl };
    }));
  }
  if (req.method === "POST" && parts.length === 3) {
    const nd = {
      id: randomUUID(),
      projectId: body.projectId,
      title: body.title ?? body.fileName ?? "無題",
      format: body.format,
      currentRevision: 1,
      sourcePath: body.source?.path,
      revisions: [],
    };
    const c = contentOf(nd.format, body);
    nd.sourceHash = body.source ? c.sha256 : undefined;
    nd.revisions.push({ revision: 1, via: "mcp", ...c });
    db.designs.set(nd.id, nd);
    return send(vo(nd));
  }
  if (req.method === "GET" && parts.length === 4) {
    const rev = url.searchParams.get("revision");
    return send(vo(d, rev ? Number(rev) : undefined));
  }
  if (req.method === "PUT" && parts[4] === "content") {
    if (body.expectedRevision !== d.currentRevision) {
      return send(null, 409, `他の人が先に保存しました（最新の修訂 ${d.currentRevision}）`);
    }
    if (body.baseSourceHash && d.sourceHash && body.baseSourceHash !== d.sourceHash) {
      return send(null, 409, "Git 側のファイルが前回の取り込み以降に更新されています");
    }
    const c = contentOf(d.format, body);
    d.currentRevision += 1;
    if (body.source) {
      d.sourceHash = c.sha256;
      d.sourcePath = body.source.path ?? d.sourcePath;
    }
    d.revisions.push({ revision: d.currentRevision, via: "mcp", ...c });
    return send(vo(d));
  }
  if (parts[4] === "frames") {
    // .pen の画框：PmDesignInternalController の frames 系（ここでは原文から最上位 frame を読んで再現）
    if (d.format !== "pen") return send([]);
    const key = (n) => `${id}/${n}`;
    const pen = JSON.parse(Buffer.from(d.revisions.at(-1).content, "base64").toString("utf8"));
    for (const n of pen.children.filter((x) => x.type === "frame" && !x.reusable)) {
      if (!db.frames.has(key(n.id))) db.frames.set(key(n.id), { nodeId: n.id, name: n.name ?? n.id, reviewStatus: "draft", tasks: [] });
    }
    if (parts.length === 5) return send([...db.frames.entries()].filter(([k]) => k.startsWith(`${id}/`)).map(([, v]) => v));
    const f = db.frames.get(key(decodeURIComponent(parts[5])));
    if (!f) return send(null, 404, "画框が存在しません");
    if (req.method === "PUT" && parts[6] === "status") {
      if (!["draft", "review", "changes", "approved"].includes(body.status)) return send(null, 400, "status");
      f.reviewStatus = body.status;
    } else if (req.method === "POST" && parts[6] === "tasks") {
      if (!f.tasks.some((x) => x.taskId === body.taskId)) f.tasks.push({ taskId: body.taskId, name: "task" });
    } else if (req.method === "DELETE" && parts[6] === "tasks") {
      f.tasks = f.tasks.filter((x) => x.taskId !== parts[7]);
    }
    return send(f);
  }
  if (parts[4] === "comments") {
    if (req.method === "POST") {
      if (!body.body?.trim()) return send(null, 400, "コメントを入力してください");
      const c = { id: randomUUID(), designId: id, revision: body.revision ?? d.currentRevision, elementId: body.elementId ?? null, body: body.body.trim(), resolved: false, authorName: "MCP User", via: "mcp" };
      db.comments.push(c);
      return send(c);
    }
    return send(db.comments.filter((c) => c.designId === id));
  }
  res.statusCode = 404;
  res.end("not found");
});

let baseUrl;
let root;
let outside;

async function connect({ noUser = false, allowLocalFiles = false, designRoot } = {}) {
  const client = new PmApiClient({ baseUrl, apiKey: "test-key" }, TENANT, noUser ? undefined : USER);
  const server = buildServer(client, { allowLocalFiles, designRoot });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const mcp = new Client({ name: "design-protocol-test", version: "0.0.0" });
  await mcp.connect(clientT); // initialize ハンドシェイク
  return mcp;
}

function json(result) {
  assert.equal(result.isError, undefined, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
}

function errorText(result) {
  assert.equal(result.isError, true, "expected tool error");
  return result.content[0].text;
}

const flowScene = (label) => ({
  elements: [
    { id: "box1", type: "rectangle", x: 0, y: 0, width: 120, height: 60, boundElements: [{ id: "arr", type: "arrow" }] },
    { id: "box2", type: "diamond", x: 300, y: 0, width: 120, height: 60, boundElements: [{ id: "arr", type: "arrow" }] },
    { id: "arr", type: "arrow", x: 120, y: 30, points: [[0, 0], [180, 0]], startBinding: { elementId: "box1", focus: 0, gap: 1 }, endBinding: { elementId: "box2", focus: 0, gap: 1 } },
    { id: "note", type: "text", x: 0, y: 120, text: label },
    { id: "shot", type: "image", x: 500, y: 0, width: 1, height: 1, fileId: "f1", status: "saved" },
  ],
  appState: { viewBackgroundColor: "#ffffff" },
  files: { f1: { id: "f1", mimeType: "image/png", dataURL: `data:image/png;base64,${PNG}`, created: 1 } },
});

before(async () => {
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${api.address().port}`;
  root = await realpath(await mkdtemp(join(tmpdir(), "pm-design-root-")));
  outside = await realpath(await mkdtemp(join(tmpdir(), "pm-design-outside-")));
});

after(async () => {
  api.close();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

// ------------------------------------------------------------------ tests

describe("design tools over MCP (mock pm-api)", () => {
  it("tools/list exposes the design tools with JSON schemas", async () => {
    const mcp = await connect();
    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name);
    for (const n of [
      "pm_list_designs",
      "pm_get_design",
      "pm_save_design",
      "pm_list_design_comments",
      "pm_add_design_comment",
      "pm_list_design_frames",
      "pm_set_design_frame_status",
      "pm_link_design_frame_task",
    ]) {
      assert.ok(names.includes(n), `${n} missing`);
      const t = tools.find((x) => x.name === n);
      assert.equal(t.inputSchema.type, "object");
    }
    const save = tools.find((t) => t.name === "pm_save_design");
    assert.ok(save.inputSchema.properties.expectedRevision);
    assert.ok(save.inputSchema.properties.scene);
    // HTTP（allowLocalFiles=false）では filePath を説明で案内しない
    assert.ok(!/filePath/.test(save.description));
  });

  it("create → read → update with expectedRevision → stale write conflicts → re-read", async () => {
    const mcp = await connect();
    const created = json(await mcp.callTool({ name: "pm_save_design", arguments: { projectId: PROJECT, title: "ログイン流程", scene: flowScene("v1") } }));
    assert.equal(created.revision, 1);
    assert.match(created.appUrl, /designs\?open=/);
    const id = created.designId;

    const got = json(await mcp.callTool({ name: "pm_get_design", arguments: { designId: id } }));
    assert.equal(got.currentRevision, 1);
    assert.equal(got.scene.elements.length, 5);
    assert.equal(got.scene.elements[2].startBinding.elementId, "box1");
    // 画像本体は既定で返さない（トークン節約）が、存在と ID は分かる
    assert.equal(got.scene.files.f1.dataURL, undefined);
    assert.equal(got.scene.files.f1.omitted, true);

    // モデルは画像を省いた scene をそのまま編集して保存できる（保存済みの画像を引き継ぐ）
    const edited = { ...got.scene, elements: got.scene.elements.map((e) => (e.id === "note" ? { ...e, text: "v2" } : e)) };
    const saved = json(await mcp.callTool({ name: "pm_save_design", arguments: { designId: id, expectedRevision: 1, scene: edited, note: "文言修正" } }));
    assert.equal(saved.revision, 2);
    const stored = JSON.parse(db.designs.get(id).revisions[1].content);
    assert.ok(stored.files.f1.dataURL.endsWith(PNG), "image data must be carried over, not lost");
    assert.equal(stored.elements.find((e) => e.id === "note").text, "v2");

    const stale = errorText(await mcp.callTool({ name: "pm_save_design", arguments: { designId: id, expectedRevision: 1, scene: flowScene("stale") } }));
    assert.match(stale, /409/);
    const after = json(await mcp.callTool({ name: "pm_get_design", arguments: { designId: id } }));
    assert.equal(after.currentRevision, 2);
    assert.equal(after.scene.elements.find((e) => e.id === "note").text, "v2");

    const listed = json(await mcp.callTool({ name: "pm_list_designs", arguments: { projectId: PROJECT } }));
    assert.ok(listed.some((d) => d.designId === id && d.revision === 2));
  });

  it("rejects updates without expectedRevision and malformed input before calling the API", async () => {
    const mcp = await connect();
    const writes = () => calls.filter((c) => c.method !== "GET").length;
    const before = writes();
    const noRev = errorText(await mcp.callTool({ name: "pm_save_design", arguments: { designId: randomUUID(), scene: flowScene("x") } }));
    assert.match(noRev, /expectedRevision/);
    const both = errorText(await mcp.callTool({ name: "pm_save_design", arguments: { projectId: PROJECT, scene: flowScene("x"), contentBase64: "AAAA" } }));
    assert.match(both, /exactly one/i);
    // JSON schema 違反（uuid でない）は SDK がツール実行前に弾く（エラー結果 or 例外のどちらでも可）
    let rejected = false;
    try {
      rejected = (await mcp.callTool({ name: "pm_save_design", arguments: { projectId: "not-a-uuid", scene: flowScene("x") } })).isError === true;
    } catch {
      rejected = true;
    }
    assert.ok(rejected, "schema violation must be rejected");
    const embed = errorText(await mcp.callTool({ name: "pm_save_design", arguments: { projectId: PROJECT, scene: { elements: [{ id: "e", type: "embeddable", link: "https://x" }] } } }));
    assert.match(embed, /embeddable/);
    assert.equal(writes(), before, "no write reached the API");
  });

  it("refuses writes when the MCP session has no user (tenant-wide key only)", async () => {
    const mcp = await connect({ noUser: true });
    const before = calls.length;
    const msg = errorText(await mcp.callTool({ name: "pm_save_design", arguments: { projectId: PROJECT, scene: flowScene("x") } }));
    assert.match(msg, /PM_DEFAULT_USER_ID|user/i);
    const c = errorText(await mcp.callTool({ name: "pm_add_design_comment", arguments: { designId: randomUUID(), body: "hi" } }));
    assert.match(c, /user/i);
    assert.equal(calls.length, before, "no request reached the API");
  });

  it("adds and lists revision-level review comments", async () => {
    const mcp = await connect();
    const created = json(await mcp.callTool({ name: "pm_save_design", arguments: { projectId: PROJECT, scene: flowScene("c") } }));
    const c = json(await mcp.callTool({ name: "pm_add_design_comment", arguments: { designId: created.designId, revision: 1, body: "矢印の向きを確認" } }));
    assert.equal(c.revision, 1);
    const list = json(await mcp.callTool({ name: "pm_list_design_comments", arguments: { designId: created.designId } }));
    assert.equal(list.length, 1);
    assert.equal(list[0].body, "矢印の向きを確認");
    const blank = await mcp.callTool({ name: "pm_add_design_comment", arguments: { designId: created.designId, body: "" } });
    assert.equal(blank.isError, true);
  });

  it("screen design: lists frames, sets review status, links / unlinks a task, comments on a frame", async () => {
    const mcp = await connect();
    const pen = JSON.stringify({
      version: "2.6",
      children: [
        { type: "frame", id: "cmp", name: "Button", reusable: true },
        { type: "frame", id: "W02", name: "W02-01 学生一覧" },
        { type: "frame", id: "W04", name: "W04-02 学生詳細" },
      ],
    });
    const created = json(await mcp.callTool({
      name: "pm_save_design",
      arguments: { projectId: PROJECT, title: "lms", contentBase64: Buffer.from(pen).toString("base64"), fileName: "lms.pen" },
    }));
    const frames = json(await mcp.callTool({ name: "pm_list_design_frames", arguments: { designId: created.designId } }));
    assert.deepEqual(frames.map((f) => f.nodeId), ["W02", "W04"], "コンポーネント定義は画面に含めない");

    const st = json(await mcp.callTool({ name: "pm_set_design_frame_status", arguments: { designId: created.designId, nodeId: "W04", status: "changes" } }));
    assert.equal(st.reviewStatus, "changes");
    assert.match(errorText(await mcp.callTool({ name: "pm_set_design_frame_status", arguments: { designId: created.designId, nodeId: "W04", status: "done" } })), /status/i);

    const task = randomUUID();
    const linked = json(await mcp.callTool({ name: "pm_link_design_frame_task", arguments: { designId: created.designId, nodeId: "W04", taskId: task } }));
    assert.deepEqual(linked.tasks.map((x) => x.taskId), [task]);
    const unlinked = json(await mcp.callTool({ name: "pm_link_design_frame_task", arguments: { designId: created.designId, nodeId: "W04", taskId: task, unlink: true } }));
    assert.deepEqual(unlinked.tasks, []);

    const c = json(await mcp.callTool({ name: "pm_add_design_comment", arguments: { designId: created.designId, nodeId: "W04", body: "ボタンの文言" } }));
    assert.equal(c.elementId, "W04");
  });

  it("HTTP mode never reads or writes local paths", async () => {
    const mcp = await connect({ allowLocalFiles: false, designRoot: root });
    const r = errorText(await mcp.callTool({ name: "pm_save_design", arguments: { projectId: PROJECT, format: "pen", filePath: "/etc/passwd" } }));
    assert.match(r, /stdio/);
    const created = json(await mcp.callTool({ name: "pm_save_design", arguments: { projectId: PROJECT, scene: flowScene("h") } }));
    const e = errorText(await mcp.callTool({ name: "pm_get_design", arguments: { designId: created.designId, exportTo: "x.excalidraw" } }));
    assert.match(e, /stdio/);
  });

  it("stdio: export to the design root, re-import as a new revision, block traversal and symlinks", async () => {
    const mcp = await connect({ allowLocalFiles: true, designRoot: root });
    // .pen 原文（未知フィールド・CRLF 付き）を 1 バイトも変えずに往復
    const penBytes = Buffer.from('{"version":"2.6","children":[{"type":"x-unknown"}]}\r\n');
    await mkdir(join(root, "design"), { recursive: true });
    await writeFile(join(root, "design", "home.pen"), penBytes);
    const created = json(await mcp.callTool({ name: "pm_save_design", arguments: { projectId: PROJECT, format: "pen", filePath: "design/home.pen", source: { path: "design/home.pen", ref: "main" } } }));
    assert.equal(created.revision, 1);
    assert.equal(created.sha256, sha(penBytes));

    const exp = json(await mcp.callTool({ name: "pm_get_design", arguments: { designId: created.designId, exportTo: "out/home.pen" } }));
    assert.deepEqual(await readFile(join(root, "out", "home.pen")), penBytes);
    const manifest = JSON.parse(await readFile(join(root, "out", "home.pen.design.json"), "utf8"));
    assert.equal(manifest.designId, created.designId);
    assert.equal(manifest.revision, 1);
    assert.equal(manifest.sha256, sha(penBytes));
    assert.equal(exp.exportedTo, join(root, "out", "home.pen"));
    assert.equal(JSON.stringify(manifest).includes("test-key"), false, "no credentials in manifest");

    // Git 側で編集 → 期待修訂 + 基準源ハッシュ付きで取り込み
    const v2 = Buffer.concat([penBytes, Buffer.from("\n")]);
    await writeFile(join(root, "out", "home.pen"), v2);
    const re = json(await mcp.callTool({ name: "pm_save_design", arguments: { designId: created.designId, expectedRevision: 1, filePath: "out/home.pen", baseSourceHash: manifest.source.hash, source: { path: "design/home.pen" } } }));
    assert.equal(re.revision, 2);
    // 基準ハッシュがずれていれば衝突
    const conflict = errorText(await mcp.callTool({ name: "pm_save_design", arguments: { designId: created.designId, expectedRevision: 2, filePath: "out/home.pen", baseSourceHash: "0".repeat(64) } }));
    assert.match(conflict, /409/);

    // ルート外・トラバーサル・シンボリックリンク・拡張子は拒否
    await writeFile(join(outside, "secret.pen"), "secret");
    for (const p of ["../secret.pen", join(outside, "secret.pen"), "design/../../secret.pen"]) {
      const m = errorText(await mcp.callTool({ name: "pm_save_design", arguments: { projectId: PROJECT, format: "pen", filePath: p } }));
      assert.match(m, /outside|root/i, p);
    }
    await symlink(join(outside, "secret.pen"), join(root, "link.pen"));
    const sl = errorText(await mcp.callTool({ name: "pm_save_design", arguments: { projectId: PROJECT, format: "pen", filePath: "link.pen" } }));
    assert.match(sl, /outside|symlink|root/i);
    const wl = errorText(await mcp.callTool({ name: "pm_get_design", arguments: { designId: created.designId, exportTo: "link.pen" } }));
    assert.match(wl, /symlink|outside|root/i);
    assert.equal(await readFile(join(outside, "secret.pen"), "utf8"), "secret", "symlink target untouched");
    const ext = errorText(await mcp.callTool({ name: "pm_get_design", arguments: { designId: created.designId, exportTo: "x.sh" } }));
    assert.match(ext, /\.pen|\.excalidraw|extension/i);
  });

  it("stdio without PM_DESIGN_ROOT refuses file paths", async () => {
    const mcp = await connect({ allowLocalFiles: true });
    const m = errorText(await mcp.callTool({ name: "pm_save_design", arguments: { projectId: PROJECT, format: "pen", filePath: "a.pen" } }));
    assert.match(m, /PM_DESIGN_ROOT/);
  });
});
