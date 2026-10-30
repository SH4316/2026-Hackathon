/** ISO-8601 instants on the wire; the interval is [from, to). */
export interface Filters {
  from?: string;
  to?: string;
  versionId?: string;
  service?: string;
  personId?: string;
  tagId?: string;
  policyStateId?: string;
  q?: string;
  hasDetections?: "true" | "false";
  unmapped?: "true";
  interval?: "hour" | "day";
}

/** Inclusive calendar dates displayed in Asia/Seoul. */
export interface DateRange {
  from: string;
  to: string;
}

export interface Tag {
  id: string;
  name: string;
  description: string;
  examples: string[];
  guidance: string;
  /** Per-tag Jev judgment prompt; preserved verbatim, up to 12000 Unicode code points. */
  jevPrompt: string;
  /** Per-tag Python re source; stored verbatim, up to 4000 Unicode code points. */
  pythonRegex: string;
  color: string;
  parentId: string | null;
  order: number;
}

export interface PolicyDefinition {
  id: string;
  name: string;
  description: string;
  color: string;
  order: number;
}

export interface VersionSummary {
  id: string;
  name: string;
  status: "DRAFT" | "PUBLISHED";
  isActive: boolean;
  revision: number;
  createdAt: string;
  publishedAt: string | null;
}

export interface ConfigVersion extends VersionSummary {
  tags: Tag[];
  policyStates: PolicyDefinition[];
}

export interface CreateVersionInput {
  name: string;
  baseVersionId?: string;
}

export interface SaveVersionInput {
  revision: number;
  name: string;
  tags: Tag[];
  policyStates: PolicyDefinition[];
}

export interface Person {
  id: string;
  name: string;
  eventCount: number;
  findingCount: number;
  lastEventAt: string | null;
}

export interface DetectionTag {
  id: string;
  name: string;
  color: string;
}

/** Offsets count Unicode code points, including each astral emoji as one. */
export interface Detection {
  id: number;
  start: number;
  end: number;
  text: string;
  tags: DetectionTag[];
}

export interface SecurityEvent {
  id: number;
  sourceId: string;
  eventId: string;
  versionId: string;
  personId: string;
  personName: string;
  prompt: string;
  occurredAt: string;
  receivedAt: string;
  service: string;
  model: string | null;
  policyStateId: string | null;
  policyStateName: string | null;
  detections: Detection[];
  findingCount: number;
}

export type Event = SecurityEvent;

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface Metrics {
  versionId: string | null;
  summary: {
    eventCount: number;
    findingCount: number;
    personCount: number;
    detectedEventCount: number;
  };
  series: Array<{ bucket: string; eventCount: number; findingCount: number }>;
  tags: Array<{
    id: string;
    parentId: string | null;
    name: string;
    color: string;
    order: number;
    count: number;
    eventCount: number;
  }>;
  unmapped: { count: number; eventCount: number };
  policies: Array<{
    id: string;
    name: string;
    color: string;
    eventCount: number;
    mapped: boolean;
  }>;
  services: Array<{
    service: string;
    eventCount: number;
    findingCount: number;
  }>;
}

export interface SavedSearch {
  id: string;
  name: string;
  versionId: string;
  createdAt: string;
  filters: Filters;
  eventCount: number;
  findingCount: number;
}

export interface SaveSearchInput {
  name: string;
  filters: Filters;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
}
