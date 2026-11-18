import type { ProLayoutProps } from "@ant-design/pro-components";

const Settings: ProLayoutProps & {
  pwa?: boolean;
  logo?: string;
} = {
  navTheme: "light",
  colorPrimary: "#1677ff",
  layout: "side",
  defaultCollapsed: true,
  contentWidth: "Fluid",
  fixedHeader: true,
  fixSiderbar: true,
  colorWeak: false,
  title: "Proyubi",
  pwa: false,
  // キャッシュバスター付きの URL はランタイム側で当てる（src/constants/assets.ts の
  // LOGO_URL）。このファイルは config.ts からも読まれるので Node 依存を持ち込めない。
  logo: "/logo.png",
  iconfontUrl: "",
  token: {},
};

export default Settings;
