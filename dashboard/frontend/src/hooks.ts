import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DependencyList } from 'react';

interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  updatedAt: Date | null;
}

export interface Resource<T> extends ResourceState<T> {
  refresh: () => void;
}

interface InternalResource<T> extends ResourceState<T> {
  context: object | null;
  revision: number;
}

/** Loads on context changes or explicit refresh, with no polling or focus refetch. */
export function useResource<T>(loader: (signal: AbortSignal) => Promise<T>, deps: DependencyList): Resource<T> {
  const context = useMemo(() => ({}), deps);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<InternalResource<T>>({
    context: null,
    revision: -1,
    data: null,
    loading: true,
    error: null,
    updatedAt: null,
  });
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const load = loaderRef.current;
    let active = true;
    setState((previous) => ({
      context,
      revision,
      data: previous.context === context ? previous.data : null,
      loading: true,
      error: null,
      updatedAt: previous.context === context ? previous.updatedAt : null,
    }));
    Promise.resolve()
      .then(() => load(controller.signal))
      .then((data) => {
        if (active && !controller.signal.aborted) {
          setState({ context, revision, data, loading: false, error: null, updatedAt: new Date() });
        }
      })
      .catch((error: unknown) => {
        if (active && !controller.signal.aborted) {
          const message = error instanceof Error && error.name !== 'TypeError'
            ? error.message
            : '서버에 연결하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.';
          setState((previous) => ({
            ...previous,
            context,
            revision,
            loading: false,
            error: message,
          }));
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [context, revision]);

  const sameContext = state.context === context;
  const sameRequest = sameContext && state.revision === revision;
  return {
    data: sameContext ? state.data : null,
    loading: sameRequest ? state.loading : true,
    error: sameRequest ? state.error : null,
    updatedAt: sameContext ? state.updatedAt : null,
    refresh,
  };
}
