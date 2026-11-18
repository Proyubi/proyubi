import { join } from "node:path";
import { defineConfig } from "@umijs/max";
import { ASSET_VERSION, assetUrl } from "./assets";
import defaultSettings from "./defaultSettings";
import proxy from "./proxy";
import routes from "./routes";

const { REACT_APP_ENV = "dev" } = process.env;
const PUBLIC_PATH: string = "/";

export default defineConfig({
  hash: true,
  publicPath: PUBLIC_PATH,
  routes,
  ignoreMomentLocale: true,
  proxy: proxy[REACT_APP_ENV as keyof typeof proxy],
  fastRefresh: true,
  model: {},
  initialState: {},
  title: "プロジェクト管理",
  layout: {
    locale: true,
    ...defaultSettings,
  },
  moment2dayjs: {
    preset: "antd",
    plugins: ["duration"],
  },
  locale: {
    default: "ja-JP",
    antd: true,
    baseNavigator: true,
  },
  antd: {
    appConfig: {},
    configProvider: {
      // antd v6 デプリケーション警告を 1 行に集約（pro-components の内部実装が
      // 旧 props を使うため大量に出るのを抑止。挙動は不変・本番では元々除去される）
      warning: { strict: false },
      theme: {
        cssVar: true,
        token: {
          fontFamily:
            "'Noto Sans JP', -apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', Meiryo, 'Helvetica Neue', Arial, sans-serif",
        },
      },
    },
  },
  request: {},
  access: {},
  links: [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    {
      rel: "preconnect",
      href: "https://fonts.gstatic.com",
      crossorigin: "anonymous",
    },
    {
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap",
    },
  ],
  headScripts: [{ src: join(PUBLIC_PATH, "scripts/loading.js"), async: true }],
  // UMI の favicons 機能は src/ 配下しか見ないため、public/favicon.ico を置いていても
  // <link rel="shortcut icon"> が一切出力されず、ブラウザは /favicon.ico を暗黙に
  // 取りに行く。暗黙 favicon はキャッシュが極端に強く、差し替えても何ヶ月も古いまま
  // なので、内容 hash 付きで明示的に宣言する。
  favicons: [assetUrl("favicon.ico")],
  // src/ 側（ログイン画面・法務ページ）から参照するキャッシュバスター。
  define: { ASSET_VERSION },
  // Design Studio：mako は package.json exports の production/development 条件を解決できず
  // `@excalidraw/excalidraw/index.css` が PackagePathNotExported になるため、固定版の dist を直接指す
  alias: {
    "@excalidraw-dist": join(
      __dirname,
      "../node_modules/@excalidraw/excalidraw/dist/prod",
    ),
  },
  // Design Studio：Excalidraw のフォントを固定版のまま自前配信（DesignCanvas の EXCALIDRAW_ASSET_PATH）
  copy: [
    {
      from: "node_modules/@excalidraw/excalidraw/dist/prod/fonts",
      to: "excalidraw-assets/fonts",
    },
  ],
  presets: ["umi-presets-pro"],
  mako: {},
  esbuildMinifyIIFE: true,
}) as ReturnType<typeof defineConfig>;
