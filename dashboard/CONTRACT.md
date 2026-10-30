# Internal implementation contract

All implementation lives in this worktree's `dashboard/`. Korean UI. Local demo, no authentication. Java 21 + Spring Boot + Gradle + JPA/Flyway/MySQL, React/TS/Vite/React Router/Recharts. Final executable is Spring JAR containing frontend build. No detector or extension edits. Manual refresh only.

## API

Prefix `/api/v1`. JSON camelCase. UTC ISO-8601 instants on wire; Asia/Seoul for calendar buckets and UI. Default range is beginning of six days ago through beginning of tomorrow in Seoul. Filter interval is `[from,to)`. Dates must carry an offset. Accept `from,to,service,personId,category,policyState`; empty values are omitted. Category filter selects events containing that category and finding totals include only the selected category. Event count always counts distinct events. Policy filters act on events. Page 0-based, size default 20 max 100. Range order validated; cap query range at 366 days with clear error. No arbitrary metric thresholds.

Enums: Category = PERSONAL_DATA | CREDENTIAL | CONFIDENTIAL; PolicyState = TRAINING_ALLOWED | TRAINING_DISABLED | UNKNOWN. Missing policyState is null, not UNKNOWN. Service is a normalized lowercase slug (1..64 chars, letters/numbers/hyphen/underscore), known labels chatgpt/claude/gemini; additional slugs are supported. model optional string max 120. Person IDs and source/event IDs match `[A-Za-z0-9_-]{1,80}`. Person names 1..80 trimmed chars.

- POST `/people` body `{id,name}`, returns 201 Person; duplicate id 409. No update/delete.
- GET `/people?q=&page=0&size=20` plus common event filters returns Page<Person>. q matches name or ID (literal search). Includes registered people with zero matching events; optional personId narrows people. Stats respect common event filters.
- GET `/people/{id}` plus common event filters returns Person, unknown 404.
- POST `/events` body `{sourceId,eventId,personId,occurredAt,service,model?,policyState?,findings:[{category,quantity}]}` returns 201 Event. findings default empty. At least policyState or one finding required. quantity integer 1..1000000; at most one finding per category; max 3 findings. Unknown person 422. Future timestamps over five minutes rejected. Other malformed input 400. Ignore no unknown properties: reject them so raw prompt/secret values cannot accidentally be accepted. DB unique(sourceId,eventId), same canonical content => 200 existing Event, different content => 409. Canonical compare order-insensitive findings, trimmed name fields, normalized service and UTC timestamps; receivedAt excluded. Use microsecond-compatible timestamp precision consistently.
- GET `/events` common filters plus pagination => Page<Event>, newest occurredAt first with id descending tie break.
- GET `/events/{id}` => Event, unknown 404.
- GET `/metrics` common filters => Metrics.
- GET `/health` => `{status:"UP"}` (local smoke check).

Person = `{id:string,name:string,eventCount:number,findingCount:number,lastEventAt:string|null}`.
Event = `{id:number,sourceId:string,eventId:string,personId:string,personName:string,occurredAt:string,receivedAt:string,service:string,model:string|null,policyState:PolicyState|null,findings:Finding[],findingCount:number}`.
Page<T> = `{items:T[],page:number,size:number,totalElements:number,totalPages:number}`.
Metrics = `{summary:{eventCount:number,findingCount:number,personCount:number,unknownPolicyCount:number},daily:[{date:"YYYY-MM-DD",eventCount:number,findingCount:number}],categories:[{category:Category,count:number,eventCount:number}],policies:[{policyState:PolicyState,eventCount:number}],services:[{service:string,eventCount:number,findingCount:number}]}`. Return all category/policy entries including zeros and zero-fill daily buckets. Null policy excluded from policies. personCount = distinct persons among matching events.
Errors = `{code:string,message:string,fieldErrors?:Record<string,string>}`; Korean helpful messages; no stack traces/payload echo. Validate all query filters and reject malformed enums/ranges.

## UI and integration

Routes `/`, `/events`, `/events/:id`, `/people`, `/people/:id`, `/settings/monitoring`. Frontend has same-origin fetch `/api/v1`; Vite proxies `/api` to 127.0.0.1:8080. Spring binds 127.0.0.1:8080 by default; MySQL Compose binds 127.0.0.1:3306. Final jar serves frontend and forwards only known SPA paths, not missing assets/API paths. Root agent owns all visual TSX/CSS and visual documentation. Data agent owns package/config, src/api.ts, src/types.ts, src/hooks.ts, src/format.ts and nonvisual tests. Avoid editing App.tsx, main.tsx, styles.css.

Backend env names: DB_URL default jdbc:mysql://127.0.0.1:3306/ai_security_dashboard?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true, DB_USERNAME default dashboard, DB_PASSWORD default dashboard-local. Compose MYSQL_DATABASE ai_security_dashboard, MYSQL_USER dashboard, MYSQL_PASSWORD dashboard-local, local-only root password via example env. Test isolation must use separate DB. Root agent does visual QA; infra agent handles backend/real MySQL/runtime validation and README/compose/scripts.
