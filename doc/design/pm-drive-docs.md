# PM 客户资料 × 外部网盘（Google ドライブ等）联动 — 第一步设计

> 2026-10-15。效果图：https://claude.ai/artifact/SCJiJUnGDbsN7b8SPNDLoN （5 张：顧客資料 / 案件資料パネル / タスク資料タブ / 追加ダイアログ / 预览失败兜底）。

> 当前页面入口范围以 §9 为准；前面的客户页设计仅保留作历史记录。

## 1. 目标与原则

客户给的原始资料（Excel / PDF / Word / 图片…）放在客户或我们自己的 Google ドライブ / SharePoint / Box 里。PM 里**只存链接 + 对应关系**（顧客 / 案件 / タスク），开发人员在 PM 里直接预览。

- **不复制、不同步文件**：文件本体始终在网盘，权限由网盘的共享设置决定。
- **第一步不接 OAuth / Drive API**：纯 URL 识别 + 网盘官方嵌入 URL（iframe）。
- 第二步（未做）：Google Picker（`drive.file` 权限，前端选文件）。第三步（不做）：服务端读 Drive 内容（`drive.readonly` 受限权限，需 CASA 审核）。
- 现有 `pm_task_link`（デザイン页签，Figma 链接）**保持不动**，与本功能并存。

### 与效果图的差异（第一步的限制）

效果图②里「案件フォルダ内の全ファイルを一覧し、各ファイルの紐付けを表示」需要 Drive API 列目录。第一步改为：
- 「フォルダ」视图 = 根文件夹的 Google 官方嵌入视图（`embeddedfolderview`，只读浏览，无法在其中标注任务）；
- 「登録済み資料」视图 = 在 PM 登记过的资料，显示任务对应关系，支持「未紐付け」筛选。

## 2. 数据模型

### `pm_doc`（资料）

| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | 应用侧 `UUID.randomUUID()` |
| tenant_id | uuid not null → platform_tenant | |
| customer_id | uuid not null → pm_customer | 所属客户。登记到案件时由服务端从案件取，不信前端 |
| project_id | uuid null → pm_project | null = 顧客共通 |
| is_root | boolean not null default false | 根文件夹（顧客ルート / 案件フォルダ）。每个 (customer, project 或 null) 至多一个未删除的 root |
| url | text not null | http(s)，≤2000 |
| provider | text not null | `google` / `microsoft` / `box` / `other` |
| kind | text not null | `gdoc` / `gsheet` / `gslide` / `gfile` / `gfolder` / `ms` / `box` / `link` |
| external_id | text null | 从 URL 解析出的 Google 文件/文件夹 id |
| title | text null | 显示名，≤200；空则前端用 URL 推断 |
| created_by | uuid not null | platform_tenant_user.id |
| created_by_name | text null | 写入时快照显示名（同 pm_comment 的做法） |
| created_at / updated_at / deleted_at | timestamptz | 软删除 |

索引：`(tenant_id, customer_id, deleted_at)`、`(project_id, deleted_at)`；部分唯一索引保证 root 唯一：
`unique (tenant_id, customer_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)) where is_root and deleted_at is null`。

### `pm_doc_task`（资料 ↔ 任务，多对多）

| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid not null | |
| doc_id | uuid not null → pm_doc | |
| task_id | uuid not null → pm_task | 必须与 doc 同案件 |
| created_by | uuid not null | |
| created_at / deleted_at | timestamptz | |

部分唯一索引 `(doc_id, task_id) where deleted_at is null`；索引 `(task_id, deleted_at)`。

## 3. URL 识别（服务端判定，前端不可信）

