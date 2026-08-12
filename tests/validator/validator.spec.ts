import { describe, expect, it } from 'vitest';
import { parse } from '../../src/parser/parser.js';
import { validate } from '../../src/validator/validator.js';
import { SearchCopError } from '../../src/errors/errors.js';
import { tryCatch } from '../../src/utils/tryCatch.js';
import type { AttributeMap } from '../../src/attributes/types.js';

const attributes: AttributeMap = {
  status: { type: 'enum', values: ['online', 'offline', 'pending'] },
  price: { type: 'number' },
  active: { type: 'boolean' },
  name: { type: 'string' },
  createdAt: { type: 'datetime' },
  releaseDate: { type: 'date' },
};

function validateQuery(query: string) {
  return validate(parse(query), attributes);
}

describe('validate: attribute checks', () => {
  it('rejects unknown attributes', () => {
    const [error] = tryCatch(() => validateQuery('unknown:foo'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('UNKNOWN_ATTRIBUTE');
  });

  it('rejects unsupported operators for enum attributes', () => {
    const [error] = tryCatch(() => validateQuery('status:>online'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_OPERATOR');
  });
});

describe('validate: value conversion', () => {
  it('converts numbers', () => {
    expect(validateQuery('price:>100')).toEqual({
      type: 'predicate',
      field: 'price',
      operator: '>',
      value: 100,
      position: expect.any(Number),
    });
  });

  it('rejects invalid numbers', () => {
    const [error] = tryCatch(() => validateQuery('price:>abc'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_VALUE');
  });

  it('converts booleans', () => {
    expect(validateQuery('active:true')).toMatchObject({ value: true });
    expect(validateQuery('active:false')).toMatchObject({ value: false });
  });

  it('rejects invalid booleans', () => {
    const [error] = tryCatch(() => validateQuery('active:yes'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_VALUE');
  });

  it('validates enum values', () => {
    const [error] = tryCatch(() => validateQuery('status:invalid'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_ENUM_VALUE');
  });

  it('converts date-only values to a UTC midnight Date', () => {
    const result = validateQuery('releaseDate:>=2026-01-01');

    expect(result).toMatchObject({ value: new Date('2026-01-01T00:00:00.000Z') });
  });

  it('rejects invalid dates', () => {
    const [error] = tryCatch(() => validateQuery('releaseDate:>abc'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_VALUE');
  });

  it('rejects calendar-invalid dates', () => {
    const [error] = tryCatch(() => validateQuery('releaseDate:2026-02-30'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_VALUE');
  });

  it('converts datetime values with an explicit UTC offset', () => {
    const result = validateQuery('createdAt:>=2026-01-01T10:00:00+02:00');

    expect(result).toMatchObject({ value: new Date('2026-01-01T08:00:00.000Z') });
  });

  it('treats datetime values without an offset as UTC', () => {
    const result = validateQuery('createdAt:>=2026-01-01T10:00:00');

    expect(result).toMatchObject({ value: new Date('2026-01-01T10:00:00.000Z') });
  });

  it('accepts date-only values for datetime attributes', () => {
    const result = validateQuery('createdAt:>=2026-01-01');

    expect(result).toMatchObject({ value: new Date('2026-01-01T00:00:00.000Z') });
  });
});

describe('validate: nested boolean expressions', () => {
  it('validates every predicate in a nested expression', () => {
    const [error] = tryCatch(() => validateQuery('status:online AND (price:>100 OR unknown:foo)'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('UNKNOWN_ATTRIBUTE');
  });

  it('preserves AND/OR structure through validation', () => {
    const result = validateQuery('status:online AND (price:>100 OR status:offline)');

    expect(result).toEqual({
      type: 'and',
      children: [
        { type: 'predicate', field: 'status', operator: '=', value: 'online', position: expect.any(Number) },
        {
          type: 'or',
          children: [
            { type: 'predicate', field: 'price', operator: '>', value: 100, position: expect.any(Number) },
            { type: 'predicate', field: 'status', operator: '=', value: 'offline', position: expect.any(Number) },
          ],
        },
      ],
    });
  });
});
