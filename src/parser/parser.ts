import { parse as parseGrammar, SyntaxError as GrammarSyntaxError } from './grammar.js';
import type { Expression } from '../ast/types.js';
import { SearchCopError } from '../errors/errors.js';
import { tryCatch } from '../utils/tryCatch.js';

// A bare value with no "field:" prefix parses to a predicate against this attribute
// key (see the second alternative of the Predicate rule in grammar.peggy — keep the
// literal there in sync with this constant).
export const DEFAULT_FIELD = '_all';

export function parse(query: string): Expression {
  const [error, expression] = tryCatch(() => parseGrammar(query) as Expression);

  if (error) {
    if (error instanceof GrammarSyntaxError) {
      const position = error.location.start.offset + 1;

      throw new SearchCopError('INVALID_SYNTAX', `Invalid search query syntax at position ${position}: ${error.message}`, position);
    }

    throw error;
  }

  return expression;
}
