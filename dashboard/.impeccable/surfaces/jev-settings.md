# Jev settings surface

Mode: Operate. Route: `/settings/jev`.

## Direction contract

THESIS: Edit one independent Jev judgment and its output tags together, with the version scope always visible. Thresholds belong to the selected version’s tags, shared by judgments using those tags.

OWN-WORLD: Extend current main’s SafePrompt shell and dark runtime color tokens with blue selection and quiet borders. The touched settings form uses its existing card, text and muted tokens consistently; keep established control sizes, spacing hierarchy and status badges. Legacy bright token documentation is preexisting drift, preserved outside this bounded extension.

STORY: Select a tree version, choose or create a judgment, set its usage switch, write its prompt, select existing output tags, set their score thresholds, and save once. Create new tags in a tree draft. Published judgments and tag details remain editable.

FIRST VIEWPORT: Page title and new-judgment action above the version bar; scope note above a narrow judgment list and wider editor. Editor leads with a labeled usage switch, name and multiline prompt, followed by searchable output tags and threshold inputs. Disabled judgments and output tags have “사용 안 함” text badges. At mobile widths list and form stack; all six navigation destinations remain visible in two rows.

FORM: Inherited list-and-detail settings editor; code-led extension of the established dashboard, with no new visual world or generated bitmap assets. The signature interaction saves a prompt, its selected outputs and shared tag thresholds atomically, then exposes the saved scope and revision through the existing configuration response. Motion remains limited to existing control feedback.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Behavioral boundaries

A blank threshold means unconfigured, zero is a valid threshold, and thresholds accept 0–1 inclusive with at most six fractional digits, without defaults or parent inheritance. Invalid input remains visible and blocks save. A tag-settings link selects that tag in the same tree version. Removing a prompt or unselecting an output preserves tags and thresholds. Changing a tree version clears the previous editor while the new version loads. The judgment usage flag is independent of tag flags, editable in draft and published versions, and saved with the existing action. Turning it off retains editable prompt text, output selection and thresholds; disabled output tags remain selectable and editable. All items and references remain in API responses. The dashboard stores configuration; a consuming detector must choose enabled judgments and their enabled output tags, skipping judgments with no enabled outputs. Server execution, synchronization and automatic reload are excluded. Usage changes preserve history, aggregates and saved searches.


## Jev separation finish record · 2026-10-30 (historical)

Disposition: **ship**. The finish reviewer opened all six final draft, published and metric-threshold captures at desktop 1440/mobile 390 and found complete settled views, preserved dashboard identity and no material findings in the reviewed source and states. The corrected checkbox rows, seven visible navigation destinations, mobile stacking and version/shared-threshold guidance satisfy the direction contract.

Frontend 95 tests, backend 71 tests, type/build checks and real MySQL/packaged-JAR checks passed. The [browser report](../../validation/jev-settings-browser.json) records 15 width checks and six axe scans with no overflow, violations, incomplete results or uncaught errors; the [package report](../../validation/jev-settings-package.json) checks the Jev route, migration and API schema. [Validation details](../../validation/jev-settings.md) record reproduction and scope. The reviewer and documenter did not independently rerun these checks.

Documentation compared the implemented App navigation, Jev editor, metric threshold field, styles and reports with the incumbent product/design authorities. PRODUCT.md and DESIGN.md prose now describe independent prompts, shared version-local thresholds and seven-item mobile navigation; normative tokens and the design sidecar are preserved. V7 retains each nonempty legacy prompt's exact text and original tag reference, while leaving thresholds unset and a fresh database empty. Python regex remains independent.

Limits: the finish review covers source and the six captured states, with no approved comp or shipping raster assets. Browser Back/Forward lacks the inherited unsaved-change confirmation; stale-version targeting is fixed and tested. Automated checks do not establish full WCAG conformance, and Docker image/container execution was not verified. No material visual drift was found in this bounded comparison; unrelated existing metadata/schema drift was left unchanged.


## Detection participation extension · 2026-10-30

The monitoring placeholder and seventh navigation destination are removed; its URL redirects to metric settings with the query string intact. The usage switch changes local form state until “판단 저장” succeeds, locks while saving, and retains unsaved state on a revision conflict. Old and new judgments default to enabled; omitted/null update flags preserve stored false. Clones preserve independent per-version settings. V8 adds the flags without changing V7 prompt text or bindings.

The prior finish record above describes the Jev separation build. The detection-participation extension compares against current main’s dark shell; the former bright-form documentation and token frontmatter are preexisting drift. A scoped style correction uses the existing dark surface/text tokens on both touched settings pages, adjusts primary-action and link/selection contrast, and keeps a compact mobile switch within a 44px-high label target. It does not replace the global visual system or update its legacy tokens/sidecar.


Extension disposition: **ship for the reviewed Dashboard/API scope**, with no material in-scope findings. The reviewer opened all four final tag-off/Jev-off desktop 1440/mobile 390 captures and reviewed source; the off judgment retains editable prompt/threshold fields and selected disabled output links. Backend 79/frontend 108 tests, type/build and MySQL/packaged-JAR checks passed. The final browser report passes seven lifecycle groups, ten width checks without overflow, four focused axe scans with zero violations/incomplete results and zero uncaught errors; six broader browser regression groups also pass. See [validation](../../validation/detection-enabled.md) and the [complete finish record](detection-enabled.md).

The reviewer and documentation pass did not rerun tests/builds. Broad-shell contrast findings remain outside `.configuration-page` (three mobile/ten desktop nodes per captured state), with no whole-app WCAG or manual assistive-technology claim. Actual detector execution, server synchronization/automatic reload and Docker image/container execution are excluded. Legacy bright tokens and the design sidecar remain unchanged.
