import { describe, expect, it } from 'vitest';
import { SearchCopError, isSearchCopError } from '../../src/errors/errors.js';

describe('isSearchCopError', () => {
  it('returns true for a SearchCopError and false for anything else', () => {
    expect(isSearchCopError(new SearchCopError('INVALID_SYNTAX', 'message'))).toBe(true);
    expect(isSearchCopError(new Error('message'))).toBe(false);
    expect(isSearchCopError({ code: 'INVALID_SYNTAX' })).toBe(false);
    expect(isSearchCopError('message')).toBe(false);
    expect(isSearchCopError(null)).toBe(false);
    expect(isSearchCopError(undefined)).toBe(false);
  });
});
