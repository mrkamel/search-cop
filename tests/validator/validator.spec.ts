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
  nameCaseInsensitive: { type: 'string', caseSensitive: false },
  createdAt: { type: 'datetime' },
  releaseDate: { type: 'date' },
  id: { type: 'uuid' },
  search: { type: 'string', fields: ['name', 'description'] },
};

function validateQuery(query: string) {
  return validate({ expression: parse(query), attributes });
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

  it('rejects unsupported operators for uuid attributes', () => {
    const [error] = tryCatch(() => validateQuery('id:>550e8400-e29b-41d4-a716-446655440000'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_OPERATOR');
  });
});

describe('validate: value conversion', () => {
  it('converts numbers', () => {
    expect(validateQuery('price:>100')).toEqual({
      type: 'predicate',
      fields: ['price'],
      operator: '>',
      value: 100,
      caseSensitive: true,
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

  it('converts uuids, lowercasing the result', () => {
    const result = validateQuery('id:550E8400-E29B-41D4-A716-446655440000');

    expect(result).toMatchObject({ value: '550e8400-e29b-41d4-a716-446655440000' });
  });

  it('accepts the nil and max uuids', () => {
    expect(validateQuery('id:00000000-0000-0000-0000-000000000000')).toMatchObject({
      value: '00000000-0000-0000-0000-000000000000',
    });
    expect(validateQuery('id:ffffffff-ffff-ffff-ffff-ffffffffffff')).toMatchObject({
      value: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    });
  });

  it('rejects malformed uuids', () => {
    // one hex digit short in the last group
    const [error] = tryCatch(() => validateQuery('id:550e8400-e29b-41d4-a716-12345678901'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_VALUE');
  });

  it('rejects uuids with an invalid version nibble', () => {
    const [error] = tryCatch(() => validateQuery('id:550e8400-e29b-00d4-a706-446655440000'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_VALUE');
  });

  it('rejects uuids with an invalid variant nibble', () => {
    const [error] = tryCatch(() => validateQuery('id:550e8400-e29b-41d4-c716-446655440000'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_VALUE');
  });

  it('accepts uuid versions 1 through 8', () => {
    for (const version of '12345678') {
      expect(validateQuery(`id:550e8400-e29b-${version}1d4-a716-446655440000`)).toMatchObject({
        value: `550e8400-e29b-${version}1d4-a716-446655440000`,
      });
    }
  });
});

describe('validate: wildcards', () => {
  it('turns "=" with a wildcard value into LIKE, translating "*" to "%"', () => {
    expect(validateQuery('name:Pet*')).toMatchObject({ operator: 'LIKE', value: 'Pet%' });
    expect(validateQuery('name:*fred')).toMatchObject({ operator: 'LIKE', value: '%fred' });
    expect(validateQuery('name:*Pet*')).toMatchObject({ operator: 'LIKE', value: '%Pet%' });
  });

  it('escapes literal "%", "_", and "\\" so they are matched literally', () => {
    expect(validateQuery('name:100%*')).toMatchObject({ value: '100\\%%' });
    expect(validateQuery('name:a_b*')).toMatchObject({ value: 'a\\_b%' });
    expect(validateQuery('name:foo\\bar*')).toMatchObject({ value: 'foo\\\\bar%' });
  });

  it('rejects wildcard values combined with ordering operators', () => {
    for (const operator of ['>', '>=', '<', '<=']) {
      const [error] = tryCatch(() => validateQuery(`name:${operator}Pet*`));

      expect(error).toBeInstanceOf(SearchCopError);
      expect((error as SearchCopError).code).toBe('INVALID_OPERATOR');
    }
  });

  it('does not apply wildcard handling to non-string attribute types', () => {
    // "*" has no special meaning outside of string values, so this is just an invalid enum value.
    const [error] = tryCatch(() => validateQuery('status:online*'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_ENUM_VALUE');
  });
});

describe('validate: case sensitivity', () => {
  it('defaults to case-sensitive for string attributes', () => {
    expect(validateQuery('name:Fred')).toMatchObject({ value: 'Fred', caseSensitive: true });
  });

  it('lowercases the value for a case-insensitive attribute, marking the predicate as such', () => {
    expect(validateQuery('nameCaseInsensitive:Fred')).toMatchObject({ value: 'fred', caseSensitive: false });
  });

  it('lowercases wildcard values for a case-insensitive attribute too', () => {
    expect(validateQuery('nameCaseInsensitive:Fred*')).toMatchObject({ operator: 'LIKE', value: 'fred%', caseSensitive: false });
  });

  it('lowercases ordering comparisons for a case-insensitive attribute too', () => {
    expect(validateQuery('nameCaseInsensitive:>Fred')).toMatchObject({ operator: '>', value: 'fred', caseSensitive: false });
  });

  it('marks non-string predicates as case-sensitive regardless', () => {
    expect(validateQuery('status:online')).toMatchObject({ caseSensitive: true });
    expect(validateQuery('price:>100')).toMatchObject({ caseSensitive: true });
  });
});

describe('validate: multi-field attributes', () => {
  it('defaults "fields" to a single-element array of the attribute key', () => {
    expect(validateQuery('name:Fred')).toMatchObject({ fields: ['name'] });
  });

  it('resolves an attribute\'s "fields" list instead of its own key', () => {
    expect(validateQuery('search:Fred')).toMatchObject({ fields: ['name', 'description'], operator: '=', value: 'Fred' });
  });

  it('carries "fields" through wildcard matches', () => {
    expect(validateQuery('search:Fred*')).toMatchObject({ fields: ['name', 'description'], operator: 'LIKE', value: 'Fred%' });
  });

  it('rejects ordering operators for multi-field attributes', () => {
    for (const operator of ['>', '>=', '<', '<=']) {
      const [error] = tryCatch(() => validateQuery(`search:${operator}Fred`));

      expect(error).toBeInstanceOf(SearchCopError);
      expect((error as SearchCopError).code).toBe('INVALID_OPERATOR');
    }
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
        { type: 'predicate', fields: ['status'], operator: '=', value: 'online', caseSensitive: true, position: expect.any(Number) },
        {
          type: 'or',
          children: [
            { type: 'predicate', fields: ['price'], operator: '>', value: 100, caseSensitive: true, position: expect.any(Number) },
            { type: 'predicate', fields: ['status'], operator: '=', value: 'offline', caseSensitive: true, position: expect.any(Number) },
          ],
        },
      ],
    });
  });
});
