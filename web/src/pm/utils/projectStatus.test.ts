jest.mock("@umijs/max", () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
import { projectDisplayStatus, hasStartedWork } from './projectStatus';
import { subSummary } from './projectTree';
import { applyProjectFilter } from '@/pages/projects/FilterBar';
type ProjectFilter = import('@/pages/projects/FilterBar').ProjectFilter;
type ProjectDisplayStatus = import('./projectStatus').ProjectDisplayStatus;

const only = (...statuses: ProjectDisplayStatus[]): ProjectFilter => ({ statuses, overdue: false });
type Project = import('../types').Project;

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1', customerId: 'c1', name: 'QA', start: '2026-06-01',
  end: null, status: 'active', progress: 0, kind: 'project', ...overrides,
});

describe('derived project display status (no persisted status mutation)', () => {
  it('shows historical active 0% / empty project as not started', () => {
    const p = project();
    expect(projectDisplayStatus(p)).toBe('planned');
    expect(p.status).toBe('active');
  });
  it.each([1, 50, 99])('shows %i%% as active even if old status is planned', progress => {
    expect(projectDisplayStatus(project({ status: 'planned', progress }))).toBe('active');
  });
  it('shows complete work as awaiting delivery, not delivered', () => {
    const p = project({ progress: 100 });
    expect(projectDisplayStatus(p)).toBe('ready');
    expect(subSummary([p]).allDone).toBe(false);
  });
  it.each([0, 50, 100])('preserves explicit paused and delivered at %i%%', progress => {
    expect(projectDisplayStatus(project({ status: 'paused', progress }))).toBe('paused');
    expect(projectDisplayStatus(project({ status: 'done', progress }))).toBe('done');
  });
  it('does not treat continuous maintenance as a finite delivery', () => {
    expect(projectDisplayStatus(project({ kind: 'ops', progress: 0 }))).toBe('planned');
    expect(projectDisplayStatus(project({ kind: 'ops', progress: 100 }))).toBe('active');
  });
  it('uses the same live progress as the Gantt progress bar', () => {
    expect(projectDisplayStatus(project({ progress: 0 }), 70)).toBe('active');
    expect(projectDisplayStatus(project({ progress: 100 }), 0)).toBe('planned');
  });
  it('uses parent rolled-up progress without marking the parent delivered', () => {
    expect(projectDisplayStatus(project({ parentId: null, progress: 100 }))).toBe('ready');
  });
  it('handles invalid or out-of-range progress defensively', () => {
    expect(projectDisplayStatus(project({ progress: Number.NaN }))).toBe('planned');
    expect(projectDisplayStatus(project({ progress: -1 }))).toBe('planned');
    expect(projectDisplayStatus(project({ progress: 101 }))).toBe('ready');
  });
  it('filters by displayed status rather than the stale stored field', () => {
    const ps = [project(), project({ id: 'p2', status: 'planned', progress: 40 }), project({ id: 'p3', progress: 100 })];
    expect(applyProjectFilter(ps, only('planned')).map(p => p.id)).toEqual(['p1']);
    expect(applyProjectFilter(ps, only('active')).map(p => p.id)).toEqual(['p2']);
    expect(applyProjectFilter(ps, only('ready')).map(p => p.id)).toEqual(['p3']);
    expect(applyProjectFilter(ps, only('done'))).toEqual([]);
  });
  it('ORs multiple selected statuses; empty selection means all', () => {
    const ps = [project(), project({ id: 'p2', status: 'planned', progress: 40 }), project({ id: 'p3', progress: 100 })];
    expect(applyProjectFilter(ps, only('planned', 'ready')).map(p => p.id)).toEqual(['p1', 'p3']);
    expect(applyProjectFilter(ps, only()).map(p => p.id)).toEqual(['p1', 'p2', 'p3']);
  });
  it('ANDs the overdue chip with the selected statuses', () => {
    const past = '2000-01-01';
    const ps = [
      project({ id: 'a', status: 'active', progress: 40, end: past }),
      project({ id: 'b', status: 'active', progress: 40 }),
      project({ id: 'c', status: 'planned', progress: 0, end: past }),
    ];
    const ids = (f: ProjectFilter) => applyProjectFilter(ps, f).map(p => p.id);
    expect(ids({ statuses: [], overdue: true })).toEqual(['a', 'c']);
    expect(ids({ statuses: ['active'], overdue: true })).toEqual(['a']);
  });
});

describe('started task state independent of progress', () => {
  it.each(['in_progress', 'testing', 'done'] as const)('%s counts as started even at 0%', status => {
    const started = hasStartedWork([{ type: 'task', status }]);
    expect(started).toBe(true);
    expect(projectDisplayStatus(project({ progress: 0, hasStartedWork: started }))).toBe('active');
  });
  it.each(['backlog', 'todo', 'cancelled'] as const)('%s alone does not count as started', status => {
    expect(hasStartedWork([{ type: 'task', status }])).toBe(false);
  });
  it('ignores summary/milestone flags and counts real tasks at any WBS depth', () => {
    expect(hasStartedWork([{ type: 'summary', status: 'in_progress' }, { type: 'milestone', status: 'done' }])).toBe(false);
    expect(hasStartedWork([{ type: 'summary', status: 'todo' }, { type: 'task', status: 'in_progress' }])).toBe(true);
    expect(hasStartedWork([])).toBe(false);
  });
  it('uses activity metadata when task data is not loaded (all list views)', () => {
    const p = project({ hasStartedWork: true, progress: 0 });
    expect(projectDisplayStatus(p)).toBe('active');
    expect(applyProjectFilter([p], only('active'))).toEqual([p]);
    expect(applyProjectFilter([p], only('planned'))).toEqual([]);
  });
  it('preserves pause/delivery and maintenance semantics with started tasks', () => {
    expect(projectDisplayStatus(project({ status: 'paused', hasStartedWork: true }))).toBe('paused');
    expect(projectDisplayStatus(project({ status: 'done', hasStartedWork: true }))).toBe('done');
    expect(projectDisplayStatus(project({ kind: 'ops', hasStartedWork: true }))).toBe('active');
  });
  it('returns to not started when the last started task is reset or removed', () => {
    expect(projectDisplayStatus(project({ hasStartedWork: hasStartedWork([{ type: 'task', status: 'todo' }]) }))).toBe('planned');
    expect(projectDisplayStatus(project({ hasStartedWork: hasStartedWork([]) }))).toBe('planned');
  });
});
