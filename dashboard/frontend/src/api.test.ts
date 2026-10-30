import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, buildQuery } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('API query and payload contract', () => {
  it('omits empty filters while preserving literal text and zero-based pagination', () => {
    const query = buildQuery({
      from: '2026-10-23T15:00:00.000Z', to: '2026-10-30T15:00:00.000Z',
      service: 'custom-service', personId: 'member_1', category: '', policyState: '',
    }, { q: '홍_% & 길동', page: 0, size: 20 });
    const params = new URLSearchParams(query);
    expect(params.get('q')).toBe('홍_% & 길동');
    expect(params.get('from')).toBe('2026-10-23T15:00:00.000Z');
    expect(params.get('service')).toBe('custom-service');
    expect(params.get('page')).toBe('0');
    expect(params.has('category')).toBe(false);
    expect(params.has('policyState')).toBe(false);
    expect(buildQuery({})).toBe('');
  });

  it('passes cancellation signals and uses the agreed people route', async () => {
    const response = { items: [], page: 2, size: 20, totalElements: 0, totalPages: 0 };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    expect(await api.people({ category: 'CREDENTIAL' }, 'kim', 2, controller.signal)).toEqual(response);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/people?category=CREDENTIAL&q=kim&page=2&size=20');
    expect(options.signal).toBe(controller.signal);
  });

  it('keeps event pagination independent from event filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], page: 3, size: 20, totalElements: 65, totalPages: 4 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.events({ personId: 'EMP-001', policyState: 'UNKNOWN' }, 3);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/events?personId=EMP-001&policyState=UNKNOWN&page=3&size=20');
  });

  it('preserves cancellation during response body reading', async () => {
    const controller = new AbortController();
    const cancellation = new DOMException('Aborted', 'AbortError');
    const response = { ok: true, status: 200, json: () => { controller.abort(); return Promise.reject(cancellation); } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(api.metrics({}, controller.signal)).rejects.toBe(cancellation);
  });

  it('posts only registration fields as JSON', async () => {
    const person = { id: 'kim_1', name: '김민지' };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...person, eventCount: 0, findingCount: 0, lastEventAt: null }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.createPerson(person);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/people', expect.objectContaining({
      method: 'POST', body: JSON.stringify(person),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    }));
  });

  it('preserves helpful API errors and handles non-JSON proxy failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'DUPLICATE_PERSON', message: '이미 등록된 ID입니다.', fieldErrors: { id: '중복 ID' } }), { status: 409 }))
      .mockResolvedValueOnce(new Response('<html>Unavailable</html>', { status: 502 }))
      .mockResolvedValueOnce(new Response('null', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.createPerson({ id: 'kim_1', name: '김민지' })).rejects.toMatchObject({
      status: 409, code: 'DUPLICATE_PERSON', message: '이미 등록된 ID입니다.', fieldErrors: { id: '중복 ID' },
    });
    await expect(api.metrics()).rejects.toBeInstanceOf(ApiError);
    await expect(api.events()).rejects.toMatchObject({ status: 500, code: 'REQUEST_FAILED' });
  });
});
