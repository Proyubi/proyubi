import { expandedProjectIds } from './projectExpansion';

describe('project expansion defaults', () => {
  it('expands all parents by default, including asynchronously loaded parents', () => {
    expect(expandedProjectIds([], [])).toEqual([]);
    expect(expandedProjectIds(['p1', 'p2'], [])).toEqual(['p1', 'p2']);
  });
  it('keeps manually collapsed parents closed and new parents open', () => {
    expect(expandedProjectIds(['p1', 'p2'], ['p1'])).toEqual(['p2']);
  });
});
