import { createHash, webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import {
  base64ToBytes,
  buildManifest,
  bytesToBase64,
  DESIGN_MAX_BYTES,
  designFileName,
  detectDesignFile,
  PEN_MAX_BYTES,
  parseScene,
  sceneVersion,
  serializeScene,
  sha256Hex,
} from './scene';

// jsdom には TextEncoder / crypto.subtle が無い（ブラウザには有る）
if (!globalThis.TextEncoder) {
  Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder });
}
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

/** 1x1 PNG */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** A1：流程框 2 つ + 両端バインド矢印 + 付箋（塗り矩形 + 文字）+ UI 截图 */
const flow = () => ({
  elements: [
    { id: 'box1', type: 'rectangle', x: 0, y: 0, version: 3 },
    { id: 'box2', type: 'diamond', x: 300, y: 0, version: 2 },
    {
      id: 'arrow1',
      type: 'arrow',
      version: 5,
      startBinding: { elementId: 'box1', focus: 0, gap: 1 },
      endBinding: { elementId: 'box2', focus: 0, gap: 1 },
    },
    {
      id: 'note1',
      type: 'rectangle',
      backgroundColor: '#ffec99',
      fillStyle: 'solid',
      version: 1,
    },
    {
      id: 'noteText',
      type: 'text',
      text: '確認お願いします',
      containerId: 'note1',
      version: 1,
    },
    { id: 'shot', type: 'image', fileId: 'f1', status: 'saved', version: 1 },
    { id: 'gone', type: 'rectangle', isDeleted: true, version: 9 },
  ],
  appState: {
    viewBackgroundColor: '#fff',
    zoom: { value: 1.25 },
    scrollX: 12,
    scrollY: -4,
    collaborators: new Map(),
    selectedElementIds: { box1: true },
    openDialog: null,
    onChange: () => {},
  } as Record<string, unknown>,
  files: {
    f1: {
      id: 'f1',
      mimeType: 'image/png',
      dataURL: `data:image/png;base64,${PNG_B64}`,
      created: 1,
    },
    orphan: {
      id: 'orphan',
      mimeType: 'image/png',
      dataURL: `data:image/png;base64,${PNG_B64}`,
      created: 1,
    },
  } as Record<string, unknown>,
});

