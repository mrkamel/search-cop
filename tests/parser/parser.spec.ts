import { describe, expect, it } from 'vitest';
import { parse } from '../../src/parser/parser.js';
import { SearchCopError } from '../../src/errors/errors.js';
import { tryCatch } from '../../src/utils/tryCatch.js';
import type { PredicateExpression } from '../../src/ast/types.js';

function predicate(field: string, operator: string, value: string): PredicateExpression {
  return { type: 'predicate', field, operator: operator as PredicateExpression['operator'], value };
}

function stripPosition(expression: unknown): unknown {
  return JSON.parse(JSON.stringify(expression), (key, value) => (key === 'position' ? undefined : value));
}

describe('parse: operators', () => {
  it('treats ":" as equality', () => {
    expect(stripPosition(parse('status:online'))).toEqual(predicate('status', ':', 'online'));
  });

  it('parses explicit equality', () => {
    expect(stripPosition(parse('status:=online'))).toEqual(predicate('status', '=', 'online'));
  });

  it('parses ">"', () => {
    expect(stripPosition(parse('price:>100'))).toEqual(predicate('price', '>', '100'));
  });

  it('parses ">="', () => {
    expect(stripPosition(parse('price:>=100'))).toEqual(predicate('price', '>=', '100'));
  });

  it('parses "<"', () => {
    expect(stripPosition(parse('price:<100'))).toEqual(predicate('price', '<', '100'));
  });

  it('parses "<="', () => {
    expect(stripPosition(parse('price:<=100'))).toEqual(predicate('price', '<=', '100'));
  });

  it('parses date-like values', () => {
    expect(stripPosition(parse('createdAt:>=2026-01-01'))).toEqual(predicate('createdAt', '>=', '2026-01-01'));
  });

  it('does not recognize "!=" as an operator: "!" is treated as a plain value character', () => {
    expect(stripPosition(parse('status:!=offline'))).toEqual(predicate('status', ':', '!=offline'));
  });

  it('parses "*" as a plain value character (wildcard interpretation happens during validation)', () => {
    expect(stripPosition(parse('name:Pet*'))).toEqual(predicate('name', ':', 'Pet*'));
    expect(stripPosition(parse('name:*fred'))).toEqual(predicate('name', ':', '*fred'));
  });
});

describe('parse: quoted values', () => {
  it('parses a quoted value containing whitespace', () => {
    expect(stripPosition(parse('first_name:"foo bar"'))).toEqual(predicate('first_name', ':', 'foo bar'));
  });

  it('parses a quoted value containing parentheses', () => {
    expect(stripPosition(parse('name:"(foo)"'))).toEqual(predicate('name', ':', '(foo)'));
  });

  it('parses an empty quoted value', () => {
    expect(stripPosition(parse('name:""'))).toEqual(predicate('name', ':', ''));
  });

  it('unescapes \\" to a literal quote', () => {
    expect(stripPosition(parse('name:"foo \\"bar\\" baz"'))).toEqual(predicate('name', ':', 'foo "bar" baz'));
  });

  it('unescapes \\\\ to a literal backslash', () => {
    expect(stripPosition(parse('name:"back\\\\slash"'))).toEqual(predicate('name', ':', 'back\\slash'));
  });

  it('combines quoted predicates with AND/OR, including implicit AND', () => {
    expect(stripPosition(parse('is_active:false OR first_name:"foo bar"'))).toEqual({
      type: 'or',
      children: [predicate('is_active', ':', 'false'), predicate('first_name', ':', 'foo bar')],
    });

    expect(stripPosition(parse('first_name:"foo bar" status:online'))).toEqual({
      type: 'and',
      children: [predicate('first_name', ':', 'foo bar'), predicate('status', ':', 'online')],
    });
  });

  it('falls back to an unquoted value when the closing quote is missing', () => {
    expect(stripPosition(parse('name:"unterminated'))).toEqual(predicate('name', ':', '"unterminated'));
  });
});

