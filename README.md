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

## Attributes

Only attributes declared in `attributes` may be queried. Supported types:

| Type       | Runtime value | Allowed operators                |
| ---------- | -------------- | --------------------------------- |
| `string`   | `string`       | `=` `!=` `>` `>=` `<` `<=`        |
| `number`   | `number`       | `=` `!=` `>` `>=` `<` `<=`        |
| `boolean`  | `boolean`      | `=` `!=`                          |
| `date`     | `Date`         | `=` `!=` `>` `>=` `<` `<=`        |
| `datetime` | `Date`         | `=` `!=` `>` `>=` `<` `<=`        |
| `enum`     | `string`       | `=` `!=`                          |

`enum` attributes also require a `values: string[]` list.

## Query syntax

A predicate is `field<op>value`. `:` means equality:

```text
status:online        // equivalent to status:=online
price:>100
price:>=100
price:<100
price:<=100
status:!=offline
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

Associations/joins, full-text search, free-text queries, range syntax (`1..100`), `NOT`,
query optimization/planning, pagination/sorting, raw SQL, and additional database adapters
are intentionally not implemented. The AST is designed so these can be added later.

## Development

```bash
pnpm install
pnpm test        # build the grammar and run the test suite
pnpm run lint
pnpm run typecheck
pnpm run build
```
