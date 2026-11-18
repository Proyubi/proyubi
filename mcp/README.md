# Proyubi MCP サーバ（運用者・開発者向け）

Claude / ChatGPT など MCP 対応 AI から、本 PM システム（Gantt/WBS, `pm_task`）へ
構造化タスクを投入・更新・照会させる橋渡し。書き込みは pm-api の内部エンドポイント
`/internal/pm/**` 経由（rollup/progress/cascade は pm-api が再計算）。

**2 つの動作モード：**

| モード | エントリ | 誰が使う | トランスポート |
|---|---|---|---|
| **stdio（ローカル）** | `dist/index.js` | 開発者（Claude Code / Cursor / Claude Desktop のローカル設定） | 標準入出力 |
| **HTTP（リモート公開）** | `dist/http.js` | **非エンジニアの PM**（ChatGPT / Claude のコネクタに URL を貼るだけ） | Streamable HTTP |

> 非エンジニア向けの「URL を貼るだけ」手順は **[`doc/manual/pm-mcp-user-guide.md`](../doc/manual/pm-mcp-user-guide.md)** に分離。
> このファイルは**サーバを建てる・デプロイする側**の資料。設計背景は [`doc/design/mcp-pipeline.md`](../doc/design/mcp-pipeline.md)。

---

## 提供ツール（両モード共通）

日付は `YYYY-MM-DD`。結果は JSON テキスト。非 2xx / 業務エラー（`R.code != 0`）はエラーとして返る。

| ツール | 種別 | HTTP |
|---|---|---|
| `pm_list_customers` | 照会 | `GET /internal/pm/customers?q=`（顧客/製品。バグ起票の `customerId` 解決用） |
| `pm_list_members` | 照会 | `GET /internal/pm/members`（担当名→member UUID 解決用） |
| `pm_list_projects` | 照会 | `GET /internal/pm/projects?q=`（`customerId` も返す） |
| `pm_get_project_tasks` | 照会 | `GET /internal/pm/projects/{id}/tasks` |
| `pm_get_risks` | 照会 | `GET /internal/pm/overview`（遅延/ブロック/未割当…のリスク俯瞰） |
| `pm_get_workload` | 照会 | `GET /internal/pm/workload?memberId=`（担当者別ワークロード） |
| `pm_list_bugs` | 照会 | `GET /internal/pm/bugs?customerId=…`（重複確認・起票結果確認） |
| `pm_create_task` | 書込 | `POST /internal/pm/tasks` |
| `pm_update_task` | 書込 | `PUT /internal/pm/tasks/{id}`（部分更新） |
| `pm_create_task_tree` | 書込 | `POST /internal/pm/tasks/tree` → `{ idMap }` |
| `pm_create_bug` | 書込 | `POST /internal/pm/bugs`（バグ起票。`BUG-xxx` は製品内で自動採番） |
| `pm_list_mockups` | 照会 | `GET /internal/pm/mockups?taskId=|bugId=|projectId=`（新版を出す前に `mockupId` を探す） |
| `pm_publish_mockup` | 書込 | `POST /internal/pm/mockups`（HTML / zip / フォルダのモックアップ公開 / 新版。`appUrl` と共有時 `shareUrl` を返す） |
| `pm_list_designs` | 照会 | `GET /internal/pm/designs?projectId=|taskId=`（白板 / .pen の一覧。`designId`・最新修訂・`appUrl`） |
| `pm_get_design` | 照会 | `GET /internal/pm/designs/{id}?revision=`（白板は `scene`。画像本体は既定で省略。stdio は `exportTo` で書き出し可） |
| `pm_save_design` | 書込 | `POST /internal/pm/designs`（新規）/ `PUT /internal/pm/designs/{id}/content`（新修訂、`expectedRevision` 必須、競合は 409） |
| `pm_list_design_comments` | 照会 | `GET /internal/pm/designs/{id}/comments?revision=` |
| `pm_add_design_comment` | 書込 | `POST /internal/pm/designs/{id}/comments`（修訂単位の審査コメント。`nodeId` で画面デザインの画面に付ける） |
| `pm_list_design_frames` | 照会 | `GET /internal/pm/designs/{id}/frames`（画面デザイン .pen の画面＝最上位フレーム、レビュー状態・紐付けタスク） |
| `pm_set_design_frame_status` | 書込 | `PUT /internal/pm/designs/{id}/frames/{nodeId}/status`（draft / review / changes / approved） |
| `pm_link_design_frame_task` | 書込 | `POST` / `DELETE /internal/pm/designs/{id}/frames/{nodeId}/tasks`（`unlink: true` で解除） |

主なフィールド：`type`=task/summary/milestone、`ownerParty`=client(貴社)/vendor(弊社)、
`status`=backlog/todo/in_progress/testing/done/cancelled、`progress`=0–100、`assigneeIds`=member UUID 配列。