describe('serializeScene / parseScene', () => {
  it('round-trips shapes, bindings, sticky note and screenshot', () => {
    const { elements, appState, files } = flow();
    const out = serializeScene(elements, appState, files);
    if (!out.ok) throw new Error(out.error.code);
    const back = parseScene(out.json);
    if (!back.ok) throw new Error('parse failed');
    const ids = back.scene.elements.map((e) => e.id);
    expect(ids).toEqual([
      'box1',
      'box2',
      'arrow1',
      'note1',
      'noteText',
      'shot',
    ]);
    const arrow = back.scene.elements[2] as Record<string, any>;
    expect(arrow.startBinding.elementId).toBe('box1');
    expect(arrow.endBinding.elementId).toBe('box2');
    expect((back.scene.elements[4] as Record<string, any>).text).toBe(
      '確認お願いします',
    );
    expect(Object.keys(back.scene.files)).toEqual(['f1']);
    expect((back.scene.files.f1 as Record<string, string>).dataURL).toContain(
      PNG_B64,
    );
  });

  it('keeps only serializable appState allowlist', () => {
    const { elements, appState, files } = flow();
    const out = serializeScene(elements, appState, files);
    if (!out.ok) throw new Error(out.error.code);
    const app = JSON.parse(out.json).appState;
    expect(app).toEqual({
      viewBackgroundColor: '#fff',
      zoom: { value: 1.25 },
      scrollX: 12,
      scrollY: -4,
    });
  });

  it('rejects images that would be lost or are unsafe', () => {
    const { elements, appState } = flow();
    expect(serializeScene(elements, appState, {})).toMatchObject({
      ok: false,
      error: { code: 'image-missing' },
    });
    expect(
      serializeScene(elements, appState, {
        f1: { id: 'f1', mimeType: 'image/png', dataURL: 'blob:http://x/1' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'image-type' } });
    expect(
      serializeScene(elements, appState, {
        f1: {
          id: 'f1',
          mimeType: 'image/svg+xml',
          dataURL: 'data:image/svg+xml;base64,PHN2Zy8+',
        },
      }),
    ).toMatchObject({ ok: false, error: { code: 'image-type' } });
  });

  it('rejects oversized images, scenes, too many elements and embeds', () => {
    const big = 'A'.repeat(Math.ceil((6 * 1024 * 1024 * 4) / 3));
    const { elements, appState } = flow();
    expect(
      serializeScene(elements, appState, {
        f1: {
          id: 'f1',
          mimeType: 'image/png',
          dataURL: `data:image/png;base64,${big}`,
        },
      }),
    ).toMatchObject({ ok: false, error: { code: 'image-size' } });

    const many = Array.from({ length: 5001 }, (_, i) => ({
      id: `e${i}`,
      type: 'rectangle',
    }));
    expect(serializeScene(many, {}, {})).toMatchObject({
      ok: false,
      error: { code: 'elements' },
    });

    const huge = [
      { id: 't', type: 'text', text: 'x'.repeat(DESIGN_MAX_BYTES) },
    ];
    expect(serializeScene(huge, {}, {})).toMatchObject({
      ok: false,
      error: { code: 'size' },
    });

    expect(
      serializeScene(
        [{ id: 'e', type: 'embeddable', link: 'https://x' }],
        {},
        {},
      ),
    ).toMatchObject({ ok: false, error: { code: 'embeddable' } });
  });

  it('reports unreadable content instead of opening a blank board', () => {
    expect(parseScene('{broken').ok).toBe(false);
    expect(parseScene('{"elements":{}}').ok).toBe(false);
    expect(parseScene('[]').ok).toBe(false);
  });

  it('sceneVersion changes on edits and ignores selection-only changes', () => {
    const { elements } = flow();
    const v1 = sceneVersion(elements, {});
    expect(sceneVersion(elements, {})).toBe(v1);
    const edited = elements.map((e) =>
      e.id === 'box1' ? { ...e, version: 4 } : e,
    );
    expect(sceneVersion(edited, {})).not.toBe(v1);
    expect(sceneVersion(elements, { f9: {} })).not.toBe(v1);
  });
});

describe('.pen 原文', () => {
  it('base64 round-trip keeps every byte and hashes the raw bytes', async () => {
    const raw = new TextEncoder().encode(
      '﻿{"version":"2.6","children":[{"type":"x-unknown"}]}\r\n',
    );
    const b64 = bytesToBase64(raw);
    expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(raw));
    const hex = await sha256Hex(raw);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(hex).toBe(createHash('sha256').update(raw).digest('hex'));
  });

  it('handles binary bytes beyond ASCII', () => {
    const raw = new Uint8Array(70000).map((_, i) => (i * 31) % 256);
    expect(Array.from(base64ToBytes(bytesToBase64(raw)))).toEqual(
      Array.from(raw),
    );
  });
});

describe('detectDesignFile', () => {
  it('detects format by extension and rejects others or oversized', () => {
    expect(detectDesignFile('home.pen', 10)).toEqual({
      ok: true,
      format: 'pen',
    });
    expect(detectDesignFile('flow.excalidraw', 10)).toEqual({
      ok: true,
      format: 'excalidraw',
    });
    expect(detectDesignFile('flow.json', 10)).toEqual({
      ok: true,
      format: 'excalidraw',
    });
    expect(detectDesignFile('a.png', 10)).toEqual({ ok: false, error: 'type' });
    // .pen は実ファイルが 10MB を超えるので上限が別（32MB）
    expect(detectDesignFile('a.pen', DESIGN_MAX_BYTES + 1)).toEqual({
      ok: true,
      format: 'pen',
    });
    expect(detectDesignFile('a.pen', PEN_MAX_BYTES + 1)).toEqual({
      ok: false,
      error: 'size',
    });
    expect(detectDesignFile('a.excalidraw', DESIGN_MAX_BYTES + 1)).toEqual({
      ok: false,
      error: 'size',
    });
  });
});

describe('export helpers', () => {
  const design = {
    id: 'd1',
    projectId: 'p1',
    title: 'ログイン / 画面: 流れ',
    format: 'excalidraw' as const,
    currentRevision: 3,
    source: { path: 'design/login.excalidraw', hash: 'abc', ref: 'main' },
  };

  it('builds safe file names', () => {
    expect(designFileName(design, 2)).toBe(
      'ログイン _ 画面_ 流れ.r2.excalidraw',
    );
    expect(
      designFileName({ ...design, format: 'pen', title: 'x' }, 1, 'home.pen'),
    ).toBe('home.pen');
  });

  it('manifest carries revision and source hash for re-import, no secrets', () => {
    const m = buildManifest(design, {
      revision: 3,
      sha256: 'ff',
      sizeBytes: 9,
    });
    expect(m).toMatchObject({
      designId: 'd1',
      revision: 3,
      sha256: 'ff',
      source: { path: 'design/login.excalidraw', hash: 'abc', ref: 'main' },
    });
    expect(JSON.stringify(m)).not.toMatch(/token|password|satoken/i);
  });
});
