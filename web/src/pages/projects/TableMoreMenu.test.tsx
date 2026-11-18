import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TableMoreMenu from './TableMoreMenu';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

const props = () => ({
  viewMode: 'list' as const,
  onViewMode: jest.fn(),
  onReload: jest.fn(),
  density: 'middle' as const,
  onDensity: jest.fn(),
  columns: [{ key: 'customer', label: 'Customer' }],
  hiddenColumns: [] as string[],
  onHiddenColumns: jest.fn(),
});

it('separates view choices from settings and retains their callbacks', async () => {
  const p = props();
  render(<TableMoreMenu {...p} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'projects.viewMode.label' }),
  );
  fireEvent.click(await screen.findByText('projects.viewMode.card'));
  expect(p.onViewMode).toHaveBeenCalledWith('card');
  fireEvent.click(
    screen.getByRole('button', { name: 'projects.more.settings' }),
  );
  fireEvent.click(await screen.findByText('projects.more.reload'));
  expect(p.onReload).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole('button', { name: 'projects.more.settings' }),
  );
  fireEvent.click(
    await screen.findByText('projects.more.columns', { exact: false }),
  );
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Customer' }));
  expect(p.onHiddenColumns).toHaveBeenCalledWith(['customer']);
});

it('closes the other menu and hides table-only settings in card mode', async () => {
  render(<TableMoreMenu {...props()} viewMode="card" />);
  const view = screen.getByRole('button', { name: 'projects.viewMode.label' });
  const settings = screen.getByRole('button', {
    name: 'projects.more.settings',
  });
  fireEvent.click(view);
  expect(view.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(settings);
  await waitFor(() => expect(view.getAttribute('aria-expanded')).toBe('false'));
  expect(settings.getAttribute('aria-expanded')).toBe('true');
  expect(screen.queryByText('projects.more.density')).toBeNull();
  expect(
    screen.queryByText('projects.more.columns', { exact: false }),
  ).toBeNull();
});

it('returns keyboard focus to its trigger on Escape', async () => {
  render(<TableMoreMenu {...props()} />);
  const view = screen.getByRole('button', { name: 'projects.viewMode.label' });
  fireEvent.click(view);
  const card = await screen.findByText('projects.viewMode.card');
  fireEvent.keyDown(card, { key: 'Escape' });
  expect(document.activeElement).toBe(view);
  expect(view.getAttribute('aria-expanded')).toBe('false');
  const settings = screen.getByRole('button', {
    name: 'projects.more.settings',
  });
  fireEvent.click(settings);
  fireEvent.keyDown(await screen.findByText('projects.more.reload'), {
    key: 'Escape',
  });
  expect(document.activeElement).toBe(settings);
});
