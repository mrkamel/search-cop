import type { DeepPartial, Repository } from 'typeorm';
import { Product } from './product.entity.js';

function buildCounter() {
  let count = 0;

  return {
    next: () => ++count,
  };
}

const productCounter = buildCounter();

export function buildProduct(overrides: DeepPartial<Product> = {}): DeepPartial<Product> {
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

export async function createProduct(repository: Repository<Product>, overrides: DeepPartial<Product> = {}) {
  return await repository.save(buildProduct(overrides));
}
