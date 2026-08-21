import type { Operator } from '../ast/types.js';

export type ValidatedValue = string | number | boolean | Date;

// Not "\": MySQL treats it as a string-escape char, breaking the literal there.
export const LIKE_ESCAPE_CHARACTER = '!';

export type ValidatedOperator = Exclude<Operator, ':'> | 'LIKE';

export type FulltextEngine = 'postgres_fulltext';

export type ValidatedField =
  | { alwaysFalse: true }
  | { field: string, value: ValidatedValue, operator: ValidatedOperator, caseSensitive: boolean | 'lower' | 'upper' }
  | { field: string, operator: 'IS NULL' | 'IS NOT NULL' }
  | { field: string, fulltext: FulltextEngine, term: string, language: string };

export interface ValidatedPredicate {
  type: 'predicate';
  fields: ValidatedField[];
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
