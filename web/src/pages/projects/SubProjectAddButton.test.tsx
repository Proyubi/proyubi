import { fireEvent, render, screen } from '@testing-library/react';
import SubProjectAddButton from './SubProjectAddButton';

describe('inline subproject creation', () => {
  it('opens the parent creation flow without triggering the row', () => {
    const onAdd = jest.fn(); const onRow = jest.fn();
    render(<div onClick={onRow}><SubProjectAddButton label="追加" onAdd={onAdd} /></div>);
    fireEvent.click(screen.getByRole('button', {name: '追加'}));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });
  it.each([{kind: 'ops'}, {parentId: 'parent'}])('does not permit nested or ops subprojects: %o', props => {
    render(<SubProjectAddButton {...props} label="追加" onAdd={jest.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('is present for a normal project with no children and supports disabled access', () => {
    const onAdd = jest.fn();
    render(<SubProjectAddButton label="追加" disabled onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', {name: '追加'}));
    expect(onAdd).not.toHaveBeenCalled();
  });
});
