# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0]

### Added

- `allowWildcards`/`allowLeftWildcard`/`allowRightWildcard: boolean` options on `string`
  attributes (all default `true`) — set to `false` to silently strip a user-typed `*` on
  that side, as if it had never been typed, falling back to whatever `autoWildcards`
  behavior is configured. Previously a user-typed `*` was always honored regardless of the
  wildcard options, which only ever controlled auto-adding one. See
  [Restricting user wildcards](README.md#restricting-user-wildcards).

### Changed

- **Breaking:** `wildcards`/`leftWildcard`/`rightWildcard` options on `string` attributes
  are renamed to `autoWildcards`/`autoLeftWildcard`/`autoRightWildcard`, to distinguish them
  from the new `allowWildcards`/`allowLeftWildcard`/`allowRightWildcard` options. Behavior is
  unchanged — only the option names changed. See
  [Implicit wildcards](README.md#implicit-wildcards).

## [0.3.0]

### Added

- `fulltext` attribute type — matches against a `tsvector` (a precomputed/indexed column, or a
  SQL expression that builds one) supplied via `fields`, same raw-SQL contract as any other
  attribute. A required `dialect` (no default — must always be set explicitly) picks one of two:
  `'to_tsquery'` compiles to `@@ to_tsquery(...)`, handing each term to Postgres's own
  text-search parser and dictionaries — an optional `language`
  (default `'simple'`) sets the `regconfig` passed to it. `'tsquery'` compiles to
  `@@ (:query)::tsquery` instead, casting straight to `tsquery` so every lexeme is taken
  literally with no re-parsing or dictionary normalization — an optional
  `tokenize: (value: string) => string[]` (default: split on whitespace) controls how a term
  becomes lexemes, matching whatever tokenized the `tsvector` in `fields` (e.g.
  `array_to_tsvector(regexp_split_to_array(...))`). A trailing `*` on a term compiles to a
  prefix match (`:*`) — the only wildcard shape `tsquery` supports; `*` anywhere else throws
  `INVALID_WILDCARD`. Only the bare `:` operator is supported. Every term is bound as its own
  parameter and quoted as a `tsquery` lexeme before being combined with others, never
  concatenated into the query text raw. See
  [Full-text search (Postgres)](README.md#full-text-search-postgres).
- `phrases: boolean` option on `fulltext` attributes — controls whether a multi-token term
  joins its lexemes with `<->` (phrase/adjacency, `true`) or `&` (plain AND, `false`). Defaults
  to `true` for `dialect: 'to_tsquery'` and `false` for `dialect: 'tsquery'`, since
  `array_to_tsvector`-built vectors carry no position data and so can never satisfy `<->`. See
  [Full-text search (Postgres)](README.md#full-text-search-postgres).
- Several bare terms against the same `fulltext` attribute, combined at the same `AND`/`OR`
  level (including a single negated term), are fused into one `@@` call instead of one call
  per term, avoiding re-evaluating the `tsvector` expression once per word. Fusion only merges
  direct siblings; a `NOT` wrapping a whole group, or terms split across nested groups with
  other attributes mixed in, still compile correctly, just without fusing. See
  [Full-text search (Postgres)](README.md#full-text-search-postgres).
- `tag` attribute type — rewrites a `field:value` predicate into a literal fulltext term
  against another (`attribute: string`) attribute, so `status:online` compiles exactly as if
  the query had been `tags:"status:online"` against the `fulltext` attribute `attribute` points
  to. The rewritten predicate is validated and resolved exactly like any other predicate
  against the target attribute, so it fuses with other terms against that same target
  (including from other `tag` attributes pointing at it) with no separate code path. See
  [Full-text search (Postgres)](README.md#full-text-search-postgres).

## [0.2.0]

### Added

- `null` attribute type — compiles to an `IS NULL`/`IS NOT NULL` check instead of a value
  comparison, with no parameter bound. Configured with `isNull: string[]` and
  `isNotNull: string[]`, each a list of DSL values that trigger that check. See
  [Null checks](README.md#null-checks).
- `wildcards`/`leftWildcard`/`rightWildcard: true` options on `string` attributes — the
  bare `:` shorthand becomes an implicit one- or two-sided `LIKE` match (`wildcards` is
  shorthand for both sides) unless the value already has an explicit `*`, or an explicit
  `=` was used. See [Implicit wildcards](README.md#implicit-wildcards).
- The bare `:` shorthand and an explicit `=` are now distinguished internally (`Operator`
  gains a `':'` member) — they still compile identically everywhere except the new
  `wildcards` option, which only applies to `:`.
- `caseSensitive` on `string` attributes now also accepts `'lower'`/`'upper'`, in addition
  to `boolean` — `'upper'` folds through SQL `UPPER()` instead of `LOWER()`, e.g. to match
  an existing functional index. `false` and `'lower'` are equivalent. See
  [Case sensitivity](README.md#case-sensitivity).
- `-` as shorthand for `NOT`, including on bare terms against `_all` (e.g. `-cheap`) — only
  when directly attached to what follows (no space), so it never conflicts with a negative
  number (`price:-5`) or a hyphenated word (`well-known`). Purely syntactic sugar; compiles
  identically to `NOT`.
- `\*` in a bare-`:` `string` value now escapes to a literal `*`, distinguishing it from a
  real wildcard — e.g. `name:Pet\*` matches the literal value `Pet*` rather than being
  treated as the wildcard `name:Pet*` (starts-with). Works the same in quoted and unquoted
  values. See [Wildcards](README.md#wildcards).
- Backslash escaping (`\\`, `\"`, `\*`, and generic `\<char>`) is now also supported in
  unquoted values, not just quoted ones — a literal backslash needs doubling (`\\`) either
  way. See [Quoted values](README.md#quoted-values).
- New `INVALID_WILDCARD` error code, thrown when a bare `*` appears anywhere other than the
  start/end of a bare-`:` `string` value (e.g. `name:Pet*Other`).
- `enum` attributes now also accept `values: Record<string, string>`, mapping the
  query-facing value to a different underlying value (e.g.
  `{ type: 'enum', values: { pending: 'waiting', completed: 'finished' } }`), in addition to
  the existing `values: string[]` form. See [Attributes](README.md#attributes).

### Changed

- A bare query (or explicit `_all:...`) no longer throws `UNKNOWN_ATTRIBUTE` when `_all`
  isn't declared in `attributes` — since it's opt-in, not a typo, it now just never matches,
  like any other unparseable value. See [Default field](README.md#default-field).
- Wildcard syntax (`*`) now only ever applies to the bare `:` shorthand — every explicit
  operator (`=`, `>`, `>=`, `<`, `<=`) always treats `*` as a plain literal character and is
  never rejected for containing one (previously, `*` combined with an ordering operator
  threw `INVALID_OPERATOR`).
- The bare `:` shorthand on a `string` attribute now always compiles to a `LIKE` predicate,
  even when the value has no `*` — previously it compiled to a plain `=` unless a wildcard
  (explicit, or via the `wildcards` option) was present. Case-sensitivity of a bare-`:`
  `string` match therefore now depends on the database's own `LIKE` collation by default.
  See [Case sensitivity](README.md#case-sensitivity).

## [0.1.0]

Initial release.
