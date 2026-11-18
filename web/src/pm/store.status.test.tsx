import { act, render } from '@testing-library/react';
import { DataProvider, useData as useStoreData } from './store';
import * as api from './api';
import { projectDisplayStatus } from './utils/projectStatus';

jest.mock('./api', () => ({
  listProjects: jest.fn(), listCustomers: jest.fn().mockResolvedValue([]),
  listMembers: jest.fn().mockResolvedValue([]), listRoadmapOptions: jest.fn().mockResolvedValue([]),
  listHolidays: jest.fn().mockResolvedValue([]), listTeams: jest.fn().mockResolvedValue([]),
  getWorkdaySetting: jest.fn().mockResolvedValue({ hoursPerWorkday: 8 }),
  listTasks: jest.fn(), listDependencies: jest.fn().mockResolvedValue([]), updateTask: jest.fn(),
}));

let data: ReturnType<typeof import("./store").useData>;
function Probe() { data = useStoreData(); return null; }
const task = (status: string) => ({ id: 't1', projectId: 'p1', type: 'task', status,
  parentId: null, name: 'Test', start: '2026-11-01', end: '2026-11-02',
  progress: 0, assigneeIds: [], levels: [], order: 0 });
const project = { id: 'p1', customerId: 'c1', name: 'Test', status: 'planned', kind: 'project', progress: 0,
  start: '2026-11-01', end: null, hasStartedWork: false };

beforeEach(() => {
  jest.clearAllMocks();
  (api.listProjects as jest.Mock).mockResolvedValue([project]);
  (api.listTasks as jest.Mock).mockResolvedValue([task('todo')]);
  (api.updateTask as jest.Mock).mockResolvedValue({});
});
async function mount() {
  render(<DataProvider><Probe /></DataProvider>);
  await act(async () => { await data.ensureBase(); });
  await act(async () => { await data.loadProject('p1'); });
}
it('refreshes display after zero-progress board moves in both directions', async () => {
  await mount();
  expect(projectDisplayStatus(data.projects[0])).toBe('planned');
  (api.listTasks as jest.Mock).mockResolvedValue([task('in_progress')]);
  await act(async () => { await data.setTaskStatus('t1', 'in_progress'); });
  expect(projectDisplayStatus(data.projects[0])).toBe('active');
  (api.listTasks as jest.Mock).mockResolvedValue([task('todo')]);
  await act(async () => { await data.setTaskStatus('t1', 'todo'); });
  expect(projectDisplayStatus(data.projects[0])).toBe('planned');
});
it('rolls back a failed board move without incorrectly marking the project started', async () => {
  await mount();
  (api.updateTask as jest.Mock).mockRejectedValueOnce(new Error('denied'));
  await act(async () => { await expect(data.setTaskStatus('t1', 'in_progress')).rejects.toThrow('denied'); });
  expect(data.tasksOf('p1')[0].status).toBe('todo');
  expect(projectDisplayStatus(data.projects[0])).toBe('planned');
});
it('refreshes parent activity after a subproject board move', async () => {
  const parent = { ...project, id: 'parent' };
  const child = { ...project, parentId: 'parent' };
  (api.listProjects as jest.Mock).mockResolvedValue([child, parent]);
  await mount();
  (api.listTasks as jest.Mock).mockResolvedValue([task('testing')]);
  (api.listProjects as jest.Mock).mockResolvedValue([{ ...child, hasStartedWork: true }, { ...parent, hasStartedWork: true }]);
  await act(async () => { await data.setTaskStatus('t1', 'testing'); });
  const refreshedParent = data.projects.find(p => p.id === 'parent');
  if (!refreshedParent) throw new Error('Expected refreshed parent project');
  expect(projectDisplayStatus(refreshedParent)).toBe('active');
});
