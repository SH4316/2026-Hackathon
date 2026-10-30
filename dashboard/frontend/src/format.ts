import type { Category, DateRange, Filters, PolicyState } from './types';

export const CATEGORY_LABELS: Record<Category, string> = {
  PERSONAL_DATA: '개인정보',
  CREDENTIAL: '인증정보',
  CONFIDENTIAL: '내부기밀',
};

export const POLICY_LABELS: Record<PolicyState, string> = {
  TRAINING_ALLOWED: '학습 허용',
  TRAINING_DISABLED: '학습 미사용',
  UNKNOWN: '설정 미확인',
};

export const SERVICE_LABELS: Record<string, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
};

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const numberFormatter = new Intl.NumberFormat('ko-KR');
const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});
const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '기록 없음';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '날짜 확인 불가' : dateFormatter.format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '기록 없음';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '날짜 확인 불가' : dateTimeFormatter.format(date);
}

/** The default seven Seoul calendar days, including today. */
export function getDefaultDateRange(now = new Date()): DateRange {
  const seoulDay = new Date(now.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${seoulDay}T00:00:00Z`) - 6 * DAY_MS).toISOString().slice(0, 10);
  return { from, to: seoulDay };
}

function calendarMidnight(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('시작일과 종료일을 올바르게 입력해 주세요.');
  const calendarUtc = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(calendarUtc) || new Date(calendarUtc).toISOString().slice(0, 10) !== value) {
    throw new Error('시작일과 종료일을 올바르게 입력해 주세요.');
  }
  return calendarUtc - SEOUL_OFFSET_MS;
}

/** Inclusive Seoul date inputs become the API's half-open UTC interval. */
export function dateRangeToFilters(range: DateRange): Pick<Filters, 'from' | 'to'> {
  const from = calendarMidnight(range.from);
  const lastDay = calendarMidnight(range.to);
  if (lastDay < from) throw new Error('종료일은 시작일보다 빠를 수 없습니다.');
  const to = lastDay + DAY_MS;
  if (to - from > 366 * DAY_MS) throw new Error('조회 기간은 최대 366일까지 선택할 수 있습니다.');
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}
