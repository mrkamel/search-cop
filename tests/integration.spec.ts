import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DataSource, Repository } from 'typeorm';
import { search } from '../src/index.js';
import { SearchCopError } from '../src/errors/errors.js';
import { createTestDataSource } from './support/data-source.js';
import { Product } from './support/product.entity.js';
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

let dataSource: DataSource;
let repository: Repository<Product>;

beforeAll(async () => {
  dataSource = await createTestDataSource();
  repository = dataSource.getRepository(Product);
});

afterAll(async () => {
  await dataSource.destroy();
});

afterEach(async () => {
  await repository.clear();
});

describe('search: end-to-end result sets', () => {
  it('filters with a single predicate', async () => {
    const online = await createProduct(repository, { status: 'online' });

    await createProduct(repository, { status: 'offline' });

    const products = await search({ repository, query: 'status:online', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([online.name]);
  });

  it('filters with AND', async () => {
    const match = await createProduct(repository, { status: 'online', price: 150 });

    await createProduct(repository, { status: 'online', price: 50 });
    await createProduct(repository, { status: 'offline', price: 150 });

    const products = await search({ repository, query: 'status:online AND price:>100', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('filters with OR', async () => {
    const online = await createProduct(repository, { status: 'online' });
    const pending = await createProduct(repository, { status: 'pending' });

    await createProduct(repository, { status: 'offline' });

    const products = await search({ repository, query: 'status:online OR status:pending', attributes }).getMany();

    expect(products.map((product) => product.name).sort()).toEqual([online.name, pending.name].sort());
  });

  it('filters with parenthesized OR combined with AND', async () => {
    const onlineExpensive = await createProduct(repository, { status: 'online', price: 150 });
    const pendingExpensive = await createProduct(repository, { status: 'pending', price: 150 });

    await createProduct(repository, { status: 'online', price: 50 });
    await createProduct(repository, { status: 'offline', price: 150 });

    const products = await search({
      repository,
      query: '(status:online OR status:pending) AND price:>100',
      attributes,
    }).getMany();

    expect(products.map((product) => product.name).sort()).toEqual([onlineExpensive.name, pendingExpensive.name].sort());
  });

  it('returns a plain TypeORM SelectQueryBuilder', () => {
    const queryBuilder = search({ repository, query: 'status:online', attributes });

    expect(typeof queryBuilder.getMany).toBe('function');
    expect(typeof queryBuilder.getQuery).toBe('function');
  });

  it('accepts a custom alias and still returns correct results', async () => {
    const online = await createProduct(repository, { status: 'online' });

    await createProduct(repository, { status: 'offline' });

    const queryBuilder = search({ repository, query: 'status:online', attributes, alias: 'p' });

    expect(queryBuilder.getSql()).toContain('"p"."status"');

    const products = await queryBuilder.getMany();

    expect(products.map((product) => product.name)).toEqual([online.name]);
  });
});

describe('search: wildcards', () => {
  it('matches a prefix wildcard', async () => {
    const match = await createProduct(repository, { name: 'Petfood' });

    await createProduct(repository, { name: 'Foodpet' });

    const products = await search({ repository, query: 'name:Pet*', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('matches a suffix wildcard', async () => {
    const match = await createProduct(repository, { name: 'Bigfred' });

    await createProduct(repository, { name: 'Fredbig' });

    const products = await search({ repository, query: 'name:*fred', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('matches a contains wildcard on both sides', async () => {
    const match = await createProduct(repository, { name: 'Superpetfoodstore' });

    await createProduct(repository, { name: 'Superstore' });

    const products = await search({ repository, query: 'name:*pet*', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('negates a wildcard with "!="', async () => {
    const match = await createProduct(repository, { name: 'Foodpet' });

    await createProduct(repository, { name: 'Petfood' });

    const products = await search({ repository, query: 'name:!=Pet*', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('treats a literal "%" in the value as a literal character, not a LIKE wildcard', async () => {
    const match = await createProduct(repository, { name: '100%organic' });

    await createProduct(repository, { name: '100xorganic' });

    const products = await search({ repository, query: 'name:100%*', attributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });

  it('rejects wildcards combined with ordering operators', () => {
    expect(() => search({ repository, query: 'name:>Pet*', attributes })).toThrow(SearchCopError);
  });
});

describe('search: case sensitivity', () => {
  it('is case-sensitive by default: a differently-cased value does not match', async () => {
    await createProduct(repository, { name: 'FRED' });

    const products = await search({ repository, query: 'name:fred', attributes }).getMany();

    expect(products).toEqual([]);
  });

  it('matches regardless of case when the attribute is declared case-insensitive', async () => {
    const match = await createProduct(repository, { name: 'FRED' });

    const products = await search({ repository, query: 'name:fred', attributes: caseInsensitiveAttributes }).getMany();

    expect(products.map((product) => product.name)).toEqual([match.name]);
  });
});
