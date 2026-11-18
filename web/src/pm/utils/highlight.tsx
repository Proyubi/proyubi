import type { ReactNode } from "react";

/**
 * キーワードに一致する最初の 1 箇所を {@code <mark>} で囲む。
 * 大小無視。keyword 空 or 不一致ならそのまま文字列を返す。
 *
 * 1 箇所だけなのは意図的：WBS の行もパレットの行も 1 行に収まる短い名前が対象で、
 * 全出現を塗ると「どこがヒットか」よりノイズの方が勝つ。
 */
export function highlightText(text: string, keyword?: string): ReactNode {
  const kw = keyword?.trim();
  if (!kw) return text;
  const i = text.toLowerCase().indexOf(kw.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="pm-hit">{text.slice(i, i + kw.length)}</mark>
      {text.slice(i + kw.length)}
    </>
  );
}
