/**
 * public/ 配下の静的資産（ファイル名が固定なもの）へのキャッシュバスター付き URL。
 *
 * `ASSET_VERSION` は config/assets.ts が画像の内容から md5 を算出し、
 * config.ts の `define` でビルド時に文字列へ置換される。画像を差し替えれば
 * 値が変わるので、ブラウザが古い logo を掴んだままになることがない。
 *
 * config/defaultSettings.ts は config.ts（Node 側）からも読まれるため、
 * この定数はそちらではなくランタイム側で当てる。
 */
export const LOGO_URL = `/logo.png?v=${ASSET_VERSION}`;

/** 青背景の上に置く白抜きのロゴ（ログイン画面の左パネル）。 */
export const LOGO_WHITE_URL = `/logo-white.svg?v=${ASSET_VERSION}`;
