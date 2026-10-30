# V2 implementation contract

Approved plan: user-defined tag tree + versioned policy catalog; Prompt/span ingestion, saved queries with immutable snapshots, graph-first overview, Swagger, dev-only SQL data. Work ONLY in existing fix/dashboard-compose-backend worktree. Preserve Spring Boot3.5/Java21/MySQL/React, local no-auth design. No new branch. User authorized clearing all old people/events/findings in V2 migration. Normal fresh DB has NO tags, policy states, versions, people or events. Existing V1 migration is immutable; add V2. Do not change external extension.

## Configuration model

IDs are strings matching [A-Za-z0-9_-]{1,80}; server generates version/saved-search IDs. UI can generate new tag/policy IDs using a supplied nonvisual helper; IDs stable across cloned versions. Tag={id,name,description,examples:string[],guidance,color,parentId:string|null,order:number}. PolicyDefinition={id,name,description,color,order:number}. Name1..80, description/guidance up to4000, examples max20 strings <=1000, color #RRGGBB; use sensible defaults for empty optional strings/arrays/color. ConfigVersion={id,name,status:'DRAFT'|'PUBLISHED',isActive:boolean,revision:number,createdAt,publishedAt:string|null,tags:Tag[],policyStates:PolicyDefinition[]}. VersionSummary is ConfigVersion without tags/policyStates. Each tag appears once in a version, any node can receive detections. Tag trees must have valid parents/no cycles, maxdepth32/max1000nodes. Catalog metadata and structure are per-version; no hardcoded category or policy enums.

- GET /api/v1/config-versions -> VersionSummary[]
- POST /api/v1/config-versions {name,baseVersionId?} ->201 ConfigVersion; absent base creates empty draft, clone keeps logical tag/policy IDs.
- GET /api/v1/config-versions/{id} -> ConfigVersion.
- PUT /api/v1/config-versions/{id} {revision,name,tags,policyStates} -> ConfigVersion; draft only; increments revision; conflict409 on stale revision. No name/code/meaning inferred from labels.
- POST /api/v1/config-versions/{id}/publish {revision} -> ConfigVersion; immutable afterwards, revision validated. An empty valid tree is allowed.
- POST /api/v1/config-versions/{id}/activate -> ConfigVersion; published only. Atomic singleton active version pointer, no two active versions. First startup none.
- DELETE /api/v1/config-versions/{id} ->204; draft only.
- GET /api/v1/classifier-config -> active ConfigVersion including tag examples/guidance/tree/definitions. 404 NO_ACTIVE_VERSION if none.

## Ingestion

POST /api/v1/events body {sourceId,eventId,personId,versionId,prompt,detections:[{start,end,text,tagIds:string[]}],occurredAt?,service?,model?,policyStateId?}.
sourceId/eventId/personId/versionId mandatory, registered person required422. prompt nonblank, <=200000 Unicode code points; total body1MiB and matching parser string limits; detections max1000; each nonempty tagIds. Span units Unicode code points, start inclusive/end exclusive, exact substring equals text, don't trim/normalize prompt. Same [start,end] repeated input merged into one detection with union tagIds; order-independent canonical replay. Different overlapping intervals remain different detections. Empty detections allowed (0findingCount). Optional occurredAt uses server receivedAt; service defaults 'unspecified' (normalize supplied lowercase slug); model/policy null. Keep original UTC precision, future validation and safe input limits.
Every new event requires active versionId; reject inactive/stale409; unknown tag/policy in that version422. Existing identical sourceId+eventId replay returns200 even after activation changed, different content409; omitted server-default timestamps must not make identical replay conflict. Creation201. Event writes atomic, concurrent idempotency preserved.
Event={id:number,sourceId,eventId,versionId,personId,personName,prompt,occurredAt,receivedAt,service,model:string|null,policyStateId:string|null,policyStateName:string|null,detections:[{id:number,start,end,text,tags:[{id,name,color}]}],findingCount:number}. Event details use captured published-version labels; viewVersion metadata used separately by charts. Full prompt/detections available on list/detail for v2; no update/delete events.
GET /api/v1/events + filters/page -> Page<Event>; GET /events/{id} -> Event. Keep people POST{id,name},GET paginated,GET/{id}; Person={id,name,eventCount,findingCount,lastEventAt}. Page={items,page,size,totalElements,totalPages},0based,size20 default max100.

## Filters / aggregates

