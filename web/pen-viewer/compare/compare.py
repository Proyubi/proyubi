#!/usr/bin/env python3
"""OpenPencil ビューアの描画を Pencil 本体の書き出し（正解）と画框ごとに比べる回帰チェック。

使い方は同じフォルダの README.md。要点：
  1. Pencil で .pen の最上位画框を 1x の PNG（ファイル名 = ノード id.png）に書き出して ref-dir に置く
  2. webapi（既定 :38082）と pm-web の dev サーバー（既定 :8000）を最新のビューアで起動しておく
  3. PEN_CMP_USERNAME / PEN_CMP_PASSWORD（ローカル開発用アカウント）を環境変数で渡して実行する

ビューアを /pen-viewer/index.html として iframe で開き、PenWorkspace と同じ postMessage 契約
（src/pm/design/penViewerProtocol.ts）で .pen を読ませ、fonts イベント後に全画框を PNG で書き出させる。
"""
import argparse
import base64
import json
import os
import sys
import urllib.request

import numpy as np
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

# 画素の差がこれを超えたら「違う」とみなす（アンチエイリアスの揺れは 48 以下に収まる）
PIXEL_THRESHOLD = 48
# 差分の塊を探す格子の大きさ（px）
CELL = 48

DRIVE_VIEWER_JS = r"""async ([penB64, token, scale]) => {
  const bytes = Uint8Array.from(atob(penB64), c => c.charCodeAt(0));
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;inset:0;width:1600px;height:1000px;border:0;z-index:99999;background:#fff';
  const seen = [];
  const waitFor = (pred, ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout; events: ' + seen.map(e => e.type).join(','))), ms);
    const onMessage = e => {
      if (e.source !== frame.contentWindow) return;
      seen.push(e.data);
      if (pred(e.data)) { clearTimeout(timer); window.removeEventListener('message', onMessage); resolve(e.data); }
    };
    window.addEventListener('message', onMessage);
  });
  const ready = waitFor(d => d.type === 'ready', 30000);
  frame.src = '/pen-viewer/index.html';
  document.body.appendChild(frame);
  await ready;
  const loaded = waitFor(d => d.type === 'loaded' || d.type === 'error', 60000);
  const fonts = waitFor(d => d.type === 'fonts', 180000);
  const post = (msg, transfer) => frame.contentWindow.postMessage(msg, location.origin, transfer);
  post({type: 'init', apiBase: '', headers: {satoken: token, 'X-App-Code': 'pm-web-jp', 'X-Lang': 'ja-JP'}});
  post({type: 'load', data: bytes.buffer, fileName: 'compare.pen'}, [bytes.buffer]);
  const l = await loaded;
  if (l.type === 'error') throw new Error(l.message);
  const f = await fonts;
  await new Promise(r => setTimeout(r, 1500));
  const exported = waitFor(d => d.type === 'exported' || (d.type === 'error' && d.requestId === 'cmp'), 120000);
  post({type: 'export', requestId: 'cmp', nodeIds: l.frames.map(fr => fr.nodeId), scale});
  const r = await exported;
  if (r.type === 'error') throw new Error(r.message);
  const b64 = buf => {
    let s = ''; const u = new Uint8Array(buf);
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  return {frames: l.frames, failedFonts: f.failed, images: r.images.map(i => ({nodeId: i.nodeId, png: i.png ? b64(i.png) : null}))};
}"""


def login(api, username, password):
    req = urllib.request.Request(
        f'{api}/app/auth/login',
        json.dumps({'username': username, 'password': password}).encode(),
        {'Content-Type': 'application/json'},
    )
    body = json.load(urllib.request.urlopen(req))
    if body.get('code') != 0:
        sys.exit(f'login failed: {body.get("msg")}')
    return body['data']['token']


def render_with_viewer(web, pen_bytes, token, scale):
    problems = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_context(viewport={'width': 1600, 'height': 1000}).new_page()
        page.on('console', lambda m: problems.append(f'[{m.type}] {m.text}')
                if m.type == 'error' or (m.type == 'warning' and 'GL Driver' not in m.text) else None)
        page.on('response', lambda r: problems.append(f'[{r.status} {r.request.method}] {r.url[:160]}')
                if r.status >= 400 else None)
        # どのページでもよい（同一オリジンの親から postMessage するため）
        page.goto(f'{web}/user/login')
        page.wait_for_load_state('networkidle')
        result = page.evaluate(DRIVE_VIEWER_JS, [base64.b64encode(pen_bytes).decode(), token, scale])
        browser.close()
    return result, problems


