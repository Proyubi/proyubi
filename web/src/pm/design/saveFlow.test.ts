jest.mock('@umijs/max', () => ({ request: jest.fn() }));

import { DesignApiError, toDesignError } from './api';
import { saveSceneDraft } from './saveFlow';

const design = { id: 'd1', currentRevision: 3 };
const scene = {
  elements: [{ id: 'a', type: 'rectangle', version: 1 }],
  appState: { viewBackgroundColor: '#fff', selectedElementIds: { a: true } },
  files: {},
};

describe('saveSceneDraft', () => {
  it('sends the serialized scene with the revision it was loaded from', async () => {
    const save = jest.fn().mockResolvedValue({ id: 'd1', currentRevision: 4 });
    const r = await saveSceneDraft(design, scene, save);
    expect(r).toEqual({
      status: 'saved',
      design: { id: 'd1', currentRevision: 4 },
    });
    expect(save).toHaveBeenCalledTimes(1);
    const [id, req] = save.mock.calls[0];
    expect(id).toBe('d1');
    expect(req.expectedRevision).toBe(3);
    const sent = JSON.parse(req.content);
    expect(sent.elements[0].id).toBe('a');
    expect(sent.appState.selectedElementIds).toBeUndefined();
  });

  it('keeps the local draft untouched on 409 conflict', async () => {
    const save = jest
      .fn()
      .mockRejectedValue(new DesignApiError(409, '他の人が先に保存しました'));
    const r = await saveSceneDraft(design, scene, save);
    expect(r.status).toBe('conflict');
    if (r.status !== 'conflict') return;
    expect(JSON.parse(r.draft).elements[0].id).toBe('a');
    expect(r.message).toContain('先に保存');
  });

  it('does not call the server when the scene is invalid', async () => {
    const save = jest.fn();
    const r = await saveSceneDraft(
      design,
      {
        elements: [{ id: 'img', type: 'image', fileId: 'x' }],
        appState: {},
        files: {},
      },
      save,
    );
    expect(r).toEqual({
      status: 'invalid',
      code: 'image-missing',
      detail: 'x',
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('surfaces server validation and network errors with the draft kept', async () => {
    const bad = jest
      .fn()
      .mockRejectedValue(new DesignApiError(400, '画像が大きすぎます'));
    expect(await saveSceneDraft(design, scene, bad)).toMatchObject({
      status: 'error',
      code: 400,
      message: '画像が大きすぎます',
    });
    const net = jest.fn().mockRejectedValue(new DesignApiError(0, 'network'));
    const r = await saveSceneDraft(design, scene, net);
    expect(r).toMatchObject({ status: 'error', code: 0 });
    if (r.status === 'error')
      expect(JSON.parse(r.draft).elements).toHaveLength(1);
  });
});

describe('toDesignError', () => {
  it('maps BizError info code (R.code) and HTTP status', () => {
    expect(
      toDesignError({ name: 'BizError', info: { code: 409, msg: 'x' } }),
    ).toMatchObject({
      code: 409,
      message: 'x',
    });
    expect(
      toDesignError({ response: { status: 413 }, message: 'big' }),
    ).toMatchObject({
      code: 413,
    });
    expect(toDesignError(new Error('offline')).code).toBe(0);
  });
});
