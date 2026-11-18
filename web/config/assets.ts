import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `?v=` を付ける対象。public/ 配下の「ファイル名が固定」な静的資産。
 * 新しく logo 系ファイルを増やしたらここにも足すこと。
 */
const VERSIONED_ASSETS = [
  "favicon.ico",
  "logo.png",
  "logo.svg",
  "logo-white.svg",
];

/**
 * public/ の静的資産の中身から算出するキャッシュバスター。
 *
 * JS/CSS は UMI が出力ファイル名に hash を付ける（= 内容が変われば URL も変わる）ので
 * 問題ないが、logo と favicon はファイル名が固定なので、画像を差し替えても
 * ブラウザ・CDN が古いものを使い続ける。手で `?v=20260616` を書き換える運用は
 * 必ず忘れるため、内容の md5 から自動生成する。
 *
 * 中身が変わったときだけ値が変わるので、デプロイのたびに無駄に再ダウンロードされることもない。
 */
export const ASSET_VERSION: string = (() => {
  const hash = createHash("md5");
  for (const file of VERSIONED_ASSETS) {
    try {
      hash.update(readFileSync(join(process.cwd(), "public", file)));
    } catch {
      // 対象ファイルが無くてもビルドは落とさない（版が変わらないだけ）
    }
  }
  return hash.digest("hex").slice(0, 8);
})();

/** public/ 直下の静的資産への、キャッシュバスター付き URL を返す。 */
export function assetUrl(file: string): string {
  return `/${file}?v=${ASSET_VERSION}`;
}
