import type { Operator } from '../ast/types.js';

export type ValidatedValue = string | number | boolean | Date;

export interface ValidatedPredicate {
  type: 'predicate';
  field: string;
  operator: Operator;
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
