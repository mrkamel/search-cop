import { parse as parseGrammar, SyntaxError as GrammarSyntaxError } from './grammar.js';
import type { Expression } from '../ast/types.js';
import { SearchCopError } from '../errors/errors.js';

export function parse(query: string): Expression {
  try {
    return parseGrammar(query) as Expression;
  } catch (error) {
    if (error instanceof GrammarSyntaxError) {
      const position = error.location.start.offset + 1;

      throw new SearchCopError('INVALID_SYNTAX', `Invalid search query syntax at position ${position}: ${error.message}`, position);
    }

    throw error;
  }
}