describe('parse: boolean expressions', () => {
  it('parses AND', () => {
    expect(stripPosition(parse('status:online AND price:>100'))).toEqual({
      type: 'and',
      children: [predicate('status', ':', 'online'), predicate('price', '>', '100')],
    });
  });

  it('treats juxtaposition (no explicit operator) as implicit AND', () => {
    expect(stripPosition(parse('status:online price:>100'))).toEqual({
      type: 'and',
      children: [predicate('status', ':', 'online'), predicate('price', '>', '100')],
    });
  });

  it('mixes implicit and explicit AND', () => {
    expect(stripPosition(parse('status:a status:b AND status:c'))).toEqual({
      type: 'and',
      children: [predicate('status', ':', 'a'), predicate('status', ':', 'b'), predicate('status', ':', 'c')],
    });
  });

  it('gives implicit AND the same precedence as explicit AND: "A B OR C" = "(A AND B) OR C"', () => {
    expect(stripPosition(parse('status:a status:b OR status:c'))).toEqual({
      type: 'or',
      children: [
        {
          type: 'and',
          children: [predicate('status', ':', 'a'), predicate('status', ':', 'b')],
        },
        predicate('status', ':', 'c'),
      ],
    });
  });

  it('parses OR', () => {
    expect(stripPosition(parse('status:online OR status:pending'))).toEqual({
      type: 'or',
      children: [predicate('status', ':', 'online'), predicate('status', ':', 'pending')],
    });
  });

  it('gives AND higher precedence than OR: "A OR B AND C" = "A OR (B AND C)"', () => {
    expect(stripPosition(parse('status:a OR status:b AND status:c'))).toEqual({
      type: 'or',
      children: [
        predicate('status', ':', 'a'),
        {
          type: 'and',
          children: [predicate('status', ':', 'b'), predicate('status', ':', 'c')],
        },
      ],
    });
  });

  it('lets parentheses override precedence: "(A OR B) AND C"', () => {
    expect(stripPosition(parse('(status:a OR status:b) AND status:c'))).toEqual({
      type: 'and',
      children: [
        {
          type: 'or',
          children: [predicate('status', ':', 'a'), predicate('status', ':', 'b')],
        },
        predicate('status', ':', 'c'),
      ],
    });
  });

  it('parses "A AND (B OR C)"', () => {
    expect(stripPosition(parse('status:a AND (status:b OR status:c)'))).toEqual({
      type: 'and',
      children: [
        predicate('status', ':', 'a'),
        {
          type: 'or',
          children: [predicate('status', ':', 'b'), predicate('status', ':', 'c')],
        },
      ],
    });
  });

  it('never treats lowercase "and"/"or" as connectors (case-sensitive grammar) — bare words, they are literal "_all" terms', () => {
    expect(stripPosition(parse('status:a and status:b'))).toEqual({
      type: 'and',
      children: [predicate('status', ':', 'a'), predicate('_all', ':', 'and'), predicate('status', ':', 'b')],
    });

    expect(stripPosition(parse('status:a or status:b'))).toEqual({
      type: 'and',
      children: [predicate('status', ':', 'a'), predicate('_all', ':', 'or'), predicate('status', ':', 'b')],
    });
  });
});

describe('parse: negation (NOT)', () => {
  it('negates a predicate', () => {
    expect(stripPosition(parse('NOT status:online'))).toEqual({ type: 'not', child: predicate('status', ':', 'online') });
  });

  it('negates a predicate with no space before "("', () => {
    expect(stripPosition(parse('NOT(status:online)'))).toEqual({ type: 'not', child: predicate('status', ':', 'online') });
  });

  it('does not split "NOT" from an immediately-following field name', () => {
    expect(stripPosition(parse('NOTstatus:online'))).toEqual(predicate('NOTstatus', ':', 'online'));
    expect(stripPosition(parse('NOTABLE:foo'))).toEqual(predicate('NOTABLE', ':', 'foo'));
  });

  it('binds tighter than AND — negates only the next term, not the rest of the expression', () => {
    expect(stripPosition(parse('NOT status:online AND price:>100'))).toEqual({
      type: 'and',
      children: [{ type: 'not', child: predicate('status', ':', 'online') }, predicate('price', '>', '100')],
    });
  });

  it('negates the whole parenthesized group when explicitly grouped', () => {
    expect(stripPosition(parse('NOT (status:online OR status:pending)'))).toEqual({
      type: 'not',
      child: {
        type: 'or',
        children: [predicate('status', ':', 'online'), predicate('status', ':', 'pending')],
      },
    });
  });

  it('negates just the next bare term amid implicit AND, not the whole phrase', () => {
    expect(stripPosition(parse('red NOT blue'))).toEqual({
      type: 'and',
      children: [predicate('_all', ':', 'red'), { type: 'not', child: predicate('_all', ':', 'blue') }],
    });

    expect(stripPosition(parse('NOT red blue'))).toEqual({
      type: 'and',
      children: [{ type: 'not', child: predicate('_all', ':', 'red') }, predicate('_all', ':', 'blue')],
    });
  });

  it('supports double negation', () => {
    expect(stripPosition(parse('NOT NOT status:online'))).toEqual({
      type: 'not',
      child: { type: 'not', child: predicate('status', ':', 'online') },
    });
  });

  it('rejects a bare, unquoted "NOT" as a value — it is always reserved, like "AND"/"OR"', () => {
    expect(() => parse('NOT')).toThrow(SearchCopError);
    expect(() => parse('status:online NOT')).toThrow(SearchCopError);
  });

  it('allows searching for the literal word "NOT" via quoting', () => {
    expect(stripPosition(parse('"NOT"'))).toEqual(predicate('_all', ':', 'NOT'));
  });
});