| 输入 URL 形式 | provider | kind | external_id | previewUrl（VO 计算返回，不落库） |
|---|---|---|---|---|
| `docs.google.com/document/d/{id}/…` | google | gdoc | id | `https://docs.google.com/document/d/{id}/preview` |
| `docs.google.com/spreadsheets/d/{id}/…` | google | gsheet | id | `https://docs.google.com/spreadsheets/d/{id}/preview` |
| `docs.google.com/presentation/d/{id}/…` | google | gslide | id | `https://docs.google.com/presentation/d/{id}/preview` |
| `drive.google.com/file/d/{id}/…`、`drive.google.com/open?id={id}`、`drive.google.com/uc?id={id}` | google | gfile | id | `https://drive.google.com/file/d/{id}/preview` |
| `drive.google.com/drive/folders/{id}`、`drive.google.com/drive/u/N/folders/{id}` | google | gfolder | id | `https://drive.google.com/embeddedfolderview?id={id}#list` |
| `*.sharepoint.com`、`onedrive.live.com`、`1drv.ms` | microsoft | ms | null | null（第一步只做链接） |
| `box.com` / `*.box.com` / `app.box.com` | box | box | null | null |
| 其他 http(s) | other | link | null | null |

`{id}` 只接受 `[A-Za-z0-9_-]+`；解析失败则降级为对应 provider 的 link（google 域解析不出 id → kind=link, provider=google, previewUrl=null）。

## 4. API（`/app/pm/**`，返回 `R<T>`）

