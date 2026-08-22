import type { Operator } from '../ast/types.js';

// Not "\": MySQL treats it as a string-escape char, breaking the literal there.
export const LIKE_ESCAPE_CHARACTER = '!';

export type ValidatedValue = string | number | boolean | Date;
export type ValidatedOperator = Exclude<Operator, ':'> | 'LIKE';
export type FulltextEngine = 'postgres_fulltext';

export type ValidatedField =
  | { alwaysFalse: true }
  | { field: string, value: ValidatedValue, operator: ValidatedOperator, caseSensitive: boolean | 'lower' | 'upper' }
  | { field: string, operator: 'IS NULL' | 'IS NOT NULL' }
  | { field: string, fulltext: FulltextEngine, term: string, wildcard: boolean, language: string }
  | { field: string, fulltext: FulltextEngine, combinedQuery: string, language: string }
  ;

export type ValidatedPredicate = {
  type: 'predicate',
  fields: ValidatedField[],
  position?: number,
};

export type ValidatedAnd = {
  type: 'and',
  children: ValidatedExpression[],
};

export type ValidatedOr = {
  type: 'or',
  children: ValidatedExpression[],
};

export type ValidatedNot = {
  type: 'not',
  child: ValidatedExpression,
};

export type ValidatedExpression = ValidatedAnd | ValidatedOr | ValidatedNot | ValidatedPredicate;
