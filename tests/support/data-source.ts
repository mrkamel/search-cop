import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Product } from './product.entity.js';

export async function createTestDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    dropSchema: true,
    synchronize: true,
    entities: [Product],
  });

  await dataSource.initialize();

  return dataSource;
}