def side_by_side(ref, viewer, box, zoom=2):
    a, b = ref.crop(box), viewer.crop(box)
    out = Image.new('RGB', (a.width * 2 + 8, a.height), 'red')
    out.paste(a, (0, 0))
    out.paste(b, (a.width + 8, 0))
    return out.resize((out.width * zoom, out.height * zoom))


def compare_frame(ref_path, viewer_path, out_dir, node_id, hotspots):
    ref = Image.open(ref_path).convert('RGB')
    viewer = Image.open(viewer_path).convert('RGB')
    note = ''
    if viewer.size != ref.size:
        note = f'size differs: viewer {viewer.size} / ref {ref.size}; '
        viewer = viewer.resize(ref.size)
    diff = np.asarray(ImageChops.difference(viewer, ref)).max(axis=2)
    Image.fromarray(np.clip(diff * 4, 0, 255).astype('uint8')).save(f'{out_dir}/{node_id}.diff.png')
    bad = diff > PIXEL_THRESHOLD
    h, w = bad.shape
    cells = bad[: h // CELL * CELL, : w // CELL * CELL].reshape(h // CELL, CELL, w // CELL, CELL).mean(axis=(1, 3))
    order = np.argsort(-cells.ravel())[:hotspots]
    crops = []
    worst = []
    for cy, cx in zip(*np.unravel_index(order, cells.shape)):
        if cells[cy, cx] == 0:
            break
        worst.append(f'({cx * CELL},{cy * CELL}) {cells[cy, cx] * 100:.0f}%')
        box = (max(0, cx * CELL - CELL), max(0, cy * CELL - CELL // 2),
               min(w, cx * CELL + CELL * 4), min(h, cy * CELL + CELL * 3 // 2))
        crops.append(side_by_side(ref, viewer, box))
    if crops:
        sheet = Image.new('RGB', (max(c.width for c in crops), sum(c.height + 6 for c in crops)), 'white')
        y = 0
        for c in crops:
            sheet.paste(c, (0, y))
            y += c.height + 6
        sheet.save(f'{out_dir}/{node_id}.hotspots.png')
    return (f'{note}mean {diff.mean():.2f}  >{PIXEL_THRESHOLD}: {bad.mean() * 100:.2f}%'
            f'  worst cells: {", ".join(worst) or "-"}')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pen', help='比べる .pen ファイル')
    ap.add_argument('--ref-dir', required=True, help='Pencil が書き出した <ノード id>.png の置き場所')
    ap.add_argument('--out', required=True, help='ビューアの PNG・差分・並べた切り抜きの出力先')
    ap.add_argument('--scale', type=float, default=1, help='書き出し倍率（参照 PNG と合わせる。既定 1）')
    ap.add_argument('--hotspots', type=int, default=3, help='画框ごとに切り出す差分の大きい場所の数')
    ap.add_argument('--api', default='http://localhost:38082', help='webapi（ログイン用）')
    ap.add_argument('--web', default='http://localhost:8000', help='pm-web の dev サーバー（/pen-viewer/ を配信）')
    args = ap.parse_args()

    username, password = os.environ.get('PEN_CMP_USERNAME'), os.environ.get('PEN_CMP_PASSWORD')
    if not username or not password:
        sys.exit('PEN_CMP_USERNAME / PEN_CMP_PASSWORD を設定してください（ローカル開発用アカウント）')
    os.makedirs(args.out, exist_ok=True)

    token = login(args.api, username, password)
    with open(args.pen, 'rb') as f:
        result, problems = render_with_viewer(args.web, f.read(), token, args.scale)

    print('failed fonts:', result['failedFonts'] or '-')
    for frame, image in zip(result['frames'], result['images']):
        node_id, name = frame['nodeId'], frame['name']
        if not image['png']:
            print(f'{node_id}  {name}  NO PNG (viewer could not render)')
            continue
        viewer_path = f'{args.out}/{node_id}.viewer.png'
        with open(viewer_path, 'wb') as f:
            f.write(base64.b64decode(image['png']))
        ref_path = f'{args.ref_dir}/{node_id}.png'
        if not os.path.exists(ref_path):
            print(f'{node_id}  {name}  no reference ({ref_path})')
            continue
        print(f'{node_id}  {name}  {compare_frame(ref_path, viewer_path, args.out, node_id, args.hotspots)}')
    print(f'console / http problems: {len(problems)}')
    for line in problems[:30]:
        print('  ', line)


if __name__ == '__main__':
    main()
