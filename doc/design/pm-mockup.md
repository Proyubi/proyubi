# モックアップ共有（pm_mockup）设计

> Claude Code / Codex 生成的**单文件交互式 HTML 效果图**发布到 PM，挂在 案件 / タスク / バグ 上，
> 社内用沙箱 iframe 预览，对外用自家域名的分享链接给客户 / 营业看。替代「直接把 claude.ai 的 Artifact 链接发给客户」。
> 画面效果图：[pm-mockup-screens.html](pm-mockup-screens.html)（M1–M6）。

## 1. 决定事项

| 项目 | 决定 | 理由 |
|---|---|---|
| 上传入口 | pm-mcp `pm_publish_mockup`（stdio 读本地 `file_path`：.html / .zip / 文件夹；HTTP 传 `html` 字符串）+ pm-web 拖入 `.html` / `.zip` | 模型不用把整份 HTML 再输出一遍；与 `wms_attach_product_image` 同思路 |
| 文件形态 | 单个 `.html`（≤ 5MB）或 **`.zip`**（≤ 50MB，展开后 ≤ 100MB / 500 文件；2026-10-22 起，见 §7） | Claude / Codex 的效果图多为单文件；Claude Design「エクスポート → ZIP」是 index.html + img/*.png |
| 存储 | PostgreSQL：入口 HTML 在 `pm_mockup_version.content`（`text`），zip 的其余文件在 `pm_mockup_file`（`bytea`） | 与元数据同事务；备份现成。带大量截图的包每版 ~10MB，频繁发布导致库膨胀时再迁 MinIO（对外 URL 不变，读取都经 webapi） |
| 下发 | webapi `GET /mock/m/{versionId}/{exp}/{sig}/{path}`（旧形式 `?exp&sig` 兼容），与 PM **同域**（`pm.example.com/mock/`，nginx 反代到 webapi） | pm-web 的登录 token 在 `localStorage`。响应头 CSP `sandbox`（无 `allow-same-origin`）让效果图跑在 opaque origin，读不到 token。2026-10-21 起放弃原定独立域名（如 `mock.example.com`）（少建一个站点/证书），代价是 CSP 头成为唯一防线 —— 改 `PmMockupPublicController#raw` 前读其注释 |
| 对外分享 | `https://<pm 域名>/share/m/{token}`（pm-web 公开页，layout:false）里 iframe 嵌原文 | 客户看到的是自家域名；token 不可猜、可设期限、可停用、可重发 |
| 编辑 | 标题 / 挂载对象在 PM 里改；内容改动 = Claude Code 改完后**作为新版本发布**（链接不变） | 不做在线 HTML 编辑器 |
| 删除 | 软删整个效果图（分享同时失效）或软删单个版本（不能删最后一版） | |

## 2. 数据模型

```
pm_mockup          一个效果图（跨版本不变的身份）
  customer_id NOT NULL（服务端从 案件/タスク/バグ 推出）, project_id?, task_id?, bug_id?
  title, current_version
  share_token (unique, nullable), share_enabled, share_expires_at, share_pinned_version
  share_view_count, share_last_viewed_at
  created_by / created_by_name, created_at, updated_at, deleted_at
pm_mockup_version  一个版本
  mockup_id, version (1..n, (mockup_id, version) 唯一), content text, size_bytes, sha256, note,
  via ('web' | 'mcp'), created_by / created_by_name, created_at, deleted_at
```

挂载规则：`taskId` / `bugId` / `projectId` 至少一个。给了 `taskId` → `projectId` 取任务所属案件；给了 `bugId` →
`customerId` 取バグ所属製品、`projectId` 若空则取バグ的案件。任务与バグ同时给时须同一案件。
同内容（sha256 与当前版相同）重复发布不新增版本，直接返回当前效果图。

可见性：有 `projectId` → 案件团队可见；否则 → バグ/顧客可见（同 `PmBugService.getVisibleBug`）。
编辑 / 删除为任意可见成员可操作（共享上下文，同 `pm_task_link`）。

## 3. API

`/app/pm`（登录）：

| Method | Path | 说明 |
|---|---|---|
| GET | `/mockups?projectId=&taskId=&bugId=` | 三选一；返回 `PmMockupVO[]`（不含 versions） |
| GET | `/mockups/{id}` | `PmMockupVO`（含 `versions`，新→旧） |
| POST | `/mockups` | JSON `{html, title?, projectId?, taskId?, bugId?, mockupId?, note?}`；`mockupId` 有值 = 发新版本（挂载参数忽略）。title 空时取 HTML `<title>`，再空取「無題のモックアップ」 |
| PUT | `/mockups/{id}` | `{title?, taskId?, bugId?, clearTask?, clearBug?}` 改元数据 |
| DELETE | `/mockups/{id}` | 软删整个 |
| DELETE | `/mockups/{id}/versions/{version}` | 软删一版；不能删最后一版；删的是当前版则 current 回退到剩余最大版 |
| GET | `/mockups/{id}/view-url?version=` | `{url, expiresAt}` 短期签名原文 URL（默认 2h） |
| PUT | `/mockups/{id}/share` | `{enabled, expiresInDays?(null=无期限), pinnedVersion?(null=总是最新)}`；首次开启生成 token |
| POST | `/mockups/{id}/share/regenerate` | 换新 token（旧链接立即失效） |

`/app/public/pm/mockups/share/{token}`（公开）：`{title, customerName, projectName, version, updatedAt, expiresAt, viewUrl}`；
无效 / 停用 / 过期 / 已删 → 统一 404「このリンクは無効です」，不泄露任何信息。每次访问 `share_view_count+1`。

`/mock/m/{versionId}?exp=&sig=`（公开，HMAC-SHA256(secret, versionId + "." + exp)）：返回 HTML 原文 +
```
Content-Type: text/html; charset=utf-8
Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads; frame-ancestors <配置>
X-Robots-Tag: noindex, nofollow
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Cache-Control: private, max-age=300
```

`/internal/pm`（MCP，`X-User-Id` 必须）：`POST /mockups`（同上 + `share?: boolean` → 未开启时以 30 天开启）、
`GET /mockups?projectId|taskId|bugId`。响应额外带 `appUrl`（PM 内打开）与 `shareUrl`（开启时）。

### PmMockupVO

```ts
{
  id, customerId, projectId, projectName, taskId, taskName, bugId, bugNo, bugTitle,
  title, currentVersion, sizeBytes,           // sizeBytes = 当前版
  updatedAt, updatedByName, lastVia,          // 当前版的发布时间 / 发布人 / web|mcp
  createdBy, createdByName, createdAt,
  share: { enabled, token, expiresAt, pinnedVersion, viewCount, lastViewedAt },
  versions?: [{ version, note, sizeBytes, via, createdByName, createdAt }]
}
```

## 4. 配置（`proyubi.pm.mockup.*`）

| key | env | 默认 | 说明 |
|---|---|---|---|
| `raw-base-url` | `PM_MOCKUP_RAW_BASE_URL` | `http://localhost:38082` | 原文下发基址。prod = `https://pm.example.com` |
| `sign-secret` | `PM_MOCKUP_SIGN_SECRET` | 空 → 启动时随机（重启后旧签名失效，仅限 dev） | |
| `frame-ancestors` | `PM_MOCKUP_FRAME_ANCESTORS` | `https://pm.example.com https://pm.example.com http://localhost:8000` | |
| `web-base-url` | `PM_MOCKUP_WEB_BASE_URL` | `https://pm.example.com` | MCP 响应里 `appUrl`/`shareUrl` 的基址（pm-web 自己用 `location.origin`） |
| `max-bytes` | — | `5242880` | |

## 5. 上线 checklist（同域 `pm.example.com`）

1. 前置 nginx `pm.example.com` 站点加 `location /mock/ { proxy_pass http://127.0.0.1:38090; ... }`，放在 SPA fallback 之前（否则落到 index.html）。可在此再 `add_header Content-Security-Policy "sandbox ..." always` 作第二道防线
2. 不需要新 DNS / 证书
3. `.env.prod` 设 `PM_MOCKUP_RAW_BASE_URL=https://pm.example.com`、`PM_MOCKUP_SIGN_SECRET=<随机 32 字节>`（固定值，否则重启后旧链接全失效）
4. CORS / OAuth 无需改动
5. pm 域名（`pm.example.com` / `pm.example.com`）的 openresty `client_max_body_size` ≥ **55m**（zip 上传 50MB + multipart 开销；MCP 走 `/internal` 时 base64 约 67MB，pm-mcp→webapi 不经 openresty 则不受影响，webapi 的 Jackson 字符串上限为此调到 80MB）。2026-10-22 实测 `pm.example.com` 48MB 通过、55MB 返回 413（推测为 50m）
6. `./db.sh init prod` 应用 migration `2026-10-15-pm-mockup.sql`、`2026-10-22-pm-mockup-files.sql`

## 6. 已知限制

- 依赖 Claude Artifact 专有运行时（`window.claude.*`、共享存储）的部分在这里不工作；纯前端交互正常。
- sandbox 无 `allow-same-origin` → 页面内 `localStorage` 抛异常（Claude 生成的页面一般已 try/catch）。
- 分期：P1 = 本文全部；P2 = 缩略图（无头浏览器截图）、效果图上打点评论；P3 = zip 多文件包（2026-10-22 完成，§7）。

## 7. zip / 多文件（2026-10-22）

起因：Claude Design 的「エクスポート → ZIP」= `index.html` + `img/*.png`（实例 105 文件 / 9.8MB），单 HTML 装不下。

- **存储**：入口 HTML 仍在 `pm_mockup_version.content`（`entry_path` 记路径，`file_count` 记文件数）；其余文件一文件一行进 `pm_mockup_file(version_id, path, content_type, size_bytes, data bytea)`，`(version_id, path)` 唯一。旧版本 `entry_path` 为 null = `index.html`，无需迁移数据。
- **URL**：签名从 query 挪进路径 `/mock/m/{versionId}/{exp}/{sig}/{path}`。相对引用 `img/a.png` 解析后仍在同一签名前缀下，页面间跳转也成立；签名按版本，一个前缀覆盖该版全部文件。版本根无尾斜杠 → 302 补 `/`；目录请求补 `index.html`。
- **安全**：所有响应（含图片 / SVG / 非入口 HTML）都带同一套 CSP `sandbox` 头（`PmMockupPublicController#secured`）。非 HTML 额外 `Access-Control-Allow-Origin: *`——sandbox 文档的 Origin 是 `null`，module script / fetch / 字体走 CORS，不加会失败；这些文件只能凭签名 URL 取得。Content-Type 由服务端按扩展名白名单决定（`PmMockupBundle`），不信上传方。
- **展开规则（`PmMockupBundle`）**：路径 `\`→`/`、NFC 正规化（macOS zip 是 NFD）；绝对路径 / `..` / 盘符 / 控制字符 → 整包拒绝；`__MACOSX/`、`.DS_Store`、`._*`、`Thumbs.db`、白名单外扩展名静默丢弃；全部文件在同一顶层文件夹下则剥掉该层；文件名 UTF-8 解析失败时按 MS932 重读。大小按实际解压字节计数（不信 zip 头），超限即停。
- **入口**：根目录 `index.html` → 根目录唯一 HTML → 全包唯一 HTML；都不满足则报错并列出候选（不做「选入口」UI）。
- **去重**：多文件包的 sha256 = 「路径\t文件 sha256」按路径排序后的哈希；只有 `index.html` 一个文件的 zip 与单 HTML 同哈希。
- **上限**（`proyubi.pm.mockup.*`）：`max-bytes` 5MB（入口 HTML）/ `max-total-bytes` 100MB / `max-files` 500；zip 本体 `max-zip-bytes` 50MB（画面上传与 MCP `zipBase64` 共用；`spring.servlet.multipart.max-file-size` 同为 50MB，`max-request-size` 60MB，其他上传接口各自有上限，不受影响）。
- **API**：pm-web 用 `POST /app/pm/mockups/upload`（multipart：`file` + `title/note/projectId/taskId/bugId/mockupId`，.html / .zip 都走这里）；JSON 的 `POST /app/pm/mockups {html}` 保留。`/internal/pm/mockups` 增加 `zipBase64` 与 `files: [{path, base64}]`（与 `html` 三选一）；pm-mcp stdio 的 `filePath` 可指 .html / .zip / 文件夹。
- VO 增加 `fileCount`（当前版与各版本）。
