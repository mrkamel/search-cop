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

// ":" (bare-colon) and "=" (explicit) are both equality — used wherever code cares about
// "is this an equality predicate", as opposed to distinguishing the two forms themselves
// (only the "wildcards" auto-wildcard option cares about that distinction).
function isEqualityOperator(operator: Operator): boolean {
  return operator === ':' || operator === '=';
}

// "false" is shorthand for "'lower'" — both mean the same fold function, "false" is just
// the pre-existing boolean spelling kept for backward compatibility.
function foldCase(value: string, caseSensitive: boolean | 'lower' | 'upper'): string {
  if (caseSensitive === true) return value;

  return caseSensitive === 'upper' ? value.toUpperCase() : value.toLowerCase();
}

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
    // "_all" is opt-in (see DEFAULT_FIELD) — a bare term against it is never a user typo the
    // way any other undeclared field is, so it degrades to "never matches" instead of erroring.
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

  // A "*" is only ever wildcard syntax for a "string"-typed field — otherwise it's just a
  // literal character (see resolveField). A field-level type override has its own
  // effective type, independent of the outer attribute, so this checks every entry rather
  // than just the outer attribute's own type.
  const hasLiteralWildcard = predicate.value.includes('*');
  const usesWildcardSyntax = hasLiteralWildcard && entries.some((entry) => effectiveType(entry, attribute) === 'string');

  if (usesWildcardSyntax && !isEqualityOperator(predicate.operator)) {
    throw new SearchCopError(
      'INVALID_OPERATOR',
      `Wildcards ("*") are only supported with "=", got "${predicate.operator}" for attribute "${predicate.field}".`,
      predicate.position,
    );
  }

  return {
    type: 'predicate',
    fields: entries.map((entry) => resolveField(entry, predicate, attribute, hasLiteralWildcard)),
    position: predicate.position,
  };
}

function effectiveType(entry: AttributeField, attribute: AttributeDefinition): AttributeDefinition['type'] {
  return typeof entry === 'string' ? attribute.type : entry.type;
}

function resolveField(
  entry: AttributeField,
  predicate: PredicateExpression,
  attribute: AttributeDefinition,
  hasLiteralWildcard: boolean,
): ValidatedField {
  if (typeof entry === 'string') {
    return resolveColumn(entry, predicate, attribute, hasLiteralWildcard && attribute.type === 'string');
  }

  // Field-level type override: validated independently against its own declared type,
  // ignoring the outer attribute entirely. A wildcard only carries over if this field
  // is itself "string" — every other type simply can't match a wildcarded value.
  const { field, ...definition } = entry;

  return resolveColumn(field, predicate, definition, hasLiteralWildcard && definition.type === 'string');
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
):
  | { value: ValidatedValue; operator: ValidatedOperator; caseSensitive: boolean | 'lower' | 'upper' }
  | { operator: 'IS NULL' | 'IS NOT NULL' }
  | null {
  // This field's own "caseSensitive" — independent of any other field in the same
  // predicate, since a field-level type override can declare its own.
  const caseSensitive = definition.type === 'string' ? definition.caseSensitive ?? true : true;

  // "wildcards"/"leftWildcard"/"rightWildcard" implicitly wrap a bare-colon "=" value with
  // "*" on one or both sides, as if the caller had written it themselves — but only when
  // they didn't already write an explicit "*" (isWildcard) or an explicit "=" (only ":"
  // opts in to this). "wildcards: true" is shorthand for both sides at once.
  const canAutoWildcard = definition.type === 'string' && operator === ':' && !isWildcard;
  const autoLeftWildcard = canAutoWildcard && (definition.wildcards === true || definition.leftWildcard === true);
  const autoRightWildcard = canAutoWildcard && (definition.wildcards === true || definition.rightWildcard === true);

  if (isWildcard || autoLeftWildcard || autoRightWildcard) {
    const pattern = toLikePattern(rawValue, autoLeftWildcard, autoRightWildcard);

    return { value: foldCase(pattern, caseSensitive), operator: 'LIKE', caseSensitive };
  }

  // Applies to every type, including a field-level override whose own type differs from
  // the outer attribute's — the outer predicate's operator was only validated against the
  // outer attribute's type, not this (possibly stricter) override's.
  if (!OPERATORS_BY_TYPE[definition.type].includes(operator)) {
    return null;
  }

  if (definition.type === 'null') {
    return resolveNull(rawValue, definition);
  }

  const value = convertValue(rawValue, definition);

  // ":" is never valid SQL — normalize it to "=" now that we're producing an actual
  // comparison (see ValidatedOperator).
  return value === null ? null : { value, operator: operator === ':' ? '=' : operator, caseSensitive };
}

// Escapes existing occurrences of the LIKE escape character itself (see
// LIKE_ESCAPE_CHARACTER), "%", and "_" so they match literally, then turns the DSL's "*"
// wildcard into the LIKE wildcard "%". Order matters: escaping runs first so the "%"
// introduced by "*" is never itself escaped. "leftWildcard"/"rightWildcard" (mirroring the
// attribute options of the same name, and only ever with no explicit "*" already in
// "value") additionally prefix/append a "%" — an implicit ends-with/starts-with/contains match.
function toLikePattern(value: string, leftWildcard: boolean, rightWildcard: boolean): string {
  const escaped = value
    .replace(new RegExp(`[${LIKE_ESCAPE_CHARACTER}%_]`, 'g'), (char) => `${LIKE_ESCAPE_CHARACTER}${char}`)
    .replace(/\*/g, '%');

  const prefixed = leftWildcard ? `%${escaped}` : escaped;

  return rightWildcard ? `${prefixed}%` : prefixed;
}

function resolveNull(rawValue: string, definition: NullAttributeDefinition): { operator: 'IS NULL' | 'IS NOT NULL' } | null {
  if (definition.isNull.includes(rawValue)) return { operator: 'IS NULL' };
  if (definition.isNotNull.includes(rawValue)) return { operator: 'IS NOT NULL' };

  return null;
}

function convertValue(value: string, definition: Exclude<AttributeDefinition, NullAttributeDefinition>): ValidatedValue | null {
  switch (definition.type) {
    case 'string':
      return foldCase(value, definition.caseSensitive ?? true);

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
