import { validate as isUuid } from 'uuid';
import type { Expression, Operator, PredicateExpression } from '../ast/types.js';
import type { AttributeDefinition, AttributeField, AttributeMap, NullAttributeDefinition } from '../attributes/types.js';
import { LIKE_ESCAPE_CHARACTER } from './types.js';
import type { ValidatedExpression, ValidatedField, ValidatedOperator, ValidatedPredicate, ValidatedValue } from './types.js';
import { SearchCopError } from '../errors/errors.js';
import { DEFAULT_FIELD } from '../parser/parser.js';

const OPERATORS_BY_TYPE: Record<AttributeDefinition['type'], Operator[]> = {
  string: [':', '=', '>', '>=', '<', '<='],
  number: [':', '=', '>', '>=', '<', '<='],
  boolean: [':', '='],
  date: [':', '=', '>', '>=', '<', '<='],
  datetime: [':', '=', '>', '>=', '<', '<='],
  enum: [':', '='],
  uuid: [':', '='],
  null: [':', '='],
};

function isEqualityOperator(operator: Operator): boolean {
  return operator === ':' || operator === '=';
}

// "false" and "'lower'" are the same fold function; "false" is kept for compatibility.
function foldCase({ value, caseSensitive }: { value: string, caseSensitive: boolean | 'lower' | 'upper' }): string {
  if (caseSensitive === true) return value;

  return caseSensitive === 'upper' ? value.toUpperCase() : value.toLowerCase();
}

// Dates with no explicit offset are interpreted as UTC, not local time.
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/;

export function validate({ expression, attributes }: { expression: Expression, attributes: AttributeMap }): ValidatedExpression {
  switch (expression.type) {
    case 'and':
      return { type: 'and', children: expression.children.map((child) => validate({ expression: child, attributes })) };

    case 'or':
      return { type: 'or', children: expression.children.map((child) => validate({ expression: child, attributes })) };

    case 'not':
      return { type: 'not', child: validate({ expression: expression.child, attributes }) };

    case 'predicate':
      return validatePredicate({ predicate: expression, attributes });
  }
}

function validatePredicate({ predicate, attributes }: { predicate: PredicateExpression, attributes: AttributeMap }): ValidatedPredicate {
  const attribute = attributes[predicate.field];

  if (!Object.hasOwn(attributes, predicate.field) || !attribute) {
    if (predicate.field === DEFAULT_FIELD) {
      return { type: 'predicate', fields: [{ alwaysFalse: true }], position: predicate.position };
    }

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

  if (attribute.fields?.length && attribute.fields.length > 1 && !isEqualityOperator(predicate.operator)) {
    throw new SearchCopError(
      'INVALID_OPERATOR',
      `Multi-field attributes only support "=", got "${predicate.operator}" for attribute "${predicate.field}".`,
      predicate.position,
    );
  }

  const entries = attribute.fields?.length ? attribute.fields : [predicate.field];

  return {
    type: 'predicate',
    fields: entries.map((entry) => resolveField({ entry, predicate, attribute })),
    position: predicate.position,
  };
}

function hasWildcard(value: string): boolean {
  let found = false;

  value.replace(/\\.|\*/g, (match) => {
    if (match === '*') found = true;

    return match;
  });

  return found;
}

function resolveField(
  { entry, predicate, attribute }:
  { entry: AttributeField, predicate: PredicateExpression, attribute: AttributeDefinition }
): ValidatedField {

  if (typeof entry === 'string') {
    return resolveColumn({ field: entry, predicate, definition: attribute });
  }

  const { field, ...definition } = entry;

  return resolveColumn({ field, predicate, definition });
}

function resolveColumn(
  { field, predicate, definition }:
  { field: string, predicate: PredicateExpression, definition: AttributeDefinition }
): ValidatedField {
  const resolved = resolveValue({ predicate, definition });

  return resolved === null ? { alwaysFalse: true } : { field, ...resolved };
}

function resolveValue(
  { predicate, definition }:
  { predicate: PredicateExpression, definition: AttributeDefinition }
):
  | { value: ValidatedValue; operator: ValidatedOperator; caseSensitive: boolean | 'lower' | 'upper' }
  | { operator: 'IS NULL' | 'IS NOT NULL' }
  | null {
  const { value: rawValue, operator } = predicate;

  const caseSensitive = definition.type === 'string' ? definition.caseSensitive ?? true : true;

  if (definition.type === 'string' && operator === ':') {
    const pattern = toLikePattern({
      value: rawValue,
      leftWildcard: definition.wildcards === true || definition.leftWildcard === true,
      rightWildcard: definition.wildcards === true || definition.rightWildcard === true,
      predicate,
    });

    return { value: foldCase({ value: pattern, caseSensitive }), operator: 'LIKE', caseSensitive };
  }

  // A field-level override may declare a stricter type than the outer attribute, whose
  // operator was only validated against the outer type.
  if (!OPERATORS_BY_TYPE[definition.type].includes(operator)) {
    return null;
  }

  if (definition.type === 'null') {
    return resolveNull(rawValue, definition);
  }

  const value = convertValue(rawValue, definition);

  return value === null ? null : { value, operator: operator === ':' ? '=' : operator, caseSensitive };
}

// "*" -> "%", "\*" -> a literal "*", everything else untouched. A bare "*" not at the
// start/end of "value" is a malformed wildcard attempt and throws.
function replaceWildcards({ value, predicate }: { value: string, predicate: PredicateExpression }): string {
  return value.replace(/\\.|\*/g, (match, offset: number, fullString: string) => {
    if (match === '*' && offset !== 0 && offset !== fullString.length - 1) {
      throw new SearchCopError(
        'INVALID_WILDCARD',
        `"*" is only valid at the start and/or end of a value, got "${value}" for attribute "${predicate.field}".`,
        predicate.position,
      );
    }

    if (match === '*') return '%';
    if (match === '\\*') return '*';

    return match;
  });
}

function toLikePattern(
  { value, leftWildcard, rightWildcard, predicate }:
  { value: string, leftWildcard: boolean, rightWildcard: boolean, predicate: PredicateExpression }
): string {
  const escaped = value.replace(new RegExp(`[${LIKE_ESCAPE_CHARACTER}%_]`, 'g'), (char) => `${LIKE_ESCAPE_CHARACTER}${char}`);
  const resolved = replaceWildcards({ value: escaped, predicate });

  if (hasWildcard(escaped)) return resolved;

  return `${leftWildcard ? '%' : ''}${resolved}${rightWildcard ? '%' : ''}`;
}

function resolveNull(rawValue: string, definition: NullAttributeDefinition): { operator: 'IS NULL' | 'IS NOT NULL' } | null {
  if (definition.isNull.includes(rawValue)) return { operator: 'IS NULL' };
  if (definition.isNotNull.includes(rawValue)) return { operator: 'IS NOT NULL' };

  return null;
}

function convertValue(value: string, definition: Exclude<AttributeDefinition, NullAttributeDefinition>): ValidatedValue | null {
  switch (definition.type) {
    case 'string':
      return foldCase({ value, caseSensitive: definition.caseSensitive ?? true });

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

function convertEnum(value: string, values: string[] | Record<string, string>): string | null {
  if (Array.isArray(values)) {
    return values.includes(value) ? value : null;
  }

  return Object.hasOwn(values, value) ? values[value] ?? null : null;
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
