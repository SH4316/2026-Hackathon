import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useResource } from './hooks';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

afterEach(cleanup);

describe('manual resource lifecycle', () => {
  it('loads once until manually refreshed and retains same-context results while refreshing', async () => {
    const next = deferred<string>();
    const loader = vi.fn().mockResolvedValueOnce('first').mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(() => useResource(loader, []));
    await waitFor(() => expect(result.current.data).toBe('first'));
    expect(result.current.loading).toBe(false);
    expect(result.current.updatedAt).toBeInstanceOf(Date);
    rerender();
    expect(loader).toHaveBeenCalledTimes(1);
    act(() => result.current.refresh());
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe('first');
    await act(async () => next.resolve('second'));
    expect(result.current.data).toBe('second');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('aborts changed contexts, hides their data and ignores stale completions', async () => {
    const stale = deferred<string>();
    const current = deferred<string>();
    const signals: AbortSignal[] = [];
    const loader = vi.fn((signal: AbortSignal, key: string) => {
      signals.push(signal);
      return key === 'old' ? stale.promise : current.promise;
    });
    const { result, rerender } = renderHook(({ key }) => useResource((signal) => loader(signal, key), [key]), { initialProps: { key: 'old' } });
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    rerender({ key: 'new' });
    expect(signals[0].aborted).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => current.resolve('current result'));
    await act(async () => stale.resolve('stale result'));
    expect(result.current.data).toBe('current result');
    expect(result.current.error).toBeNull();
  });

  it('ignores stale errors after a newer context succeeds', async () => {
    const stale = deferred<string>();
    const { result, rerender } = renderHook(({ key }) => useResource(() => key === 'old' ? stale.promise : Promise.resolve('fresh'), [key]), { initialProps: { key: 'old' } });
    rerender({ key: 'new' });
    await waitFor(() => expect(result.current.data).toBe('fresh'));
    await act(async () => stale.reject(new Error('stale failure')));
    expect(result.current.data).toBe('fresh');
    expect(result.current.error).toBeNull();
  });

  it('uses the latest loader closure on explicit refresh without adding automatic fetches', async () => {
    const loader = vi.fn((value: string) => Promise.resolve(value));
    const { result, rerender } = renderHook(({ value }) => useResource(() => loader(value), []), { initialProps: { value: 'initial' } });
    await waitFor(() => expect(result.current.data).toBe('initial'));
    rerender({ value: 'latest' });
    expect(loader).toHaveBeenCalledTimes(1);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data).toBe('latest'));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('clears previously loaded data and errors when moving to a different filter', async () => {
    const next = deferred<string>();
    const { result, rerender } = renderHook(({ key }) => useResource(async () => key === 'old' ? 'loaded' : next.promise, [key]), { initialProps: { key: 'old' } });
    await waitFor(() => expect(result.current.data).toBe('loaded'));
    rerender({ key: 'new' });
    expect(result.current.data).toBeNull();
    expect(result.current.updatedAt).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => next.reject(new Error('조회 기간을 확인해 주세요.')));
    expect(result.current.error).toBe('조회 기간을 확인해 주세요.');
    expect(result.current.data).toBeNull();
  });

  it('aborts unmounted requests and ignores stale rejections', async () => {
    const pending = deferred<string>();
    let signal: AbortSignal | undefined;
    const { unmount } = renderHook(() => useResource((requestSignal) => {
      signal = requestSignal;
      return pending.promise;
    }, []));
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.reject(new Error('late error')));
  });
});
