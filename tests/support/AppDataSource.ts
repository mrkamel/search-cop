import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ProductEntity } from './ProductEntity.js';
import { ArticleEntity } from './ArticleEntity.js';

const entities = [ProductEntity, ArticleEntity];

export const AppDataSource = (() => {
  if (process.env.DATABASE === 'postgres') {
    return new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432,
      username: process.env.POSTGRES_USER ?? 'search_cop',
      password: process.env.POSTGRES_PASSWORD ?? 'search_cop',
      database: process.env.POSTGRES_DB ?? 'search_cop',
      dropSchema: true,
      synchronize: true,
      entities,
    });
  }

  return new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    dropSchema: true,
    synchronize: true,
    entities,
  });
})();
