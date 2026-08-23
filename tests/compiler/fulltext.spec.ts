import { describe, expect, it } from 'vitest';
import { combineFulltextTerms, fuseFulltext } from '../../src/compiler/fulltext.js';
import type { ValidatedExpression, ValidatedField, ValidatedNot, ValidatedPredicate } from '../../src/validator/types.js';

const DEFAULT_TOKENIZE = (value: string): string[] => value.split(/\s+/).filter((word) => word.length > 0);

function fulltextField(
  { field, term, wildcard = false, phrases = true, language = 'simple' }:
  { field: string, term: string, wildcard?: boolean, phrases?: boolean, language?: string },
): ValidatedField {
  return { field, fulltext: 'to_tsquery', term, wildcard, phrases, language };
}

function fusedField({ field, combinedQuery, language = 'simple' }: { field: string, combinedQuery: string, language?: string }): ValidatedField {
  return { field, fulltext: 'to_tsquery', combinedQuery, language };
}

function predicate(...fields: ValidatedField[]): ValidatedPredicate {
  return { type: 'predicate', fields };
}

function not(child: ValidatedExpression): ValidatedNot {
  return { type: 'not', child };
}

function and(...children: ValidatedExpression[]): ValidatedExpression {
  return { type: 'and', children };
}

function or(...children: ValidatedExpression[]): ValidatedExpression {
  return { type: 'or', children };
}

describe('fuseFulltext: single leaves', () => {
  it('leaves a lone predicate untouched', () => {
    const expression = predicate(fulltextField({ field: '_all', term: 'word1' }));

    expect(fuseFulltext(expression)).toEqual(expression);
  });

  it('leaves a lone negated predicate untouched (nothing to fuse with)', () => {
    const expression = not(predicate(fulltextField({ field: '_all', term: 'word1' })));

    expect(fuseFulltext(expression)).toEqual(expression);
  });
});

describe('fuseFulltext: sibling fusion', () => {
  it('fuses two AND-level sibling terms into one predicate, "&"-joined', () => {
    const expression = and(
      predicate(fulltextField({ field: '_all', term: 'word1' })),
      predicate(fulltextField({ field: '_all', term: 'word2' })),
    );

    expect(fuseFulltext(expression)).toEqual(and(predicate(fusedField({ field: '_all', combinedQuery: `'word1' & 'word2'` }))));
  });

  it('fuses OR-level sibling terms, joined with "|"', () => {
    const expression = or(
      predicate(fulltextField({ field: '_all', term: 'word1' })),
      predicate(fulltextField({ field: '_all', term: 'word2' })),
    );

    expect(fuseFulltext(expression)).toEqual(or(predicate(fusedField({ field: '_all', combinedQuery: `'word1' | 'word2'` }))));
  });

  it('fuses a NOT-wrapped single leaf into a "!"-prefixed term', () => {
    const expression = and(
      predicate(fulltextField({ field: '_all', term: 'word1' })),
      not(predicate(fulltextField({ field: '_all', term: 'word2' }))),
    );

    expect(fuseFulltext(expression)).toEqual(and(predicate(fusedField({ field: '_all', combinedQuery: `'word1' & !'word2'` }))));
  });

  it('fuses three or more siblings in their original order', () => {
    const expression = and(
      predicate(fulltextField({ field: '_all', term: 'word1' })),
      predicate(fulltextField({ field: '_all', term: 'word2' })),
      not(predicate(fulltextField({ field: '_all', term: 'word3' }))),
    );

    expect(fuseFulltext(expression)).toEqual(and(predicate(fusedField({ field: '_all', combinedQuery: `'word1' & 'word2' & !'word3'` }))));
  });

  it('appends ":*" only to a wildcarded term when fusing with a plain one', () => {
    const expression = and(
      predicate(fulltextField({ field: '_all', term: 'word1', wildcard: true })),
      predicate(fulltextField({ field: '_all', term: 'word2' })),
    );

    expect(fuseFulltext(expression)).toEqual(and(predicate(fusedField({ field: '_all', combinedQuery: `'word1':* & 'word2'` }))));
  });

  it('appends ":*" to a NOT-wrapped wildcarded single leaf, after the "!"', () => {
    const expression = and(
      predicate(fulltextField({ field: '_all', term: 'word1' })),
      not(predicate(fulltextField({ field: '_all', term: 'word2', wildcard: true }))),
    );

    expect(fuseFulltext(expression)).toEqual(and(predicate(fusedField({ field: '_all', combinedQuery: `'word1' & !'word2':*` }))));
  });

  it('quotes a multi-word term as a single lexeme (Postgres tokenizes it into a phrase on its own)', () => {
    const expression = and(
      predicate(fulltextField({ field: '_all', term: 'red shoes' })),
      predicate(fulltextField({ field: '_all', term: 'word2' })),
    );

    expect(fuseFulltext(expression)).toEqual(and(predicate(fusedField({ field: '_all', combinedQuery: `'red shoes' & 'word2'` }))));
  });

  it('doubles an embedded single quote in a term before quoting it', () => {
    const expression = and(
      predicate(fulltextField({ field: '_all', term: "foo 'bar' baz" })),
      predicate(fulltextField({ field: '_all', term: 'word2' })),
    );

    expect(fuseFulltext(expression)).toEqual(and(predicate(fusedField({ field: '_all', combinedQuery: `'foo ''bar'' baz' & 'word2'` }))));
  });

  it('fuses per field position across multi-field fulltext siblings', () => {
    const expression = and(
      predicate(fulltextField({ field: 'vec1', term: 'word1' }), fulltextField({ field: 'vec2', term: 'worda' })),
      predicate(fulltextField({ field: 'vec1', term: 'word2' }), fulltextField({ field: 'vec2', term: 'wordb' })),
    );

    expect(fuseFulltext(expression)).toEqual(
      and(predicate(
        fusedField({ field: 'vec1', combinedQuery: `'word1' & 'word2'` }),
        fusedField({ field: 'vec2', combinedQuery: `'worda' & 'wordb'` }),
      )),
    );
  });
});

