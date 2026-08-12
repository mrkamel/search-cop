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
    expect(stripPosition(parse('status:online'))).toEqual(predicate('status', '=', 'online'));
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

  it('parses "!="', () => {
    expect(stripPosition(parse('status:!=offline'))).toEqual(predicate('status', '!=', 'offline'));
  });

  it('parses date-like values', () => {
    expect(stripPosition(parse('createdAt:>=2026-01-01'))).toEqual(predicate('createdAt', '>=', '2026-01-01'));
  });

  it('parses "*" as a plain value character (wildcard interpretation happens during validation)', () => {
    expect(stripPosition(parse('name:Pet*'))).toEqual(predicate('name', '=', 'Pet*'));
    expect(stripPosition(parse('name:*fred'))).toEqual(predicate('name', '=', '*fred'));
  });
});

describe('parse: quoted values', () => {
  it('parses a quoted value containing whitespace', () => {
    expect(stripPosition(parse('first_name:"foo bar"'))).toEqual(predicate('first_name', '=', 'foo bar'));
  });

  it('parses a quoted value containing parentheses', () => {
    expect(stripPosition(parse('name:"(foo)"'))).toEqual(predicate('name', '=', '(foo)'));
  });

  it('parses an empty quoted value', () => {
    expect(stripPosition(parse('name:""'))).toEqual(predicate('name', '=', ''));
  });

  it('unescapes \\" to a literal quote', () => {
    expect(stripPosition(parse('name:"foo \\"bar\\" baz"'))).toEqual(predicate('name', '=', 'foo "bar" baz'));
  });

  it('unescapes \\\\ to a literal backslash', () => {
    expect(stripPosition(parse('name:"back\\\\slash"'))).toEqual(predicate('name', '=', 'back\\slash'));
  });

  it('combines quoted predicates with AND/OR, including implicit AND', () => {
    expect(stripPosition(parse('is_active:false OR first_name:"foo bar"'))).toEqual({
      type: 'or',
      children: [predicate('is_active', '=', 'false'), predicate('first_name', '=', 'foo bar')],
    });

    expect(stripPosition(parse('first_name:"foo bar" status:online'))).toEqual({
      type: 'and',
      children: [predicate('first_name', '=', 'foo bar'), predicate('status', '=', 'online')],
    });
  });

  it('falls back to an unquoted value when the closing quote is missing', () => {
    expect(stripPosition(parse('name:"unterminated'))).toEqual(predicate('name', '=', '"unterminated'));
  });
});

describe('parse: boolean expressions', () => {
  it('parses AND', () => {
    expect(stripPosition(parse('status:online AND price:>100'))).toEqual({
      type: 'and',
      children: [predicate('status', '=', 'online'), predicate('price', '>', '100')],
    });
  });

  it('treats juxtaposition (no explicit operator) as implicit AND', () => {
    expect(stripPosition(parse('status:online price:>100'))).toEqual({
      type: 'and',
      children: [predicate('status', '=', 'online'), predicate('price', '>', '100')],
    });
  });

  it('mixes implicit and explicit AND', () => {
    expect(stripPosition(parse('status:a status:b AND status:c'))).toEqual({
      type: 'and',
      children: [predicate('status', '=', 'a'), predicate('status', '=', 'b'), predicate('status', '=', 'c')],
    });
  });

  it('gives implicit AND the same precedence as explicit AND: "A B OR C" = "(A AND B) OR C"', () => {
    expect(stripPosition(parse('status:a status:b OR status:c'))).toEqual({
      type: 'or',
      children: [
        {
          type: 'and',
          children: [predicate('status', '=', 'a'), predicate('status', '=', 'b')],
        },
        predicate('status', '=', 'c'),
      ],
    });
  });

  it('parses OR', () => {
    expect(stripPosition(parse('status:online OR status:pending'))).toEqual({
      type: 'or',
      children: [predicate('status', '=', 'online'), predicate('status', '=', 'pending')],
    });
  });

  it('gives AND higher precedence than OR: "A OR B AND C" = "A OR (B AND C)"', () => {
    expect(stripPosition(parse('status:a OR status:b AND status:c'))).toEqual({
      type: 'or',
      children: [
        predicate('status', '=', 'a'),
        {
          type: 'and',
          children: [predicate('status', '=', 'b'), predicate('status', '=', 'c')],
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
          children: [predicate('status', '=', 'a'), predicate('status', '=', 'b')],
        },
        predicate('status', '=', 'c'),
      ],
    });
  });

  it('parses "A AND (B OR C)"', () => {
    expect(stripPosition(parse('status:a AND (status:b OR status:c)'))).toEqual({
      type: 'and',
      children: [
        predicate('status', '=', 'a'),
        {
          type: 'or',
          children: [predicate('status', '=', 'b'), predicate('status', '=', 'c')],
        },
      ],
    });
  });

  it('rejects lowercase "and"/"or" keywords (case-sensitive grammar)', () => {
    expect(() => parse('status:a and status:b')).toThrow(SearchCopError);
    expect(() => parse('status:a or status:b')).toThrow(SearchCopError);
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
