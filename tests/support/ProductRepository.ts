import { AppDataSource } from "./AppDataSource.js";
import { ProductEntity } from "./ProductEntity.js";

export const ProductRepository = AppDataSource.getRepository(ProductEntity);
