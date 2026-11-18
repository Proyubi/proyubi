// Pencil の旧い .pen の書き方を OpenPencil 0.16 のリーダーが読める形に直す（1 ノード分）。
// リーダーが黙って捨てるので、直さないと枠線が全部消え、太字が通常の太さになる。

type PenNode = Record<string, unknown>;

/** 数字だけの文字列（"600" など）の太さを数値に。リーダーは数値と bold 等の名前しか知らず、それ以外は 400 になる */
function numericWeight(value: unknown): number | null {
  return typeof value === 'string' && /^\d{3}$/.test(value.trim())
    ? Number(value)
    : null;
}

/** 旧形式の strokeWidth：数値か、辺ごとの { bottom: 1 } など（書いていない辺は線なし）。省略は 1 */
function legacyThickness(value: unknown): number | Record<string, number> {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const sides: Record<string, number> = {};
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const v = (value as Record<string, unknown>)[side];
      sides[side] = typeof v === 'number' ? v : 0;
    }
    return sides;
  }
  return 1;
}

/** node を書き換えたら true */
export function normalizeLegacyPenNode(node: PenNode): boolean {
  let changed = false;
  // 旧形式の枠線：stroke が色の文字列、太さは strokeWidth（新形式は { fill, thickness }）
  if (typeof node.stroke === 'string') {
    node.stroke = {
      fill: node.stroke,
      thickness: legacyThickness(node.strokeWidth),
      align: 'inside',
    };
    delete node.strokeWidth;
    changed = true;
  }
  for (const key of ['fontWeight', 'weight'] as const) {
    const weight = numericWeight(node[key]);
    if (weight !== null) {
      node[key] = weight;
      changed = true;
    }
  }
  return changed;
}
