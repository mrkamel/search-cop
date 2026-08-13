import { validate as isUuid } from 'uuid';
import type { Expression, Operator, PredicateExpression } from '../ast/types.js';
import type { AttributeDefinition, AttributeField, AttributeMap } from '../attributes/types.js';
import type { ValidatedExpression, ValidatedField, ValidatedOperator, ValidatedPredicate, ValidatedValue } from './types.js';
import { SearchCopError } from '../errors/errors.js';

const OPERATORS_BY_TYPE: Record<AttributeDefinition['type'], Operator[]> = {
  string: ['=', '>', '>=', '<', '<='],
  number: ['=', '>', '>=', '<', '<='],
  boolean: ['='],
  date: ['=', '>', '>=', '<', '<='],
  datetime: ['=', '>', '>=', '<', '<='],
  enum: ['='],
  uuid: ['='],
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

    case 'not':
      return { type: 'not', child: validate({ expression: expression.child, attributes }) };

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

  if (attribute.fields?.length && attribute.fields.length > 1 && predicate.operator !== '=') {
    throw new SearchCopError(
      'INVALID_OPERATOR',
      `Multi-field attributes only support "=", got "${predicate.operator}" for attribute "${predicate.field}".`,
      predicate.position,
    );
  }

  const isWildcard = attribute.type === 'string' && predicate.value.includes('*');

  if (isWildcard && predicate.operator !== '=') {
    throw new SearchCopError(
      'INVALID_OPERATOR',
      `Wildcards ("*") are only supported with "=", got "${predicate.operator}" for attribute "${predicate.field}".`,
      predicate.position,
    );
  }

  const caseSensitive = attribute.type === 'string' ? attribute.caseSensitive ?? true : true;
  const entries = attribute.fields?.length ? attribute.fields : [predicate.field];

  return {
    type: 'predicate',
    fields: entries.map((entry) => resolveField(entry, predicate, attribute, isWildcard)),
    caseSensitive,
    position: predicate.position,
  };
}

function resolveField(
  entry: AttributeField,
  predicate: PredicateExpression,
  attribute: AttributeDefinition,
  isWildcard: boolean,
): ValidatedField {
  if (typeof entry === 'string') {
    return resolveColumn(entry, predicate, attribute, isWildcard);
  }

  // Field-level type override: validated independently against its own declared type,
  // ignoring the outer attribute entirely. A wildcard only carries over if this field
  // is itself "string" — every other type simply can't match a wildcarded value.
  const { field, ...definition } = entry;

  return resolveColumn(field, predicate, definition, isWildcard && definition.type === 'string');
}

function resolveColumn(field: string, predicate: PredicateExpression, definition: AttributeDefinition, isWildcard: boolean): ValidatedField {
  const resolved = resolveValue(predicate.value, predicate.operator, definition, isWildcard);

  return resolved === null ? { alwaysFalse: true } : { field, ...resolved };
}

function resolveValue(
  rawValue: string,
  operator: Operator,
  definition: AttributeDefinition,
  isWildcard: boolean,
): { value: ValidatedValue; operator: ValidatedOperator } | null {
  if (isWildcard) {
    const pattern = toLikePattern(rawValue);
    const caseSensitive = definition.type === 'string' ? definition.caseSensitive ?? true : true;

    return { value: caseSensitive ? pattern : pattern.toLowerCase(), operator: 'LIKE' };
  }

  if (!OPERATORS_BY_TYPE[definition.type].includes(operator)) {
    return null;
  }

  const value = convertValue(rawValue, definition);

  return value === null ? null : { value, operator };
}

// Escapes existing "\", "%", and "_" so they match literally, then turns the DSL's
// "*" wildcard into the LIKE wildcard "%". Order matters: escaping runs first so the
// "%" introduced by "*" is never itself escaped.
function toLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`).replace(/\*/g, '%');
}

function convertValue(value: string, definition: AttributeDefinition): ValidatedValue | null {
  switch (definition.type) {
    case 'string':
      return definition.caseSensitive === false ? value.toLowerCase() : value;

    case 'number':
      return convertNumber(value);

    case 'boolean':
      return convertBoolean(value);

    case 'date':
      return convertDate(value, false);

    case 'datetime':
      return convertDate(value, true);

    case 'enum':
      return convertEnum(value, definition.values);

    case 'uuid':
      return convertUuidValue(value);
  }
}

function convertNumber(value: string): number | null {
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : null;
}

function convertBoolean(value: string): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;

  return null;
}

function convertEnum(value: string, values: string[]): string | null {
  return values.includes(value) ? value : null;
}

function convertUuidValue(value: string): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

function convertDate(value: string, allowTime: boolean): Date | null {
  const dateOnlyMatch = DATE_ONLY.exec(value);

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;

    return buildUtcDate(Number(year), Number(month), Number(day), 0, 0, 0, 0);
  }

  if (allowTime) {
    const dateTimeMatch = DATE_TIME.exec(value);

    if (dateTimeMatch) {
      const [, year, month, day, hour, minute, second, fraction, offset] = dateTimeMatch;
      const millis = fraction ? Math.round(Number(`0.${fraction}`) * 1000) : 0;
      const date = buildUtcDate(Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second), millis);

      if (date === null) {
        return null;
      }

      if (offset && offset !== 'Z') {
        const sign = offset.startsWith('-') ? -1 : 1;
        const [offsetHours = 0, offsetMinutes = 0] = offset.slice(1).split(':').map(Number);

        date.setUTCMinutes(date.getUTCMinutes() - sign * (offsetHours * 60 + offsetMinutes));
      }

      return date;
    }
  }

  return null;
}

function buildUtcDate(year: number, month: number, day: number, hour: number, minute: number, second: number, millis: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return date;
}
