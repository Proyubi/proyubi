/**
 * 临时 Mock：当前没有后端，让应用以「已登录」状态直接进入，菜单走前端静态配置。
 *
 * 接入真实后端后：把 MOCK_NO_BACKEND 改为 false（或删除本文件及 app.tsx 中对它的引用），
 * getInitialState 就会恢复调用 getCurrentUser / getBootstrapData 的正常流程。
 */

export const MOCK_NO_BACKEND = false;

const mockCurrentUser: API.CurrentUser = {
  loginId: "demo",
  name: "田炎平",
  avatar: "",
  tenantId: "mock-tenant",
  role: "owner",
};

/**
 * 侧栏菜单（前端静态）。app.tsx 的 menuDataRender 会用 initialState.menuTree 渲染，
 * access.ts 也会用它做路由级鉴权（path 命中即放行）。
 * 数组顺序即侧栏顺序：均为 PM 业务页面。
 */
const mockMenuTree: API.RouteItemVO[] = [
  {
    path: "/overview",
    name: "overview",
    meta: { title: "俯瞰", icon: "dashboard", orderNo: 1 },
  },
  {
    path: "/projects",
    name: "projects",
    meta: { title: "项目管理", icon: "project", orderNo: 2 },
  },
  {
    path: "/quality",
    name: "quality",
    meta: { title: "品質管理", icon: "shield-check", orderNo: 3 },
  },
  {
    path: "/resources",
    name: "resources",
    meta: { title: "成员视图", icon: "team", orderNo: 4 },
  },
  {
    path: "/customers",
    name: "customers",
    meta: { title: "客户 / 产品", icon: "appstore", orderNo: 4 },
  },
  {
    path: "/notifications",
    name: "notifications",
    meta: { title: "通知", icon: "bell", orderNo: 5 },
  },
];

const mockGrantedPermissions: string[] = ["*"];

export function mockInitialState() {
  const fetchUserInfo = async () => mockCurrentUser;
  return {
    fetchUserInfo,
    currentUser: mockCurrentUser,
    menuTree: mockMenuTree,
    grantedPermissions: mockGrantedPermissions,
  };
}
