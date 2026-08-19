// ":" is the bare-colon shorthand ("field:value", and bare "_all" terms) — semantically
// equality, exactly like "=", but tracked separately so the validator can tell whether the
// user wrote an explicit operator (needed for the "wildcards" auto-wildcard option).
export type Operator = ':' | '=' | '>' | '>=' | '<' | '<=';

export interface PredicateExpression {
  type: 'predicate';
  field: string;
  operator: Operator;
  value: string;
  /** Approximate 1-based character offset of this node in the source query, if known. */
  position?: number;
}

export interface AndExpression {
  type: 'and';
  children: Expression[];
}

export interface OrExpression {
  type: 'or';
  children: Expression[];
}

export interface NotExpression {
  type: 'not';
  child: Expression;
}

export type Expression = AndExpression | OrExpression | NotExpression | PredicateExpression;
