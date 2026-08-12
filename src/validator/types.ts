import type { Operator } from '../ast/types.js';

export type ValidatedValue = string | number | boolean | Date;

// LIKE never comes from the parser — the validator produces it from "=" predicates
// on string attributes whose value contains a "*" wildcard.
export type ValidatedOperator = Operator | 'LIKE';

// A value that doesn't fit its (possibly field-overridden) type never errors — it
// simply can never match, compiling to an unconditionally false condition instead
// of a real comparison.
export type ValidatedField =
  | { alwaysFalse: true }
  | { field: string; value: ValidatedValue; operator: ValidatedOperator }
  | { raw: string; value: ValidatedValue; operator: ValidatedOperator };

export interface ValidatedPredicate {
  type: 'predicate';
  /** Always non-empty. More than one entry means the fields are OR'd together. */
  fields: ValidatedField[];
  /** When false, the compiler matches each field's value case-insensitively. */
  caseSensitive: boolean;
  position?: number;
}

export interface ValidatedAnd {
  type: 'and';
  children: ValidatedExpression[];
}

export interface ValidatedOr {
  type: 'or';
  children: ValidatedExpression[];
}

export interface ValidatedNot {
  type: 'not';
  child: ValidatedExpression;
}

export type ValidatedExpression = ValidatedAnd | ValidatedOr | ValidatedNot | ValidatedPredicate;
