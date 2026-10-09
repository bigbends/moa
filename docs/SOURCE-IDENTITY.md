# Stable source IDs and address aliases

Mangayomi JS and Aniyomi APK keep their existing contracts: work `link` and episode `url` values are passed to the original extension. No new extension field or per-source setting is required.

## IDs and aliases

`media.id` and `episodes.id` remain permanent. Existing IDs, progress for every profile, watchlists, subtitles and client links are not rewritten. New items still receive the legacy hash-shaped ID after alias matching fails; a hash is an initial allocation, not an instruction to replace an existing ID when its URL changes.

The host stores old and new raw addresses as aliases. Exact alias matching comes first, then path/query/fragment matching within a known site namespace. Work lookup is scoped to one installed source; episode lookup is scoped to one work. Multiple matches are not merged. Titles, season numbers and episode labels alone are not identity evidence.

Absolute and relative forms can match within a known namespace, but the extension receives its original representation. JSON identifiers, bare IDs and non-HTTP schemes remain opaque. Queries, fragments and encoded values are not stripped or sorted. Unrelated hosts in an aggregator remain separate even when they use the same path.

## Where address relationships come from

- A successfully installed extension's base URL transition connects the old and new origin when the base path is unchanged. This supports numeric, TLD and hostname changes. Merely refreshing a repository index cannot change a running extension's address.
- Explicit extension rollback selects the restored installed origin, regardless of numeric order. Old aliases remain usable.
- Numbered siblings in the source's own namespace remain supported for extensions whose manifests have static base URLs. A fresh list/detail response can introduce a new candidate in either numeric direction. The largest observed number is not the current-address rule. An already retired origin returned by a stale response does not replace the active candidate. This numbered-host association is a compatibility heuristic, not universal proof that two sites have the same content.
- A successful detail call returning a new origin with the same resource path records a work-local alias; it does not migrate every unrelated host in the source.

The host never invents or probes domains. Base-path changes are not automatically translated. If neither installed metadata nor a source response reveals a new address, existing extension behavior is preserved. Returning to an already retired runtime-discovered origin requires an explicit installed-state transition or the extension's own resolver; stale responses alone cannot establish that return.

## Direct resume

Home playback selects the known address without fetching another catalogue or forcing details to refresh. Only an absolute navigation URL with a known relationship can be rewritten; media, HLS, subtitle, image and authentication headers are not rewritten.

If extraction with the changed navigation URL fails or has no usable videos, the original URL is tried once. Failed candidate pairs are suppressed for five minutes (bounded memory; cleared on source invalidation). The saved episode URL changes only after usable extraction; original aliases are retained. Cancelled or superseded generations do not publish address updates or retry, and unused APK leases are released.

## Persistence and compatibility

`source_work_alias` / `source_episode_alias` store aliases and indexed resource keys. `source_address_state`, `source_address_sites` and `source_address_origins` record installed base state, namespaces and candidate selection. `source_identity_migrations` makes the additive initial backfill transactional and one-time. Old PR numeric-family tables are not treated as evidence of arbitrary domain migration. Uninstall explicitly clears source address state as well as aliases because source_entries rows can remain after removal.

Added tables do not imply safe write compatibility with an older application. An old application does not know the aliases and may create duplicate entries after an address change. Do not declare release rollback safe without separately checking this. No production migration or downgrade is performed by the tests below.

Unrecognized site restructuring, changed path/episode identifiers, repository/source-ID migration and historical duplicate consolidation are outside this change. Existing records remain intact. No zero-regression claim is made for all third-party extensions.

## Validation

Tests cover two-profile history preservation and backfill, installed numeric/TLD/name transitions, extension rollback, direct resume position, repeated fallback suppression, ambiguous records, base paths, unrelated hosts, opaque/relative identifiers, cancellation and unused leases. Standard Mangayomi JS runs unchanged through the real QuickJS runtime against a synthetic contract fixture; APK descriptor transitions exercise the existing bridge contract. Existing source/APK/cache regression tests remain applicable. External sites are not contacted by these tests. Two unmodified public extension snapshots also passed metadata/filter invocation with network access disabled; that is contract coverage, not live playback certification. Legacy URLs newer than static metadata are left intact during backfill until an actual transition establishes retirement.

Upstream reference: [Mangayomi chapter synchronization](https://github.com/kodjodevf/mangayomi/blob/e479d28ac601594b6768ff343035ed6486babc17/lib/modules/manga/detail/providers/update_manga_detail_providers.dart) compares domainless URLs and additional chapter-recognition keys while keeping matched database IDs. MOA does not copy title-based merging or destructive deduplication.
