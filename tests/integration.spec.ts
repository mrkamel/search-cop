import { Brackets } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { search, searchCondition } from '../src/index.js';
import { SearchCopError } from '../src/errors/errors.js';
import { AppDataSource } from './support/AppDataSource.js';
import { ProductEntity } from './support/ProductEntity.js';
import { createProduct } from './support/factories.js';
import type { AttributeMap } from '../src/attributes/types.js';

const attributes: AttributeMap = {
  status: { type: 'enum', values: ['online', 'offline', 'pending'] },
  price: { type: 'number' },
  name: { type: 'string' },
};

// Same "name" column as above, but declared case-insensitive.
const caseInsensitiveAttributes: AttributeMap = {
  name: { type: 'string', caseSensitive: false },
};

const multiFieldAttributes: AttributeMap = {
  search: { type: 'string', fields: ['name', 'description'] },
};

const defaultFieldAttributes: AttributeMap = {
  _all: { type: 'string', fields: ['name', 'description'] },
};

// "id" is an integer column — casting it to TEXT lets it be searched as part of a
// string-typed multi-field group without the database rejecting a non-numeric value.
const rawFieldAttributes: AttributeMap = {
  search: { type: 'string', fields: ['name', 'CAST(id AS TEXT)'] },
};

const typedFieldAttributes: AttributeMap = {
  search: { type: 'string', fields: ['name', { field: 'id', type: 'number' }] },
};

const uuidAttributes: AttributeMap = {
  id: { type: 'uuid' },
};

const nullAttributes: AttributeMap = {
  assigned: { type: 'null', isNull: ['no'], isNotNull: ['yes'], fields: ['assignedTo'] },
};

const ProductRepository = AppDataSource.getRepository(ProductEntity);

beforeAll(async () => {
  await AppDataSource.initialize();
});

afterAll(async () => {
  await AppDataSource.destroy();
});

afterEach(async () => {
  await ProductRepository.clear();
});

