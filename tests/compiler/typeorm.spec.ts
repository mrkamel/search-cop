import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DataSource, Repository } from 'typeorm';
import { parse } from '../../src/parser/parser.js';
import { validate } from '../../src/validator/validator.js';
import { compile } from '../../src/compiler/typeorm.js';
import { createTestDataSource } from '../support/data-source.js';
import { Product } from '../support/product.entity.js';
import type { AttributeMap } from '../../src/attributes/types.js';

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

let dataSource: DataSource;
let repository: Repository<Product>;

beforeAll(async () => {
  dataSource = await createTestDataSource();
  repository = dataSource.getRepository(Product);
});

afterAll(async () => {
  await dataSource.destroy();
});

function compileQuery({ query, attributeMap = attributes, alias }: { query: string; attributeMap?: AttributeMap; alias?: string }) {
  const validated = validate({ expression: parse(query), attributes: attributeMap });

  return compile({ repository, expression: validated, alias });
}

describe('compile: simple predicates', () => {
  it('compiles equality', () => {
    const [sql, params] = compileQuery({ query: 'status:online' }).getQueryAndParameters();

    expect(sql).toContain('"status" = ?');
    expect(params).toEqual(['online']);
  });

  it('compiles comparison operators', () => {
    // The sqlite driver inlines numeric parameters as literals rather than binding them,
    // since a JS `number` cannot carry an injection payload. Strings, dates, and booleans
    // are still bound through "?" placeholders (see the tests below).
    const [sql, params] = compileQuery({ query: 'price:>100' }).getQueryAndParameters();

    expect(sql).toContain('"price" > 100');
    expect(params).toEqual([]);
  });

});

describe('compile: boolean expressions', () => {
  it('combines predicates with AND', () => {
    const [sql, params] = compileQuery({ query: 'status:online AND price:>100' }).getQueryAndParameters();

    expect(sql).toMatch(/"status" = \? AND .*"price" > 100/);
    expect(params).toEqual(['online']);
  });

  it('combines predicates with OR', () => {
    const [sql, params] = compileQuery({ query: 'status:online OR status:pending' }).getQueryAndParameters();

    expect(sql).toMatch(/"status" = \? OR .*"status" = \?/);
    expect(params).toEqual(['online', 'pending']);
  });

  it('preserves parenthesized precedence: "(A OR B) AND C"', () => {
    const [sql, params] = compileQuery({ query: '(status:online OR status:pending) AND price:>100' }).getQueryAndParameters();

    expect(sql).toMatch(/\(.*"status" = \? OR .*"status" = \?.*\) AND .*"price" > 100/);
    expect(params).toEqual(['online', 'pending']);
  });

  it('preserves default precedence: "A OR B AND C" = "A OR (B AND C)"', () => {
    const [sql, params] = compileQuery({ query: 'status:online OR status:pending AND price:>100' }).getQueryAndParameters();

    expect(sql).toMatch(/"status" = \? OR .*"status" = \? AND .*"price" > 100/);
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

    expect(sql).toContain(`"name" LIKE ? ESCAPE '\\'`);
    expect(params).toEqual(['Pet%']);
  });

  it('escapes literal "%" and "_" so they are not treated as LIKE wildcards', () => {
    const [, params] = compileQuery({ query: 'name:100%_off*' }).getQueryAndParameters();

    expect(params).toEqual(['100\\%\\_off%']);
  });
});

describe('compile: case sensitivity', () => {
  it('leaves the column bare for a case-sensitive attribute', () => {
    const [sql] = compileQuery({ query: 'name:Fred' }).getQueryAndParameters();

    expect(sql).toContain('"name" = ?');
    expect(sql).not.toContain('LOWER');
  });

  it('wraps the column in LOWER() for a case-insensitive attribute, and lowercases the bound value', () => {
    const [sql, params] = compileQuery({ query: 'name:Fred', attributeMap: caseInsensitiveAttributes }).getQueryAndParameters();

    expect(sql).toContain('LOWER("products"."name") = ?');
    expect(params).toEqual(['fred']);
  });

  it('wraps the column in LOWER() for a case-insensitive wildcard too', () => {
    const [sql, params] = compileQuery({ query: 'name:Fred*', attributeMap: caseInsensitiveAttributes }).getQueryAndParameters();

    expect(sql).toContain(`LOWER("products"."name") LIKE ? ESCAPE '\\'`);
    expect(params).toEqual(['fred%']);
  });
});

describe('compile: multi-field attributes', () => {
  it('ORs together each field for "="', () => {
    const [sql, params] = compileQuery({ query: 'search:Fred', attributeMap: multiFieldAttributes }).getQueryAndParameters();

    expect(sql).toContain('("products"."name" = ? OR "products"."description" = ?)');
    expect(params).toEqual(['Fred', 'Fred']);
  });

  it('ORs together each field for a wildcard match', () => {
    const [sql, params] = compileQuery({ query: 'search:Fred*', attributeMap: multiFieldAttributes }).getQueryAndParameters();

    expect(sql).toContain(`("products"."name" LIKE ? ESCAPE '\\' OR "products"."description" LIKE ? ESCAPE '\\')`);
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

    expect(sql).not.toContain('(("products"."status"');
  });
});

describe('compile: alias', () => {
  it('defaults the alias to the entity\'s table name', () => {
    const [sql] = compileQuery({ query: 'status:online' }).getQueryAndParameters();

    expect(sql).toContain('FROM "products" "products"');
    expect(sql).toContain('"products"."status" = ?');
  });

  it('uses an explicitly provided alias instead', () => {
    const [sql] = compileQuery({ query: 'status:online', alias: 'p' }).getQueryAndParameters();

    expect(sql).toContain('FROM "products" "p"');
    expect(sql).toContain('"p"."status" = ?');
  });
});
