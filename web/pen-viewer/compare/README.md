# ビューア描画の回帰チェック（Pencil 本体との比較）

`pen-viewer/`（OpenPencil）は Pencil 本体とは別の実装で、.pen の書き方のうち知らないものを**黙って捨てる**。
「文字や図形が出ているか」を目で見るだけでは、枠線・太さ・記号などが欠けていても気づけない。
ビューアを変えたら、Pencil の書き出しを正解として画素で比べる。

## 1. 正解の PNG を Pencil で書き出す

対象の .pen を Pencil で開き、最上位の画框を **1x の PNG、ファイル名 = ノード id** で書き出す。
Claude Code から pencil MCP を使う場合：

```js
// mcp__pencil__execute（filePath に .pen を指定）
Export(["<画框 id>", ...], "png", "/tmp/pen-ref", {scale: 1})
```

画框 id は `mcp__pencil__get_app_state` の Top-level nodes に出る。

## 2. サービスを起動する

- webapi：`:38082`（ログインと `/app/pm/design-fonts` プロキシに使う）
- pm-web：`npm run build:pen-viewer` のあと dev サーバーを**起動し直す**（umi dev は `public/pen-viewer` をメモリに持つので、
  ビルドだけでは古いビューアが配信される）。`curl -s localhost:8000/pen-viewer/index.html` の bundle 名が
  `public/pen-viewer/index.html` と同じことを確かめる。

## 3. 比べる

Python 3 と `playwright`（`playwright install chromium` 済み）、`Pillow`、`numpy` が要る。
アカウントはローカル開発用のものを環境変数で渡す（リポジトリに書かない）。

```bash
export PEN_CMP_USERNAME=... PEN_CMP_PASSWORD=...
python3 pen-viewer/compare/compare.py path/to/file.pen --ref-dir /tmp/pen-ref --out /tmp/pen-cmp
```

画框ごとに 1 行出る：

```
MCGt4  02 AMS 既存担当者の一括紐付け  mean 1.07  >48: 0.39%  worst cells: (1392,432) 8%, ...
```

- `mean` / `>48` は全体の差。アンチエイリアスだけなら `>48` は 1% 未満に収まる。
- `worst cells` は差の集まった 48px 角。**数字より `<id>.hotspots.png`（左＝Pencil、右＝ビューア）を見る**。
  塊で抜けている（文字列ごと無い・枠線が無い・太さが違う）なら不具合、輪郭が少しずれているだけならフォントの描画差。
- 出力先には `<id>.viewer.png`（ビューアの書き出し）と `<id>.diff.png`（差を 4 倍にした濃淡）も残る。

## これまでに見つかった差（`compat.ts` / `icons.ts` / `main.ts` で対応済み）

| 症状 | 原因 |
|---|---|
| 枠線が全部消える | 旧形式 `stroke: "#色"` ＋ `strokeWidth`（数値 / `{bottom: 1}` など辺ごと） |
| 太字が通常の太さ | `fontWeight: "600"`（数字の文字列） |
| アイコンが塗りの四角 | `type: "icon"`（lucide などのライブラリ参照） |
| 記号を含む文字列が丸ごと出ない | OpenPencil は描けない字が 1 つでもあると文字ノードを描かない。記号用の Noto フォントを足して対応 |
| 日本語が豆腐・空白 | Google Fonts が woff2 を返す（UA）／文書の全文字の要求が 8KB を超える |

残る差：☑ などの記号は Pencil が macOS のシステムフォントで描くため、Noto の字形とは大きさ・形が少し違う。
