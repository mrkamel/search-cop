import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ProductEntity } from './ProductEntity.js';

export const AppDataSource = new DataSource({
  type: 'better-sqlite3',
  database: ':memory:',
  dropSchema: true,
  synchronize: true,
  entities: [ProductEntity],
});