Filters={from?,to?,versionId?,service?,personId?,tagId?,policyStateId?,hasDetections?:'true'|'false',q?,interval?:'hour'|'day',unmapped?:'true'}. from/to ISO instants, [from,to), default last7Seoul calendar dates, max366days. q literal substring in prompt (not SQL wildcard). Person list search is separate `personQuery` query parameter; no collision with prompt q. People registry membership is restricted only by personQuery/personId; all event filters affect stats/lastEventAt only, so registered people with zero matching events remain visible. `versionId` selects PUBLISHED interpretation tree only; it NEVER filters by event.version_id. Omitted selects active. No active with no explicit version =>200 empty-tree metrics/event browsing; tag filters invalid without published version. q/from/etc apply consistently across events/people/metrics. tagId includes itself+all descendants under selected version. hasDetections controls event-level presence. policyStateId filters exact stableID. unmapped mutually exclusive tagId; means detection whose tag IDs are all absent from selected tree.
Summary/counts: eventCount=distinct matching events, findingCount=distinct detection IDs after tag/unmapped restriction, personCount=persons with matching events, detectedEventCount=events with at least one matched detection. Multi-tags never duplicate a detection. Tree node count=union of own+descendant tags; distinct events per node; don't sum child counts. An unmapped detection only means none of its tagIDs in viewed tree. Global counts include all matching spans regardless version; selected tree has unmapped aggregate in addition. policy null omitted from state distribution; version-unmapped states use captured names and mapped:false, never a synthetic user-defined state.
GET /api/v1/metrics -> Metrics={versionId:string|null,summary:{eventCount,findingCount,personCount,detectedEventCount},series:[{bucket:string,eventCount,findingCount}],tags:[{id,parentId,name,color,order,count,eventCount}],unmapped:{count,eventCount},policies:[{id,name,color,eventCount,mapped:boolean}],services:[{service,eventCount,findingCount}]}. bucket is ISO date YYYY-MM-DD for day, full UTC instant for hour; fill zero buckets with Seoul boundaries. Max hourly range31days (clear400 beyond). Counts derive SQL, don't load whole event population in Java to aggregate.

## Saved searches

POST /api/v1/saved-searches {name,filters:Filters} ->201 SavedSearch; resolve relative/default date range and active version to absolute published version/range, persist all matching event IDs transactionally, not current page; require published view version409 if absent.
SavedSearch={id,name,versionId,createdAt,filters:Filters,eventCount,findingCount}. GET list ->SavedSearch[]; GET /{id}->SavedSearch; DELETE /{id}->204 removes membership/config only, never original events.
GET /saved-searches/{id}/events?page&size ->Page<Event>; GET /saved-searches/{id}/metrics ->Metrics. Snapshot is immutable event membership plus frozen filters/version. Original events and published configs immutable. New ingestion/active version cannot change snapshots. Requery is client navigation to /events with saved filters, never overwrites snapshot.

## Swagger/errors/routes

Add springdoc-openapi-starter-webmvc-ui2.10.0 compatibleBoot3.5. Swagger /swagger-ui.html redirect and /swagger-ui/index.html, JSON /v3/api-docs. Relative server '/' and all API groups/examples documented incl Unicode offsets, version mismatch, replay. Don't SPA-forward docs or missingAPI/assets. Errors {code,message,fieldErrors?}, Korean, no stack/prompt echo.
SPA routes /,/events,/events/:id,/people,/people/:id,/settings/metrics,/settings/monitoring,/saved-searches,/saved-searches/:id.

## Dev SQL

compose-dev.yml: retain APP_BIND_IP/APP_PORT, use dev-mysql-data volume replacing base volume, mount ./dev/sql read-only into backend /app/dev-sql and set SPRING_FLYWAY_LOCATIONS=classpath:db/migration,filesystem:/app/dev-sql. SQL callback afterMigrate__demo.sql inserts sample data after schema only for dev. BaseCompose unchanged, no devseed inside classpath. Idempotent fixed IDs / date-specific eventIDs; don't overwrite user-edited configs or chosen active version. Activate demoV1 only if no active version exists. Seed two published versions (one active), provided14categories+PII name/phone/email submetrics, examples+guidance, editable policies, explicitly labeled demo people and fake prompts; varied30day/hour data incl zero detections/multi-tags/repeated spans. Coordinate actual schema backend -> SQL agent promptly. Normal V2 startup empty; old data reset ONCE via migration, never on ordinary startup.

## Ownership

Root owns all visual TSX/CSS, design docs, UI flows. Backend agent owns backend/** and concise schema notes for SQL agent. Frontend data agent owns frontend types/api/format/query/hooks and nonvisual tests/config, NEVER App/ui/styles unless requested. Runtime/SQL agent owns dev/** compose-dev.yml README scripts/** validation/**, runtime/tests and SQL fixtures. Shared current branch, no new worktrees/branches/commits by agents. Root final commit.
