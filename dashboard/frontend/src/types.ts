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
  /** Shared by every Jev prompt outputting this tag; null means unset, zero is valid. */
  jevThreshold: number | null;
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

export interface JevPrompt {
  id: string;
  name: string;
  /** Preserved verbatim, up to 12000 Unicode code points. */
  prompt: string;
  /** Existing tags in this version; thresholds live on the shared tags. */
  tagIds: string[];
}

export interface JevOutputInput {
  tagId: string;
  /** Inclusive 0..1 with up to six fractional digits; null means unset. */
  threshold: number | null;
}

export interface SaveJevPromptInput {
  revision: number;
  name: string;
  prompt: string;
  outputs: JevOutputInput[];
}

export interface ConfigVersion extends VersionSummary {
  tags: Tag[];
  jevPrompts: JevPrompt[];
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

/** Mutable details for one tag in one version; tree structure stays unchanged. */
export type SaveTagDetailsInput = Omit<Tag, "id" | "parentId" | "order"> & {
  revision: number;
};

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

/** 대시보드가 발급한 검사 서버 연결. 비밀값은 발급 응답의 connectionUrl에만 있습니다. */
export interface Connector {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedConnector {
  connector: Connector;
  connectionUrl: string;
}

export type ReportText = "masked" | "full" | "off";
export type TagAction = "warn" | "mask" | "block";

/** 연결된 검사 서버가 따르는 조직 설정. */
export interface DetectorSettings {
  reportText: ReportText;
  tagMap: Record<string, string>;
  tagAction: TagAction;
  jevEnabled: boolean;
  revision: number;
  updatedAt: string | null;
}
