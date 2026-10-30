# Jev settings surface

Mode: Operate. Route: `/settings/jev`.

## Direction contract

THESIS: Edit one independent Jev judgment and its output tags together, with the version scope always visible. Thresholds belong to the selected version’s tags, shared by judgments using those tags.

OWN-WORLD: Extend the existing bright Korean administrator interface: Noto Sans KR, blue selection, neutral text, white form surface and quiet borders. Keep established control sizes, spacing hierarchy and status badges.

STORY: Select a tree version, choose or create a judgment, write its prompt, select existing output tags, set their score thresholds, and save once. Create new tags in a tree draft. Published judgments and tag details remain editable.

FIRST VIEWPORT: Page title and new-judgment action above the version bar; scope note above a narrow judgment list and wider editor. Editor leads with name and multiline prompt, followed by searchable output tags and threshold inputs. At mobile widths list and form stack; all seven navigation destinations remain visible.

FORM: Inherited list-and-detail settings editor; code-led extension of the established dashboard, with no new visual world or generated bitmap assets. The signature interaction saves a prompt, its selected outputs and shared tag thresholds atomically, then exposes the saved scope and revision through the existing configuration response. Motion remains limited to existing control feedback.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Behavioral boundaries

A blank threshold means unconfigured, zero is a valid threshold, and thresholds accept 0–1 inclusive with at most six fractional digits, without defaults or parent inheritance. Invalid input remains visible and blocks save. A tag-settings link selects that tag in the same tree version. Removing a prompt or unselecting an output preserves tags and thresholds. Changing a tree version clears the previous editor while the new version loads. The dashboard stores configuration; the connected detector executes Jev judgments.


## Finish record · 2026-10-30

Disposition: **ship**. The finish reviewer opened all six final draft, published and metric-threshold captures at desktop 1440/mobile 390 and found complete settled views, preserved dashboard identity and no material findings in the reviewed source and states. The corrected checkbox rows, seven visible navigation destinations, mobile stacking and version/shared-threshold guidance satisfy the direction contract.

Frontend 95 tests, backend 71 tests, type/build checks and real MySQL/packaged-JAR checks passed. The [browser report](../../validation/jev-settings-browser.json) records 15 width checks and six axe scans with no overflow, violations, incomplete results or uncaught errors; the [package report](../../validation/jev-settings-package.json) checks the Jev route, migration and API schema. [Validation details](../../validation/jev-settings.md) record reproduction and scope. The reviewer and documenter did not independently rerun these checks.

Documentation compared the implemented App navigation, Jev editor, metric threshold field, styles and reports with the incumbent product/design authorities. PRODUCT.md and DESIGN.md prose now describe independent prompts, shared version-local thresholds and seven-item mobile navigation; normative tokens and the design sidecar are preserved. V7 retains each nonempty legacy prompt's exact text and original tag reference, while leaving thresholds unset and a fresh database empty. Python regex remains independent.

Limits: the finish review covers source and the six captured states, with no approved comp or shipping raster assets. Browser Back/Forward lacks the inherited unsaved-change confirmation; stale-version targeting is fixed and tested. Automated checks do not establish full WCAG conformance, and Docker image/container execution was not verified. No material visual drift was found in this bounded comparison; unrelated existing metadata/schema drift was left unchanged.
