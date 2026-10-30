import type { DateRange, Detection, DetectionTag, Filters, Tag } from "./types";

export const KNOWN_SERVICES = [
  { id: "openai", label: "ChatGPT" },
  { id: "anthropic", label: "Claude" },
  { id: "google", label: "Gemini" },
  { id: "microsoft", label: "Copilot" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "moonshot", label: "Kimi" },
  { id: "mistral", label: "Mistral" },
  { id: "perplexity", label: "Perplexity" },
  { id: "xai", label: "Grok" },
  { id: "alibaba", label: "Qwen" },
  { id: "meta", label: "Meta AI" },
] as const;

const providerLabels: Record<string, string> = Object.fromEntries(
  KNOWN_SERVICES.map(({ id, label }) => [id, label]),
);

export const SERVICE_LABELS: Record<string, string> = {
  ...providerLabels,
  chatgpt: providerLabels.openai,
  claude: providerLabels.anthropic,
  gemini: providerLabels.google,
};

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const numberFormatter = new Intl.NumberFormat("ko-KR");
const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "기록 없음";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "날짜 확인 불가"
    : dateFormatter.format(date);
}

export function formatDateTime(
  value: string | Date | null | undefined,
): string {
  if (!value) return "기록 없음";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "날짜 확인 불가"
    : dateTimeFormatter.format(date);
}

/** The default seven Seoul calendar days, including today. */
export function getDefaultDateRange(now = new Date()): DateRange {
  const seoulDay = new Date(now.getTime() + SEOUL_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
  const from = new Date(Date.parse(`${seoulDay}T00:00:00Z`) - 6 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return { from, to: seoulDay };
}

function calendarMidnight(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("시작일과 종료일을 올바르게 입력해 주세요.");
  const calendarUtc = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(calendarUtc) ||
    new Date(calendarUtc).toISOString().slice(0, 10) !== value
  ) {
    throw new Error("시작일과 종료일을 올바르게 입력해 주세요.");
  }
  return calendarUtc - SEOUL_OFFSET_MS;
}

/** Inclusive Seoul date inputs become the API's half-open UTC interval. */
export function dateRangeToFilters(
  range: DateRange,
): Pick<Filters, "from" | "to"> {
  const from = calendarMidnight(range.from);
  const lastDay = calendarMidnight(range.to);
  if (lastDay < from) throw new Error("종료일은 시작일보다 빠를 수 없습니다.");
  const to = lastDay + DAY_MS;
  if (to - from > 366 * DAY_MS)
    throw new Error("조회 기간은 최대 366일까지 선택할 수 있습니다.");
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

let generatedIdCount = 0;

/** Browser-safe IDs also work on a LAN origin without secure-context randomUUID. */
export function createId(prefix: string): string {
  const safePrefix =
    prefix.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "id";
  const crypto = globalThis.crypto;
  try {
    if (typeof crypto?.randomUUID === "function") {
      return `${safePrefix}_${crypto.randomUUID().replace(/-/g, "")}`;
    }
    if (typeof crypto?.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return `${safePrefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    }
  } catch {
    // Some embedded browsers expose crypto methods without allowing their use.
  }
  generatedIdCount += 1;
  return `${safePrefix}_${Date.now().toString(36)}_${generatedIdCount.toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

export type FlatTag = Tag & { depth: number };

/** Stable tree order matches the API's ASCII ID tie-breaker, independent of editable labels. */
export function compareTagOrder(
  a: Pick<Tag, "id" | "order">,
  b: Pick<Tag, "id" | "order">,
): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Preorder view of the catalog; transient orphan/cyclic edits cannot hide nodes. */
export function flattenTree(tags: Tag[]): FlatTag[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const children = new Map<string | null, Tag[]>();
  for (const tag of byId.values()) {
    const parent =
      tag.parentId && tag.parentId !== tag.id && byId.has(tag.parentId)
        ? tag.parentId
        : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(tag);
    children.set(parent, siblings);
  }
  for (const siblings of children.values()) siblings.sort(compareTagOrder);
  const result: FlatTag[] = [];
  const visited = new Set<string>();
  const visit = (root: Tag) => {
    const stack = [{ tag: root, depth: 0 }];
    while (stack.length > 0) {
      const entry = stack.pop()!;
      if (visited.has(entry.tag.id)) continue;
      visited.add(entry.tag.id);
      result.push({ ...entry.tag, depth: entry.depth });
      const descendants = children.get(entry.tag.id) ?? [];
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        stack.push({ tag: descendants[index], depth: entry.depth + 1 });
      }
    }
  };
  for (const root of children.get(null) ?? []) visit(root);
  for (const remaining of [...byId.values()].sort(compareTagOrder))
    visit(remaining);
  return result;
}

/** The selected tag and all descendant IDs, once each, including cycle-safe editing states. */
export function descendantIds(tags: Tag[], id: string): string[] {
  if (!tags.some((tag) => tag.id === id)) return [];
  const children = new Map<string, string[]>();
  for (const tag of tags) {
    if (tag.parentId === null) continue;
    const siblings = children.get(tag.parentId) ?? [];
    siblings.push(tag.id);
    children.set(tag.parentId, siblings);
  }
  const result = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    const descendants = children.get(current) ?? [];
    for (let index = descendants.length - 1; index >= 0; index -= 1)
      stack.push(descendants[index]);
  }
  return [...result];
}

export interface HighlightSegment {
  start: number;
  end: number;
  text: string;
  detections: Detection[];
  tags: DetectionTag[];
}

/** Split by code-point intervals, preserving repeated text and every overlapping detection. */
export function highlightSegments(
  prompt: string,
  detections: Detection[],
): HighlightSegment[] {
  const points = Array.from(prompt);
  if (points.length === 0) return [];
  const boundaries = new Set([0, points.length]);
  const starts = new Map<number, number[]>();
  const ends = new Map<number, number[]>();
  detections.forEach((detection, index) => {
    const { start, end, text } = detection;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > points.length ||
      end <= start ||
      points.slice(start, end).join("") !== text
    )
      return;
    boundaries.add(start);
    boundaries.add(end);
    starts.set(start, [...(starts.get(start) ?? []), index]);
    ends.set(end, [...(ends.get(end) ?? []), index]);
  });
  const ordered = [...boundaries].sort((a, b) => a - b);
  const active = new Set<number>();
  const result: HighlightSegment[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    for (const detection of ends.get(start) ?? []) active.delete(detection);
    for (const detection of starts.get(start) ?? []) active.add(detection);
    const overlapping = [...active]
      .sort((a, b) => a - b)
      .map((item) => detections[item]);
    const tags = new Map<string, DetectionTag>();
    for (const detection of overlapping) {
      for (const tag of detection.tags)
        if (!tags.has(tag.id)) tags.set(tag.id, tag);
    }
    result.push({
      start,
      end,
      text: points.slice(start, end).join(""),
      detections: overlapping,
      tags: [...tags.values()],
    });
  }
  return result;
}
