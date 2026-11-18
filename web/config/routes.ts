export default [
  {
    path: "/user",
    layout: false,
    routes: [
      { path: "/user/login", component: "./user/login" },
      // passwordless 流：注册/找回都合并到 login，旧路径重定向避免外链 404
      { path: "/user/register", redirect: "/user/login" },
      { path: "/user/forgot-password", redirect: "/user/login" },
      { path: "/user/reset-password", redirect: "/user/login" },
      {
        path: "/user/change-initial-password",
        redirect: "/user/login",
      },
    ],
  },
  {
    path: "/oauth/callback",
    layout: false,
    component: "./user/OAuthCallback",
    hideInMenu: true,
  },
  {
    path: "/terms",
    layout: false,
    component: "./terms",
    hideInMenu: true,
  },
  {
    path: "/privacy",
    layout: false,
    component: "./privacy",
    hideInMenu: true,
  },
  // モックアップの対外共有ページ（ログイン不要。token が無効なら「無効」表示のみ）
  {
    path: "/share/m/:token",
    layout: false,
    component: "./share/mockup",
    hideInMenu: true,
  },
  { path: "/", redirect: "/overview" },

  // --- 顶级菜单顺序 = 侧栏顺序 ---
  // PM 业务：俯瞰（全社/担当者の遅延・リスク早期発見）
  {
    path: "/overview",
    name: "overview",
    component: "./overview",
    access: "canAccessMenu",
  },
  // PM 业务：日历（个人/全员月视图，回答「今日/今週やるべきこと」）
  {
    path: "/calendar",
    name: "calendar",
    component: "./calendar",
    access: "canAccessMenu",
  },
  // PM 业务：项目管理 + 甘特图
  {
    path: "/projects",
    name: "projects",
    component: "./projects",
    access: "canAccessMenu",
  },
  {
    path: "/projects/:projectId/gantt",
    component: "./projects/gantt",
    hideInMenu: true,
    access: "canAccessMenu",
  },
  // 案件のモックアップ一覧（ガント画面ヘッダから遷移。?open=<id> でプレビューを直接開く）
  {
    path: "/projects/:projectId/mockups",
    component: "./projects/mockups",
    hideInMenu: true,
    access: "canAccessMenu",
  },
  // 案件の Design Studio（白板 / .pen）。ガント画面ヘッダとタスク詳細から遷移（サイドバー菜单は増やさない）。
  // ?open=<id> でワークスペース、?new=1&taskId=<id> で新規、?taskId=<id> で絞り込み
  {
    path: "/projects/:projectId/designs",
    component: "./projects/designs",
    hideInMenu: true,
    access: "canAccessMenu",
  },
  // PM 业务：品質管理（テストケース + バグ管理）
  {
    path: "/quality",
    name: "quality",
    component: "./quality",
    access: "canAccessMenu",
  },
  {
    path: "/quality/:customerId",
    component: "./quality",
    hideInMenu: true,
    access: "canAccessMenu",
  },
  // PM 业务：成员视图 / 资源视图（リソース）
  {
    path: "/resources",
    name: "resources",
    component: "./resources",
    access: "canAccessMenu",
  },
  // PM 业务：思维导图（独立文档，对标 ProcessOn）
  {
    path: "/mindmaps",
    name: "mindmaps",
    component: "./mindmaps",
    access: "canAccessMenu",
  },
  {
    path: "/mindmaps/:id",
    component: "./mindmaps/edit",
    hideInMenu: true,
    access: "canAccessMenu",
  },
  // PM 业务：客户 / 产品管理
  {
    path: "/customers",
    name: "customers",
    component: "./customers",
    access: "canAccessMenu",
  },
  // PM 业务：通知センター（侧栏铃铛的落地页）
  {
    path: "/notifications",
    name: "notifications",
    component: "./notifications",
    access: "canAccessMenu",
  },
  // PM 业务：节假日（红日子）管理 —— 工期排除周末 + 这些日期
  // 已迁移到「設定 → 祝日管理」Tab；保留路由（深链/旧书签）但从侧栏隐藏
  {
    path: "/holidays",
    name: "holidays",
    component: "./holidays",
    access: "canAccessMenu",
    hideInMenu: true,
  },
  // 配置
  {
    path: "/settings",
    name: "settings",
    component: "./settings",
  },
  {
    path: "/settings/notice/:id",
    component: "./settings/notice-detail",
    hideInMenu: true,
  },

  // --- 不入侧栏的路由 ---
  // 邀请邮件深链：凭 token 预览并接受（无侧栏；未登录会先跳登录再回来）
  {
    path: "/invitations/accept",
    layout: false,
    component: "./invitations/accept",
  },
  // 后端网关不可达整页（由 requestErrorConfig 的 errorHandler 跳转）
  {
    path: "/502",
    layout: false,
    component: "./502",
  },
  {
    path: "*",
    layout: false,
    component: "./404",
  },
];
