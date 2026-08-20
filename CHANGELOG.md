# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

### Changed

- A bare query (or explicit `_all:...`) no longer throws `UNKNOWN_ATTRIBUTE` when `_all`
  isn't declared in `attributes` — since it's opt-in, not a typo, it now just never matches,
  like any other unparseable value. See [Default field](README.md#default-field).

## [0.1.0]

Initial release.
