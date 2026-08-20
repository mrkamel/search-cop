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
  nameCaseInsensitiveUpper: { type: 'string', caseSensitive: 'upper' },
  nameContains: { type: 'string', wildcards: true },
  nameEndsWith: { type: 'string', leftWildcard: true },
  nameStartsWith: { type: 'string', rightWildcard: true },
  createdAt: { type: 'datetime' },
  releaseDate: { type: 'date' },
  id: { type: 'uuid' },
  search: { type: 'string', fields: ['name', 'description'] },
  assigned: { type: 'null', isNull: ['false', 'no'], isNotNull: ['true', 'yes'] },
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
      fields: [{ field: 'price', operator: '>', value: 100, caseSensitive: true }],
      position: expect.any(Number),
    });
  });

  it('does not error on an unparseable number — it just never matches', () => {
    expect(validateQuery('price:>abc')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });

  it('converts booleans', () => {
    expect(validateQuery('active:true')).toMatchObject({ fields: [{ value: true }] });
    expect(validateQuery('active:false')).toMatchObject({ fields: [{ value: false }] });
  });

  it('does not error on an unparseable boolean — it just never matches', () => {
    expect(validateQuery('active:yes')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });

  it('does not error on an unknown enum value — it just never matches', () => {
    expect(validateQuery('status:invalid')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });

  it('maps enum values declared as a Record to their underlying value', () => {
    const attributesWithEnumMap: AttributeMap = {
      status: { type: 'enum', values: { pending: 'waiting', completed: 'finished' } },
    };

    expect(validate({ expression: parse('status:pending'), attributes: attributesWithEnumMap })).toMatchObject({
      fields: [{ field: 'status', value: 'waiting' }],
    });
  });

  it('does not error on an unknown value for an enum declared as a Record — it just never matches', () => {
    const attributesWithEnumMap: AttributeMap = {
      status: { type: 'enum', values: { pending: 'waiting', completed: 'finished' } },
    };

    expect(validate({ expression: parse('status:invalid'), attributes: attributesWithEnumMap })).toMatchObject({
      fields: [{ alwaysFalse: true }],
    });
  });

  it('converts date-only values to a UTC midnight Date', () => {
    const result = validateQuery('releaseDate:>=2026-01-01');

    expect(result).toMatchObject({ fields: [{ value: new Date('2026-01-01T00:00:00.000Z') }] });
  });

  it('does not error on an unparseable date — it just never matches', () => {
    expect(validateQuery('releaseDate:>abc')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });

  it('does not error on a calendar-invalid date — it just never matches', () => {
    expect(validateQuery('releaseDate:2026-02-30')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });

  it('converts datetime values with an explicit UTC offset', () => {
    const result = validateQuery('createdAt:>=2026-01-01T10:00:00+02:00');

    expect(result).toMatchObject({ fields: [{ value: new Date('2026-01-01T08:00:00.000Z') }] });
  });

  it('treats datetime values without an offset as UTC', () => {
    const result = validateQuery('createdAt:>=2026-01-01T10:00:00');

    expect(result).toMatchObject({ fields: [{ value: new Date('2026-01-01T10:00:00.000Z') }] });
  });

  it('accepts date-only values for datetime attributes', () => {
    const result = validateQuery('createdAt:>=2026-01-01');

    expect(result).toMatchObject({ fields: [{ value: new Date('2026-01-01T00:00:00.000Z') }] });
  });

  it('converts uuids, lowercasing the result', () => {
    const result = validateQuery('id:550E8400-E29B-41D4-A716-446655440000');

    expect(result).toMatchObject({ fields: [{ value: '550e8400-e29b-41d4-a716-446655440000' }] });
  });

  it('accepts the nil and max uuids', () => {
    expect(validateQuery('id:00000000-0000-0000-0000-000000000000')).toMatchObject({
      fields: [{ value: '00000000-0000-0000-0000-000000000000' }],
    });
    expect(validateQuery('id:ffffffff-ffff-ffff-ffff-ffffffffffff')).toMatchObject({
      fields: [{ value: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
    });
  });

  it('does not error on a malformed uuid — it just never matches', () => {
    // one hex digit short in the last group
    expect(validateQuery('id:550e8400-e29b-41d4-a716-12345678901')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });

  it('does not error on an invalid uuid version nibble — it just never matches', () => {
    expect(validateQuery('id:550e8400-e29b-00d4-a706-446655440000')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });

  it('does not error on an invalid uuid variant nibble — it just never matches', () => {
    expect(validateQuery('id:550e8400-e29b-41d4-c716-446655440000')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });

  it('accepts uuid versions 1 through 8', () => {
    for (const version of '12345678') {
      expect(validateQuery(`id:550e8400-e29b-${version}1d4-a716-446655440000`)).toMatchObject({
        fields: [{ value: `550e8400-e29b-${version}1d4-a716-446655440000` }],
      });
    }
  });
});

describe('validate: "null" attributes', () => {
  it('resolves any "isNull" value to an "IS NULL" check, with no bound value', () => {
    expect(validateQuery('assigned:false')).toMatchObject({ fields: [{ field: 'assigned', operator: 'IS NULL' }] });
    expect(validateQuery('assigned:no')).toMatchObject({ fields: [{ field: 'assigned', operator: 'IS NULL' }] });
  });

  it('resolves any "isNotNull" value to an "IS NOT NULL" check, with no bound value', () => {
    expect(validateQuery('assigned:true')).toMatchObject({ fields: [{ field: 'assigned', operator: 'IS NOT NULL' }] });
    expect(validateQuery('assigned:yes')).toMatchObject({ fields: [{ field: 'assigned', operator: 'IS NOT NULL' }] });
  });

  it('does not include a "value" key for either check', () => {
    const [result] = (validateQuery('assigned:yes') as { fields: object[] }).fields;

    expect(result).not.toHaveProperty('value');
  });

  it('rejects unsupported operators', () => {
    const [error] = tryCatch(() => validateQuery('assigned:>yes'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_OPERATOR');
  });

  it('does not error on an unknown value — it just never matches', () => {
    expect(validateQuery('assigned:maybe')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });

  it('a field-level "null" override rejects an operator the outer attribute allows but "null" does not', () => {
    // The outer attribute's own operator check only validates against "date" (which allows
    // ">"), not against the override's stricter "null" type (which only allows "=") — the
    // override must reject ">" itself rather than compiling an "IS NOT NULL" regardless.
    const attributesWithNullOverride: AttributeMap = {
      createdAt: { type: 'date', fields: [{ field: 'assignedTo', type: 'null', isNull: ['no'], isNotNull: ['yes'] }] },
    };

    expect(validate({ expression: parse('createdAt:>yes'), attributes: attributesWithNullOverride })).toMatchObject({
      fields: [{ alwaysFalse: true }],
    });
  });
});

describe('validate: wildcards', () => {
  it('turns "=" with a wildcard value into LIKE, translating "*" to "%"', () => {
    expect(validateQuery('name:Pet*')).toMatchObject({ fields: [{ operator: 'LIKE', value: 'Pet%' }] });
    expect(validateQuery('name:*fred')).toMatchObject({ fields: [{ operator: 'LIKE', value: '%fred' }] });
    expect(validateQuery('name:*Pet*')).toMatchObject({ fields: [{ operator: 'LIKE', value: '%Pet%' }] });
  });

  it('escapes literal "%", "_", and "!" (the LIKE escape character) so they are matched literally', () => {
    expect(validateQuery('name:100%*')).toMatchObject({ fields: [{ value: '100!%%' }] });
    expect(validateQuery('name:a_b*')).toMatchObject({ fields: [{ value: 'a!_b%' }] });
    expect(validateQuery('name:100!bar*')).toMatchObject({ fields: [{ value: '100!!bar%' }] });
  });

  it('does not escape a literal "\\" — it has no special meaning to LIKE', () => {
    expect(validateQuery('name:foo\\\\bar*')).toMatchObject({ fields: [{ value: 'foo\\bar%' }] });
  });

  it('treats "*" as a plain literal character with ordering operators — no wildcard interpretation', () => {
    for (const operator of ['>', '>=', '<', '<=']) {
      expect(validateQuery(`name:${operator}Pet*`)).toMatchObject({ fields: [{ operator, value: 'Pet*' }] });
    }
  });

  it('does not apply wildcard handling to non-string attribute types', () => {
    // "*" has no special meaning outside of string values, so this is just an unknown enum value —
    // which, like any other unparseable value, never matches rather than erroring.
    expect(validateQuery('status:online*')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });

  it('applies wildcard handling to a "string"-typed field override, even under a non-string outer attribute', () => {
    const attributesWithStringOverride: AttributeMap = {
      price: { type: 'number', fields: [{ field: 'sku', type: 'string' }] },
    };

    expect(validate({ expression: parse('price:abc*'), attributes: attributesWithStringOverride })).toMatchObject({
      fields: [{ field: 'sku', operator: 'LIKE', value: 'abc%' }],
    });
  });
});

describe('validate: escaped wildcards ("\\*")', () => {
  it('unescapes "\\*" to a literal "*" when no real wildcard is present', () => {
    expect(validateQuery('name:Name\\*')).toMatchObject({ fields: [{ operator: 'LIKE', value: 'Name*' }] });
    expect(validateQuery('name:\\*Name')).toMatchObject({ fields: [{ operator: 'LIKE', value: '*Name' }] });
    expect(validateQuery('name:Name\\*Other')).toMatchObject({ fields: [{ operator: 'LIKE', value: 'Name*Other' }] });
  });

  it('allows an escaped "\\*" together with ordering operators, since it carries no wildcard meaning', () => {
    expect(validateQuery('name:>Name\\*')).toMatchObject({ fields: [{ operator: '>', value: 'Name*' }] });
    expect(validateQuery('name:<=Name\\*')).toMatchObject({ fields: [{ operator: '<=', value: 'Name*' }] });
  });

  it('combines a real prefix/suffix wildcard with an escaped literal "*" elsewhere in the value', () => {
    expect(validateQuery('name:*Name\\*Other')).toMatchObject({ fields: [{ operator: 'LIKE', value: '%Name*Other' }] });
    expect(validateQuery('name:Name\\*Other*')).toMatchObject({ fields: [{ operator: 'LIKE', value: 'Name*Other%' }] });
  });

  it('rejects a real (un-escaped) "*" anywhere other than the start/end of the value', () => {
    const [error] = tryCatch(() => validateQuery('name:Name*Other'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_WILDCARD');
  });

  it('rejects a real "*" in the middle even when the value also has valid edge wildcards', () => {
    const [error] = tryCatch(() => validateQuery('name:*Name*Other*'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_WILDCARD');
  });

  it('drops a single "\\" before an unrelated character, e.g. an unescaped Windows-style path', () => {
    expect(validateQuery('name:C:\\Name\\Other')).toMatchObject({ fields: [{ operator: 'LIKE', value: 'C:NameOther' }] });
  });

  it('requires doubling "\\" to keep a literal backslash, e.g. a Windows-style path', () => {
    expect(validateQuery('name:C:\\\\Name\\\\Other')).toMatchObject({ fields: [{ operator: 'LIKE', value: 'C:\\Name\\Other' }] });
    expect(validateQuery('name:C:\\\\Name\\\\Other*')).toMatchObject({ fields: [{ operator: 'LIKE', value: 'C:\\Name\\Other%' }] });
  });

  it('respects "caseSensitive: false" on an escaped-only value', () => {
    expect(validateQuery('nameCaseInsensitive:Name\\*')).toMatchObject({ fields: [{ operator: 'LIKE', value: 'name*' }] });
  });

  it('does not unescape "\\*" for a non-string attribute type — it stays a literal, never-matching value', () => {
    expect(validateQuery('status:onl\\*ine')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });

  it('behaves identically for a quoted value', () => {
    expect(validateQuery('name:"Name\\*Other"')).toMatchObject({ fields: [{ operator: 'LIKE', value: 'Name*Other' }] });
  });
});

describe('validate: "wildcards" option (implicit contains matching)', () => {
  it('wraps a bare-colon value with "*" on both sides', () => {
    expect(validateQuery('nameContains:Name')).toMatchObject({ fields: [{ operator: 'LIKE', value: '%Name%' }] });
  });

  it('leaves an explicit "=" value exactly as written — no implicit wrapping', () => {
    expect(validateQuery('nameContains:=Name')).toMatchObject({ fields: [{ operator: '=', value: 'Name' }] });
  });

  it('leaves a value with an explicit "*" exactly as written — no double-wrapping', () => {
    expect(validateQuery('nameContains:Name*')).toMatchObject({ fields: [{ operator: 'LIKE', value: 'Name%' }] });
    expect(validateQuery('nameContains:*Name')).toMatchObject({ fields: [{ operator: 'LIKE', value: '%Name' }] });
  });

  it('does not double-wrap an explicit "*" on a "string"-typed field override under a non-string outer attribute', () => {
    const attributesWithStringOverride: AttributeMap = {
      price: { type: 'number', fields: [{ field: 'sku', type: 'string', wildcards: true }] },
    };

    expect(validate({ expression: parse('price:abc*'), attributes: attributesWithStringOverride })).toMatchObject({
      fields: [{ field: 'sku', operator: 'LIKE', value: 'abc%' }],
    });
  });

  it('does not apply to attributes without the option — an exact match, like today', () => {
    expect(validateQuery('name:Name')).toMatchObject({ fields: [{ operator: 'LIKE', value: 'Name' }] });
  });

  it('escapes literal "%", "_", and "!" in the auto-wrapped value', () => {
    expect(validateQuery('nameContains:100%')).toMatchObject({ fields: [{ value: '%100!%%' }] });
  });

  it('respects "caseSensitive: false" on the auto-wrapped value', () => {
    const attributesWithBoth: AttributeMap = { nameContains: { type: 'string', wildcards: true, caseSensitive: false } };

    expect(validate({ expression: parse('nameContains:Name'), attributes: attributesWithBoth })).toMatchObject({
      fields: [{ operator: 'LIKE', value: '%name%', caseSensitive: false }],
    });
  });

  it('does not apply to ordering operators — a plain ">" comparison stays a comparison', () => {
    expect(validateQuery('nameContains:>Name')).toMatchObject({ fields: [{ operator: '>', value: 'Name' }] });
  });

  it('applies to a bare term against "_all" too, since bare terms are ":" as well', () => {
    const attributesWithAllWildcards: AttributeMap = { _all: { type: 'string', fields: ['name', 'description'], wildcards: true } };

    expect(validate({ expression: parse('Name'), attributes: attributesWithAllWildcards })).toMatchObject({
      fields: [
        { field: 'name', operator: 'LIKE', value: '%Name%' },
        { field: 'description', operator: 'LIKE', value: '%Name%' },
      ],
    });
  });
});

describe('validate: "leftWildcard"/"rightWildcard" options (one-sided auto-wildcard)', () => {
  it('"leftWildcard" prefixes the value with "*" only — an ends-with match', () => {
    expect(validateQuery('nameEndsWith:Name')).toMatchObject({ fields: [{ operator: 'LIKE', value: '%Name' }] });
  });

  it('"rightWildcard" appends "*" to the value only — a starts-with match', () => {
    expect(validateQuery('nameStartsWith:Name')).toMatchObject({ fields: [{ operator: 'LIKE', value: 'Name%' }] });
  });

  it('"wildcards: true" is equivalent to both "leftWildcard" and "rightWildcard" together', () => {
    const attributesWithBoth: AttributeMap = { nameBoth: { type: 'string', leftWildcard: true, rightWildcard: true } };

    expect(validate({ expression: parse('nameBoth:Name'), attributes: attributesWithBoth })).toMatchObject({
      fields: [{ operator: 'LIKE', value: '%Name%' }],
    });
  });

  it('an explicit "*" still takes precedence — no additional one-sided wrapping', () => {
    expect(validateQuery('nameEndsWith:Name*')).toMatchObject({ fields: [{ operator: 'LIKE', value: 'Name%' }] });
    expect(validateQuery('nameStartsWith:*Name')).toMatchObject({ fields: [{ operator: 'LIKE', value: '%Name' }] });
  });

  it('an explicit "=" still requires an exact match — no implicit wrapping', () => {
    expect(validateQuery('nameEndsWith:=Name')).toMatchObject({ fields: [{ operator: '=', value: 'Name' }] });
    expect(validateQuery('nameStartsWith:=Name')).toMatchObject({ fields: [{ operator: '=', value: 'Name' }] });
  });
});

describe('validate: case sensitivity', () => {
  it('defaults to case-sensitive for string attributes', () => {
    expect(validateQuery('name:Fred')).toMatchObject({ fields: [{ value: 'Fred', caseSensitive: true }] });
  });

  it('lowercases the value for a case-insensitive attribute, marking the field as such', () => {
    expect(validateQuery('nameCaseInsensitive:Fred')).toMatchObject({ fields: [{ value: 'fred', caseSensitive: false }] });
  });

  it('lowercases wildcard values for a case-insensitive attribute too', () => {
    expect(validateQuery('nameCaseInsensitive:Fred*')).toMatchObject({
      fields: [{ operator: 'LIKE', value: 'fred%', caseSensitive: false }],
    });
  });

  it('lowercases ordering comparisons for a case-insensitive attribute too', () => {
    expect(validateQuery('nameCaseInsensitive:>Fred')).toMatchObject({
      fields: [{ operator: '>', value: 'fred', caseSensitive: false }],
    });
  });

  it('marks non-string predicates as case-sensitive regardless', () => {
    expect(validateQuery('status:online')).toMatchObject({ fields: [{ caseSensitive: true }] });
    expect(validateQuery('price:>100')).toMatchObject({ fields: [{ caseSensitive: true }] });
  });

  it('"caseSensitive: \'lower\'" behaves exactly like "false"', () => {
    const attributesWithLower: AttributeMap = { nameLower: { type: 'string', caseSensitive: 'lower' } };

    expect(validate({ expression: parse('nameLower:Fred'), attributes: attributesWithLower })).toMatchObject({
      fields: [{ value: 'fred', caseSensitive: 'lower' }],
    });
  });

  it('uppercases the value for "caseSensitive: \'upper\'", marking the field as such', () => {
    expect(validateQuery('nameCaseInsensitiveUpper:Fred')).toMatchObject({ fields: [{ value: 'FRED', caseSensitive: 'upper' }] });
  });

  it('uppercases wildcard values for "caseSensitive: \'upper\'" too', () => {
    expect(validateQuery('nameCaseInsensitiveUpper:Fred*')).toMatchObject({
      fields: [{ operator: 'LIKE', value: 'FRED%', caseSensitive: 'upper' }],
    });
  });

  it('a field-level override can declare its own "caseSensitive", independent of the outer attribute', () => {
    const attributesWithOverride: AttributeMap = {
      search: { type: 'string', fields: ['name', { field: 'description', type: 'string', caseSensitive: false }] },
    };

    expect(validate({ expression: parse('search:Fred'), attributes: attributesWithOverride })).toMatchObject({
      fields: [
        { field: 'name', value: 'Fred', caseSensitive: true },
        { field: 'description', value: 'fred', caseSensitive: false },
      ],
    });
  });
});

describe('validate: multi-field attributes', () => {
  it('defaults "fields" to a single-element array of the attribute key', () => {
    expect(validateQuery('name:Fred')).toMatchObject({ fields: [{ field: 'name' }] });
  });

  it('resolves an attribute\'s "fields" list instead of its own key', () => {
    expect(validateQuery('search:Fred')).toMatchObject({
      fields: [
        { field: 'name', operator: 'LIKE', value: 'Fred' },
        { field: 'description', operator: 'LIKE', value: 'Fred' },
      ],
    });
  });

  it('carries "fields" through wildcard matches', () => {
    expect(validateQuery('search:Fred*')).toMatchObject({
      fields: [
        { field: 'name', operator: 'LIKE', value: 'Fred%' },
        { field: 'description', operator: 'LIKE', value: 'Fred%' },
      ],
    });
  });

  it('treats every "fields" entry as a raw SQL expression, inserted verbatim', () => {
    const attributesWithRaw: AttributeMap = {
      search: { type: 'string', fields: ['name', 'CAST(id AS TEXT)'] },
    };
    const result = validate({ expression: parse('search:Fred'), attributes: attributesWithRaw });

    expect(result).toMatchObject({
      fields: [
        { field: 'name', value: 'Fred' },
        { field: 'CAST(id AS TEXT)', value: 'Fred' },
      ],
    });
  });

  it('rejects ordering operators for multi-field attributes', () => {
    for (const operator of ['>', '>=', '<', '<=']) {
      const [error] = tryCatch(() => validateQuery(`search:${operator}Fred`));

      expect(error).toBeInstanceOf(SearchCopError);
      expect((error as SearchCopError).code).toBe('INVALID_OPERATOR');
    }
  });

  it('allows ordering operators when "fields" has only a single element, unlike a real multi-field attribute', () => {
    const attributesWithSingleField: AttributeMap = {
      renamed: { type: 'number', fields: ['price'] },
    };

    for (const operator of ['>', '>=', '<', '<=']) {
      expect(validate({ expression: parse(`renamed:${operator}100`), attributes: attributesWithSingleField })).toMatchObject({
        fields: [{ field: 'price', operator, value: 100 }],
      });
    }
  });
});

describe('validate: field-level type overrides', () => {
  const attributesWithTypedField: AttributeMap = {
    search: { type: 'string', fields: ['name', { field: 'id', type: 'uuid' }] },
  };

  function validateTyped(query: string) {
    return validate({ expression: parse(query), attributes: attributesWithTypedField });
  }

  it('validates the overridden field independently, using its own type', () => {
    expect(validateTyped('search:550E8400-E29B-41D4-A716-446655440000')).toMatchObject({
      fields: [
        { field: 'name', value: '550E8400-E29B-41D4-A716-446655440000' },
        { field: 'id', value: '550e8400-e29b-41d4-a716-446655440000' },
      ],
    });
  });

  it('does not error when the value does not fit the override type — that field just never matches', () => {
    expect(validateTyped('search:Fred')).toMatchObject({
      fields: [
        { field: 'name', value: 'Fred' },
        { alwaysFalse: true },
      ],
    });
  });

  it('never matches an overridden non-string field under a wildcard query', () => {
    // Even a full, valid uuid can't satisfy a wildcard: the literal "*" is part of the
    // raw value being validated, and no uuid string legitimately contains one.
    expect(validateTyped('search:550e8400-e29b-41d4-a716-446655440000*')).toMatchObject({
      fields: [
        { field: 'name', operator: 'LIKE' },
        { alwaysFalse: true },
      ],
    });
  });

  it('supports enum overrides with their own "values"', () => {
    const attributesWithEnumOverride: AttributeMap = {
      search: { type: 'string', fields: ['name', { field: 'status', type: 'enum', values: ['online', 'offline'] }] },
    };

    expect(validate({ expression: parse('search:online'), attributes: attributesWithEnumOverride })).toMatchObject({
      fields: [{ field: 'name', value: 'online' }, { field: 'status', value: 'online' }],
    });
    expect(validate({ expression: parse('search:Fred'), attributes: attributesWithEnumOverride })).toMatchObject({
      fields: [{ field: 'name', value: 'Fred' }, { alwaysFalse: true }],
    });
  });
});

describe('validate: unparseable values never error, for any attribute — not just multi-field ones', () => {
  it('a plain uuid attribute queried with a non-uuid value never matches, instead of throwing', () => {
    expect(validateQuery('id:foo')).toEqual({
      type: 'predicate',
      fields: [{ alwaysFalse: true }],
      position: expect.any(Number),
    });
  });

  it('a plain enum attribute queried with an unknown value never matches, instead of throwing', () => {
    expect(validateQuery('status:banana')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });

  it('a plain boolean attribute queried with a non-boolean value never matches, instead of throwing', () => {
    expect(validateQuery('active:banana')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });

  it('a plain number attribute queried with a non-numeric value never matches, instead of throwing', () => {
    expect(validateQuery('price:>banana')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });

  it('a plain date attribute queried with a non-date value never matches, instead of throwing', () => {
    expect(validateQuery('releaseDate:>banana')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });
});

describe('validate: default field ("_all")', () => {
  it('does not error on a bare query when "_all" is not declared — it just never matches', () => {
    expect(validateQuery('Fred')).toMatchObject({ fields: [{ alwaysFalse: true }] });
  });

  it('validates a bare query like any other attribute once "_all" is declared', () => {
    const attributesWithAll: AttributeMap = { ...attributes, _all: { type: 'string', fields: ['name', 'description'] } };
    const result = validate({ expression: parse('Fred'), attributes: attributesWithAll });

    expect(result).toMatchObject({
      fields: [
        { field: 'name', operator: 'LIKE', value: 'Fred' },
        { field: 'description', operator: 'LIKE', value: 'Fred' },
      ],
    });
  });

  it('applies wildcard handling to bare queries the same as any string attribute', () => {
    const attributesWithAll: AttributeMap = { ...attributes, _all: { type: 'string', fields: ['name', 'description'] } };
    const result = validate({ expression: parse('Fred*'), attributes: attributesWithAll });

    expect(result).toMatchObject({
      fields: [
        { field: 'name', operator: 'LIKE', value: 'Fred%' },
        { field: 'description', operator: 'LIKE', value: 'Fred%' },
      ],
    });
  });

  it('supports a raw SQL expression in "_all"\'s fields for columns of an incompatible SQL type', () => {
    const attributesWithAll: AttributeMap = {
      ...attributes,
      _all: { type: 'string', fields: ['name', 'description', 'CAST(id AS TEXT)'] },
    };
    const result = validate({ expression: parse('Fred'), attributes: attributesWithAll });

    expect(result).toMatchObject({
      fields: [
        { field: 'name', operator: 'LIKE', value: 'Fred' },
        { field: 'description', operator: 'LIKE', value: 'Fred' },
        { field: 'CAST(id AS TEXT)', operator: 'LIKE', value: 'Fred' },
      ],
    });
  });

  it('supports a field-level type override in "_all", gracefully skipping when the value does not fit', () => {
    const attributesWithAll: AttributeMap = {
      ...attributes,
      _all: { type: 'string', fields: ['name', { field: 'id', type: 'uuid' }] },
    };
    const result = validate({ expression: parse('Fred'), attributes: attributesWithAll });

    expect(result).toMatchObject({ fields: [{ field: 'name', value: 'Fred' }, { alwaysFalse: true }] });
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
        {
          type: 'predicate',
          fields: [{ field: 'status', operator: '=', value: 'online', caseSensitive: true }],
          position: expect.any(Number),
        },
        {
          type: 'or',
          children: [
            {
              type: 'predicate',
              fields: [{ field: 'price', operator: '>', value: 100, caseSensitive: true }],
              position: expect.any(Number),
            },
            {
              type: 'predicate',
              fields: [{ field: 'status', operator: '=', value: 'offline', caseSensitive: true }],
              position: expect.any(Number),
            },
          ],
        },
      ],
    });
  });
});

describe('validate: negation (NOT)', () => {
  it('validates the negated predicate and wraps it in a "not" node', () => {
    expect(validateQuery('NOT status:online')).toEqual({
      type: 'not',
      child: {
        type: 'predicate',
        fields: [{ field: 'status', operator: '=', value: 'online', caseSensitive: true }],
        position: expect.any(Number),
      },
    });
  });

  it('validates every predicate inside a negated group', () => {
    const [error] = tryCatch(() => validateQuery('NOT (status:online AND unknown:foo)'));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('UNKNOWN_ATTRIBUTE');
  });

  it('carries an "alwaysFalse" field through negation unchanged (negation is purely a compile-time SQL concern)', () => {
    expect(validateQuery('NOT status:banana')).toEqual({
      type: 'not',
      child: { type: 'predicate', fields: [{ alwaysFalse: true }], position: expect.any(Number) },
    });
  });

  it('preserves double negation as nested "not" nodes', () => {
    expect(validateQuery('NOT NOT status:online')).toMatchObject({
      type: 'not',
      child: { type: 'not', child: { fields: [{ field: 'status', value: 'online' }] } },
    });
  });
});
