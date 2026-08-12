import { describe, expect, it } from 'vitest';
import { tryCatch } from '../../src/utils/tryCatch.js';

describe('tryCatch: sync functions', () => {
  it('returns [null, value] when the function does not throw', () => {
    expect(tryCatch(() => 1)).toEqual([null, 1]);
  });

  it('returns [error, null] with the original error when the function throws an Error', () => {
    const error = new Error('boom');
    const [returnedError, result] = tryCatch((): number => { throw error; });

    expect(returnedError).toBe(error);
    expect(result).toBeNull();
  });

  it('wraps a thrown string into an Error', () => {
    const [error, result] = tryCatch((): number => { throw 'boom'; });

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('boom');
    expect(result).toBeNull();
  });

  it('wraps any other thrown value into an Error', () => {
    const [error] = tryCatch((): number => { throw { code: 'boom' }; });

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('Invalid error: [object Object]');
  });
});

describe('tryCatch: async functions', () => {
  it('resolves to [null, value] when the promise resolves', async () => {
    await expect(tryCatch(() => Promise.resolve(1))).resolves.toEqual([null, 1]);
  });

  it('resolves to [error, null] with the original error when the promise rejects', async () => {
    const error = new Error('boom');

    await expect(tryCatch(() => Promise.reject(error))).resolves.toEqual([error, null]);
  });

  it('wraps a non-Error rejection into an Error', async () => {
    const [error, result] = await tryCatch(() => Promise.reject('boom'));

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('boom');
    expect(result).toBeNull();
  });
});
