import { singleton } from '../utils/singleton.js';

export type SearchCopErrorCode =
  | 'INVALID_SYNTAX'
  | 'UNKNOWN_ATTRIBUTE'
  | 'INVALID_OPERATOR'
  | 'INVALID_WILDCARD'
  | 'CIRCULAR_TAG_REFERENCE'
  ;

class SearchCopErrorClass extends Error {
  override readonly name = 'SearchCopError';

  readonly code: SearchCopErrorCode;
  readonly position?: number;

  constructor(code: SearchCopErrorCode, message: string, position?: number) {
    super(message);
    this.code = code;
    this.position = position;
  }
}

export const SearchCopError = singleton('SearchCopError', () => SearchCopErrorClass);
export type SearchCopError = SearchCopErrorClass;
