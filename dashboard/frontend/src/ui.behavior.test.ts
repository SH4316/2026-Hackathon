import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pagination } from './ui';

afterEach(cleanup);

describe('pagination recovery', () => {
  it('offers a deliberate first-page action for an out-of-range page', () => {
    const onChange = vi.fn();
    render(createElement(Pagination, {
      page: { items: [], page: 999, size: 20, totalElements: 48, totalPages: 3 },
      onChange,
    }));
    expect(screen.getByText('요청한 페이지에 기록이 없습니다')).toBeTruthy();
    expect(screen.queryByText(/19,981/)).toBeNull();
    expect(screen.queryByRole('button', { name: '이전 페이지' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '첫 페이지로' }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('retains normal next-page navigation and hides pagination for no results', () => {
    const onChange = vi.fn();
    const { rerender } = render(createElement(Pagination, {
      page: { items: [], page: 0, size: 20, totalElements: 48, totalPages: 3 },
      onChange,
    }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '이전 페이지' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '다음 페이지' }));
    expect(onChange).toHaveBeenCalledWith(1);
    rerender(createElement(Pagination, {
      page: { items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 },
      onChange,
    }));
    expect(screen.queryByRole('button')).toBeNull();
  });
});
