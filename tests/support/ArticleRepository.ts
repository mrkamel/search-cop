import { AppDataSource } from './AppDataSource.js';
import { ArticleEntity } from './ArticleEntity.js';

export const ArticleRepository = AppDataSource.getRepository(ArticleEntity);