describe('fuseFulltext: fusion boundaries', () => {
  it('does not fuse a fulltext leaf with a non-fulltext sibling', () => {
    const statusField: ValidatedField = { field: 'status', value: 'online', operator: '=', caseSensitive: true };
    const expression = and(predicate(fulltextField({ field: '_all', term: 'word1' })), predicate(statusField));

    expect(fuseFulltext(expression)).toEqual(expression);
  });

  it('does not fuse leaves that target different fields', () => {
    const expression = and(
      predicate(fulltextField({ field: 'a', term: 'word1' })),
      predicate(fulltextField({ field: 'b', term: 'word2' })),
    );

    expect(fuseFulltext(expression)).toEqual(expression);
  });

  it('does not fuse leaves using different languages, even on the same field', () => {
    const expression = and(
      predicate(fulltextField({ field: '_all', term: 'word1', language: 'english' })),
      predicate(fulltextField({ field: '_all', term: 'word2', language: 'simple' })),
    );

    expect(fuseFulltext(expression)).toEqual(expression);
  });

  it('does not fuse leaves using different "phrases" settings, even on the same field', () => {
    const expression = and(
      predicate(fulltextField({ field: '_all', term: 'word1', phrases: true })),
      predicate(fulltextField({ field: '_all', term: 'word2', phrases: false })),
    );

    expect(fuseFulltext(expression)).toEqual(expression);
  });

  it('does not push a NOT wrapping a multi-field predicate down into its fields', () => {
    const grouped = predicate(fulltextField({ field: 'vec1', term: 'x' }), fulltextField({ field: 'vec2', term: 'y' }));
    const expression = and(predicate(fulltextField({ field: '_all', term: 'word1' })), not(grouped));

    expect(fuseFulltext(expression)).toEqual(expression);
  });

  it('does not fuse a NOT wrapping a compound group', () => {
    const expression = and(
      predicate(fulltextField({ field: '_all', term: 'word1' })),
      not(or(predicate(fulltextField({ field: '_all', term: 'word2' })), predicate(fulltextField({ field: '_all', term: 'word3' })))),
    );

    expect(fuseFulltext(expression)).toEqual(
      and(
        predicate(fulltextField({ field: '_all', term: 'word1' })),
        not(or(predicate(fusedField({ field: '_all', combinedQuery: `'word2' | 'word3'` })))),
      ),
    );
  });
});