describe('search: end-to-end result sets', () => {
  it('filters with a single predicate', async () => {
    const online = await createProduct({ status: 'online' });

    await createProduct({ status: 'offline' });

    const products = await search({ repository: ProductRepository, query: 'status:online', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([online.name]);
  });

  it('filters with AND', async () => {
    const match = await createProduct({ status: 'online', price: 150 });

    await createProduct({ status: 'online', price: 50 });
    await createProduct({ status: 'offline', price: 150 });

    const products = await search({ repository: ProductRepository, query: 'status:online AND price:>100', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('filters with OR', async () => {
    const online = await createProduct({ status: 'online' });
    const pending = await createProduct({ status: 'pending' });

    await createProduct({ status: 'offline' });

    const products = await search({ repository: ProductRepository, query: 'status:online OR status:pending', attributes }).getMany();

    expect(products.map((product) => product.name).sort()).toEqual([online.name, pending.name].sort());
  });

  it('filters with parenthesized OR combined with AND', async () => {
    const onlineExpensive = await createProduct({ status: 'online', price: 150 });
    const pendingExpensive = await createProduct({ status: 'pending', price: 150 });

    await createProduct({ status: 'online', price: 50 });
    await createProduct({ status: 'offline', price: 150 });

    const products = await search({
      repository: ProductRepository,
      query: '(status:online OR status:pending) AND price:>100',
      attributes,
    }).getMany();

    expect(products.map((product) => product.name).sort()).toEqual([onlineExpensive.name, pendingExpensive.name].sort());
  });

  it('returns a plain TypeORM SelectQueryBuilder', () => {
    const queryBuilder = search({ repository: ProductRepository, query: 'status:online', attributes });

    expect(typeof queryBuilder.getMany).toBe('function');
    expect(typeof queryBuilder.getQuery).toBe('function');
  });

  it('accepts a custom alias and still returns correct results', async () => {
    const online = await createProduct({ status: 'online' });

    await createProduct({ status: 'offline' });

    const queryBuilder = search({ repository: ProductRepository, query: 'status:online', attributes, alias: 'p' });

    // Fields are inserted verbatim now (no auto alias-qualification), so a custom
    // `alias` only affects the FROM/SELECT clauses TypeORM generates on its own.
    expect(queryBuilder.getSql()).toContain('FROM "products" "p"');

    const products = await queryBuilder.getMany();

    expect(products.map((product) => product.name)).toEqual([online.name]);
  });
});

describe('search: wildcards', () => {
  it('matches a prefix wildcard', async () => {
    const match = await createProduct({ name: 'Petfood' });

    await createProduct({ name: 'Foodpet' });

    const products = await search({ repository: ProductRepository, query: 'name:Pet*', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('matches a suffix wildcard', async () => {
    const match = await createProduct({ name: 'Bigfred' });

    await createProduct({ name: 'Fredbig' });

    const products = await search({ repository: ProductRepository, query: 'name:*fred', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('matches a contains wildcard on both sides', async () => {
    const match = await createProduct({ name: 'Superpetfoodstore' });

    await createProduct({ name: 'Superstore' });

    const products = await search({ repository: ProductRepository, query: 'name:*pet*', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('treats a literal "%" in the value as a literal character, not a LIKE wildcard', async () => {
    const match = await createProduct({ name: '100%organic' });

    await createProduct({ name: '100xorganic' });

    const products = await search({ repository: ProductRepository, query: 'name:100%*', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('treats "*" as a plain literal character with ordering operators — no wildcard interpretation', async () => {
    const match = await createProduct({ name: 'Pets' });

    await createProduct({ name: 'Pet' });

    const products = await search({ repository: ProductRepository, query: 'name:>Pet*', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });
});

describe('search: escaped wildcards ("\\*")', () => {
  it('matches a literal "*" via "\\*", without treating it as a wildcard', async () => {
    const match = await createProduct({ name: 'Name*' });

    await createProduct({ name: 'Name' });
    await createProduct({ name: 'NameOther' });

    const products = await search({ repository: ProductRepository, query: 'name:Name\\*', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('a real wildcard in the same position matches every value with that prefix, unlike the escaped form', async () => {
    const first = await createProduct({ name: 'Name' });
    const second = await createProduct({ name: 'Name*' });

    const products = await search({ repository: ProductRepository, query: 'name:Name*', attributes }).getMany();

    expect(products.map((product) => product.name).sort()).toEqual([first.name, second.name].sort());
  });

  it('rejects a real "*" that is not at the start/end of the value', () => {
    expect(() => search({ repository: ProductRepository, query: 'name:Name*Other', attributes })).toThrow(SearchCopError);
  });
});

describe('search: "wildcards" option (implicit contains matching)', () => {
  const wildcardOptionAttributes: AttributeMap = { name: { type: 'string', wildcards: true } };

  it('matches a bare-colon value anywhere in the field, without an explicit "*"', async () => {
    const match = await createProduct({ name: 'First Name' });

    await createProduct({ name: 'other' });

    const products = await search({ repository: ProductRepository, query: 'name:Name', attributes: wildcardOptionAttributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('an explicit "=" still requires an exact match', async () => {
    const match = await createProduct({ name: 'Name' });

    await createProduct({ name: 'First Name' });

    const products = await search({ repository: ProductRepository, query: 'name:=Name', attributes: wildcardOptionAttributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('applies to a bare term against "_all" too, since bare terms are ":" as well', async () => {
    const matchesByName = await createProduct({ name: 'First Name', description: 'other' });
    const matchesByDescription = await createProduct({ name: 'other', description: 'Second Name' });

    await createProduct({ name: 'other', description: 'other' });

    const products = await search({
      repository: ProductRepository,
      query: 'Name',
      attributes: { _all: { type: 'string', fields: ['name', 'description'], wildcards: true } },
    }).getMany();

    expect(products.map((product) => product.name).sort()).toEqual([matchesByName.name, matchesByDescription.name].sort());
  });
});

describe('search: case sensitivity', () => {
  // Known limitation: every bare-colon string predicate compiles to LIKE (see resolveValue
  // in validator.ts), and SQLite's LIKE operator is ASCII case-insensitive by default
  // regardless of collation — so "caseSensitive: true" (the default) can't actually be
  // enforced here on SQLite. Fixing this needs a SQLite-specific construct in the compiler
  // (e.g. GLOB, or PRAGMA case_sensitive_like); tracked separately from this behavior.
  it('is case-sensitive by default in principle, but SQLite\'s LIKE ignores case regardless', async () => {
    const match = await createProduct({ name: 'FRED' });

    const products = await search({ repository: ProductRepository, query: 'name:fred', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('matches regardless of case when the attribute is declared case-insensitive', async () => {
    const match = await createProduct({ name: 'FRED' });

    const products = await search({ repository: ProductRepository, query: 'name:fred', attributes: caseInsensitiveAttributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });
});

describe('search: multi-field attributes', () => {
  it('matches if either underlying field matches', async () => {
    const matchesByName = await createProduct({ name: 'Fred', description: 'irrelevant' });
    const matchesByDescription = await createProduct({ name: 'irrelevant', description: 'Fred' });

    await createProduct({ name: 'other', description: 'other' });

    const products = await search({ repository: ProductRepository, query: 'search:Fred', attributes: multiFieldAttributes }).getMany();

    expect(products.map((product) => product.name).sort()).toEqual([matchesByName.name, matchesByDescription.name].sort());
  });

  it('supports wildcards across every underlying field', async () => {
    const matchesByName = await createProduct({ name: 'Frederick', description: 'irrelevant' });
    const matchesByDescription = await createProduct({ name: 'irrelevant', description: 'Frederick' });

    await createProduct({ name: 'other', description: 'other' });

    const products = await search({ repository: ProductRepository, query: 'search:Fred*', attributes: multiFieldAttributes }).getMany();

    expect(products.map((product) => product.name).sort()).toEqual([matchesByName.name, matchesByDescription.name].sort());
  });
});

describe('search: default field ("_all")', () => {
  it('returns no results for a bare query when "_all" is not configured, instead of erroring', async () => {
    await createProduct({});

    const products = await search({ repository: ProductRepository, query: 'Fred', attributes }).getMany();

    expect(products).toEqual([]);
  });

  it('matches a bare query against any configured "_all" field', async () => {
    const matchesByName = await createProduct({ name: 'Fred', description: 'irrelevant' });
    const matchesByDescription = await createProduct({ name: 'irrelevant', description: 'Fred' });

    await createProduct({ name: 'other', description: 'other' });

    const products = await search({ repository: ProductRepository, query: 'Fred', attributes: defaultFieldAttributes }).getMany();

    expect(products.map((product) => product.name).sort()).toEqual([matchesByName.name, matchesByDescription.name].sort());
  });

  it('supports free-text search: multiple bare terms are ANDed, each OR-ing across "_all" fields', async () => {
    // Bare terms use exact "=" (no implicit wildcard), so each term must exactly equal
    // one of the "_all" fields' values on its own — "red" and "sneakers" here, not
    // substrings of a longer phrase.
    const match = await createProduct({ name: 'red', description: 'sneakers' });

    await createProduct({ name: 'blue', description: 'sneakers' });
    await createProduct({ name: 'red', description: 'hat' });

    const products = await search({ repository: ProductRepository, query: 'red sneakers', attributes: defaultFieldAttributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('mixes bare terms with explicit field:value predicates', async () => {
    const match = await createProduct({ name: 'Fred', status: 'online' });

    await createProduct({ name: 'Fred', status: 'offline' });

    const products = await search({ repository: ProductRepository, query: 'Fred status:online', attributes: { ...attributes, ...defaultFieldAttributes } }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });
});

describe('search: "raw" fields for multi-field attributes', () => {
  it('matches an integer column through its cast text representation', async () => {
    const match = await createProduct({ name: 'irrelevant' });

    const products = await search({ repository: ProductRepository, query: `search:${match.id}`, attributes: rawFieldAttributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('does not error, and simply does not match, when the term is not a valid integer', async () => {
    const match = await createProduct({ name: 'Fred' });

    const products = await search({ repository: ProductRepository, query: 'search:Fred', attributes: rawFieldAttributes }).getMany();

    // Matches via the "name" field; the cast "id" field just doesn't match "Fred".
    expect(products.map((product) => product.name)).toEqual([match.name]);
  });
});

describe('search: field-level type overrides', () => {
  it('matches the overridden field using its own type', async () => {
    const match = await createProduct({ name: 'irrelevant' });

    const products = await search({ repository: ProductRepository, query: `search:${match.id}`, attributes: typedFieldAttributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('does not error, and simply does not match, when the value does not fit the override type', async () => {
    const match = await createProduct({ name: 'Fred' });

    const products = await search({ repository: ProductRepository, query: 'search:Fred', attributes: typedFieldAttributes }).getMany();

    // Matches via the "name" field; the number-typed "id" field just doesn't match "Fred".
    expect(products.map((product) => product.name)).toEqual([match.name]);
  });
});

describe('search: unparseable values never error, for any attribute — not just multi-field ones', () => {
  it('returns no results instead of throwing when the value does not fit the declared type', async () => {
    await createProduct({});

    const products = await search({ repository: ProductRepository, query: 'id:foo', attributes: uuidAttributes }).getMany();

    expect(products).toEqual([]);
  });
});

describe('search: "null" attributes', () => {
  it('matches rows where the underlying field is null', async () => {
    const match = await createProduct({ assignedTo: null });

    await createProduct({ assignedTo: 'Fred' });

    const products = await search({ repository: ProductRepository, query: 'assigned:no', attributes: nullAttributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('matches rows where the underlying field is not null', async () => {
    await createProduct({ assignedTo: null });

    const match = await createProduct({ assignedTo: 'Fred' });

    const products = await search({ repository: ProductRepository, query: 'assigned:yes', attributes: nullAttributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });
});

describe('search: negation (NOT)', () => {
  it('negates a single predicate', async () => {
    const match = await createProduct({ status: 'offline' });

    await createProduct({ status: 'online' });

    const products = await search({ repository: ProductRepository, query: 'NOT status:online', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('negates a parenthesized group, applying De Morgan\'s across it', async () => {
    const match = await createProduct({ status: 'pending' });

    await createProduct({ status: 'online' });
    await createProduct({ status: 'offline' });

    const products = await search({ repository: ProductRepository, query: 'NOT (status:online OR status:offline)', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('combines with implicit AND: negates only the next term, not the whole rest of the query', async () => {
    const match = await createProduct({ status: 'offline', price: 150 });

    await createProduct({ status: 'online', price: 150 });
    await createProduct({ status: 'offline', price: 50 });

    const products = await search({ repository: ProductRepository, query: 'NOT status:online price:>100', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('double negation cancels out', async () => {
    const match = await createProduct({ status: 'online' });

    await createProduct({ status: 'offline' });

    const products = await search({ repository: ProductRepository, query: 'NOT NOT status:online', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('negates a multi-field attribute, matching rows where neither field matches', async () => {
    const match = await createProduct({ name: 'other', description: 'other' });

    await createProduct({ name: 'Fred', description: 'irrelevant' });
    await createProduct({ name: 'irrelevant', description: 'Fred' });

    const products = await search({ repository: ProductRepository, query: 'NOT search:Fred', attributes: multiFieldAttributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('does not drop a row whose non-matching field is NULL — a NULL column is never "Name" either', async () => {
    // Regression test: SQL's three-valued logic means "NOT(name = 'Name' OR assignedTo =
    // 'Name')" naively evaluates to NULL (not true) for a row where assignedTo IS NULL and
    // name doesn't match, silently dropping it from the results instead of including it.
    const nullableMultiFieldAttributes: AttributeMap = { search: { type: 'string', fields: ['name', 'assignedTo'] } };

    const match = await createProduct({ name: 'other', assignedTo: null });

    await createProduct({ name: 'Name', assignedTo: null });
    await createProduct({ name: 'other', assignedTo: 'Name' });

    const products = await search({
      repository: ProductRepository,
      query: 'NOT search:Name',
      attributes: nullableMultiFieldAttributes,
    }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('stays NULL-safe through double negation too', async () => {
    const nullableMultiFieldAttributes: AttributeMap = { search: { type: 'string', fields: ['name', 'assignedTo'] } };

    const match = await createProduct({ name: 'Name', assignedTo: null });

    await createProduct({ name: 'other', assignedTo: null });

    const products = await search({
      repository: ProductRepository,
      query: 'NOT NOT search:Name',
      attributes: nullableMultiFieldAttributes,
    }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('negating an unparseable value matches everything, since the un-negated predicate matched nothing', async () => {
    const match = await createProduct({});

    const products = await search({ repository: ProductRepository, query: 'NOT id:foo', attributes: uuidAttributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('"-" is shorthand for "NOT", including on a bare term against "_all"', async () => {
    const match = await createProduct({ status: 'offline' });

    await createProduct({ status: 'online' });

    const products = await search({ repository: ProductRepository, query: '-status:online', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });
});

describe('searchCondition: merging into a caller-built queryBuilder', () => {
  it('returns a Brackets instance, usable directly with andWhere/orWhere', () => {
    const brackets = searchCondition({ query: 'status:online', attributes });

    expect(brackets).toBeInstanceOf(Brackets);
  });

  it('composes with conditions already present on the queryBuilder, instead of replacing them', async () => {
    const match = await createProduct({ status: 'online', price: 150 });

    await createProduct({ status: 'online', price: 50 });
    await createProduct({ status: 'offline', price: 150 });

    const queryBuilder = ProductRepository.createQueryBuilder('product').andWhere('product.status = :status', { status: 'online' });

    queryBuilder.andWhere(searchCondition({ query: 'price:>100', attributes }));

    const products = await queryBuilder.getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });
});
