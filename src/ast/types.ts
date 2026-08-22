// ":" is bare-colon shorthand for "=", tracked separately for the "wildcards" option.
export type Operator = ':' | '=' | '>' | '>=' | '<' | '<=';

export type PredicateExpression = {
  type: 'predicate';
  field: string;
  operator: Operator;
  value: string;
  /** Approximate 1-based character offset of this node in the source query, if known. */
  position?: number;
};

export type AndExpression = {
  type: 'and';
  children: Expression[];
}

export type OrExpression = {
  type: 'or';
  children: Expression[];
}

export type NotExpression = {
  type: 'not';
  child: Expression;
}

export type Expression = AndExpression | OrExpression | NotExpression | PredicateExpression;
