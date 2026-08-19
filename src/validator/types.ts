import type { Operator } from '../ast/types.js';

export type ValidatedValue = string | number | boolean | Date;

// LIKE never comes from the parser — the validator produces it from "=" predicates
// on string attributes whose value contains a "*" wildcard. ":" (the bare-colon shorthand,
// see ast/types.ts) is always normalized to "=" by the validator — it's not valid SQL, and
// carries no meaning beyond "the user didn't write an explicit operator".
export type ValidatedOperator = Exclude<Operator, ':'> | 'LIKE';

// A value that doesn't fit its (possibly field-overridden) type never errors — it
// simply can never match, compiling to an unconditionally false condition instead
// of a real comparison. "field" is inserted into the SQL verbatim — see AttributeField.
//
// "caseSensitive" lives on each field individually, not on the predicate as a whole:
// a field-level type override can declare its own "caseSensitive", independent of the
// outer attribute's, so a single shared value wouldn't be correct for every field in a
// multi-field predicate. When not `true`, the compiler folds the column through `LOWER()`
// (`false`/`'lower'`) or `UPPER()` (`'upper'`) — see StringAttributeDefinition.caseSensitive.
export type ValidatedField =
  | { alwaysFalse: true }
  | { field: string, value: ValidatedValue, operator: ValidatedOperator, caseSensitive: boolean | 'lower' | 'upper' }
  // "null" attributes: an existence check, not a value comparison — no parameter is bound,
  // and no case folding applies.
  | { field: string, operator: 'IS NULL' | 'IS NOT NULL' };

export interface ValidatedPredicate {
  type: 'predicate';
  /** Always non-empty. More than one entry means the fields are OR'd together. */
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
