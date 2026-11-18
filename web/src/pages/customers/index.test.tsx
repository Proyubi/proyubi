import { fireEvent, render, screen, within } from '@testing-library/react';
import CustomerListPage from './index';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@ant-design/pro-components', () => ({
  PageContainer: ({
    children,
    extra,
  }: {
    children: import('react').ReactNode;
    extra: import('react').ReactNode;
  }) => (
    <div>
      {extra}
      {children}
    </div>
  ),
}));
jest.mock('@/pm/store', () => ({
  useData: () => ({
    customers: [{ id: 'c1', name: 'Customer', active: true }],
    projects: [],
    ensureBase: jest.fn(),
    baseLoaded: true,
  }),
}));

it('offers customer editing without a Drive docs entry', () => {
  render(<CustomerListPage />);

  expect(screen.getByText('Customer')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /docs.title/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /common.edit/ }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText('customers.edit')).toBeTruthy();
  expect(dialog.getByDisplayValue('Customer')).toBeTruthy();
});
