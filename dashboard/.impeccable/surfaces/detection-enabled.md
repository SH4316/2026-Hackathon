# Detection participation settings

Mode: Operate. Routes: `/settings/metrics`, `/settings/jev`.

## Direction contract

THESIS: Keep each detection setting beside the tag or Jev judgment it controls. A separate monitoring page adds no configuration responsibility and is removed.

OWN-WORLD: Inherit current main’s SafePrompt shell and dark color tokens. Use existing editor layout, form controls and version badges. The two touched settings pages apply those tokens consistently so headings and helper text stay readable; unrelated screens and global branding are outside this change.

STORY: Choose a version, edit a tag or judgment, switch its participation on or off, and save with the existing action. A disabled item retains its editable settings, output relationships and historical records. Child tags remain independent.

FIRST VIEWPORT: Preserve the page title, version bar, list/tree and editor. Place one labeled switch and concise scope explanation at the beginning of each detail form. Show “사용 안 함” beside disabled list items and output tags. Six navigation items use the existing mobile three-column grid; editors stack vertically.

FORM: Code-led extension of the existing list/detail editor. Native checkbox semantics with role=switch, visible state text and keyboard focus. Toggle edits remain local until the revision-checked save succeeds. Motion is limited to the thumb moving with reduced-motion support.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Contract boundaries

`Tag.enabled` and `JevPrompt.enabled` default to true for old and new items and belong to the selected tree version. Explicit false survives reads, clone, publication, activation and other saves. Omitted/null flags preserve existing values on updates; new IDs and new judgments default to true. Published metadata and these flags remain editable; tree, version-name and policy locks remain. Turning an item off retains editable metadata, regex, prompt text, thresholds and output relationships. Parent and child tags are independent.

The API returns the complete tree and judgments, including disabled entries and output references, with boolean response flags. The consuming server must select enabled regex tags and enabled judgments’ enabled output tags, skipping a judgment with no enabled outputs. No server synchronization, execution or automatic reload is added. Ingestion accepts existing tag IDs regardless of usage flag. History, captured labels, filters, aggregates and saved-search membership/counts remain unchanged.

The monitoring placeholder component and navigation item are removed. The old URL redirects to metric settings with its query string preserved. Existing save actions persist switch edits with the current revision; conflicts retain local switch and form input. Save-pending controls are locked. A false usage flag does not disable metadata inputs or output selection.

## Incumbent comparison

Current main already uses the SafePrompt dark shell and runtime color tokens. The pre-extension capture at `/tmp/dashboard-runtime/enabled-incumbent.png` shows bright settings forms and low-contrast headings within that shell. The scoped correction applies the existing card, text, muted and border tokens to the two touched settings pages, with local contrast adjustments for primary actions, selected labels and links. The compact switch retains its shape on mobile within a 44px-high label target. PRODUCT.md/DESIGN.md’s legacy bright descriptions and token frontmatter are preexisting documentation drift; their global palette, typography, tokens and design sidecar are preserved. Unrelated header/footer styling is outside this extension. Visual code was authored directly; no approved comp or shipping raster asset is involved.


## Finish record · 2026-10-30

Disposition: **ship for the reviewed Dashboard/API scope**, with no material in-scope findings. The finish reviewer opened all four final saved tag-off/Jev-off captures at desktop 1440/mobile 390 and reviewed the source and browser report. Off-state switches and badges, retained editable settings and selected disabled outputs, desktop hierarchy, six-item mobile navigation and stacked editors are coherent without visible clipping. Source review confirms associated descriptions, native switch semantics, keyboard focus, the 44px label target and reduced-motion support. No approved comp or shipping raster asset is involved; screenshots are transient review evidence.

The [final browser report](../../validation/detection-enabled-browser.json) passes seven lifecycle groups, ten width measurements at 320/390/768/1280/1440 with no overflow, and four focused `.configuration-page` axe scans with zero violations or incomplete results. It records zero uncaught JavaScript errors. Behavior evidence covers explicit save, keyboard Space, pending locks, reload persistence, revision conflicts, independent parent/child and version states, disabled output editing, unchanged historical/snapshot results and the query-preserving redirect. The four still images show saved off states; interaction claims come from the behavior/browser checks and source review.

[Backend evidence](../../validation/detection-enabled-backend-tests.json) records 79 passing tests with no failures, errors or skips; [frontend evidence](../../validation/detection-enabled-frontend-tests.json) records 108 passing tests. Type/build checks and the real MySQL/packaged-JAR check passed. The [package report](../../validation/detection-enabled-package.json) verifies V8, boolean response and nullable optional input schemas, empty fresh bootstrap and SPA/API assets. The final JAR SHA-256 is `e12e836d8351814c06423ce148feb79e3549898a3bd8f46cb05d4f8f560ebc61`. The additional [broader browser regression report](../../validation/detection-enabled-regression-browser.json) passes six groups with no uncaught errors. Reproduction and detailed scope are in [validation](../../validation/detection-enabled.md). The root’s mechanical design check reported no findings.

The documentation pass compared product/design authorities, source, the incumbent capture, final captures and reports; it did not rerun app tests or builds. The finish reviewer read source, captures and recorded checks without rerunning them. DESIGN.md prose reflects this extension, while its normative frontmatter tokens and the design sidecar remain unchanged.

Limits: broad-shell axe scans retain preexisting `color-contrast` findings outside `.configuration-page`: three nodes per mobile state and ten per desktop state in the sidebar/navigation, topbar and footer. These results are preserved separately in `broadAxe`; four clean focused scans do not establish whole-app WCAG conformance or manual assistive-technology coverage. Legacy bright design/token documentation drift and unrelated global shell styling remain outside this extension. Actual detector execution, server synchronization, automatic reload and Docker image/container execution were not verified or implemented here.