`PmDocVO`：`id, customerId, projectId, projectName, url, provider, kind, externalId, previewUrl, title, isRoot, tasks: [{taskId, taskName}], createdBy, createdByName, createdAt`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/customers/{customerId}/docs` | 客户全部资料：顧客共通 + 用户可见案件的资料（含各 root）。按 projectId(null 在前)、isRoot desc、createdAt 排序 |
| GET | `/projects/{projectId}/docs` | 案件资料（含 root） |
| GET | `/tasks/{taskId}/docs` | 挂在任务上的资料 |
| POST | `/docs` | body `{customerId?, projectId?, url, title?, taskIds?: uuid[], isRoot?: boolean}`。projectId 优先（customerId 从案件取）；二者都没有 → 400。taskIds 需要 projectId 且每个任务属于该案件、团队可见。isRoot=true 时软删除同 scope 旧 root 再插入（root 不挂任务） |
| PATCH | `/docs/{id}` | body `{title?, taskIds?}`；taskIds 非 null 时整体替换对应关系 |
| DELETE | `/docs/{id}` | 软删除 doc + 其 pm_doc_task |

权限：客户 → `PmCustomerService.getByIdAndTenant`（含团队可见性）；案件 → `PmProjectService.getByIdAndTenant`；任务 → `PmTaskService.getVisibleTask`。客户资料列表中，案件资料只返回团队可见的案件。删除/编辑任意本租户（团队可见）成员可操作，同 `pm_task_link`。

级联（`PmCascadeService`）：任务删除 → 软删其 `pm_doc_task`；案件删除 → 软删该案件 `pm_doc` + 其 `pm_doc_task`；客户删除（若有级联入口）→ 软删客户 `pm_doc`。

## 5. 前端（pm-web）

- `src/pm/types.ts` / `api.ts`：`PmDoc` 类型与 6 个 API 包装。
- 共通组件 `src/pm/docs/`：
  - `DocIcon`：按 kind + 标题/URL 扩展名显示类型方块（PDF/XLS/DOC/PPT/IMG/文件夹/链接）。
  - `DocPreview`：有 previewUrl → iframe（`allow` 最小，`referrerPolicy="no-referrer"`）+ 顶栏（provider·种类·追加者、「新しいタブで開く」）+ 底部常驻提示「表示されない場合：閲覧権限がない／別アカウントでログイン中／ブラウザが埋め込みをブロック → 新しいタブで開く」；无 previewUrl → 兜底卡片（效果图⑤）。
  - `DocAddModal`：URL、表示名、紐付け先（顧客共通 / 案件全体 / タスク + 任务多选），可预设 scope；URL 输入时前端做**仅用于提示**的轻量识别（真正 kind 以服务端为准）。
  - `DocTaskSelect`：任务多选（叶子+汇总都可选，显示 WBS 路径）。
- **タスク編集弹窗**（`gantt/TaskFormModal.tsx`）：在既有页签旁加「資料」页签 → `TaskDocs`：顶部文件 chip 列表 + 「＋ 資料を紐付け」（可新增，或从本案件已登记资料中选择挂上）+ 下方 `DocPreview`。
- **ガント页**（`pages/projects/gantt`）：头部加「案件資料 (n)」按钮 → 右侧 Drawer `ProjectDocsPanel`：案件フォルダ卡片（设定/变更 root）+ 分段「フォルダ（root 嵌入视图）/ 登録済み資料 / 未紐付け」；登録済み列表每行显示 → 任务 tag、「タスクに紐付け」（编辑 taskIds）、删除；点行在 Drawer 内预览。WBS 行的资料数徽标：若改动面小则加，否则不做。
- **顧客页**（`pages/customers`）：每行加「資料」操作 → 宽 Drawer `CustomerDocsDrawer`：顧客ルートフォルダ卡片 + 搜索 + 类型筛选 + 按「顧客共通 / 各案件」分组的表（名前 / 保存先 / 紐付け先 / 追加日）+ 右侧 `DocPreview`。
- i18n：所有新文案进 ja-JP / en-US / zh-CN / zh-TW。

## 6. 第一步不做

OAuth、Google Picker、Drive 目录列举、全文检索、MCP 工具（`pm-mcp` 之后可加 `pm_list_docs`）、SharePoint/Box 嵌入预览、文件上传。

## 7. 第二步：Google Picker（2026-10-15 追加）

目的：从 Google ドライブ 直接选文件（可多选），**文件名 / 类型自动带入**，解决「贴 URL 不填名字就只显示域名」的问题。文件本体仍不经过我们的服务器：Picker 与 OAuth token 只在浏览器里，后端只收到「url / 名称 / mimeType」。

### Google Cloud 侧（复用现有 Google 登录用的项目与 OAuth Client）

1. 启用 Google Drive API、Google Picker API。
2. 新建 API Key：API 限制 = Google Picker API；HTTP referrer 限制 = PM 各域名 + `http://localhost:8000/*`。
3. OAuth Client 的「承認済みの JavaScript 生成元」加 `https://pm.example.com`、`https://pm.example.com`、`http://localhost:8000`。
4. OAuth 同意画面加 scope `https://www.googleapis.com/auth/drive.file`（非敏感，无需审核）。
5. 环境变量（`.env.dev` / `.env.prod`）：`GOOGLE_PICKER_API_KEY`、`GOOGLE_CLOUD_PROJECT_NUMBER`（= Picker 的 appId）；clientId 默认复用 `GOOGLE_OAUTH_CLIENT_ID`，可用 `GOOGLE_PICKER_CLIENT_ID` 覆盖。

### 数据

`pm_doc.mime_type text null`（Picker 返回的 mimeType；贴 URL 时为 null）。迁移 `migrations/2026-10-15-pm-doc-mime.sql`。

