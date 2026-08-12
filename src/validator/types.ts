import type { Operator } from '../ast/types.js';

export type ValidatedValue = string | number | boolean | Date;

// LIKE/NOT LIKE never come from the parser — the validator produces them from
// "=" / "!=" predicates on string attributes whose value contains a "*" wildcard.
export type ValidatedOperator = Operator | 'LIKE' | 'NOT LIKE';

export interface ValidatedPredicate {
  type: 'predicate';
  field: string;
  operator: ValidatedOperator;
  value: ValidatedValue;
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
