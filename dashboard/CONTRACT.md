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

## Detector HTTP ingestion

The detector adapter adds endpoints alongside the existing public API; `/events` and its camelCase request/response contract remain unchanged. Preserve the existing empty initial configuration, registered people, immutable published versions and local no-auth runtime. Do not change the detector or extension to call this endpoint as part of this implementation. Producer reference: `origin/main` commit `e2021df`, `docs/rule-formats.md`, `server/app/schemas.py` and `server/docs/api-contract.md`.

`POST /api/v1/detector-events` accepts JSON with snake_case envelope fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `source_id` | yes | Existing dashboard ID syntax; stable producer namespace. |
| `person_id` | yes | Already registered dashboard person. |
| `version_id` | yes | Active published dashboard configuration for a new event. |
| `text` | yes | Exact original inspected prompt; empty/blank text is valid, at most 200000 Unicode code points. Existing `/events` still requires nonblank text. |
| `result` | yes | Unchanged detector `InspectResponse` JSON, retained with all metadata. |
| `occurred_at` | no | ISO 8601 timestamp with timezone; otherwise server receipt time. Existing event timestamp bounds apply. |
| `service` | no | Existing service normalization; otherwise `result.destination.provider`. |
| `model` | no | Explicit destination LLM model name; otherwise null. Detector model versions do not identify it. |
| `policy_state_id` | no | Configured policy state in `version_id`; otherwise null. Do not infer it from `decision`. |
| `tag_map` | no | Object mapping detector `finding.type` to an existing tag ID in `version_id`. |
| `files` | no | At most 100 `{name}` entries; filename metadata only. |
| `images` | no | At most 20 `{name,media_type,data_base64}` entries; `image/*` MIME type, canonical padded standard Base64 without whitespace or a data URI prefix. |

The result uses the producer's exact snake_case fields: `request_id` (1..128 characters), `input_version` (integer or string), `status` (`complete|incomplete|error`), `decision` (`allow|warn|block`), `signal` (`green|yellow|red|gray`), `findings`, `policy_version`, `destination`, `detector_versions`, and optional `notices`. Every finding has `finding_id`, `type`, `category`, `rule_id`, `detector` (`rule|model`), `confidence` (`high|medium|low`), `severity` (`critical|high|medium|low|info`), `action` (`block|mask|warn|allow`), `span`, `reason` and optional nullable `replacement`. `span` contains `start,end,start_utf16,end_utf16`. `destination` contains `provider,channel,tier,verified,basis`; required nullable `basis` is valid. OpenAPI3.1 represents `input_version` as integer-or-string `oneOf` without an int64 bound or a `JsonNode` object reference, and nullable strings as `type: [string, null]`. Preserve the complete result object, including metadata fields not projected into the dashboard event.

Validate code-point ranges against `text` and verify UTF-16 positions match the same boundaries; all ranges are start-inclusive/end-exclusive. Derive detection text from the original prompt without trimming or normalization. For `A😀 hong@example.com`, the email has code-point `[3,19)` and UTF-16 `[4,20)`. The adapter imposes no additional finding count cap beyond the16MiB body limit; existing `/events` retains its1000-detection limit. Equal ranges merge into one dashboard detection with the union of mapped tags; the original result findings remain intact.

Resolve a finding's tag from explicit `tag_map`, otherwise from an active tag with the same ID as `finding.type`. If neither exists, retain an untagged detection and count it as unmapped. An explicit mapping to a missing tag returns422. Do not seed a built-in taxonomy. Dashboard `version_id` is independent of detector `policy_version` and `detector_versions.ruleset`; no equivalence may be inferred. Require existing person/configuration and preserve current 409 version mismatch and 422 person/policy checks for new events.

