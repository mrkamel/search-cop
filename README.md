# search-cop

A small search DSL that compiles to a TypeORM `SelectQueryBuilder`.

```ts
import { search } from 'search-cop';

const qb = search({
  repository: ProductRepository,
  query: 'status:online AND price:>100',
  attributes: {
    status: { type: 'enum', values: ['online', 'offline'] },
    price: { type: 'number' },
    createdAt: { type: 'datetime' },
  },
});

const products = await qb.getMany();
```

`search()` returns a plain TypeORM `SelectQueryBuilder` — nothing is wrapped.

`repository`, `query`, and `attributes` are required. `alias` is optional and defaults to
the entity's table name — pass it explicitly if you need the generated query to use a
specific alias (e.g. to match an alias already used elsewhere in a larger query).

## Attributes

Only attributes declared in `attributes` may be queried. Supported types:

| Type       | Runtime value | Allowed operators                |
| ---------- | -------------- | --------------------------------- |
| `string`   | `string`       | `=` `>` `>=` `<` `<=`             |
| `number`   | `number`       | `=` `>` `>=` `<` `<=`             |
| `boolean`  | `boolean`      | `=`                               |
| `date`     | `Date`         | `=` `>` `>=` `<` `<=`             |
| `datetime` | `Date`         | `=` `>` `>=` `<` `<=`             |
| `enum`     | `string`       | `=`                               |
| `uuid`     | `string`       | `=`                               |

`enum` attributes also require a `values: string[]` list.