バグ票（`pm_create_bug` / `pm_list_bugs`）は pm-web の「品質管理 → バグ起票」と同じ入力：
`customerId`(必須) + `title`(必須) / `description`（再現手順・期待・実際）/ `severity`・`priority`=high/medium/low /
`environment` / `assigneeMemberId` / `projectId`（版本。未指定=製品全体）/ `taskId` / `reportedOn`。

> **起票者（reporter）について**：`pm_bug.reporter_user_id` は NOT NULL。内部 API にはログインユーザーが居ないため、
> pm-mcp は **MCP トークンから解決したユーザー**を `X-User-Id` ヘッダで渡す（HTTP モードは自動）。
> stdio モードは `PM_DEFAULT_USER_ID` を設定した場合のみバグ起票できる（未設定なら 400「起票者が特定できません」）。

モックアップ（`pm_publish_mockup`）：Claude Code / Codex / Claude Design が作った HTML を案件 / タスク / バグに公開する。stdio の `filePath` は**単一 .html（≤ 5MB）・.zip（≤ 50MB、Claude Design のエクスポート等）・index.html を含むフォルダ**のどれでもよい（展開後 100MB / 500 ファイルまで、相対パスの画像等もそのまま表示される）。
stdio モードは `filePath`（ローカルのファイル・フォルダの絶対パス）で渡す——サーバが自分で読むので、モデルが HTML 全文を出力し直さずに済む。
HTTP モードはローカルファイルを読めないため `html` 文字列（≤ 1MB）だけ。`mockupId` を渡すと同じリンクのまま新しい版になる。
公開者は `X-User-Id` 必須（stdio は `PM_DEFAULT_USER_ID`）。設計：`doc/design/pm-mockup.md`。

デザイン（Design Studio、`pm_*_design*`）：案件の **Excalidraw 白板**（截图・付箋・矢印で流程整理）と **.pen 原稿**（原文バイトを無改変保存）を
Proyubi server に保存する。公共の Excalidraw MCP / OpenPencil MCP には保存しない（上流 MCP で編集したら、ここで明示的に保存し直す）。

- **読み書きとも `X-User-Id` 必須**。stdio は `PM_DEFAULT_USER_ID` 未設定だとデザイン系ツールは API を呼ばずにエラー（租户 API キーだけで団队可視性を越えない）。
- 既存デザインの更新は `pm_get_design` で読んだ `currentRevision` を `expectedRevision` に渡す。他の人が先に保存していれば **409 エラー**（上書きしない）→ 読み直して適用し直す。
- 白板の `scene` は `{elements, appState?, files?}`。`pm_get_design` は画像の dataURL を省いて返し、そのまま編集して保存すると**保存済みの画像を引き継ぐ**（画像が消えない）。
- **HTTP モードはローカルファイルを一切読まない / 書かない**（`filePath` / `exportTo` は拒否）。
- **stdio モードのファイル取り込み / 書き出し**は `PM_DESIGN_ROOT`（例：リポジトリの作業コピー）配下だけ：realpath 検証・シンボリックリンク拒否・`.excalidraw` / `.pen` のみ・10MB 以下・一時ファイル + rename の原子的書き込み。
  `pm_get_design {exportTo}` は原文と `<file>.design.json`（designId / revision / sha256 / 由来ハッシュ。認証情報なし）を書く。
  Git で編集・commit した後、`pm_save_design {designId, expectedRevision: manifest.revision, filePath, baseSourceHash: manifest.source.hash, source:{path}}` で新修訂として戻す。
  **pull / commit / push は一切しない**（手動 Git 同期。自動双方向同期は未実装）。
- 試験：`npm test`（SDK Client + InMemoryTransport で initialize / tools/list / tools/call。pm-api は**ローカル mock**で、実バックエンド端到端ではない）。

---

## ビルド

```bash
cd pm-mcp
npm install
npm run build      # tsc -> dist/{core,index,http}.js
```

---

## A. stdio モード（ローカル開発用）

pm-api への認証は `X-Api-Key`（`PM_INTERNAL_API_KEY`）+ `X-Tenant-Id`（`PM_DEFAULT_TENANT_ID`）。
単一テナント固定。Claude Code の `.mcp.json` に登録：

```json
{
  "mcpServers": {
    "pm-mcp": {
      "command": "node",
      "args": ["/path/to/proyubi/mcp/dist/index.js"],
      "env": {
        "PM_API_BASE_URL": "http://localhost:38082",
        "PM_INTERNAL_API_KEY": "replace-with-real-key",
        "PM_DEFAULT_TENANT_ID": "replace-with-tenant-uuid",
        "PM_DEFAULT_USER_ID": "replace-with-user-uuid（任意。バグ起票の起票者・デザイン系ツールに必須）",
        "PM_DESIGN_ROOT": "/path/to/your/repo（任意。デザインのファイル取り込み / 書き出しを許すディレクトリ）"
      }
    }
  }
}
```

