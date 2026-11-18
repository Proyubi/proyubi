import { shouldOpenProjectRow } from './projectRowInteraction';

describe('project row double-click navigation', () => {
  let row: HTMLTableRowElement;
  beforeEach(() => {
    document.body.innerHTML = `<table><tbody><tr role="button"><td><span id="plain">Project</span><button><span id="add">+</span></button><a id="link" href="/project">Project</a><input id="input" /><span role="button"><svg id="handle"></svg></span></td></tr></tbody></table>`;
    const element = document.querySelector('tr');
    if (!element) throw new Error('Expected project row fixture');
    row = element;
  });
  afterEach(() => { document.body.innerHTML = ''; });
  it('opens plain cells inside a draggable role=button row', () => {
    const target = document.getElementById('plain');
    if (!target) throw new Error('Expected project name fixture');
    // The old closest-only guard incorrectly matched the row itself.
    expect(target.closest("button, a, input, [role='button']")).toBe(row);
    expect(shouldOpenProjectRow(target, row)).toBe(true);
    expect(shouldOpenProjectRow(row, row)).toBe(true);
  });
  it.each(['add', 'link', 'input', 'handle'])('does not open from nested control %s', (id) => {
    expect(shouldOpenProjectRow(document.getElementById(id), row)).toBe(false);
  });
  it('opens a plain row without draggable attributes', () => {
    row.removeAttribute('role');
    expect(shouldOpenProjectRow(document.getElementById('plain'), row)).toBe(true);
  });
  it('ignores missing or outside targets', () => {
    expect(shouldOpenProjectRow(null, row)).toBe(false);
    expect(shouldOpenProjectRow(document.body, row)).toBe(false);
  });
});
