import { validate as isUuid } from 'uuid';
import type { Expression, Operator, PredicateExpression } from '../ast/types.js';
import type { AttributeDefinition, AttributeMap } from '../attributes/types.js';
import type { ValidatedExpression, ValidatedPredicate, ValidatedValue } from './types.js';
import { SearchCopError } from '../errors/errors.js';

const OPERATORS_BY_TYPE: Record<AttributeDefinition['type'], Operator[]> = {
  string: ['=', '!=', '>', '>=', '<', '<='],
  number: ['=', '!=', '>', '>=', '<', '<='],
  boolean: ['=', '!='],
  date: ['=', '!=', '>', '>=', '<', '<='],
  datetime: ['=', '!=', '>', '>=', '<', '<='],
  enum: ['=', '!='],
  uuid: ['=', '!='],
};

/**
 * Date-only values (and datetime values without an explicit offset) are interpreted as UTC,
 * not the host machine's local timezone.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/;

export interface ValidateOptions {
  expression: Expression;
  attributes: AttributeMap;
}

export function validate({ expression, attributes }: ValidateOptions): ValidatedExpression {
  switch (expression.type) {
    case 'and':
      return { type: 'and', children: expression.children.map((child) => validate({ expression: child, attributes })) };

    case 'or':
      return { type: 'or', children: expression.children.map((child) => validate({ expression: child, attributes })) };

    case 'predicate':
      return validatePredicate(expression, attributes);
  }
}

function validatePredicate(predicate: PredicateExpression, attributes: AttributeMap): ValidatedPredicate {
  const attribute = attributes[predicate.field];

  if (!Object.hasOwn(attributes, predicate.field) || !attribute) {
    throw new SearchCopError('UNKNOWN_ATTRIBUTE', `Unknown search attribute "${predicate.field}".`, predicate.position);
  }

  const allowedOperators = OPERATORS_BY_TYPE[attribute.type];

  if (!allowedOperators.includes(predicate.operator)) {
    throw new SearchCopError(
      'INVALID_OPERATOR',
      `Operator "${predicate.operator}" is not supported for attribute "${predicate.field}" of type "${attribute.type}".`,
      predicate.position,
    );
  }

  const caseSensitive = attribute.type === 'string' ? attribute.caseSensitive ?? true : true;

  if (attribute.type === 'string' && predicate.value.includes('*')) {
    return convertWildcard(predicate, caseSensitive);
  }

  return {
    type: 'predicate',
    field: predicate.field,
    operator: predicate.operator,
    value: convertValue(predicate, attribute),
    caseSensitive,
    position: predicate.position,
  };
}

function convertWildcard(predicate: PredicateExpression, caseSensitive: boolean): ValidatedPredicate {
  if (predicate.operator !== '=' && predicate.operator !== '!=') {
    throw new SearchCopError(
      'INVALID_OPERATOR',
      `Wildcards ("*") are only supported with "=" and "!=", got "${predicate.operator}" for attribute "${predicate.field}".`,
      predicate.position,
    );
  }

  const pattern = toLikePattern(predicate.value);

  return {
    type: 'predicate',
    field: predicate.field,
    operator: predicate.operator === '=' ? 'LIKE' : 'NOT LIKE',
    value: caseSensitive ? pattern : pattern.toLowerCase(),
    caseSensitive,
    position: predicate.position,
  };
}

// Escapes existing "\", "%", and "_" so they match literally, then turns the DSL's
// "*" wildcard into the LIKE wildcard "%". Order matters: escaping runs first so the
// "%" introduced by "*" is never itself escaped.
function toLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`).replace(/\*/g, '%');
}

function convertValue(predicate: PredicateExpression, attribute: AttributeDefinition): ValidatedValue {
  switch (attribute.type) {
    case 'string':
      return attribute.caseSensitive === false ? predicate.value.toLowerCase() : predicate.value;

    case 'number':
      return convertNumber(predicate);

    case 'boolean':
      return convertBoolean(predicate);

    case 'date':
      return convertDate(predicate, false);

    case 'datetime':
      return convertDate(predicate, true);

    case 'enum':
      return convertEnum(predicate, attribute.values);

    case 'uuid':
      return convertUuid(predicate);
  }
}

function convertNumber(predicate: PredicateExpression): number {
  if (!/^-?\d+(\.\d+)?$/.test(predicate.value)) {
    throw new SearchCopError(
      'INVALID_VALUE',
      `Invalid number "${predicate.value}" for attribute "${predicate.field}".`,
      predicate.position,
    );
  }

  return Number(predicate.value);
}

function convertBoolean(predicate: PredicateExpression): boolean {
  if (predicate.value === 'true') {
    return true;
  }

  if (predicate.value === 'false') {
    return false;
  }

  throw new SearchCopError(
    'INVALID_VALUE',
    `Invalid boolean "${predicate.value}" for attribute "${predicate.field}". Expected "true" or "false".`,
    predicate.position,
  );
}

function convertEnum(predicate: PredicateExpression, values: string[]): string {
  if (!values.includes(predicate.value)) {
    throw new SearchCopError(
      'INVALID_ENUM_VALUE',
      `Invalid value "${predicate.value}" for attribute "${predicate.field}". Expected one of: ${values.join(', ')}.`,
      predicate.position,
    );
  }

  return predicate.value;
}

function convertUuid(predicate: PredicateExpression): string {
  if (!isUuid(predicate.value)) {
    throw new SearchCopError(
      'INVALID_VALUE',
      `Invalid UUID "${predicate.value}" for attribute "${predicate.field}".`,
      predicate.position,
    );
  }

  return predicate.value.toLowerCase();
}

function convertDate(predicate: PredicateExpression, allowTime: boolean): Date {
  const dateOnlyMatch = DATE_ONLY.exec(predicate.value);

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;

    return buildUtcDate(predicate, Number(year), Number(month), Number(day), 0, 0, 0, 0);
  }

  if (allowTime) {
    const dateTimeMatch = DATE_TIME.exec(predicate.value);

    if (dateTimeMatch) {
      const [, year, month, day, hour, minute, second, fraction, offset] = dateTimeMatch;
      const millis = fraction ? Math.round(Number(`0.${fraction}`) * 1000) : 0;
      const date = buildUtcDate(predicate, Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second), millis);

      if (offset && offset !== 'Z') {
        const sign = offset.startsWith('-') ? -1 : 1;
        const [offsetHours = 0, offsetMinutes = 0] = offset.slice(1).split(':').map(Number);

        date.setUTCMinutes(date.getUTCMinutes() - sign * (offsetHours * 60 + offsetMinutes));
      }

      return date;
    }
  }

  throw new SearchCopError(
    'INVALID_VALUE',
    `Invalid ${allowTime ? 'datetime' : 'date'} "${predicate.value}" for attribute "${predicate.field}". Expected format "YYYY-MM-DD"${
      allowTime ? ' or "YYYY-MM-DDTHH:mm:ss[.sss](Z|±HH:mm)"' : ''
    }.`,
    predicate.position,
  );
}

function buildUtcDate(
  predicate: PredicateExpression,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millis: number,
): Date {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new SearchCopError(
      'INVALID_VALUE',
      `Invalid date "${predicate.value}" for attribute "${predicate.field}".`,
      predicate.position,
    );
  }

  return date;
}
