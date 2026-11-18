# PM タスク投入パイプライン（MCP + 内部API + Skill）設計

> **更新（現状）**：MCP は当初 stdio のみだったが、非エンジニアの PM が ChatGPT / Claude から
> 「URL を貼るだけ」で使えるよう **リモート HTTP モード（`pm-mcp/src/http.ts`, Streamable HTTP,
> ユーザー別トークンを URL パスに埋め込み）** を追加した。ツールも 7 種に拡張（照会系に
> `pm_get_risks` / `pm_get_workload`、更新に `pm_update_task`）。
> - 運用者・開発者向け手順 → [`pm-mcp/README.md`](../../pm-mcp/README.md)
> - **非エンジニア向け（URL を貼るだけ）** → [`doc/manual/pm-mcp-user-guide.md`](../manual/pm-mcp-user-guide.md)
> 以下は初期設計の記録（stdio 前提）。

## 目的

他プロジェクトで要件を会話しているとき、「これタスク化して」と言う／`/pm-add` を打つだけで、
要件を WBS ツリーに分解し、本PMシステム（`pm_task`）へ正しく着地させる。Gantt に即反映。

## 確定方針

| 軸 | 決定 |
|---|---|
| 書込経路 | **REST API 経由**（rollup / progress / cascade を pm-api に任せ整合を保つ） |
| 形態 | **MCP サーバ ＋ Skill トリガー** |
| トリガー | **両方**（自然文の自動ルーティング ＋ 明示 `/pm-add`） |
| API認証 | **機械用内部エンドポイント追加**（API-key + `X-Tenant-Id` ヘッダ、ログイン不要） |
| MCP実装 | **TypeScript**、`mcp/` に新規（`@modelcontextprotocol/sdk`、stdio） |

## アーキテクチャ

```
my-app で要件を会話
   │  「タスク化して」/ /pm-add
   ▼
Skill(pm-add)  ── 要件→WBSツリー分解、projectId 解決、ツリーをユーザに提示し確認
   ▼
MCP ツール  pm_create_task_tree / pm_create_task / pm_list_projects ...
   ▼  (HTTP + X-Api-Key + X-Tenant-Id)
pm-api  /internal/pm/**  ── 既存 PmTaskService 経由で rollup・progress・cascade が正しく走る
   ▼
Supabase pm_task に着地 → Gantt 反映
```

## 1. pm-api：機械用内部エンドポイント

新パス接頭辞 **`/internal/pm/**`**（`/app/**`・`/ops/**` の Sa-Token 対象外なので素で公開 → 自前ガードを付ける）。

- **ガード**：新規 `InternalApiKeyInterceptor`（`/internal/**` に適用）。
  - `X-Api-Key` を env `PM_INTERNAL_API_KEY` と照合（不一致は 401）。webhook 署名検証と同じ「業務層ガード」思想。
  - `X-Tenant-Id` を `TenantContext.setTenantId(...)` に手動セット（`/internal/**` は TenantContextInterceptor 対象外のため）。`afterCompletion` で `TenantContext.clear()`。
- **エンドポイント**（新 `PmInternalController`、既存 `PmTaskService` を再利用）：
  - `GET  /internal/pm/projects?q=` → `[{id, name, customerName}]`（名前→ID 解決用）
  - `GET  /internal/pm/projects/{projectId}/tasks` → 既存ツリー（親探索・並び確認用）
  - `POST /internal/pm/tasks` → 単発。body は既存 `CreateTaskReq` を流用
  - `POST /internal/pm/tasks/tree` → **一括ツリー作成**（下記）

### 一括ツリー作成 `POST /internal/pm/tasks/tree`

要件は木で来るため、親→子をトポロジカル順に1トランザクションで挿入。

```jsonc
{
  "projectId": "uuid",
  "parentId": "uuid|null",        // ツリー全体の接続先（既存タスク配下に挿す時）
  "nodes": [
    { "tempId": "n1", "parentTempId": null, "name": "受験料/入学金", "type": "summary",
      "start": "2026-07-01", "end": "2026-08-31", "ownerParty": "vendor" },
    { "tempId": "n2", "parentTempId": "n1", "name": "受験料マスタ設計", "type": "task",
      "start": "2026-07-01", "end": "2026-07-10" }
  ]
}
```
レスポンス：`{ "idMap": { "n1": "uuid", "n2": "uuid" } }`。
サービス側で各ノードを `CreateTaskReq` に変換し既存 `create()` を順次呼ぶ（rollup/progress は既存ロジックで自動再計算）。

### env 追加
- `PM_INTERNAL_API_KEY`（`.env.*` と `.env.*.example` に追記、ランダム32+桁）

## 2. MCP サーバ `pm-mcp/`（TypeScript）

- `@modelcontextprotocol/sdk` の stdio サーバ。env：`PM_API_BASE_URL`, `PM_INTERNAL_API_KEY`, `PM_DEFAULT_TENANT_ID`。
- ツール：
  - `pm_list_projects({ query? })`
  - `pm_get_project_tasks({ projectId })`
  - `pm_create_task({ projectId, parentId?, name, start, end, type?, ... })`
  - `pm_create_task_tree({ projectId, parentId?, nodes:[{tempId,parentTempId,name,...}] })`
- すべて構造化JSONを返す。型は `pm-web/src/pm/types.ts` を流用。

### Claude Code への登録
プロジェクトごとの `.mcp.json`（例 my-app 直下）に stdio サーバとして登録。tenant は env で固定 or ツール引数で上書き。

## 3. Skill `pm-add`（my-app/.claude/skills/pm-add/SKILL.md）

私（Claude）に渡す *手順知識*：
- WBS 分解規約：`type`= summary/task/milestone、`ownerParty`= client(貴社)/vendor(弊社)、`levels[]`、roadmap系、依存は FS のみ
- 流れ：要件文 → ツリー草案 → **ユーザに提示して確認** → `pm_create_task_tree` 呼び出し → 結果（投入件数・Gantt URL）報告
- プロジェクト解決：`pm_list_projects` で名前→ID（my-app 既定 projectId を冒頭に記載）

## 4. トリガー（my-app/CLAUDE.md ルーティング追記）

- 明示：`/pm-add ...`
- 自然文：「タスク化 / PMに追加 / 项目管理に入れて / 做成任务 / タスクにして」→ pm-add を invoke

## セキュリティ留意

- `/internal/**` は API-key のみのガード。鍵は env 管理・リポジトリ非コミット（`.env.*.example` はダミー）。
- 本番公開先では `/internal/**` を LB/WAF でネットワーク制限することを推奨（将来）。
- 単一テナント前提の運用なら `X-Tenant-Id` は MCP env 固定で誤投入を防ぐ。

## 実装順

1. pm-api：`InternalApiKeyInterceptor` + `PmInternalController` + tree 一括サービス + env
2. ローカル起動して curl で疎通（projects 一覧 → tree 投入 → Gantt 確認）
3. `pm-mcp/` 実装 + ビルド
4. my-app `.mcp.json` 登録 + `pm-add` skill + CLAUDE.md ルーティング
5. my-app で「タスク化して」E2E 確認