describe('parse: negation ("-" shorthand)', () => {
  it('negates a predicate, same as "NOT"', () => {
    expect(stripPosition(parse('-status:online'))).toEqual({ type: 'not', child: predicate('status', ':', 'online') });
  });

  it('negates a bare term against "_all"', () => {
    expect(stripPosition(parse('-cheap'))).toEqual({ type: 'not', child: predicate('_all', ':', 'cheap') });
  });

  it('negates a parenthesized group with no space before "("', () => {
    expect(stripPosition(parse('-(status:online OR status:pending)'))).toEqual({
      type: 'not',
      child: {
        type: 'or',
        children: [predicate('status', ':', 'online'), predicate('status', ':', 'pending')],
      },
    });
  });

  it('negates just the next bare term amid implicit AND, not the whole phrase', () => {
    expect(stripPosition(parse('red -cheap'))).toEqual({
      type: 'and',
      children: [predicate('_all', ':', 'red'), { type: 'not', child: predicate('_all', ':', 'cheap') }],
    });
  });

  it('supports double negation', () => {
    expect(stripPosition(parse('--cheap'))).toEqual({
      type: 'not',
      child: { type: 'not', child: predicate('_all', ':', 'cheap') },
    });
  });

  it('requires "-" to be directly attached to what follows — a space makes it a literal value instead', () => {
    expect(stripPosition(parse('- cheap'))).toEqual({
      type: 'and',
      children: [predicate('_all', ':', '-'), predicate('_all', ':', 'cheap')],
    });
  });

  it('treats a lone "-" as the literal value "-", not negation', () => {
    expect(stripPosition(parse('-'))).toEqual(predicate('_all', ':', '-'));
  });

  it('does not treat "-" inside a value as negation — e.g. a negative number, or a hyphenated word', () => {
    expect(stripPosition(parse('price:-5'))).toEqual(predicate('price', ':', '-5'));
    expect(stripPosition(parse('well-known'))).toEqual(predicate('_all', ':', 'well-known'));
  });

  it('allows searching for a literal leading "-" via quoting', () => {
    expect(stripPosition(parse('-"AND"'))).toEqual({ type: 'not', child: predicate('_all', ':', 'AND') });
  });
});

describe('parse: default field ("_all")', () => {
  it('parses a bare value with no "field:" prefix against "_all"', () => {
    expect(stripPosition(parse('Pet'))).toEqual(predicate('_all', ':', 'Pet'));
    expect(stripPosition(parse('Pet*'))).toEqual(predicate('_all', ':', 'Pet*'));
  });

  it('parses a bare quoted value against "_all"', () => {
    expect(stripPosition(parse('"foo bar"'))).toEqual(predicate('_all', ':', 'foo bar'));
  });

  it('combines multiple bare terms with implicit AND (free-text search)', () => {
    expect(stripPosition(parse('red shoes'))).toEqual({
      type: 'and',
      children: [predicate('_all', ':', 'red'), predicate('_all', ':', 'shoes')],
    });
  });

  it('mixes bare terms with explicit field:value predicates', () => {
    expect(stripPosition(parse('red status:online'))).toEqual({
      type: 'and',
      children: [predicate('_all', ':', 'red'), predicate('status', ':', 'online')],
    });
  });

  it('still recognizes "OR" between two bare terms as the keyword, not a literal term', () => {
    expect(stripPosition(parse('red OR blue'))).toEqual({
      type: 'or',
      children: [predicate('_all', ':', 'red'), predicate('_all', ':', 'blue')],
    });
  });

  it('rejects a bare, unquoted "AND"/"OR" as a value — they are always reserved', () => {
    expect(() => parse('AND')).toThrow(SearchCopError);
    expect(() => parse('OR')).toThrow(SearchCopError);
    expect(() => parse('red AND OR blue')).toThrow(SearchCopError);
  });

  it('allows searching for the literal word "AND"/"OR" via quoting', () => {
    expect(stripPosition(parse('"AND"'))).toEqual(predicate('_all', ':', 'AND'));
    expect(stripPosition(parse('"OR"'))).toEqual(predicate('_all', ':', 'OR'));
  });

  it('does not treat a word merely containing "AND"/"OR" as reserved', () => {
    expect(stripPosition(parse('ANDROID'))).toEqual(predicate('_all', ':', 'ANDROID'));
    expect(stripPosition(parse('FOREST'))).toEqual(predicate('_all', ':', 'FOREST'));
  });
});

describe('parse: syntax errors', () => {
  it('throws a SearchCopError with code INVALID_SYNTAX and a position', () => {
    const [error] = tryCatch(() => parse('status:online AND'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_SYNTAX');
    expect((error as SearchCopError).position).toBeGreaterThan(0);
  });

  it('rejects unbalanced parentheses', () => {
    expect(() => parse('(status:online AND price:>100')).toThrow(SearchCopError);
  });
});
