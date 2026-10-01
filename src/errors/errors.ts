import { singleton } from '../utils/singleton.js';

export type SearchCopErrorCode =
  | 'INVALID_SYNTAX'
  | 'UNKNOWN_ATTRIBUTE'
  | 'INVALID_OPERATOR'
  | 'INVALID_WILDCARD'
  | 'CIRCULAR_TAG_REFERENCE'
  ;

class SearchCopErrorClass extends Error {
  readonly code: SearchCopErrorCode;
  readonly position?: number;

  constructor(code: SearchCopErrorCode, message: string, position?: number) {
    super(message);
    this.name = 'SearchCopError';
    this.code = code;
    this.position = position;
  }
}

export const SearchCopError = singleton('SearchCopError', () => SearchCopErrorClass);
export type SearchCopError = SearchCopErrorClass;
export const isSearchCopError = (error: unknown): error is SearchCopError => error instanceof SearchCopError;
