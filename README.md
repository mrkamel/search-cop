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
specific alias (e.g. to match an alias already used elsewhere in a larger query). It only
affects the `FROM`/`SELECT` clauses TypeORM generates on its own; it has no effect on the
`WHERE` clause, since [`fields`](#multi-field-attributes) are always inserted verbatim.

## Combining with your own queryBuilder

`search()` is a convenience for the common case: give it a `repository` and get back a
ready-to-go `SelectQueryBuilder`. If you've already built your own queryBuilder — with
joins, a specific alias, or other `where` conditions already in place — use `searchCondition()`
instead. It compiles a query to a standalone [`Brackets`][typeorm-brackets] fragment rather
than a full query, which you merge in yourself via `andWhere()`/`orWhere()`:

```ts
import { searchCondition } from 'search-cop';

const queryBuilder = ProductRepository.createQueryBuilder('product').leftJoinAndSelect('product.author', 'author');

queryBuilder.andWhere(searchCondition({
  query: 'author.name:joe',
  attributes: {
    // A join means there's now more than one table, so this field is qualified —
    // exactly as with any other field, search-cop inserts it verbatim (see below).
    author: { type: 'string', fields: ['author.name'] },
  },
}));

const products = await queryBuilder.getMany();
```

`Brackets` (and its negated counterpart `NotBrackets`, used internally for `NOT`) is
TypeORM's own portable where-clause primitive — its callback isn't evaluated until it's
handed to `andWhere()`/`orWhere()`/`where()` on a real queryBuilder, so `searchCondition()`
needs no `repository` or queryBuilder of its own, and doesn't touch or know about the rest
of your query. Using `andWhere()` (rather than `where()`) to merge it in means any
conditions you already added stay in place — search-cop only ever adds to your `WHERE`
clause, never replaces it.

[typeorm-brackets]: https://typeorm.io/select-query-builder#using-brackets

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
| `null`     | none — compiles to `IS NULL`/`IS NOT NULL` | `=`  |

`enum` attributes also require a `values: string[]` list, or a `values: Record<string, string>`
map to translate the query-facing value into a different underlying value, e.g.
`{ type: 'enum', values: { pending: 'waiting', completed: 'finished' } }`.

`null` attributes require `isNull: string[]` and `isNotNull: string[]` — see
[Null checks](#null-checks).

`string` attributes accept an optional `caseSensitive: boolean | 'lower' | 'upper'` (default
`true`) — see [Case sensitivity](#case-sensitivity) — and optional `wildcards`/
`leftWildcard`/`rightWildcard: boolean` (all default `false`) — see
[Implicit wildcards](#implicit-wildcards).

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

For most attribute types, `status:online` and `status:=online` compile identically. For a
`string` attribute they don't: the bare `:` form always compiles to a `LIKE` predicate (so
it can support wildcard syntax — see [Wildcards](#wildcards)) and enables the `wildcards`
option (see [Implicit wildcards](#implicit-wildcards)); an explicit `=` always compiles to
a plain `=` comparison and opts out of both.

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

Prefix a predicate or parenthesized group with `NOT` to negate it. `NOT` binds tighter than
`AND`/`OR`, so it only negates the next term or group — parenthesize to negate more than one:

```text
NOT status:online                        // negates just this predicate
NOT status:online price:>100             // == (NOT status:online) AND price:>100
NOT (status:online OR status:pending)    // negates the whole group
NOT NOT status:online                    // double negation cancels out
```

`NOT` must be immediately followed by whitespace or `(` — `NOTstatus:online` is a field
literally named `NOTstatus`, not a negation. `NOT` is reserved the same way `AND`/`OR`
are (see below) — double-quote it (`"NOT"`) to search for the literal word.

`-` is shorthand for `NOT`, including on a bare term against `_all` (see
[Default field](#default-field)):

```text
-status:online                           // == NOT status:online
-cheap                                   // negates a bare term
red -cheap                               // == red AND (NOT cheap)
-(status:online OR status:pending)       // negates the whole group
```

Unlike `NOT`, `-` only counts as negation when directly attached to what follows — no
space. `- cheap` (a space after `-`) parses `-` itself as the literal value `-`, followed
by a separate `cheap` term; a lone `-` is likewise just the literal value `-`. This also
means `-` is never mistaken for negation *inside* a value — a negative number
(`price:-5`) or a hyphenated word (`well-known`) are unaffected, since this rule only
ever applies at the very start of a term. Searching for a literal leading `-` needs
quoting (`-"AND"` negates the literal word `AND`; `"-test"` searches for the literal
string `-test`).

### Quoted values

Unquoted values end at the first (unescaped) whitespace or parenthesis, so a value
containing either must be double-quoted:

```text
name:"foo bar"
name:"(foo)"
```

`\` escapes the following character the same way in both quoted and unquoted values: `\"`
unescapes to a literal `"` (only meaningful inside quotes, to embed one without ending the
value early), `\\` to a literal `\`, and `\*` to a literal `*` (see [Wildcards](#wildcards)
— the one case that matters outside quotes too). Any other `\<char>` just drops the
backslash, so a literal backslash needs doubling:

```text
name:"foo \"bar\" baz"                   // foo "bar" baz
name:back\\slash                         // back\slash
name:back\slash                          // backslash (a single "\" is just dropped)
```

Escaping in an unquoted value can't swallow a terminator — `\` followed by a space or
parenthesis still ends the value there; quote the value instead if you need one included.

### Wildcards

Wildcard syntax exists only for the bare `:` shorthand on a `string` attribute — every
explicit operator (`=`, `>`, `>=`, `<`, `<=`) always treats `*` as a plain literal
character, never a wildcard (see [Query syntax](#query-syntax)). Because of that, `:` on a
`string` attribute always compiles to a `LIKE` predicate — even when the value has no `*`
at all — while every explicit operator always compiles to a plain comparison. Wildcards
don't apply to `enum`/`uuid`/other attribute types.

A `*` translates to SQL's `%`; any literal `%` or `_` in the value is escaped so it's
matched literally rather than as a `LIKE` wildcard. A bare `*` is only valid at the very
start and/or end of the value — one anywhere else throws `INVALID_WILDCARD` rather than
silently falling back to a literal match:

```text
name:Pet*                                   // starts with "Pet"
name:*fred                                  // ends with "fred"
name:*pet*                                  // contains "pet"
```

Escape a literal `*` with `\*` (see [Quoted values](#quoted-values)):

```text
name:Pet\*                                  // literal value "Pet*", not a wildcard
name:*Pet\*Other                            // starts with "Pet*Other" (real wildcard + literal "*")
```

Because `:` always compiles to `LIKE`, case-sensitivity of *every* bare-colon `string`
match (wildcarded or not) depends on the database's `LIKE` collation by default (e.g.
Postgres' `LIKE` is case-sensitive; SQLite's is case-insensitive for ASCII regardless of
collation) — see [Case sensitivity](#case-sensitivity) for a portable, explicit alternative.

### Implicit wildcards

Set `wildcards: true` on a `string` attribute to make the bare `:` shorthand a contains
match by default, without writing `*` yourself:

```ts
attributes: {
  name: { type: 'string', wildcards: true },
}
```

```text
name:pet                                    // contains "pet" — same as name:*pet*
name:pet*                                   // explicit "*" is left exactly as written
name:=pet                                   // explicit "=" always stays an exact match
```

`wildcards: true` is shorthand for setting both `leftWildcard` and `rightWildcard`, which
you can also set independently for a one-sided match:

```ts
attributes: {
  endsWithName: { type: 'string', leftWildcard: true },     // endsWithName:pet   -> *pet  (ends with)
  startsWithName: { type: 'string', rightWildcard: true },  // startsWithName:pet -> pet*  (starts with)
}
```

Precedence, in order: an explicit `*` anywhere in the value is always respected as-is (no
double-wrapping); otherwise an explicit `=` is always an exact match; only a bare `:` with
neither falls back to the implicit wrap. This also applies to a bare term against `_all`
(see [Default field](#default-field)), since bare terms are `:` too.

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

Set `caseSensitive: 'upper'` instead to fold through `UPPER()` rather than `LOWER()` — for
example, to match an existing functional index built on `UPPER(column)`:

```ts
attributes: {
  name: { type: 'string', caseSensitive: 'upper' },
}
```

```text
name:=Fred     // UPPER(name) = 'FRED'
```

`caseSensitive: 'lower'` is also accepted, and behaves exactly like `false` — it's just the
explicit spelling, useful if you'd rather not read `false` as "off".

### Multi-field attributes

An attribute can match against multiple underlying columns instead of a single one — for
example, searching a "name" query across both `firstName` and `lastName` columns:

```ts
attributes: {
  name: { type: 'string', fields: ['firstName', 'lastName'] },
}
```

```text
name:Fred          // (firstName LIKE 'Fred' ...) OR (lastName LIKE 'Fred' ...)
name:Fred*         // (firstName LIKE 'Fred%' ...) OR (lastName LIKE 'Fred%' ...)
name:=Fred         // firstName = 'Fred' OR lastName = 'Fred'
```

Only `=` is supported (including its wildcard form) — ordering operators (`>` `>=` `<`
`<=`) are rejected, since combining multiple columns with `OR` under an ordering comparison
doesn't have an unambiguous meaning.

#### Fields are raw SQL

Every `fields` entry — whether a plain string, or the implicit default when `fields` is
omitted (the attribute's own key) — is inserted into the generated SQL **verbatim**: no
escaping, and no alias-qualification. search-cop doesn't know whether your column name is
a safe unquoted identifier, doesn't know your database's quote character, and doesn't
support joins (so there's never a table to disambiguate against) — you do, so quoting
(e.g. `'"createdAt"'` to preserve case on Postgres) and qualification (e.g. `'author.name'`
if you've added your own `leftJoin`) are entirely your responsibility whenever you need
them. A plain `'firstName'` is exactly as raw as any other entry; it's just already a
valid bare identifier, so it needs nothing extra.

This also means a field entry doesn't have to be a column name at all — anything valid in
SQL works: a cast, a computed expression, string concatenation, and so on. A `string`-typed
multi-field attribute always binds the search value as a plain string parameter for every
field. If one of the underlying columns is actually a stricter type — a `uuid` or integer
primary key, say — comparing it directly against an arbitrary string can make the
*database* reject the query outright (e.g. Postgres: `invalid input syntax for type uuid:
"foo"`) instead of the field simply not matching. Cast that field to text instead:

```ts
attributes: {
  name: {
    type: 'string',
    fields: ['firstName', 'lastName', 'CAST(id AS TEXT)'],
  },
}
```

```text
name:Fred     // (firstName LIKE 'Fred' ...) OR (lastName LIKE 'Fred' ...) OR (CAST(id AS TEXT) LIKE 'Fred' ...)
```

`CAST` itself is standard SQL and works identically everywhere, but the type-name argument
is dialect-specific: `TEXT` works on Postgres and SQLite, but MySQL's `CAST` doesn't accept
`TEXT` (use `CHAR` there instead); conversely a bare `CHAR` silently truncates to a single
character on Postgres. search-cop never inspects or validates a `fields` entry — it's
entirely your responsibility: you know your database; search-cop deliberately doesn't try
to.

#### Field-level type overrides

If you'd rather not write SQL at all, give a field its own `type` (and, for `enum`, its
own `values`) instead of casting. search-cop then validates that field independently, using
its own type's normal conversion — reusing the exact same logic as a regular attribute —
rather than the outer attribute's `string` type:

```ts
attributes: {
  name: {
    type: 'string',
    fields: ['firstName', 'lastName', { field: 'id', type: 'uuid' }],
  },
}
```

```text
name:Fred                                    // (firstName LIKE 'Fred' ...) OR (lastName LIKE 'Fred' ...)
                                              //   OR (id is skipped: "Fred" isn't a valid uuid)
name:550e8400-e29b-41d4-a716-446655440000     // ...OR id = '550e8400-e29b-41d4-a716-446655440000'
```

Unlike casting, a field-level `type` override needs no dialect knowledge and no `CAST` at
all — a value that doesn't fit the override's type just makes that one field not match
(see [Unparseable values never error](#unparseable-values-never-error)), while a value
that *does* fit gets bound normally, letting the database do its own natural type
coercion. The tradeoff: it only ever produces an exact `=` match, so (unlike casting to
text) it can't support wildcards against that field — a wildcarded query always fails
validation for anything other than `string` (there's always a literal `*` in the raw
value, and no uuid/number/date/etc. can ever contain one).

### Trigram indexes (Postgres)

A bare-`:` `string` match compiles to `LIKE '%...%'` when [wildcards](#implicit-wildcards)
are used on both sides — a pattern a plain B-tree index can't accelerate at all, since the
leading `%` rules out any prefix-based lookup. Postgres' [`pg_trgm`][pg_trgm] extension
provides a `GIN`/`GiST` index type built for exactly this case:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_name_trgm ON products USING gin (name gin_trgm_ops);
```

```ts
attributes: {
  name: { type: 'string', wildcards: true },
}
```

```text
name:pet     // name LIKE '%pet%' — now served by idx_name_trgm instead of a seq scan
```

This is entirely a database-side concern — search-cop doesn't create or know about indexes,
it just needs the compiled SQL expression to match whatever expression the index was built
on, exactly. Two ways that expression can drift out from under an index without erroring
(the query still runs, just without using the index):

- **A [multi-field](#multi-field-attributes) attribute** compiles to separate `OR`-ed `LIKE`
  conditions per field (`name LIKE ... OR description LIKE ...`), which doesn't match an
  index built on a *concatenated* expression. To use an index on `(name || ' ' ||
  description)`, give that same concatenation as a single raw [`fields`](#fields-are-raw-sql)
  entry instead of two separate ones, so the compiled condition is one `LIKE` against that
  exact expression:

  ```ts
  attributes: {
    search: { type: 'string', wildcards: true, fields: ["name || ' ' || description"] },
  }
  ```

  ```sql
  CREATE INDEX idx_search_trgm ON products USING gin ((name || ' ' || description) gin_trgm_ops);
  ```

- **`caseSensitive: false`/`'upper'`** (see [Case sensitivity](#case-sensitivity)) wraps the
  column in `LOWER()`/`UPPER()`, changing the compiled expression — build the index on the
  same wrapped expression (e.g. `USING gin ((LOWER(name)) gin_trgm_ops)`) to keep it matching.

[pg_trgm]: https://www.postgresql.org/docs/current/pgtrgm.html

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
    // Fold a uuid primary key into the default field too — casting it to text (see
    // above) keeps a non-uuid-shaped term from erroring against that column.
    [DEFAULT_FIELD]: { type: 'string', fields: ['name', 'description', 'CAST(id AS TEXT)'] },
  },
});
```

Bare terms can be freely combined with explicit `field:value` predicates and with each
other. Since `AND` is already implicit between predicates, multiple bare terms behave like
free-text search — each term ORs across the configured fields, and terms AND together:

```text
red shoes             // (name LIKE 'red' ... OR description LIKE 'red' ...)
                      //   AND (name LIKE 'shoes' ... OR description LIKE 'shoes' ...)
red* shoes*           // same, but with wildcards on each term
red status:online     // (name LIKE 'red' ... OR description LIKE 'red' ...) AND status = 'online'
```

Unlike any other undeclared field, a bare query never errors when `_all` isn't declared in
`attributes` — it's opt-in, so it just never matches (see
[Unparseable values never error](#unparseable-values-never-error)) rather than being
treated as a typo. `AND`/`OR`/`NOT` are always reserved as keywords, even as a bare term on
their own — double-quote them (`"AND"`, `"OR"`, `"NOT"`) to search for the literal word.

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

### Null checks

A `null` attribute compiles to an `IS NULL`/`IS NOT NULL` check on the underlying column
instead of a value comparison — no parameter is ever bound. `isNull`/`isNotNull` are each a
list of DSL values that trigger that check, letting you accept multiple synonyms for the
same check:

```ts
attributes: {
  assigned: { type: 'null', isNull: ['false', 'no'], isNotNull: ['true', 'yes'], fields: ['assignedTo'] },
}
```

```text
assigned:no      // assignedTo IS NULL
assigned:yes     // assignedTo IS NOT NULL
```

A value that's in neither list never errors — like any other attribute type, it just never
matches (see [Unparseable values never error](#unparseable-values-never-error)). Only `=` is
supported, same as `enum`/`boolean`/`uuid`.

### Dates and datetimes

Date-only values (`YYYY-MM-DD`) are interpreted as **UTC midnight**. Datetime values accept
`YYYY-MM-DDTHH:mm:ss[.sss](Z|±HH:mm)`; when no offset is given, the value is interpreted as **UTC**,
not the host machine's local timezone.

```text
releaseDate:>=2026-01-01                    // 2026-01-01T00:00:00.000Z
createdAt:>=2026-01-01T10:00:00             // 2026-01-01T10:00:00.000Z (UTC)
createdAt:>=2026-01-01T10:00:00+02:00       // 2026-01-01T08:00:00.000Z
```

### Unparseable values never error

A value that doesn't fit its attribute's type — `id:foo` where `id` is a `uuid`,
`status:banana` where `status` is an `enum`, `price:>banana` where `price` is a `number`,
and so on — never throws. It simply can't match anything, so it compiles to an
unconditional `1 = 0` instead of a real comparison. This applies to every attribute type,
not just multi-field ones or [field-level type overrides](#field-level-type-overrides) —
it's the same reason those two features can gracefully skip a field instead of erroring
the whole query.

This is deliberate: search-cop treats "this value can never match this type" as a normal,
expected outcome of a search — the same as any other query that happens to match zero
rows — rather than a client error. If you want to reject malformed input before it reaches
`search()` (e.g. to return a 400 to an API caller), validate it yourself first.

## Errors

Invalid queries throw a `SearchCopError` with a `code`:

- `INVALID_SYNTAX` — the query does not parse (includes an approximate character `position`)
- `UNKNOWN_ATTRIBUTE` — the field is not declared in `attributes` (except a bare query
  against an undeclared `_all` — see [Default field](#default-field))
- `INVALID_OPERATOR` — the operator is not supported for the attribute's type (e.g. `status:>online` for an `enum`)
- `INVALID_WILDCARD` — a bare `*` appears somewhere other than the start/end of a bare-colon `string` value (e.g. `name:Pet*Other`; see [Wildcards](#wildcards))

Note there's no error for a value that doesn't fit its type (an invalid uuid, an unknown
enum value, ...) — see [Unparseable values never error](#unparseable-values-never-error).

## Out of scope (for now)

Associations/joins, full-text search (ranking/relevance/stemming — bare terms against
`_all` are exact/wildcard `LIKE` matches, not a relevance-ranked search), a `!=` operator
(negate with [`NOT`](#query-syntax) instead), range syntax (`1..100`), query
optimization/planning, pagination/sorting, raw SQL as the top-level query language (a
[`fields` entry](#fields-are-raw-sql) is raw SQL, but the `query` string itself is always
the DSL, never passed through), and additional database adapters are intentionally not
implemented. The AST is designed so these can be added later.

## Development

```bash
pnpm install
pnpm test        # build the grammar and run the test suite
pnpm run lint
pnpm run typecheck
pnpm run build
```