`string` attributes accept an optional `caseSensitive: boolean` (default `true`) — see
[Case sensitivity](#case-sensitivity).

`uuid` values are validated against RFC 9562 (version 1-8 and variant nibbles, plus the nil
and max UUIDs) using the [`uuid`](https://www.npmjs.com/package/uuid) package, and are
lowercased on the way out.

Any attribute type accepts an optional `fields` to match multiple underlying columns
instead of the attribute's own key — see
[Multi-field attributes](#multi-field-attributes).

A query term with no `field:` prefix is matched against the conventional `_all` attribute
key — see [Default field](#default-field).

## Query syntax

A predicate is `field<op>value`, or just a bare `value` to search the default field (see
[Default field](#default-field)). `:` means equality:

```text
status:online        // equivalent to status:=online
price:>100
price:>=100
price:<100
price:<=100
createdAt:>=2026-01-01
```

Combine predicates with `AND` / `OR` (case-sensitive — lowercase `and`/`or` are rejected)
and parentheses. `AND` binds tighter than `OR`:

```text
status:online AND price:>100
status:online OR status:pending
status:a OR status:b AND status:c        // == status:a OR (status:b AND status:c)
(status:online OR status:pending) AND price:>100
```

`AND` is the default combinator and may be omitted — juxtaposing predicates with whitespace
implies `AND`:

```text
status:online price:>100                 // == status:online AND price:>100
```

### Quoted values

Unquoted values end at the first whitespace or parenthesis, so a value containing either
must be double-quoted. Inside quotes, `\"` and `\\` are unescaped to `"` and `\`:

```text
name:"foo bar"
name:"(foo)"
name:"foo \"bar\" baz"                   // foo "bar" baz
```

### Wildcards

A `*` in a `string` attribute's value (with `=`) compiles to a `LIKE` predicate, with `*`
translated to SQL's `%`. Any literal `%`, `_`, or `\` in the value is escaped so it's matched
literally rather than as a `LIKE` wildcard. There's no way to match a literal `*` — every
`*` is treated as a wildcard. Wildcards are rejected with `>` `>=` `<` `<=`, and don't apply
to `enum`/`uuid`/other attribute types.

```text
name:Pet*                                   // starts with "Pet"
name:*fred                                  // ends with "fred"
name:*pet*                                  // contains "pet"
```

By default, case-sensitivity of the match depends on the database's `LIKE` collation (e.g.
Postgres' `LIKE` is case-sensitive; SQLite's is case-insensitive for ASCII by default) — see
[Case sensitivity](#case-sensitivity) for a portable, explicit alternative.

### Case sensitivity

By default, `string` attributes are matched case-sensitively (subject to the database's own
collation rules, as noted above for wildcards). Set `caseSensitive: false` on the attribute
definition to make `=`, `<` `<=` `>` `>=`, and wildcard matches case-insensitive:

```ts
attributes: {
  name: { type: 'string', caseSensitive: false },
}
```

This compiles to `LOWER(column) <op> LOWER(value)`, using the standard SQL `LOWER()`
function so behavior is identical across Postgres, MySQL, and SQLite — rather than a
database-specific mechanism (e.g. Postgres' `ILIKE` or `citext`, or a `COLLATE` clause).

### Multi-field attributes

An attribute can match against multiple underlying columns instead of a single one — for
example, searching a "name" query across both `firstName` and `lastName` columns:

```ts
attributes: {
  name: { type: 'string', fields: ['firstName', 'lastName'] },
}
```

```text
name:Fred          // firstName = 'Fred' OR lastName = 'Fred'
name:Fred*         // (firstName LIKE 'Fred%' ...) OR (lastName LIKE 'Fred%' ...)
```

Only `=` is supported (including its wildcard form) — ordering operators (`>` `>=` `<`
`<=`) are rejected, since combining multiple columns with `OR` under an ordering comparison
doesn't have an unambiguous meaning.

#### Raw fields

A `string`-typed multi-field attribute always binds the search value as a plain string
parameter for every field. If one of the underlying columns is actually a stricter type —
a `uuid` or integer primary key, say — comparing it directly against an arbitrary string
can make the *database* reject the query outright (e.g. Postgres: `invalid input syntax for
type uuid: "foo"`) instead of the field simply not matching. Give that field's entry a
`raw` SQL expression instead of a plain column name to compare it as text:

```ts
attributes: {
  name: {
    type: 'string',
    fields: ['firstName', 'lastName', { raw: 'CAST(id AS TEXT)' }],
  },
}
```

```text
name:Fred     // firstName = 'Fred' OR lastName = 'Fred' OR CAST(id AS TEXT) = 'Fred'
```

A `raw` entry is inserted verbatim — no escaping, and **no alias-qualification** (unlike a
plain `fields` string, which is automatically escaped and prefixed with the query's table
alias). Since search-cop doesn't support joins, an unqualified column reference like `id`
above is unambiguous either way; if you do need the alias, you're responsible for writing
it yourself (and for keeping it in sync if you ever pass a custom `alias` to `search()`).
`CAST` itself is standard SQL and works identically everywhere, but the type-name argument
is dialect-specific: `TEXT` works on Postgres and SQLite, but MySQL's `CAST` doesn't accept
`TEXT` (use `CHAR` there instead); conversely a bare `CHAR` silently truncates to a single
character on Postgres. `raw` isn't limited to casting, either — anything a plain column
name can't express (cleaning up a type's text representation, e.g. trimming a trailing
`.0`, `COALESCE`, concatenation, ...) is fair game. search-cop never inspects or validates
`raw` — it's entirely your responsibility, for the same reason as `cast`'s type name above:
you know your database; search-cop deliberately doesn't try to.

### Default field

A query term with no `field:` prefix compiles to a predicate against the conventional
`_all` attribute key (exported as `DEFAULT_FIELD`). Define it like any other attribute —
typically as a [multi-field attribute](#multi-field-attributes) — to opt in:

```ts
import { search, DEFAULT_FIELD } from 'search-cop';

const qb = search({
  repository: ProductRepository,
  query: 'red shoes status:online',
  attributes: {
    status: { type: 'enum', values: ['online', 'offline'] },
    // Fold a uuid primary key into the default field too — a `raw` CAST (see above)
    // keeps a non-uuid-shaped term from erroring against that column.
    [DEFAULT_FIELD]: { type: 'string', fields: ['name', 'description', { raw: 'CAST(id AS TEXT)' }] },
  },
});
```

Bare terms can be freely combined with explicit `field:value` predicates and with each
other. Since `AND` is already implicit between predicates, multiple bare terms behave like
free-text search — each term ORs across the configured fields, and terms AND together:

```text
red shoes             // (name = 'red' OR description = 'red')
                      //   AND (name = 'shoes' OR description = 'shoes')
red* shoes*           // same, but with wildcards on each term
red status:online     // (name = 'red' OR description = 'red') AND status = 'online'
```

If `_all` isn't declared in `attributes`, a bare query throws `UNKNOWN_ATTRIBUTE` like any
other undeclared field. `AND`/`OR` are always reserved as connector keywords, even as a
bare term on their own — double-quote them (`"AND"`, `"OR"`) to search for the literal word.

### UUIDs

```text
id:550e8400-e29b-41d4-a716-446655440000
id:550E8400-E29B-41D4-A716-446655440000     // case-insensitive, lowercased on output
```

### Booleans

```text
active:true
active:false
```

### Dates and datetimes

Date-only values (`YYYY-MM-DD`) are interpreted as **UTC midnight**. Datetime values accept
`YYYY-MM-DDTHH:mm:ss[.sss](Z|±HH:mm)`; when no offset is given, the value is interpreted as **UTC**,
not the host machine's local timezone.

```text
releaseDate:>=2026-01-01                    // 2026-01-01T00:00:00.000Z
createdAt:>=2026-01-01T10:00:00             // 2026-01-01T10:00:00.000Z (UTC)
createdAt:>=2026-01-01T10:00:00+02:00       // 2026-01-01T08:00:00.000Z
```

## Errors

Invalid queries throw a `SearchCopError` with a `code`:

- `INVALID_SYNTAX` — the query does not parse (includes an approximate character `position`)
- `UNKNOWN_ATTRIBUTE` — the field is not declared in `attributes`
- `INVALID_OPERATOR` — the operator is not supported for the attribute's type (e.g. `status:>online` for an `enum`)
- `INVALID_VALUE` — the value cannot be converted to the attribute's type
- `INVALID_ENUM_VALUE` — the value is not one of the enum's declared `values`

## Out of scope (for now)

Associations/joins, full-text search (ranking/relevance/stemming — bare terms against
`_all` are exact/wildcard `LIKE` matches, not a relevance-ranked search), range syntax
(`1..100`), negation (`!=`/`NOT`), query optimization/planning, pagination/sorting, raw SQL
as the top-level query language (a `fields` entry can be a [raw expression](#raw-fields),
but the `query` string itself is always the DSL, never passed through), and additional
database adapters are intentionally not implemented. The AST is designed so these can be
added later.

## Development

```bash
pnpm install
pnpm test        # build the grammar and run the test suite
pnpm run lint
pnpm run typecheck
pnpm run build
```
