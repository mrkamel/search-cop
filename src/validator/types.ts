import type { Operator } from '../ast/types.js';

export type ValidatedValue = string | number | boolean | Date;

// LIKE never comes from the parser — the validator produces it from "=" predicates
// on string attributes whose value contains a "*" wildcard.
export type ValidatedOperator = Operator | 'LIKE';

export interface ValidatedPredicate {
  type: 'predicate';
  /** Always non-empty. More than one entry means the fields are OR'd together. */
  fields: string[];
  operator: ValidatedOperator;
  value: ValidatedValue;
  /** When false, the compiler matches "value" against each field case-insensitively. */
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

export type ValidatedExpression = ValidatedAnd | ValidatedOr | ValidatedPredicate;
