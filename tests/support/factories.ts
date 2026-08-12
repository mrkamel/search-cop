import type { DeepPartial } from 'typeorm';
import { ProductEntity } from './ProductEntity.js';
import { ProductRepository } from './ProductRepository.js';

function buildCounter() {
  let count = 0;

  return {
    next: () => ++count,
  };
}

const productCounter = buildCounter();

export function buildProduct(overrides: DeepPartial<ProductEntity> = {}): DeepPartial<ProductEntity> {
  const i = productCounter.next();

  return {
    name: `Product ${i}`,
    description: `Description ${i}`,
    status: 'online',
    price: 100,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export async function createProduct(overrides: DeepPartial<ProductEntity> = {}) {
  return await ProductRepository.save(buildProduct(overrides));
}
