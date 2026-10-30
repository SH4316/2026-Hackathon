# Dashboard surface

Mode: Operate.

Approved direction: bright Korean administrator interface, implemented directly in React. This is a local demonstration of received security events, not a working detector or organization-wide surveillance deployment.

First viewport: persistent navigation, page heading, explicit date/service/category/policy/person filters, and four clearly named numeric summaries. The numbers use counts from the same selected event scope.

Primary path: overall metrics → selected category/policy/service event list → event detail or person's history. Person registration precedes event ingestion. Context filters survive drilldowns while list pagination does not.

Signature interaction: the category and policy distributions are links to the matching event history. Every count has an explicit unit.

State requirements: empty storage, loading, retriable API failure, zero results, unknown person/event, invalid date input, duplicate person ID, out-of-range pagination recovery, and disabled monitoring settings. No polling or focus refetch. Data loads on entry and query changes; the refresh button explicitly reloads the current scope. The timestamp records the last successful fetch in Korean time and is hidden at 1280px and below.

Responsive contract: 1440px desktop and 390px mobile. Mobile navigation appears above the content and scrolls with the document; wide tables have local scrolling and accessible region names. No document overflow.

Evidence: transient screenshots under .impeccable/review; code-led work has no image comp. Review both overall overview and disabled settings at desktop/mobile plus people/events/person detail.
