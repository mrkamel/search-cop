import type { Brackets, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { parse } from './parser/parser.js';
import { validate } from './validator/validator.js';
import { compile, compileCondition } from './compiler/typeorm.js';
import type { AttributeMap } from './attributes/types.js';

export { DEFAULT_FIELD } from './parser/parser.js';

export interface SearchOptions<Entity extends ObjectLiteral> {
  repository: Repository<Entity>;
  query: string;
  attributes: AttributeMap;
  /** SQL alias used for the entity's table in the generated query. Defaults to the table name. */
  alias?: string;
}

export function search<Entity extends ObjectLiteral>(options: SearchOptions<Entity>): SelectQueryBuilder<Entity> {
  const expression = parse(options.query);
  const validated = validate({ expression, attributes: options.attributes });

  return compile({ repository: options.repository, expression: validated, alias: options.alias });
}

export interface SearchConditionOptions {
  query: string;
  attributes: AttributeMap;
}

/**
 * Compiles a query to a standalone `Brackets` where-clause fragment instead of a full
 * query, to merge into a queryBuilder you've already built yourself — with your own
 * joins, alias, and other `where` conditions already in place:
 *
 * ```ts
 * const queryBuilder = repository.createQueryBuilder('product').leftJoinAndSelect('product.author', 'author');
 * queryBuilder.andWhere(searchCondition({ query: 'author.name:joe', attributes }));
 * ```
 */
export function searchCondition(options: SearchConditionOptions): Brackets {
  const expression = parse(options.query);
  const validated = validate({ expression, attributes: options.attributes });

  return compileCondition(validated);
}

export { SearchCopError } from './errors/errors.js';
export type { SearchCopErrorCode } from './errors/errors.js';
export type {
  AttributeDefinition,
  AttributeField,
  AttributeFieldType,
  AttributeMap,
  AttributeType,
  BooleanAttributeDefinition,
  DateAttributeDefinition,
  DatetimeAttributeDefinition,
  EnumAttributeDefinition,
  NullAttributeDefinition,
  NumberAttributeDefinition,
  StringAttributeDefinition,
  UuidAttributeDefinition,
} from './attributes/types.js';
export type { AndExpression, Expression, NotExpression, Operator, OrExpression, PredicateExpression } from './ast/types.js';
export type { ValidatedExpression, ValidatedField, ValidatedNot, ValidatedOperator, ValidatedPredicate, ValidatedValue } from './validator/types.js';
