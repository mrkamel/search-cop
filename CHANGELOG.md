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

## [0.1.0]

Initial release.
