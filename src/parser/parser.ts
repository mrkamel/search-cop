import { parse as parseGrammar, SyntaxError as GrammarSyntaxError } from './grammar.js';
import type { Expression } from '../ast/types.js';
import { SearchCopError } from '../errors/errors.js';
import { tryCatch } from '../utils/tryCatch.js';

// Keep in sync with the "_all" literal in grammar.peggy's Predicate rule.
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
