import { Brackets } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from '../../src/parser/parser.js';
import { validate } from '../../src/validator/validator.js';
import { compile, compileCondition } from '../../src/compiler/typeorm.js';
import { AppDataSource } from '../support/AppDataSource.js';
import { SearchCopError } from '../../src/errors/errors.js';
import { tryCatch } from '../../src/utils/tryCatch.js';
import type { AttributeMap } from '../../src/attributes/types.js';
import { ProductRepository } from '../support/ProductRepository.js';

const attributes: AttributeMap = {
  status: { type: 'enum', values: ['online', 'offline', 'pending'] },
  price: { type: 'number' },
  createdAt: { type: 'datetime' },
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

// "price" is a number column — casting it to TEXT lets it be searched as part of a
// string-typed multi-field group without the database rejecting a non-numeric value.
const rawFieldAttributes: AttributeMap = {
  search: { type: 'string', fields: ['name', 'CAST(price AS TEXT)'] },
};

const typedFieldAttributes: AttributeMap = {
  search: { type: 'string', fields: ['name', { field: 'price', type: 'number' }] },
};

const uuidAttributes: AttributeMap = {
  id: { type: 'uuid' },
};

const nullAttributes: AttributeMap = {
  assigned: { type: 'null', isNull: ['false', 'no'], isNotNull: ['true', 'yes'] },
};

const wildcardOptionAttributes: AttributeMap = {
  name: { type: 'string', wildcards: true },
};

beforeAll(async () => {
  await AppDataSource.initialize();
});

afterAll(async () => {
  await AppDataSource.destroy();
});

function compileQuery({ query, attributeMap = attributes, alias }: { query: string; attributeMap?: AttributeMap; alias?: string }) {
  const validated = validate({ expression: parse(query), attributes: attributeMap });

  return compile({ repository: ProductRepository, expression: validated, alias });
}

describe('compile: simple predicates', () => {
  it('compiles equality', () => {
    const [sql, params] = compileQuery({ query: 'status:online' }).getQueryAndParameters();

    expect(sql).toContain('status = ?');
    expect(params).toEqual(['online']);
  });

  it('compiles comparison operators', () => {
    // The sqlite driver inlines numeric parameters as literals rather than binding them,
    // since a JS `number` cannot carry an injection payload. Strings, dates, and booleans
    // are still bound through "?" placeholders (see the tests below).
    const [sql, params] = compileQuery({ query: 'price:>100' }).getQueryAndParameters();

    expect(sql).toContain('price > 100');
    expect(params).toEqual([]);
  });
});

describe('compile: boolean expressions', () => {
  it('combines predicates with AND', () => {
    const [sql, params] = compileQuery({ query: 'status:online AND price:>100' }).getQueryAndParameters();

    expect(sql).toMatch(/status = \? AND .*price > 100/);
    expect(params).toEqual(['online']);
  });

  it('combines predicates with OR', () => {
    const [sql, params] = compileQuery({ query: 'status:online OR status:pending' }).getQueryAndParameters();

    expect(sql).toMatch(/status = \? OR .*status = \?/);
    expect(params).toEqual(['online', 'pending']);
  });

  it('preserves parenthesized precedence: "(A OR B) AND C"', () => {
    const [sql, params] = compileQuery({ query: '(status:online OR status:pending) AND price:>100' }).getQueryAndParameters();

    expect(sql).toMatch(/\(.*status = \? OR .*status = \?.*\) AND .*price > 100/);
    expect(params).toEqual(['online', 'pending']);
  });

  it('preserves default precedence: "A OR B AND C" = "A OR (B AND C)"', () => {
    const [sql, params] = compileQuery({ query: 'status:online OR status:pending AND price:>100' }).getQueryAndParameters();

    expect(sql).toMatch(/status = \? OR .*status = \? AND .*price > 100/);
    expect(params).toEqual(['online', 'pending']);
  });

  it('uses a unique parameter for every predicate, even for repeated fields', () => {
    const parameters = compileQuery({ query: 'status:online OR status:offline' }).getParameters();

    expect(new Set(Object.keys(parameters)).size).toBe(2);
  });

  it('never interpolates string values directly into the SQL string', () => {
    const [sql] = compileQuery({ query: 'status:online' }).getQueryAndParameters();

    expect(sql).not.toContain('online');
  });
});

describe('compile: wildcards', () => {
  it('compiles a wildcard equality predicate to LIKE with an ESCAPE clause', () => {
    const [sql, params] = compileQuery({ query: 'name:Pet*' }).getQueryAndParameters();

    expect(sql).toContain(`name LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['Pet%']);
  });

  it('escapes literal "%" and "_" so they are not treated as LIKE wildcards', () => {
    const [, params] = compileQuery({ query: 'name:100%_off*' }).getQueryAndParameters();

    expect(params).toEqual(['100!%!_off%']);
  });
});

describe('compile: escaped wildcards ("\\*")', () => {
  it('compiles an escaped-only "\\*" to a literal "*", not a wildcard', () => {
    const [sql, params] = compileQuery({ query: 'name:Name\\*' }).getQueryAndParameters();

    expect(sql).toContain(`name LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['Name*']);
  });

  it('compiles a real wildcard combined with an escaped "\\*" to a LIKE pattern with a literal "*" in it', () => {
    const [sql, params] = compileQuery({ query: 'name:*Name\\*Other' }).getQueryAndParameters();

    expect(sql).toContain(`name LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['%Name*Other']);
  });

  it('throws when compiling a real "*" that is not at the start/end of the value', () => {
    const [error] = tryCatch(() => compileQuery({ query: 'name:Name*Other' }));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_WILDCARD');
  });
});

describe('compile: "wildcards" option (implicit contains matching)', () => {
  it('compiles a bare-colon value to a "%...%" LIKE pattern', () => {
    const [sql, params] = compileQuery({ query: 'name:Name', attributeMap: wildcardOptionAttributes }).getQueryAndParameters();

    expect(sql).toContain(`name LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['%Name%']);
  });

  it('compiles an explicit "=" value to a plain equality, not LIKE', () => {
    const [sql, params] = compileQuery({ query: 'name:=Name', attributeMap: wildcardOptionAttributes }).getQueryAndParameters();

    expect(sql).toContain('name = ?');
    expect(params).toEqual(['Name']);
  });

  it('"leftWildcard" prefixes the value with "%" only', () => {
    const leftWildcardAttributes: AttributeMap = { name: { type: 'string', leftWildcard: true } };
    const [, params] = compileQuery({ query: 'name:Name', attributeMap: leftWildcardAttributes }).getQueryAndParameters();

    expect(params).toEqual(['%Name']);
  });

  it('"rightWildcard" appends "%" to the value only', () => {
    const rightWildcardAttributes: AttributeMap = { name: { type: 'string', rightWildcard: true } };
    const [, params] = compileQuery({ query: 'name:Name', attributeMap: rightWildcardAttributes }).getQueryAndParameters();

    expect(params).toEqual(['Name%']);
  });
});

describe('compile: case sensitivity', () => {
  it('leaves the column bare for a case-sensitive attribute', () => {
    const [sql] = compileQuery({ query: 'name:Fred' }).getQueryAndParameters();

    expect(sql).toContain(`name LIKE ? ESCAPE '!'`);
    expect(sql).not.toContain('LOWER');
  });

  it('wraps the column in LOWER() for a case-insensitive attribute, and lowercases the bound value', () => {
    const [sql, params] = compileQuery({ query: 'name:Fred', attributeMap: caseInsensitiveAttributes }).getQueryAndParameters();

    expect(sql).toContain(`LOWER(name) LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['fred']);
  });

  it('wraps the column in LOWER() for a case-insensitive wildcard too', () => {
    const [sql, params] = compileQuery({ query: 'name:Fred*', attributeMap: caseInsensitiveAttributes }).getQueryAndParameters();

    expect(sql).toContain(`LOWER(name) LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['fred%']);
  });

  it('wraps the column in UPPER() for "caseSensitive: \'upper\'", and uppercases the bound value', () => {
    const upperCaseAttributes: AttributeMap = { name: { type: 'string', caseSensitive: 'upper' } };
    const [sql, params] = compileQuery({ query: 'name:Fred', attributeMap: upperCaseAttributes }).getQueryAndParameters();

    expect(sql).toContain(`UPPER(name) LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['FRED']);
  });

  it('applies a field-level override\'s own "caseSensitive", independent of the outer attribute\'s', () => {
    const mixedCaseAttributes: AttributeMap = {
      search: { type: 'string', fields: ['name', { field: 'description', type: 'string', caseSensitive: false }] },
    };
    const [sql, params] = compileQuery({ query: 'search:Fred', attributeMap: mixedCaseAttributes }).getQueryAndParameters();

    expect(sql).toContain(`(name LIKE ? ESCAPE '!' OR LOWER(description) LIKE ? ESCAPE '!')`);
    expect(params).toEqual(['Fred', 'fred']);
  });
});

describe('compile: multi-field attributes', () => {
  it('ORs together each field for a bare-colon value', () => {
    const [sql, params] = compileQuery({ query: 'search:Fred', attributeMap: multiFieldAttributes }).getQueryAndParameters();

    expect(sql).toContain(`(name LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!')`);
    expect(params).toEqual(['Fred', 'Fred']);
  });

  it('ORs together each field for a wildcard match', () => {
    const [sql, params] = compileQuery({ query: 'search:Fred*', attributeMap: multiFieldAttributes }).getQueryAndParameters();

    expect(sql).toContain(`(name LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!')`);
    expect(params).toEqual(['Fred%', 'Fred%']);
  });

  it('uses a unique parameter for every field', () => {
    const parameters = compileQuery({ query: 'search:Fred', attributeMap: multiFieldAttributes }).getParameters();

    expect(new Set(Object.keys(parameters)).size).toBe(2);
  });

  it('does not add its own extra bracket around a single-field predicate', () => {
    // The outer Brackets wrapping the whole expression is pre-existing/unrelated;
    // a single-field predicate must not additionally double that nesting itself.
    const [sql] = compileQuery({ query: 'status:online' }).getQueryAndParameters();

    expect(sql).not.toContain('((status');
  });

  it('inserts a "raw" field verbatim, unescaped and unqualified, leaving other fields bare', () => {
    const [sql, params] = compileQuery({ query: 'search:Fred', attributeMap: rawFieldAttributes }).getQueryAndParameters();

    expect(sql).toContain(`(name LIKE ? ESCAPE '!' OR CAST(price AS TEXT) LIKE ? ESCAPE '!')`);
    expect(params).toEqual(['Fred', 'Fred']);
  });

  it('applies a "raw" field under a wildcard match too', () => {
    const [sql, params] = compileQuery({ query: 'search:Fred*', attributeMap: rawFieldAttributes }).getQueryAndParameters();

    expect(sql).toContain(`CAST(price AS TEXT) LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['Fred%', 'Fred%']);
  });
});

describe('compile: field-level type overrides', () => {
  it('converts the overridden field using its own type', () => {
    const [sql, params] = compileQuery({ query: 'search:100', attributeMap: typedFieldAttributes }).getQueryAndParameters();

    expect(sql).toContain(`name LIKE ? ESCAPE '!'`);
    // The sqlite driver inlines numeric parameters as literals rather than binding them.
    expect(sql).toContain('price = 100');
    expect(params).toEqual(['100']);
  });

  it('compiles a non-matching overridden field to an unconditional "1 = 0", not an error', () => {
    const [sql, params] = compileQuery({ query: 'search:Fred', attributeMap: typedFieldAttributes }).getQueryAndParameters();

    expect(sql).toContain(`(name LIKE ? ESCAPE '!' OR 1 = 0)`);
    expect(params).toEqual(['Fred']);
  });
});

describe('compile: unparseable values compile to "1 = 0" for any attribute, not just multi-field ones', () => {
  it('does not throw, and compiles to an unconditional false', () => {
    const [sql, params] = compileQuery({ query: 'id:foo', attributeMap: uuidAttributes }).getQueryAndParameters();

    expect(sql).toContain('1 = 0');
    expect(params).toEqual([]);
  });

  it('still compiles normally when the value is valid', () => {
    const [sql, params] = compileQuery({
      query: 'id:550e8400-e29b-41d4-a716-446655440000',
      attributeMap: uuidAttributes,
    }).getQueryAndParameters();

    expect(sql).toContain('id = ?');
    expect(params).toEqual(['550e8400-e29b-41d4-a716-446655440000']);
  });
});

describe('compile: "null" attributes', () => {
  it('compiles an "isNull" value to "IS NULL", with no bound parameter', () => {
    const [sql, params] = compileQuery({ query: 'assigned:no', attributeMap: nullAttributes }).getQueryAndParameters();

    expect(sql).toContain('assigned IS NULL');
    expect(params).toEqual([]);
  });

  it('compiles an "isNotNull" value to "IS NOT NULL", with no bound parameter', () => {
    const [sql, params] = compileQuery({ query: 'assigned:yes', attributeMap: nullAttributes }).getQueryAndParameters();

    expect(sql).toContain('assigned IS NOT NULL');
    expect(params).toEqual([]);
  });

  it('compiles an unknown value to an unconditional "1 = 0", not an error', () => {
    const [sql, params] = compileQuery({ query: 'assigned:maybe', attributeMap: nullAttributes }).getQueryAndParameters();

    expect(sql).toContain('1 = 0');
    expect(params).toEqual([]);
  });
});

describe('compile: default field ("_all")', () => {
  it('compiles a bare query against "_all", OR-ing its configured fields', () => {
    const [sql, params] = compileQuery({ query: 'Fred', attributeMap: defaultFieldAttributes }).getQueryAndParameters();

    expect(sql).toContain(`(name LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!')`);
    expect(params).toEqual(['Fred', 'Fred']);
  });

  it('ANDs multiple bare terms together (free-text search)', () => {
    const [sql, params] = compileQuery({ query: 'red shoes', attributeMap: defaultFieldAttributes }).getQueryAndParameters();

    expect(sql).toMatch(/\(name LIKE \? ESCAPE '!' OR description LIKE \? ESCAPE '!'\) AND \(name LIKE \? ESCAPE '!' OR description LIKE \? ESCAPE '!'\)/);
    expect(params).toEqual(['red', 'red', 'shoes', 'shoes']);
  });
});

describe('compile: alias', () => {
  it('defaults the alias to the entity\'s table name', () => {
    const [sql] = compileQuery({ query: 'status:online' }).getQueryAndParameters();

    expect(sql).toContain('FROM "products" "products"');
    // The alias only affects the FROM/SELECT clauses TypeORM generates on its own —
    // fields are inserted verbatim into WHERE, so the column stays unqualified here.
    expect(sql).toContain('status = ?');
  });

  it('uses an explicitly provided alias instead', () => {
    const [sql] = compileQuery({ query: 'status:online', alias: 'p' }).getQueryAndParameters();

    expect(sql).toContain('FROM "products" "p"');
    expect(sql).toContain('status = ?');
  });
});

describe('compile: negation (NOT)', () => {
  // NOT's content is rendered to a single string and wrapped in exactly one
  // "COALESCE(..., FALSE)" — see src/compiler/typeorm.ts's renderNegated — so a NULL
  // column can't make the un-negated expression evaluate to NULL/UNKNOWN, which would
  // otherwise make SQL's NOT(...) also NULL and silently drop that row from the results.
  it('wraps a negated predicate in NOT(COALESCE(..., FALSE))', () => {
    const [sql, params] = compileQuery({ query: 'NOT status:online' }).getQueryAndParameters();

    expect(sql).toContain('NOT(COALESCE((status = ?), FALSE))');
    expect(params).toEqual(['online']);
  });

  it('wraps a negated group in NOT(COALESCE(..., FALSE)), preserving the AND/OR structure inside', () => {
    const [sql, params] = compileQuery({ query: 'NOT (status:online OR status:pending)' }).getQueryAndParameters();

    expect(sql).toContain('NOT(COALESCE((status = ? OR status = ?), FALSE))');
    expect(params).toEqual(['online', 'pending']);
  });

  it('combines a negated term with a non-negated one via implicit AND', () => {
    const [sql, params] = compileQuery({ query: 'NOT status:online price:>100' }).getQueryAndParameters();

    expect(sql).toMatch(/NOT\(COALESCE\(\(status = \?\), FALSE\)\) AND .*price > 100/);
    expect(params).toEqual(['online']);
  });

  it('double negation compiles to nested NOT(COALESCE(...))', () => {
    const [sql] = compileQuery({ query: 'NOT NOT status:online' }).getQueryAndParameters();

    expect(sql).toContain('NOT(COALESCE((NOT(COALESCE((status = ?), FALSE))), FALSE))');
  });

  it('negates a multi-field OR group as a whole, not each field independently', () => {
    const [sql, params] = compileQuery({ query: 'NOT search:Fred', attributeMap: multiFieldAttributes }).getQueryAndParameters();

    expect(sql).toContain(`NOT(COALESCE(((name LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!')), FALSE))`);
    expect(params).toEqual(['Fred', 'Fred']);
  });

  it('negating an unparseable ("1 = 0") predicate compiles to an unconditional true', () => {
    const [sql, params] = compileQuery({ query: 'NOT id:foo', attributeMap: uuidAttributes }).getQueryAndParameters();

    expect(sql).toContain('NOT(COALESCE((1 = 0), FALSE))');
    expect(params).toEqual([]);
  });
});

describe('compileCondition', () => {
  function compileConditionQuery(query: string, attributeMap: AttributeMap = attributes): Brackets {
    const validated = validate({ expression: parse(query), attributes: attributeMap });

    return compileCondition(validated);
  }

  it('returns a Brackets fragment, not a full queryBuilder', () => {
    expect(compileConditionQuery('status:online')).toBeInstanceOf(Brackets);
  });

  it('applies correctly when merged via andWhere() onto a queryBuilder built independently', () => {
    const queryBuilder = ProductRepository.createQueryBuilder('products');

    queryBuilder.andWhere(compileConditionQuery('status:online AND price:>100'));

    const [sql, params] = queryBuilder.getQueryAndParameters();

    expect(sql).toMatch(/status = \? AND .*price > 100/);
    expect(params).toEqual(['online']);
  });

  it('composes with conditions already present on the queryBuilder, instead of replacing them', () => {
    const queryBuilder = ProductRepository.createQueryBuilder('products').andWhere('products.status = :status', { status: 'online' });

    queryBuilder.andWhere(compileConditionQuery('price:>100'));

    const [sql, params] = queryBuilder.getQueryAndParameters();

    expect(sql).toMatch(/"products"\."status" = \?.*AND.*price > 100/);
    expect(params).toEqual(['online']);
  });
});
