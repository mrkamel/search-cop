import type { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { parse } from './parser/parser.js';
import { validate } from './validator/validator.js';
import { compile } from './compiler/typeorm.js';
import type { AttributeMap } from './attributes/types.js';

export interface SearchOptions<Entity extends ObjectLiteral> {
  repository: Repository<Entity>;
  query: string;
  attributes: AttributeMap;
}

export function search<Entity extends ObjectLiteral>(options: SearchOptions<Entity>): SelectQueryBuilder<Entity> {
  const expression = parse(options.query);
  const validated = validate(expression, options.attributes);

  return compile(options.repository, validated);
}

export { SearchCopError } from './errors/errors.js';
export type { SearchCopErrorCode } from './errors/errors.js';
export type {
  AttributeDefinition,
  AttributeMap,
  AttributeType,
  BooleanAttributeDefinition,
  DateAttributeDefinition,
  DatetimeAttributeDefinition,
  EnumAttributeDefinition,
  NumberAttributeDefinition,
  StringAttributeDefinition,
} from './attributes/types.js';
export type { AndExpression, Expression, Operator, OrExpression, PredicateExpression } from './ast/types.js';
export type { ValidatedExpression, ValidatedPredicate, ValidatedValue } from './validator/types.js';
