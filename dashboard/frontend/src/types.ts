export type Category = 'PERSONAL_DATA' | 'CREDENTIAL' | 'CONFIDENTIAL';
export type PolicyState = 'TRAINING_ALLOWED' | 'TRAINING_DISABLED' | 'UNKNOWN';

/** ISO-8601 UTC instants on the wire; the interval is [from, to). */
export interface Filters {
  from?: string;
  to?: string;
  service?: string;
  personId?: string;
  category?: Category | '';
  policyState?: PolicyState | '';
}

/** Inclusive calendar dates displayed in Asia/Seoul. */
export interface DateRange {
  from: string;
  to: string;
}

export interface Person {
  id: string;
  name: string;
  eventCount: number;
  findingCount: number;
  lastEventAt: string | null;
}

export interface Finding {
  category: Category;
  quantity: number;
}

export interface SecurityEvent {
  id: number;
  sourceId: string;
  eventId: string;
  personId: string;
  personName: string;
  occurredAt: string;
  receivedAt: string;
  service: string;
  model: string | null;
  policyState: PolicyState | null;
  findings: Finding[];
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
  summary: {
    eventCount: number;
    findingCount: number;
    personCount: number;
    unknownPolicyCount: number;
  };
  daily: Array<{ date: string; eventCount: number; findingCount: number }>;
  categories: Array<{ category: Category; count: number; eventCount: number }>;
  policies: Array<{ policyState: PolicyState; eventCount: number }>;
  services: Array<{ service: string; eventCount: number; findingCount: number }>;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
}