### API 追加

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/app/pm/docs/picker-config` | `{enabled, clientId, apiKey, appId}`；三者任一为空 → `enabled=false`，其余字段 null。前端据此决定是否显示「Google ドライブから選択」 |
| POST | `/app/pm/docs/batch` | body `{customerId?, projectId?, taskIds?: uuid[], items: [{url, title?, mimeType?}]}`（items 1..50），一个事务内登记多件，scope/taskIds 规则同 `POST /docs`（不支持 isRoot）。返回 `PmDocVO[]` |
| POST | `/app/pm/docs` | body 追加可选 `mimeType` |

`PmDocVO` 追加 `mimeType`。

### 前端

- `src/pm/docs/googlePicker.ts`：按需加载 `https://apis.google.com/js/api.js`（`gapi.load('picker')`）与 `https://accounts.google.com/gsi/client`（`google.accounts.oauth2.initTokenClient`，scope `drive.file`）；token 只存内存（页面生命周期内复用，过期重取）。`openPicker({parentFolderId?, multiselect, foldersOnly?}) → Promise<PickedFile[]>`（`{id, name, mimeType, url}`）。视图：有根文件夹时第一个视图 `DocsView().setParent(rootId)`（「このフォルダ」），再加「マイドライブ」「共有ドライブ」(`setEnableDrives(true)`)；`setAppId(appId)`、`enableFeature(SUPPORT_DRIVES)`、多选。
- `DocAddModal` 第二页签「Google ドライブから選択」：picker-config `enabled=false` 时显示说明（管理者未设定）且禁用。选完后显示已选文件列表（图标 + 名称，可改名、可移除），下方同样选「紐付け先」，确定 → `POST /docs/batch`。
- 根文件夹卡片的「設定 / 変更」也可用 Picker 选文件夹（`foldersOnly`）。
- `docFileType` 优先用 mimeType 判定类型。
- 同时修正：根文件夹无表示名时显示「Google ドライブのフォルダ」等 provider 别默认名，不显示域名；顾客資料左侧空列表时提示「フォルダ内のファイルは右側で閲覧できます。PM に登録するとタスクに紐付けられます」；类型筛选由下拉改为 chip 按钮组（すべて / PDF / Excel / Word / PowerPoint / 画像 / フォルダ）。

## 8. 文件夹的角色收敛（2026-10-15 追加）

问题：原来普通资料也能登记文件夹，结果顾客页同时出现「顧客ルートフォルダ」和登记成资料的另一个文件夹，右侧预览成了文件夹列表而不是文件预览；而文件夹嵌入视图（`embeddedfolderview`）是跨域 iframe，点里面的文件只能在新标签打开，`drive.file` 权限也列不出文件夹内容，**无法在面板内点文件预览**。

规则：
- **文件夹只有两种身份**：顧客ルートフォルダ、案件フォルダ（`is_root`）。普通资料只能是文件。后端 `PmDocService.insertDoc` 对非 root 的 `gfolder` / 文件夹 mimeType 返回 400；前端 URL 登记做同样校验，Picker 文件模式下文件夹可进入但不可选。
- **右侧只预览登记过的资料，不再显示文件夹内容**：去掉横条的「中身を表示」和案件面板的「フォルダ」视图（文件夹嵌入视图点不进预览，又和「資料を追加 → Picker 选文件」重复，用户看不懂两者关系）。根文件夹 / 案件文件夹不出现在资料列表里（它们是设定，不是资料）；看文件夹内容用「ルートフォルダを開く」去 Drive。类型筛选去掉「フォルダ」。默认选中列表第一个文件，列表为空时右侧只显示提示。
- **登记入口只有一个**：抽屉右上角「資料を追加」。设了 Google 根文件夹时直接打开「Google ドライブから選択」页签、Picker 以根文件夹为起点。空列表、文件夹预览底部都只放文字引导（指向右上角），不再放第二个按钮。
- 已有的「登记成资料的文件夹」不做迁移，照常显示，可删除。

## 9. Drive 联动仅保留在 Gantt（2026-10-16）

- **Gantt 保留**：案件资料抽屉、案件文件夹设定、Google Picker、资料预览与任务关联；从 Gantt 打开的任务编辑窗保留「資料」页签。
- **其它页面移除入口**：客户列表不再提供「資料」按钮和客户资料抽屉；资源页复用任务编辑窗时不显示「資料」页签。
- **共用组件默认关闭**：`TaskFormModal.showDocs` 默认为 `false`，仅 `pages/projects/gantt.tsx` 显式启用；隐藏页签时不挂载 `TaskDocs`。
- 删除闲置的客户资料抽屉与前端客户资料查询包装。已有 `pm_doc`、任务关联与后端 API 保留；Gantt 内的客户共通资料登记范围维持现状，不做数据删除或迁移。
