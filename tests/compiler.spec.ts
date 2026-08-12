import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DataSource, Repository } from 'typeorm';
import { parse } from '../src/parser/parser.js';
import { validate } from '../src/validator/validator.js';
import { compile } from '../src/compiler/typeorm.js';
import { createTestDataSource } from './support/data-source.js';
import { Product } from './support/product.entity.js';
import type { AttributeMap } from '../src/attributes/types.js';

const attributes: AttributeMap = {
  status: { type: 'enum', values: ['online', 'offline', 'pending'] },
  price: { type: 'number' },
  createdAt: { type: 'datetime' },
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

function compileQuery(query: string) {
  const validated = validate(parse(query), attributes);

  return compile(repository, validated);
}

describe('compile: simple predicates', () => {
  it('compiles equality', () => {
    const [sql, params] = compileQuery('status:online').getQueryAndParameters();

    expect(sql).toContain('"status" = ?');
    expect(params).toEqual(['online']);
  });

  it('compiles comparison operators', () => {
    // The sqlite driver inlines numeric parameters as literals rather than binding them,
    // since a JS `number` cannot carry an injection payload. Strings, dates, and booleans
    // are still bound through "?" placeholders (see the tests below).
    const [sql, params] = compileQuery('price:>100').getQueryAndParameters();

    expect(sql).toContain('"price" > 100');
    expect(params).toEqual([]);
  });

  it('compiles inequality', () => {
    const [sql, params] = compileQuery('status:!=offline').getQueryAndParameters();

    expect(sql).toContain('"status" != ?');
    expect(params).toEqual(['offline']);
  });
});

describe('compile: boolean expressions', () => {
  it('combines predicates with AND', () => {
    const [sql, params] = compileQuery('status:online AND price:>100').getQueryAndParameters();

    expect(sql).toMatch(/"status" = \? AND .*"price" > 100/);
    expect(params).toEqual(['online']);
  });

  it('combines predicates with OR', () => {
    const [sql, params] = compileQuery('status:online OR status:pending').getQueryAndParameters();

    expect(sql).toMatch(/"status" = \? OR .*"status" = \?/);
    expect(params).toEqual(['online', 'pending']);
  });

  it('preserves parenthesized precedence: "(A OR B) AND C"', () => {
    const [sql, params] = compileQuery('(status:online OR status:pending) AND price:>100').getQueryAndParameters();

    expect(sql).toMatch(/\(.*"status" = \? OR .*"status" = \?.*\) AND .*"price" > 100/);
    expect(params).toEqual(['online', 'pending']);
  });

  it('preserves default precedence: "A OR B AND C" = "A OR (B AND C)"', () => {
    const [sql, params] = compileQuery('status:online OR status:pending AND price:>100').getQueryAndParameters();

    expect(sql).toMatch(/"status" = \? OR .*"status" = \? AND .*"price" > 100/);
    expect(params).toEqual(['online', 'pending']);
  });

  it('uses a unique parameter for every predicate, even for repeated fields', () => {
    const parameters = compileQuery('status:online OR status:offline').getParameters();

    expect(new Set(Object.keys(parameters)).size).toBe(2);
  });

  it('never interpolates string values directly into the SQL string', () => {
    const [sql] = compileQuery('status:online').getQueryAndParameters();

    expect(sql).not.toContain('online');
  });
});