Names are nonblank and contain 1..255 Unicode code points; slash, backslash, control characters and names `.` or `..` are invalid. Images decode to at most 5MiB each and 10MiB combined. Preserve input order, file names, media type metadata and original decoded image bytes; do not re-encode images. POST body limit16MiB; other existing API body limits remain1MiB. Reject malformed Base64 and oversize uploads safely. V3 adds detector metadata/attachment storage without changing V1/V2 migrations or deleting existing data. Prompt, result and attachments are committed atomically.

Idempotency identity is the tuple `(source_id,result.request_id,typed result.input_version)`, serialized as a JSON array and represented by `d_` plus its SHA-256 hash in the existing event ID. Numeric `3` and string `"3"` are distinct identities. New201, identical replay200, changed content under the same identity409. Compare original detector payload and attachments as well as projected event fields; JSON object key order must not cause conflicts. Omitted server-default occurrence times must not make retries conflict. A valid identical replay succeeds after activation changes. Do not truncate request IDs to the existing80-character event ID limit.

POST returns the same shape as `GET /api/v1/detector-events/{id}`:

```text
{
  id, event_id, event: Event,
  source_id, person_id, version_id, text, result,
  occurred_at, service, model, policy_state_id, tag_map,
  files: [{name}],
  images: [{id,name,media_type,size_bytes,download_path}]
}
```

`id` is the existing numeric dashboard event ID; `event_id` is the deterministic external event ID. `event` is the existing camelCase dashboard `Event`; the surrounding adapter fields are snake_case. Image Base64 is not repeated in responses. `download_path` points to `GET /api/v1/detector-events/{id}/images/{imageId}`, which returns the stored bytes as an `application/octet-stream` attachment with `X-Content-Type-Options: nosniff`. Image lookup is scoped to its detector event. Missing detector records/images return404. Regular `/events` list/detail, metrics and saved searches continue to use projected events/detections; detector metadata is retrieved through the adapter detail endpoint.

Invalid spans, Base64 or names return400 `INVALID_INPUT`; malformed JSON, unknown fields and invalid enum values return400 `INVALID_JSON`. Explicit unknown tag mappings return422 `TAG_NOT_IN_VERSION`, stale active versions return409 `VERSION_MISMATCH`, and changed replay metadata/files/image bytes return409 `EVENT_CONFLICT`. Existing safe error envelopes remain `{code,message,fieldErrors?}`.

These records represent inspection decisions. They do not assert that a prompt was transmitted, blocked by a client, or accepted by an external AI. Confidence describes detection certainty; severity describes risk; action and decision are policy outcomes. Keep these values separate.

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

The root `DashboardApplication` remains the component-scan entry point. Backend packages are `api` (existing wire DTOs), `configuration` (catalog lifecycle), `event` (person/event writes and atomic replay), `detector` (producer adapter), `query` (filters, reads and aggregates), `savedsearch` (immutable search snapshots), `common` (validation/errors/JDBC helpers), and `web` (HTTP infrastructure, JSON/OpenAPI settings and SPA routes). Controllers are grouped with their feature; health and SPA controllers stay in `web`. The former mixed `DashboardController` is replaced by configuration, people, event, metrics, saved-search and health controllers. Existing HTTP paths, field names and status behavior are preserved.

`DetectorEventNormalizer` validates the producer JSON, projects code-point spans, decodes original image bytes and prepares the deterministic identity/fingerprint. `DetectorEventService` handles persistence and detail/image reads. Its metadata callback participates in `EventWriter`'s existing transaction. `InputValidation` centralizes shared ID, Unicode, text, time and service checks; configuration and query code no longer call each other's generic validation helpers. `JdbcRows` owns shared JDBC row/time conversion. `DashboardQueries.captureSnapshotMembers` keeps the complete matching-event SQL inside the query package while participating in `SavedSearchService`'s transaction. Query SQL fragments remain internal.

Only types/methods used across feature packages are public. Controllers, feature constructors and implementation helpers stay package-private. Unit tests live with event/query/configuration internals; HTTP and migration integration tests remain in the root test package for Spring Boot discovery. Do not change frontend visuals, database migrations or the external detector during this package refactor.
