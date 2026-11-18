jest.mock('@open-pencil/core/icons', () => ({}));

// pen-viewer は別ビルドだが、icons.ts の .pen 書き換えは純関数なのでここで確かめる
import { TextDecoder, TextEncoder } from 'node:util';
import { penIconLayerName, preparePen } from '../../../pen-viewer/icons';

// jsdom には TextEncoder / TextDecoder がない（ビューア本体はブラウザで動く）
Object.assign(globalThis, { TextEncoder, TextDecoder });

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const decode = (data: Uint8Array) => JSON.parse(new TextDecoder().decode(data));

describe('preparePen', () => {
  it('returns the original bytes when there is no icon or the file is not JSON', () => {
    const plain = encode({ children: [{ type: 'frame', id: 'f' }] });
    expect(preparePen(plain).data).toBe(plain);
    const broken = new TextEncoder().encode('not json');
    expect(preparePen(broken)).toEqual({ data: broken, refs: [] });
  });

  it('turns nested icons into marked transparent-ready frames and keeps their box', () => {
    const { data, refs } = preparePen(
      encode({
        children: [
          {
            type: 'frame',
            children: [
              {
                type: 'icon',
                id: 'i1',
                name: '学校の切替',
                icon: 'chevrons-up-down',
                library: 'lucide',
                width: 12,
                height: 12,
                fill: '#15232B',
              },
              {
                type: 'icon',
                id: 'i2',
                icon: 'arrow_back',
                library: 'Material Symbols Rounded',
              },
            ],
          },
        ],
      }),
    );
    expect(refs).toEqual([
      { iconName: 'lucide:chevrons-up-down', name: '学校の切替' },
      { iconName: 'material-symbols:arrow-back', name: 'arrow_back' },
    ]);
    const [icon] = decode(data).children[0].children;
    expect(icon).toMatchObject({
      type: 'frame',
      id: 'i1',
      layout: 'none',
      width: 12,
      height: 12,
      fill: '#15232B',
    });
    expect(icon).not.toHaveProperty('icon');
    expect(icon).not.toHaveProperty('library');
    expect(penIconLayerName(icon.name, refs)).toBe('学校の切替');
  });

  it('defaults to lucide and leaves icons without a name alone', () => {
    const { refs, data } = preparePen(
      encode({ children: [{ type: 'icon', icon: 'x' }, { type: 'icon' }] }),
    );
    expect(refs).toEqual([{ iconName: 'lucide:x', name: 'x' }]);
    expect(decode(data).children[1]).toEqual({ type: 'icon' });
  });
});

describe('penIconLayerName', () => {
  it('keeps names that are not marked', () => {
    expect(penIconLayerName('01 AMS', [])).toBe('01 AMS');
  });
});

describe('preparePen legacy compat', () => {
  it('turns a color-string stroke with strokeWidth into a stroke object', () => {
    const { data } = preparePen(
      encode({
        children: [
          { type: 'frame', stroke: '#E4E4E7', strokeWidth: 2 },
          { type: 'rectangle', stroke: '#F59E0B' },
          { type: 'frame', stroke: { fill: '#000', thickness: 1 } },
          { type: 'frame', stroke: '#F5C518', strokeWidth: { bottom: 2 } },
        ],
      }),
    );
    const [a, b, c, d] = decode(data).children;
    expect(d.stroke).toEqual({
      fill: '#F5C518',
      thickness: { top: 0, right: 0, bottom: 2, left: 0 },
      align: 'inside',
    });
    expect(a).toEqual({
      type: 'frame',
      stroke: { fill: '#E4E4E7', thickness: 2, align: 'inside' },
    });
    expect(b.stroke).toEqual({
      fill: '#F59E0B',
      thickness: 1,
      align: 'inside',
    });
    expect(c.stroke).toEqual({ fill: '#000', thickness: 1 });
  });

  it('turns numeric-string font weights into numbers and keeps named ones', () => {
    const { data } = preparePen(
      encode({
        children: [
          { type: 'text', fontWeight: '600' },
          { type: 'text', fontWeight: 'normal' },
          { type: 'text', fontWeight: 500 },
        ],
      }),
    );
    expect(
      decode(data).children.map((n: { fontWeight: unknown }) => n.fontWeight),
    ).toEqual([600, 'normal', 500]);
  });
});
