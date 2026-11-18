import { RightOutlined } from "@ant-design/icons";
import type { Settings as LayoutSettings } from "@ant-design/pro-components";
import type { MenuDataItem } from "@ant-design/pro-components";
import type { RequestConfig, RunTimeLayoutConfig } from "@umijs/max";
import { history } from "@umijs/max";
import { Avatar } from "antd";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/services/platform/auth";
import { getBootstrapData } from "@/services/platform/bootstrap";
import { getTeamName } from "@/services/platform/team";
import defaultSettings from "../config/defaultSettings";
import { LOGO_URL } from "@/constants/assets";
import {
  errorConfig,
  goServerError,
  isGatewayError,
} from "./requestErrorConfig";
import { renderLucideMenuIcon } from "@/utils/lucide-menu-icon";
import { MOCK_NO_BACKEND, mockInitialState } from "@/mockBackend";
import { DataProvider } from "@/pm/store";
import TaskSearchPalette from "@/components/TaskSearchPalette";

const loginPath = "/user/login";

/**
 * 无需登录即可访问的公开路径（前缀匹配）。未登录访问这些页面时不强制跳登录，
 * 由页面自身处理鉴权（如邀请深链 /invitations/accept 会按需引导登录）。
 */
const PUBLIC_PATHS = [
  loginPath,
  "/invitations/accept",
  "/502",
  "/terms",
  "/privacy",
  "/share",
];
const isPublicPath = (pathname: string) =>
  PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

const shouldFetchUserOnPublicPath = (pathname: string) =>
  pathname === "/invitations/accept" ||
  pathname.startsWith("/invitations/accept/");

/**
 * レイアウトに渡す設定。logo だけはキャッシュバスター付き URL に差し替える
 *（defaultSettings 側は Node からも読まれるため素の /logo.png を持つ）。
 */
const layoutSettings = {
  ...defaultSettings,
  logo: LOGO_URL,
} as Partial<LayoutSettings>;

export async function getInitialState(): Promise<{
  settings?: Partial<LayoutSettings>;
  currentUser?: API.CurrentUser;
  menuTree?: API.RouteItemVO[];
  grantedPermissions?: string[];
  /** 当前团队（租户）名；用户自定义后用于侧边栏标题，未修改则回退到 defaultSettings.title */
  tenantName?: string;
  loading?: boolean;
  fetchUserInfo?: () => Promise<API.CurrentUser | undefined>;
}> {
  // 临时 mock：无后端时直接以已登录状态进入，菜单走前端静态配置。接后端后删除本分支。
  if (MOCK_NO_BACKEND) {
    return {
      ...mockInitialState(),
      settings: layoutSettings,
    };
  }

  const fetchUserInfo = async () => {
    try {
      const data = await getCurrentUser({ skipErrorHandler: true });
      // 后端返回 HTTP 200 + { code: 401 } 时，skipErrorHandler 会跳过 errorThrower，
      // 导致返回原始对象而非 unwrap 后的 user。需要校验 loginId 确认是有效用户。
      if (data && (data as any).loginId) {
        return data as API.CurrentUser;
      }
    } catch (error) {
      // getCurrentUser 带 skipErrorHandler，错误不进 errorHandler，需在此自行判定：
      // 后端网关不可达（502/503/504 或无响应）→ 整页 502，而不是误跳登录。
      if (isGatewayError(error)) {
        goServerError();
        return undefined;
      }
      // 其余（含后端 401）按下方逻辑处理
    }
    // 公开页（如邀请深链）未登录时不强制跳登录，交由页面自行处理
    if (!isPublicPath(history.location.pathname)) {
      history.push(loginPath);
    }
    return undefined;
  };

  const fetchBootstrap = async (): Promise<{
    menuTree?: API.RouteItemVO[];
    grantedPermissions?: string[];
  }> => {
    try {
      const data = await getBootstrapData();
      return {
        menuTree: data?.menuTree,
        grantedPermissions: data?.grantedPermissions,
      };
    } catch {
      return {};
    }
  };

  const fetchTeamName = async (): Promise<string | undefined> => {
    try {
      const data = await getTeamName();
      return data?.name;
    } catch {
      return undefined;
    }
  };

  const { location } = history;
  // 登录页与静态公开页（如利用規約 / プライバシーポリシー）不依赖用户态，不主动拉取用户，
  // 以避免后端异常时这些页面也被带去 502。
  // 邀请深链虽然是公开页，但需要识别当前是否已登录以及登录身份，因此仍会尝试拉取用户信息。
  if (
    !isPublicPath(location.pathname) ||
    shouldFetchUserOnPublicPath(location.pathname)
  ) {
    const currentUser = await fetchUserInfo();

    const [bootstrap, tenantName] = currentUser
      ? await Promise.all([fetchBootstrap(), fetchTeamName()])
      : [{}, undefined];
    return {
      fetchUserInfo,
      currentUser,
      menuTree: bootstrap?.menuTree,
      grantedPermissions: bootstrap?.grantedPermissions,
      tenantName,
      settings: layoutSettings,
    };
  }
  return {
    fetchUserInfo,
    settings: layoutSettings,
  };
}

/** 将后端 RouteItemVO 转换为 Ant Design Pro MenuDataItem */
function convertToMenuData(items: API.RouteItemVO[]): MenuDataItem[] {
  return items.map((item) => ({
    path: item.path,
    name: item.meta?.title,
    locale: false,
    icon: item.meta?.icon ? renderLucideMenuIcon(item.meta.icon) : undefined,
    children: item.children ? convertToMenuData(item.children) : undefined,
  }));
}