describe('fuseFulltext: recursion into nested groups', () => {
  it('fuses within a nested OR group, leaving the outer AND structure intact', () => {
    const statusField: ValidatedField = { field: 'status', value: 'online', operator: '=', caseSensitive: true };
    const expression = and(
      or(predicate(fulltextField({ field: '_all', term: 'word1' })), predicate(fulltextField({ field: '_all', term: 'word2' }))),
      predicate(statusField),
    );

    expect(fuseFulltext(expression)).toEqual(
      and(or(predicate(fusedField({ field: '_all', combinedQuery: `'word1' | 'word2'` }))), predicate(statusField)),
    );
  });

  it('fuses within a NOT-wrapped compound group without pushing the negation through', () => {
    const expression = not(
      and(predicate(fulltextField({ field: '_all', term: 'word1' })), predicate(fulltextField({ field: '_all', term: 'word2' }))),
    );

    expect(fuseFulltext(expression)).toEqual(not(and(predicate(fusedField({ field: '_all', combinedQuery: `'word1' & 'word2'` })))));
  });

  it('folds an already-fused nested AND group into an enclosing OR as one predicate', () => {
    const expression = or(
      and(predicate(fulltextField({ field: '_all', term: 'word1' })), predicate(fulltextField({ field: '_all', term: 'word2' }))),
      predicate(fulltextField({ field: '_all', term: 'word3' })),
    );

    expect(fuseFulltext(expression)).toEqual(
      or(predicate(fusedField({ field: '_all', combinedQuery: `('word1' & 'word2') | 'word3'` }))),
    );
  });

  it('folds an already-fused nested OR group into an enclosing AND as one predicate', () => {
    const expression = and(
      or(predicate(fulltextField({ field: '_all', term: 'word1' })), predicate(fulltextField({ field: '_all', term: 'word2' }))),
      predicate(fulltextField({ field: '_all', term: 'word3' })),
    );

    expect(fuseFulltext(expression)).toEqual(
      and(predicate(fusedField({ field: '_all', combinedQuery: `('word1' | 'word2') & 'word3'` }))),
    );
  });

  it('does not fold a nested group into an enclosing combinator when a sibling inside it is non-fulltext', () => {
    // word1 AND word2 OR (word3 AND status:online)
    const statusField: ValidatedField = { field: 'status', value: 'online', operator: '=', caseSensitive: true };

    const expression = or(
      and(predicate(fulltextField({ field: '_all', term: 'word1' })), predicate(fulltextField({ field: '_all', term: 'word2' }))),
      and(predicate(fulltextField({ field: '_all', term: 'word3' })), predicate(statusField)),
    );

    expect(fuseFulltext(expression)).toEqual(
      or(
        and(predicate(fusedField({ field: '_all', combinedQuery: `'word1' & 'word2'` }))),
        and(predicate(fulltextField({ field: '_all', term: 'word3' })), predicate(statusField)),
      ),
    );
  });

  it('does not fold a nested group into an enclosing combinator when the fields differ', () => {
    const expression = or(
      and(predicate(fulltextField({ field: 'a', term: 'word1' })), predicate(fulltextField({ field: 'a', term: 'word2' }))),
      predicate(fulltextField({ field: 'b', term: 'word3' })),
    );

    expect(fuseFulltext(expression)).toEqual(
      or(
        and(predicate(fusedField({ field: 'a', combinedQuery: `'word1' & 'word2'` }))),
        predicate(fulltextField({ field: 'b', term: 'word3' })),
      ),
    );
  });
});

