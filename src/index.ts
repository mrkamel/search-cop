import type { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { parse } from './parser/parser.js';
import { validate } from './validator/validator.js';
import { compile } from './compiler/typeorm.js';
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

export { SearchCopError } from './errors/errors.js';
export type { SearchCopErrorCode } from './errors/errors.js';
export type {
  AttributeDefinition,
  AttributeField,
  AttributeFieldType,
  AttributeMap,
  AttributeRawField,
  AttributeType,
  BooleanAttributeDefinition,
  DateAttributeDefinition,
  DatetimeAttributeDefinition,
  EnumAttributeDefinition,
  NumberAttributeDefinition,
  StringAttributeDefinition,
  UuidAttributeDefinition,
} from './attributes/types.js';
export type { AndExpression, Expression, NotExpression, Operator, OrExpression, PredicateExpression } from './ast/types.js';
export type { ValidatedExpression, ValidatedField, ValidatedNot, ValidatedOperator, ValidatedPredicate, ValidatedValue } from './validator/types.js';
