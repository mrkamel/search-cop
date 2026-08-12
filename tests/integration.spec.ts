import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DataSource, Repository } from 'typeorm';
import { search } from '../src/index.js';
import { createTestDataSource } from './support/data-source.js';
import { Product } from './support/product.entity.js';
import { createProduct } from './support/factories.js';
import type { AttributeMap } from '../src/attributes/types.js';

const attributes: AttributeMap = {
  status: { type: 'enum', values: ['online', 'offline', 'pending'] },
  price: { type: 'number' },
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
});
