import { fireEvent, render, screen } from '@testing-library/react';
import TaskFormModal from './TaskFormModal';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('../store', () => ({
  useData: () => ({ roadmapOptionsOf: () => [], holidays: [] }),
}));
jest.mock('../api', () => ({ listTasks: jest.fn().mockResolvedValue([]) }));
jest.mock('../components/RichTextEditor', () => () => null);
jest.mock('../components/TaskActivity', () => () => null);
jest.mock('../components/TaskComments', () => () => null);
jest.mock('../components/TaskLinks', () => () => null);
jest.mock('../mockup/MockupPanel', () => () => null);
jest.mock('../design/DesignTaskPanel', () => () => null);
jest.mock('../components/TaskQuality', () => ({
  TaskBugs: () => null,
  TaskTestCases: () => null,
}));
jest.mock('../docs/TaskDocs', () => ({
  __esModule: true,
  default: ({ taskId }: { taskId: string }) => (
    <div data-testid="task-docs">{taskId}</div>
  ),
}));

const task: import('../types').Task = {
  id: 't1',
  projectId: 'p1',
  parentId: null,
  name: 'Task',
  type: 'task',
  start: '2026-10-16',
  end: '2026-10-20',
  progress: 0,
  assigneeIds: [],
  levels: [],
  order: 0,
};
const props = {
  open: true,
  task,
  members: [],
  onCancel: jest.fn(),
  onSubmit: jest.fn(),
};

it('omits Drive docs in the shared task editor by default', () => {
  render(<TaskFormModal {...props} />);

  expect(screen.queryByRole('tab', { name: 'docs.title' })).toBeNull();
  expect(
    screen.getByRole('tab', { name: 'projects.comments.title' }),
  ).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'mockup.tab' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'design.tab' })).toBeTruthy();
  expect(screen.queryByTestId('task-docs')).toBeNull();
});

it('keeps Drive docs accessible when enabled by Gantt and hides them on leaving', () => {
  const { rerender } = render(<TaskFormModal {...props} showDocs />);

  fireEvent.click(screen.getByRole('tab', { name: 'docs.title' }));
  expect(screen.getByTestId('task-docs').textContent).toBe(task.id);

  rerender(<TaskFormModal {...props} showDocs={false} />);
  expect(screen.queryByRole('tab', { name: 'docs.title' })).toBeNull();
  expect(screen.queryByTestId('task-docs')).toBeNull();
});
