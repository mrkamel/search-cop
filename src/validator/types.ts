import type { Operator } from '../ast/types.js';

export type ValidatedValue = string | number | boolean | Date;

// The character used for a LIKE pattern's ESCAPE clause — shared between the validator
// (which escapes "%"/"_"/this character itself in the raw value) and the compiler (which
// writes the matching "ESCAPE '!'" clause). Deliberately not "\": Postgres and SQLite treat
// backslash as an ordinary character inside a string literal (so `'\'` is one character),
// but MySQL's default sql_mode treats backslash as a string-escape character too, so that
// same `'\'` is parsed as an escaped quote rather than a terminated string — there's no
// single spelling of a backslash-as-escape-char literal that's correct for both. "!" has no
// special meaning in any of the three dialects' string literal syntax, sidestepping the
// whole issue.
export const LIKE_ESCAPE_CHARACTER = '!';

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
