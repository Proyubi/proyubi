declare namespace API {
  /** 通用分页参数 */
  interface PageParams {
    page?: number;
    size?: number;
    keyword?: string;
  }

  /** 通用分页结果 */
  interface PageResult<T> {
    list: T[];
    total: number;
  }

  /** 登录请求 */
  interface LoginParams {
    username: string;
    password: string;
  }

  /** 注册请求 */
  interface RegisterParams {
    username: string;
    password: string;
    displayName?: string;
  }

  /** 登录响应（注册也返回此结构） */
  interface LoginResult {
    token: string;
    loginId: string;
    accountClosing?: boolean;
    deletionRequestedAt?: string;
    remainingDays?: number;
    forcePasswordChange?: boolean;
  }

  /** 当前用户 */
  interface CurrentUser {
    loginId: string;
    /** 展示名：有表示名时为表示名，否则后端回退为 loginId（用于侧边栏等展示） */
    name?: string;
    /** 原始表示名（display_name）：未设置时为 null/空，供设置页表单回填，区别于 name 的兜底值 */
    displayName?: string;
    avatar?: string;
    tenantId?: string;
    role?: string;
    accountClosing?: boolean;
    deletionRequestedAt?: string;
    remainingDays?: number;
    forcePasswordChange?: boolean;
    /** 该账号是否设置了密码（OAuth-only 用户为 false，用于决定是否显示"修改密码"等入口） */
    hasPassword?: boolean;
    /** 账号绑定的邮箱（OAuth 用户为 Google 邮箱；用户名密码用户通常为空） */
    email?: string;
    /** 账号注册时间（ISO 8601） */
    createdAt?: string;
    /** 当前账号可访问的所有团队（含当前团队，邮箱级账号才有；username 子账号为空数组） */
    availableTeams?: TeamMembership[];
  }

  /** 多租户成员关系（用于团队切换器） */
  interface TeamMembership {
    tenantUserId: string;
    tenantId: string;
    tenantName?: string;
    displayName?: string;
    role: "owner" | "member";
    isCurrent: boolean;
  }

  /** 团队成员 */
  interface TeamMember {
    id: string;
    username?: string;
    displayName?: string;
    role: "owner" | "member";
    isEnabled: boolean;
    createdByOwner: boolean;
    hasCustomPermissions?: boolean;
    createdAt: string;
    lastLoginAt?: string;
    /** 所属子团队（多团队工作区时使用）；owner 通常为空（全チーム可見） */
    teams?: { id: string; name: string }[];
  }

  /** 权限项 */
  interface PermissionItem {
    code: string;
    name: string;
    type: "menu" | "button";
    action: string;
  }

  /** 权限组 */
  interface PermissionGroup {
    group: string;
    groupLabel: string;
    permissions: PermissionItem[];
  }

  /** 权限模块 */
  interface PermissionModule {
    module: string;
    moduleLabel: string;
    groups: PermissionGroup[];
  }

  /** 成员权限 */
  interface MemberPermissions {
    memberId: string;
    custom: boolean;
    permissions: string[];
  }

  /** 团队邀请 */
  interface Invitation {
    id: string;
    tenantId?: string;
    inviterUserId?: string;
    inviterName?: string;
    tenantName?: string;
    email: string;
    displayName?: string;
    role: "owner" | "member";
    customPermissions?: string[];
    message?: string;
    status: "pending" | "accepted" | "declined" | "revoked" | "expired";
    expiresAt?: string;
    acceptedAt?: string;
    createdAt?: string;
    /** owner 侧 check 接口返回 */
    accountExists?: boolean;
    /** owner 侧 check 接口返回 */
    alreadyMember?: boolean;
    /** 邀请目标团队 id（null/空=默认团队） */
    teamIds?: string[];
  }

  /** 团队（租户内子团队 / platform_team） */
  interface Team {
    id: string;
    name: string;
    color?: string;
    isDefault: boolean;
    sortOrder: number;
    memberCount: number;
    /** 当前套餐是否允许继续新建团队（PRO/TRIAL=true，FREE=false） */
    canCreateMore: boolean;
  }

  /** 团队成员（GET /app/team/teams/:id/members） */
  interface TeamMemberRef {
    tenantUserId: string;
    displayName?: string;
    role: "owner" | "member";
    isEnabled: boolean;
  }

  /** 接受邀请的返回 */
  interface InvitationAcceptResult {
    tenantUserId: string;
    tenantId: string;
    tenantName?: string;
  }

  /** 租户业务配置 */
  interface TenantSettings {
    defaultLowStockThreshold?: number;
    appIconUrl?: string;
    fieldOverrides?: Record<string, Record<string, boolean>>;
    [key: string]: any;
  }

  /** 路由 Meta */
  interface RouteMetaVO {
    title: string;
    icon?: string;
    orderNo?: number;
    hidden?: boolean;
  }

  /** 路由项（后端返回的菜单格式） */
  interface RouteItemVO {
    path: string;
    name?: string;
    component?: string;
    meta?: RouteMetaVO;
    children?: RouteItemVO[];
  }

  /** 能力信息 */
  interface CapabilityInfo {
    code: string;
    name: string;
    status: string;
    limits?: Record<string, any>;
  }

  /** Bootstrap 数据 */
  interface BootstrapData {
    enabledCapabilities: CapabilityInfo[];
    grantedPermissions: string[];
    menuTree: RouteItemVO[];
  }

  /** 通知公告（租户端） */
  interface Notice {
    id: string;
    noticeTitle: string;
    noticeType: "NOTICE" | "ANNOUNCEMENT";
    noticeContent?: string;
    read: boolean;
    createdAt: string;
  }

  /** 未读通知数量 */
  interface UnreadCount {
    count: number;
  }
}
