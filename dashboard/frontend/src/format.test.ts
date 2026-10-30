import { describe, expect, it } from 'vitest';
import { dateRangeToFilters, formatDateTime, formatNumber, getDefaultDateRange } from './format';

describe('Seoul calendar ranges', () => {
  it('includes Seoul today when UTC is still the preceding date', () => {
    expect(getDefaultDateRange(new Date('2026-10-29T15:00:00Z'))).toEqual({ from: '2026-10-24', to: '2026-10-30' });
    expect(getDefaultDateRange(new Date('2026-10-29T14:59:59Z'))).toEqual({ from: '2026-10-23', to: '2026-10-29' });
  });

  it('uses inclusive local dates and an exclusive UTC end across a leap day', () => {
    expect(dateRangeToFilters({ from: '2024-02-28', to: '2024-02-29' })).toEqual({
      from: '2024-02-27T15:00:00.000Z', to: '2024-02-29T15:00:00.000Z',
    });
    expect(dateRangeToFilters({ from: '2026-12-31', to: '2026-12-31' })).toEqual({
      from: '2026-12-30T15:00:00.000Z', to: '2026-12-31T15:00:00.000Z',
    });
  });

  it('rejects impossible, partial, reversed and overlong dates', () => {
    for (const range of [
      { from: '2026-02-29', to: '2026-03-01' },
      { from: '', to: '2026-10-30' },
      { from: '2026-10-30', to: '2026-10-29' },
      { from: '2025-01-01', to: '2026-01-02' },
    ]) expect(() => dateRangeToFilters(range)).toThrow();
    expect(() => dateRangeToFilters({ from: '2024-01-01', to: '2024-12-31' })).not.toThrow();
  });
});

describe('Korean display formatting', () => {
  it('uses count grouping and a fixed Seoul timezone', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatDateTime('2026-10-29T15:05:00Z')).toContain('2026. 10. 30.');
    expect(formatDateTime('2026-10-29T15:05:00Z')).toContain('00:05');
    expect(formatDateTime(null)).toBe('기록 없음');
  });
});