describe('combineFulltextTerms: "to_tsquery" dialect', () => {
  it('joins a multi-word wildcarded value with "<->" by default (phrases: true)', () => {
    const query = combineFulltextTerms({
      engine: 'to_tsquery',
      combinator: 'and',
      phrases: true,
      terms: [{ value: 'foo bar', wildcard: true, negated: false }],
    });

    expect(query).toBe(`'foo' <-> 'bar':*`);
  });

  it('joins with "&" instead when "phrases: false"', () => {
    const query = combineFulltextTerms({
      engine: 'to_tsquery',
      combinator: 'and',
      phrases: false,
      terms: [{ value: 'foo bar', wildcard: true, negated: false }],
    });

    expect(query).toBe(`'foo' & 'bar':*`);
  });
});

describe('combineFulltextTerms: "tsquery" dialect', () => {
  it('quotes a single-token term as one literal lexeme', () => {
    const query = combineFulltextTerms({
      engine: 'tsquery',
      combinator: 'and',
      phrases: false,
      tokenize: DEFAULT_TOKENIZE,
      terms: [{ value: 'foo:bar', wildcard: false, negated: false }],
    });

    expect(query).toBe(`'foo:bar'`);
  });

  it('tokenizes a multi-word term and joins with "&" by default, not "<->"', () => {
    const query = combineFulltextTerms({
      engine: 'tsquery',
      combinator: 'and',
      phrases: false,
      tokenize: DEFAULT_TOKENIZE,
      terms: [{ value: 'foo bar', wildcard: false, negated: false }],
    });

    expect(query).toBe(`'foo' & 'bar'`);
  });

  it('joins with "<->" instead when "phrases: true"', () => {
    const query = combineFulltextTerms({
      engine: 'tsquery',
      combinator: 'and',
      phrases: true,
      tokenize: DEFAULT_TOKENIZE,
      terms: [{ value: 'foo bar', wildcard: false, negated: false }],
    });

    expect(query).toBe(`'foo' <-> 'bar'`);
  });

  it('appends ":*" only to the last token of a wildcarded multi-word term', () => {
    const query = combineFulltextTerms({
      engine: 'tsquery',
      combinator: 'and',
      phrases: false,
      tokenize: DEFAULT_TOKENIZE,
      terms: [{ value: 'foo bar', wildcard: true, negated: false }],
    });

    expect(query).toBe(`'foo' & 'bar':*`);
  });

  it('prefixes a negated term with "!"', () => {
    const query = combineFulltextTerms({
      engine: 'tsquery',
      combinator: 'and',
      phrases: false,
      tokenize: DEFAULT_TOKENIZE,
      terms: [{ value: 'foo', wildcard: false, negated: true }],
    });

    expect(query).toBe(`!'foo'`);
  });

  it('fuses several sibling terms with "&"/"|", independent of the per-term join', () => {
    const andQuery = combineFulltextTerms({
      engine: 'tsquery',
      combinator: 'and',
      phrases: false,
      tokenize: DEFAULT_TOKENIZE,
      terms: [
        { value: 'foo', wildcard: false, negated: false },
        { value: 'bar', wildcard: false, negated: true },
      ],
    });

    const orQuery = combineFulltextTerms({
      engine: 'tsquery',
      combinator: 'or',
      phrases: false,
      tokenize: DEFAULT_TOKENIZE,
      terms: [
        { value: 'foo', wildcard: false, negated: false },
        { value: 'bar', wildcard: false, negated: false },
      ],
    });

    expect(andQuery).toBe(`'foo' & !'bar'`);
    expect(orQuery).toBe(`'foo' | 'bar'`);
  });

  it('uses a custom "tokenize" function instead of splitting on whitespace', () => {
    const query = combineFulltextTerms({
      engine: 'tsquery',
      combinator: 'and',
      phrases: false,
      tokenize: (value) => value.split(','),
      terms: [{ value: 'foo,bar', wildcard: false, negated: false }],
    });

    expect(query).toBe(`'foo' & 'bar'`);
  });
});
