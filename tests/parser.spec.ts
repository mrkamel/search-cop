import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser/parser.js';
import { SearchCopError } from '../src/errors/errors.js';
import type { PredicateExpression } from '../src/ast/types.js';

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
});

describe('parse: boolean expressions', () => {
  it('parses AND', () => {
    expect(stripPosition(parse('status:online AND price:>100'))).toEqual({
      type: 'and',
      children: [predicate('status', '=', 'online'), predicate('price', '>', '100')],
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
  it('rejects implicit AND (no operator between predicates)', () => {
    expect(() => parse('status:online price:>100')).toThrow(SearchCopError);
  });

  it('throws a SearchCopError with code INVALID_SYNTAX and a position', () => {
    try {
      parse('status:online AND');
      expect.fail('expected parse to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SearchCopError);
      expect((error as SearchCopError).code).toBe('INVALID_SYNTAX');
      expect((error as SearchCopError).position).toBeGreaterThan(0);
    }
  });

  it('rejects unbalanced parentheses', () => {
    expect(() => parse('(status:online AND price:>100')).toThrow(SearchCopError);
  });
});
