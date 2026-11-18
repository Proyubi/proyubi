declare module "slash2";
declare module "*.css";
declare module "*.less";
declare module "*.scss";
declare module "*.sass";
declare module "*.svg";
declare module "*.png";
declare module "*.jpg";
declare module "*.jpeg";
declare module "*.gif";
declare module "*.bmp";
declare module "*.tiff";
declare module "omit.js";
declare module "numeral";
declare module "mockjs";
declare module "react-fittext";
// simple-mind-map 的插件以 src/*.js 子路径引入，未随包提供对应 .d.ts，这里声明为模块。
declare module "simple-mind-map/src/plugins/*";

declare const REACT_APP_ENV: "test" | "dev" | "pre" | false;

/**
 * public/ の logo・favicon 用キャッシュバスター。config/assets.ts が画像の内容から
 * md5 を算出し、config.ts の `define` でビルド時に文字列へ置換される。
 */
declare const ASSET_VERSION: string;
