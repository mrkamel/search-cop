export type SearchCopErrorCode =
  | 'INVALID_SYNTAX'
  | 'UNKNOWN_ATTRIBUTE'
  | 'INVALID_OPERATOR'
  | 'INVALID_WILDCARD'
  | 'CIRCULAR_TAG_REFERENCE'
  ;

export class SearchCopError extends Error {
  readonly code: SearchCopErrorCode;
  readonly position?: number;

  constructor(code: SearchCopErrorCode, message: string, position?: number) {
    super(message);
    this.name = 'SearchCopError';
    this.code = code;
    this.position = position;
  }
}
