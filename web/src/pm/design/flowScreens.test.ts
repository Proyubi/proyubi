import {
  frameFileId,
  frameRefOf,
  layoutScreens,
  SCREEN_WIDTH,
  screenHeight,
} from './flowScreens';

const design = { id: 'd1', title: 'lms.pen' };
const shot = (nodeId: string, name: string, width = 960, height = 540) => ({
  nodeId,
  name,
  dataURL: 'data:image/png;base64,AA==',
  width,
  height,
});

describe('layoutScreens', () => {
  it('並べた画像に参照元（設計・画框・版）を残し、ラベルを下に置く', () => {
    const out = layoutScreens(
      design,
      4,
      [shot('W02', 'W02-01 学生一覧'), shot('M1', 'Mobile', 390, 844)],
      100,
      200,
      1,
    );
    expect(out).toHaveLength(2);
    const [a, b] = out;
    expect(a.image).toMatchObject({
      type: 'image',
      x: 100,
      y: 200,
      width: SCREEN_WIDTH,
      height: 180,
      fileId: a.file.id,
    });
    expect(a.image.customData.pm).toEqual({
      kind: 'pen-frame',
      designId: 'd1',
      designTitle: 'lms.pen',
      nodeId: 'W02',
      name: 'W02-01 学生一覧',
      revision: 4,
    });
    expect(a.label).toMatchObject({ text: 'W02-01 学生一覧', x: 100, y: 390 });
    // 2 枚目は右に並び、縦長でも幅は揃える
    expect(b.image.x).toBe(100 + SCREEN_WIDTH + 100);
    expect(b.image.height).toBe(screenHeight(390, 844, SCREEN_WIDTH));
  });
});

describe('frameRefOf', () => {
  it('参照元を持つ画像だけを画面として扱う', () => {
    const [s] = layoutScreens(design, 2, [shot('A', 'a')], 0, 0, 1);
    expect(frameRefOf(s.image)?.nodeId).toBe('A');
    expect(frameRefOf({ type: 'image', customData: {} })).toBeNull();
    expect(frameRefOf({ customData: { pm: { kind: 'other' } } })).toBeNull();
    expect(
      frameRefOf({ customData: { pm: { kind: 'pen-frame', designId: 'd' } } }),
    ).toBeNull();
    expect(frameRefOf(undefined)).toBeNull();
  });
});

describe('frameFileId', () => {
  it('同じ画框・同じ版は同じ画像、版が違えば別の画像', () => {
    expect(frameFileId('d', '766:45', 3)).toBe(frameFileId('d', '766:45', 3));
    expect(frameFileId('d', '766:45', 3)).not.toBe(
      frameFileId('d', '766:45', 4),
    );
    expect(frameFileId('d', '766:45', 3)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
