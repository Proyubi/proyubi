/**
 * 路由级权限控制
 *
 * - isLoggedIn: 已登录用户可访问
 * - canAccessMenu: 检查后端返回的菜单树中是否包含当前路由
 *   用于防止用户通过直接输入 URL 访问未授权的页面
 */
export default function access(
  initialState:
    | {
        currentUser?: API.CurrentUser;
        menuTree?: API.RouteItemVO[];
      }
    | undefined
) {
  const { currentUser, menuTree } = initialState ?? {};

  // 从菜单树中提取所有被授权的路径
  const authorizedPaths = new Set<string>();
  // 始终允许的基础路径
  authorizedPaths.add("/settings");
  // PM 业务（项目管理 / 甘特图 / 客户产品）已并入 pm-web，作为核心页对所有登录用户开放，
  // 不依赖后端 platform_sys_menu。/projects/:projectId/gantt 由 isAuthorized 的前缀兜底放行。
  authorizedPaths.add("/overview");
  authorizedPaths.add("/calendar");
  authorizedPaths.add("/projects");
  authorizedPaths.add("/quality");
  authorizedPaths.add("/resources");
  authorizedPaths.add("/mindmaps");
  authorizedPaths.add("/customers");
  authorizedPaths.add("/notifications");
  authorizedPaths.add("/holidays");

  function collectPaths(items?: API.RouteItemVO[]) {
    if (!items) return;
    for (const item of items) {
      if (item.path) {
        authorizedPaths.add(item.path);
      }
      if (item.children) {
        collectPaths(item.children);
      }
    }
  }
  collectPaths(menuTree);

  const isAuthorized = (path: string): boolean => {
    if (authorizedPaths.has(path)) return true;
    for (const p of authorizedPaths) {
      if (path.startsWith(p + "/")) return true;
    }
    return false;
  };

  return {
    isLoggedIn: !!currentUser,
    canAccessMenu: (route: { path?: string }) => {
      if (!currentUser) return false;
      if (!route.path) return true;
      return isAuthorized(route.path);
    },
  };
}