export const layout: RunTimeLayoutConfig = ({ initialState }) => {
  // 侧边栏标题：显示自定义的团队（租户）名。注册时租户名默认取邮箱/用户名/表示名，
  // 用户若未在「チーム管理」改过，则租户名仍等于这些默认值 → 回退到 defaultSettings.title。
  const rawTenantName = initialState?.tenantName?.trim();
  const u = initialState?.currentUser;
  const defaultTenantNames = [u?.email, u?.loginId, u?.displayName, u?.name]
    .map((v) => v?.trim())
    .filter(Boolean);
  const isCustomTenantName =
    !!rawTenantName && !defaultTenantNames.includes(rawTenantName);
  const sidebarTitle = isCustomTenantName
    ? rawTenantName
    : defaultSettings.title;
  return {
    headerTitleRender: (logo) => <>{logo}</>,
    // 左右结构：去掉顶部 header，三个快捷功能下移到左侧菜单底部
    headerRender: false,
    // 默认收缩（非受控：ProLayout 自管，刷新后回到收缩，不记忆上次状态）
    defaultCollapsed: true,
    // 关键：关闭 Sider 响应式断点，否则宽屏挂载时会自动展开、把默认收缩冲掉
    breakpoint: false,
    avatarProps: undefined,
    // 検索の可視な入口は各ページヘッダーの extra（SearchButton）に置く。
    // ここではパレット本体＝⌘K リスナーだけをぶら下げる。サイドバー側に置くと、
    // モバイルで ProLayout がサイドバーを Drawer に入れるため、Drawer を開くまで
    // ⌘K リスナーもモーダルも存在しない状態になる。
    childrenRender: (children) => (
      <>
        {children}
        {initialState?.currentUser ? <TaskSearchPalette /> : null}
      </>
    ),
    menuFooterRender: (props) => {
      if (!initialState?.currentUser) return null;
      const displayName =
        initialState.currentUser.name ||
        initialState.currentUser.loginId ||
        "?";
      const firstLetter = displayName.charAt(0).toUpperCase();
      const avatarNode = initialState.currentUser.avatar ? (
        <Avatar size="small" src={initialState.currentUser.avatar} />
      ) : (
        <Avatar
          size="small"
          style={{ backgroundColor: "#1677ff", fontSize: 14 }}
        >
          {firstLetter}
        </Avatar>
      );
      const collapsed = props?.collapsed;
      return (
        <div>
          {/* 通知は侧栏「通知」菜单（/notifications）へ移動；チーム切替・言語はアカウント設定へ */}
          {/* 当前用户 / 订阅 → 设置 */}
          <div
            onClick={() => history.push("/settings")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              cursor: "pointer",
              justifyContent: collapsed ? "center" : "flex-start",
              borderTop: "1px solid rgba(0, 0, 0, 0.06)",
              borderRadius: 6,
              minWidth: 0,
            }}
          >
            {avatarNode}
            {!collapsed && (
              <>
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 14,
                  }}
                >
                  {displayName}
                </span>
                <RightOutlined style={{ color: "#999", fontSize: 12 }} />
              </>
            )}
          </div>
        </div>
      );
    },
    onPageChange: () => {
      const { location } = history;
      if (!initialState?.currentUser && !isPublicPath(location.pathname)) {
        history.push(loginPath);
      }
    },
    menuHeaderRender: undefined,
    menuDataRender: (menuData: MenuDataItem[]) => {
      // 使用后端返回的动态菜单，不降级到 routes.ts 静态配置
      // 避免未授权用户看到全部菜单
      if (initialState?.menuTree && initialState.menuTree.length > 0) {
        return convertToMenuData(initialState.menuTree);
      }
      // Bootstrap 未返回菜单时，只保留基础路由（overview、settings）
      return menuData.filter(
        (item) => item.path === "/overview" || item.path === "/settings"
      );
    },
    ...initialState?.settings,
    // settings.title 之后覆盖：未自定义团队名时仍为 defaultSettings.title
    title: sidebarTitle,
  };
};

export const request: RequestConfig = {
  // baseURL 由 config/config.prod.ts 通过 define 注入；dev 留空走 UMI proxy
  baseURL: process.env.API_BASE_URL || "",
  ...errorConfig,
};

const SUPPORTED_LOCALES = ["ja-JP", "zh-CN", "zh-TW", "en-US"] as const;

function detectBrowserLocale(): string {
  if (typeof navigator === "undefined") return "ja-JP";
  const candidates = [
    navigator.language,
    ...((navigator.languages as readonly string[] | undefined) ?? []),
  ].filter(Boolean);
  for (const raw of candidates) {
    const tag = String(raw).toLowerCase();
    const exact = SUPPORTED_LOCALES.find((s) => s.toLowerCase() === tag);
    if (exact) return exact;
    if (
      tag.startsWith("zh-tw") ||
      tag.startsWith("zh-hk") ||
      tag.startsWith("zh-mo") ||
      tag.startsWith("zh-hant")
    ) {
      return "zh-TW";
    }
    if (tag.startsWith("zh")) return "zh-CN";
    if (tag.startsWith("ja")) return "ja-JP";
    if (tag.startsWith("en")) return "en-US";
  }
  return "ja-JP";
}

export const locale = {
  getLocale() {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem("umi_locale");
      if (stored) return stored;
    }
    return detectBrowserLocale();
  },
};

// 用 DataProvider 包裹整个应用，PM 业务页（项目列表 / 甘特图）通过 useData 懒加载后端 /app/pm 数据
export function rootContainer(container: ReactNode) {
  return <DataProvider>{container}</DataProvider>;
}
