import { describe, expect, it } from 'vitest';
import { fuseFulltext } from '../../src/compiler/fulltext.js';
import type { ValidatedExpression, ValidatedField, ValidatedNot, ValidatedPredicate } from '../../src/validator/types.js';

function fulltextField(
  { field, term, wildcard = false, language = 'simple' }: { field: string, term: string, wildcard?: boolean, language?: string },
): ValidatedField {
  return { field, fulltext: 'postgres_fulltext', term, wildcard, language };
}

function fusedField({ field, combinedQuery, language = 'simple' }: { field: string, combinedQuery: string, language?: string }): ValidatedField {
  return { field, fulltext: 'postgres_fulltext', combinedQuery, language };
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
});