> ⚠️ このローカル方式は Node 導入 + JSON 手書きが要るので**開発者専用**。非エンジニアには HTTP モード（下記）を使う。

---

## B. HTTP モード（リモート公開・本番）

`dist/http.js` が Streamable HTTP を待ち受ける。**ユーザー別トークンを URL パスに埋め込む**方式：

```
https://mcp.example.com/t/<TOKEN>/mcp
```

トークン → tenant を解決。OAuth 不要で **ChatGPT・Claude 両方に「URL 貼るだけ」で繋がる**。

### env（HTTP モード）

| 変数 | 例 | 意味 |
|---|---|---|
| `PM_API_BASE_URL` | `http://server:38082` | Proyubi server（docker compose 内ではサービス名で直连） |
| `PM_INTERNAL_API_KEY` | `<key>` | server の `proyubi.internal-api.key`（`PM_INTERNAL_API_KEY`）と一致 |
| `PM_MCP_TOKENS` | `[{"token":"...","tenantId":"uuid","userId":"uuid","label":"田中"}]` | （任意）静的トークン表。テスト用フォールバック |
| `PM_MCP_TOKENS_FILE` | `/path/tokens.json` | （任意）静的トークン表をファイルで渡す場合 |
| `PORT` | `8080` | 待受ポート |

ヘルスチェック：`GET /healthz` → `{ok:true,tools:21,staticTokens:N}`。

### トークン発行 ＝ **ユーザー自身が画面から取得（DB管理）**

トークンは **各ユーザーが pm-web の「設定 → MCP設定」タブで自分の URL を取得**する方式（推奨）。
バックエンドが `pm_mcp_token` テーブルに個人トークンを発行・保存し、pm-mcp は届いた URL の token を
`GET /internal/pm/mcp/resolve?token=` で tenant に反查（5分キャッシュ）。**env へのトークン列挙は不要**。

- 失効／再発行：ユーザーが同画面の「URL を再発行」を押す（旧 URL は即失効）。運用者の再デプロイ不要。
- `PM_MCP_TOKENS`（静的）は、DB を使わないローカル検証などの**任意フォールバック**として残置。
- 前提：`pm_mcp_token` テーブルを dev / prod の DB に適用しておくこと（`schema/init-pm.sql`。SQL は自動実行されない運用なので手動反映）。

---

## デプロイ

リポジトリ直下の `docker-compose.yml` に `mcp` サービスとして入っている（`dist/http.js` を起動、host 3110 → 容器 8080）。

```bash
docker compose up -d --build mcp
curl http://localhost:3110/healthz   # {"ok":true,...}
```

公開時はリバースプロキシで HTTPS 終端する（**必須**。ChatGPT/Claude は https のみ）。
SSE ストリームのため `proxy_buffering off`、`proxy_read_timeout` は長め（例 3600s）を推奨。

---

## トラブルシュート

| 症状 | 原因 / 対処 |
|---|---|
| `/healthz` が返らない | コンテナ未起動 / ポート 3110 衝突 / エッジ未設定 |
| MCP クライアントで 401 | URL の `<token>` が失効／打ち間違い（DB 反查で見つからない）。`pm_mcp_token` 未適用の可能性も |
| ツール実行で `HTTP 401` | `PM_INTERNAL_API_KEY` が webapi 側と不一致 |
| ツール実行で `HTTP 400 X-Tenant-Id` | トークンの `tenantId` が不正 UUID |
| バグ起票で「起票者が特定できません」 | `X-User-Id` が届いていない。stdio は `PM_DEFAULT_USER_ID` 未設定、HTTP は古い `pm_mcp_token`（`user_id` 欠落）か静的トークンに `userId` 未指定 |
| `business error (code N)` | pm-api の業務エラー（HTTP 200 + `R.code!=0`）。msg 参照 |

ログ：HTTP モードは stdout に出力（`docker compose logs -f mcp`）。

---

## セキュリティ

- `/internal/**` は API-Key ガード。鍵・トークンは env 管理・非コミット（`.env*.example` はダミー）。
- トークンは URL に含まれる → **必ず HTTPS**。配布は安全な経路で。失効はトークン削除＋再デプロイ。
- 可能ならエッジで `/t/*/mcp` への到達を IP 制限 or WAF 併用を推奨。

## Proyubi naming and compatibility

The npm package and executable are now `@proyubi/mcp` and `proyubi-mcp`.
Existing `pm_*` tool names, `/internal/pm/**` endpoints, `PM_*` environment
variables, and exported `kind: "pullcord-design"` are retained deliberately:
changing these identifiers would break existing clients and saved design files.
