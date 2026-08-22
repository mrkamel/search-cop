import { Brackets } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from '../../src/parser/parser.js';
import { validate } from '../../src/validator/validator.js';
import { compile, compileCondition } from '../../src/compiler/typeorm.js';
import { AppDataSource } from '../support/AppDataSource.js';
import { SearchCopError } from '../../src/errors/errors.js';
import { tryCatch } from '../../src/utils/tryCatch.js';
import type { AttributeMap } from '../../src/attributes/types.js';
import { ProductRepository } from '../support/ProductRepository.js';

const attributes: AttributeMap = {
  status: { type: 'enum', values: ['online', 'offline', 'pending'] },
  price: { type: 'number' },
  createdAt: { type: 'datetime' },
  name: { type: 'string' },
};

// Same "name" column as above, but declared case-insensitive.
const caseInsensitiveAttributes: AttributeMap = {
  name: { type: 'string', caseSensitive: false },
};

const multiFieldAttributes: AttributeMap = {
  search: { type: 'string', fields: ['name', 'description'] },
};

const defaultFieldAttributes: AttributeMap = {
  _all: { type: 'string', fields: ['name', 'description'] },
};

// "price" is a number column — casting it to TEXT lets it be searched as part of a
// string-typed multi-field group without the database rejecting a non-numeric value.
const rawFieldAttributes: AttributeMap = {
  search: { type: 'string', fields: ['name', 'CAST(price AS TEXT)'] },
};

const typedFieldAttributes: AttributeMap = {
  search: { type: 'string', fields: ['name', { field: 'price', type: 'number' }] },
};

const uuidAttributes: AttributeMap = {
  id: { type: 'uuid' },
};

const nullAttributes: AttributeMap = {
  assigned: { type: 'null', isNull: ['false', 'no'], isNotNull: ['true', 'yes'] },
};

const wildcardOptionAttributes: AttributeMap = {
  name: { type: 'string', wildcards: true },
};

beforeAll(async () => {
  await AppDataSource.initialize();
});

afterAll(async () => {
  await AppDataSource.destroy();
});

function compileQuery({ query, attributeMap = attributes, alias }: { query: string; attributeMap?: AttributeMap; alias?: string }) {
  const validated = validate({ expression: parse(query), attributes: attributeMap });

  return compile({ repository: ProductRepository, expression: validated, alias });
}

// Reads the query pre-driver-escaping (still ":paramName" placeholders — no dialect-specific
// "?"/"$1" syntax, and no sqlite-only numeric-literal inlining), so assertions here hold
// identically regardless of which database AppDataSource currently points at.
function getSqlAndParams(queryBuilder: { getQuery(): string, getParameters(): Record<string, unknown> }): [string, unknown[]] {
  const parameters = queryBuilder.getParameters();
  const params: unknown[] = [];
  // Negative lookbehind excludes Postgres's "::" cast operator (e.g. "(:param)::tsquery"),
  // which would otherwise be misread as a second placeholder named "tsquery".
  const sql = queryBuilder.getQuery().replace(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => {
    params.push(parameters[name]);

    return '?';
  });

  return [sql, params];
}

describe('compile: simple predicates', () => {
  it('compiles equality', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'status:online' }));

    expect(sql).toContain('status = ?');
    expect(params).toEqual(['online']);
  });

  it('compiles comparison operators', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'price:>100' }));

    expect(sql).toContain('price > ?');
    expect(params).toEqual([100]);
  });
});

describe('compile: boolean expressions', () => {
  it('combines predicates with AND', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'status:online AND price:>100' }));

    expect(sql).toMatch(/status = \? AND .*price > \?/);
    expect(params).toEqual(['online', 100]);
  });

  it('combines predicates with OR', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'status:online OR status:pending' }));

    expect(sql).toMatch(/status = \? OR .*status = \?/);
    expect(params).toEqual(['online', 'pending']);
  });

  it('preserves parenthesized precedence: "(A OR B) AND C"', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: '(status:online OR status:pending) AND price:>100' }));

    expect(sql).toMatch(/\(.*status = \? OR .*status = \?.*\) AND .*price > \?/);
    expect(params).toEqual(['online', 'pending', 100]);
  });

  it('preserves default precedence: "A OR B AND C" = "A OR (B AND C)"', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'status:online OR status:pending AND price:>100' }));

    expect(sql).toMatch(/status = \? OR .*status = \? AND .*price > \?/);
    expect(params).toEqual(['online', 'pending', 100]);
  });

  it('uses a unique parameter for every predicate, even for repeated fields', () => {
    const parameters = compileQuery({ query: 'status:online OR status:offline' }).getParameters();

    expect(new Set(Object.keys(parameters)).size).toBe(2);
  });

  it('never interpolates string values directly into the SQL string', () => {
    const [sql] = getSqlAndParams(compileQuery({ query: 'status:online' }));

    expect(sql).not.toContain('online');
  });
});

describe('compile: wildcards', () => {
  it('compiles a wildcard equality predicate to LIKE with an ESCAPE clause', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'name:Pet*' }));

    expect(sql).toContain(`name LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['Pet%']);
  });

  it('escapes literal "%" and "_" so they are not treated as LIKE wildcards', () => {
    const [, params] = getSqlAndParams(compileQuery({ query: 'name:100%_off*' }));

    expect(params).toEqual(['100!%!_off%']);
  });
});

describe('compile: escaped wildcards ("\\*")', () => {
  it('compiles an escaped-only "\\*" to a literal "*", not a wildcard', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'name:Name\\*' }));

    expect(sql).toContain(`name LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['Name*']);
  });

  it('compiles a real wildcard combined with an escaped "\\*" to a LIKE pattern with a literal "*" in it', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'name:*Name\\*Other' }));

    expect(sql).toContain(`name LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['%Name*Other']);
  });

  it('throws when compiling a real "*" that is not at the start/end of the value', () => {
    const [error] = tryCatch(() => compileQuery({ query: 'name:Name*Other' }));

    expect(error).toBeInstanceOf(SearchCopError);
    expect((error as SearchCopError).code).toBe('INVALID_WILDCARD');
  });
});

describe('compile: "wildcards" option (implicit contains matching)', () => {
  it('compiles a bare-colon value to a "%...%" LIKE pattern', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'name:Name', attributeMap: wildcardOptionAttributes }));

    expect(sql).toContain(`name LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['%Name%']);
  });

  it('compiles an explicit "=" value to a plain equality, not LIKE', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'name:=Name', attributeMap: wildcardOptionAttributes }));

    expect(sql).toContain('name = ?');
    expect(params).toEqual(['Name']);
  });

  it('"leftWildcard" prefixes the value with "%" only', () => {
    const leftWildcardAttributes: AttributeMap = { name: { type: 'string', leftWildcard: true } };
    const [, params] = getSqlAndParams(compileQuery({ query: 'name:Name', attributeMap: leftWildcardAttributes }));

    expect(params).toEqual(['%Name']);
  });

  it('"rightWildcard" appends "%" to the value only', () => {
    const rightWildcardAttributes: AttributeMap = { name: { type: 'string', rightWildcard: true } };
    const [, params] = getSqlAndParams(compileQuery({ query: 'name:Name', attributeMap: rightWildcardAttributes }));

    expect(params).toEqual(['Name%']);
  });
});

describe('compile: case sensitivity', () => {
  it('leaves the column bare for a case-sensitive attribute', () => {
    const [sql] = getSqlAndParams(compileQuery({ query: 'name:Value' }));

    expect(sql).toContain(`name LIKE ? ESCAPE '!'`);
    expect(sql).not.toContain('LOWER');
  });

  it('wraps the column in LOWER() for a case-insensitive attribute, and lowercases the bound value', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'name:Value', attributeMap: caseInsensitiveAttributes }));

    expect(sql).toContain(`LOWER(name) LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['value']);
  });

  it('wraps the column in LOWER() for a case-insensitive wildcard too', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'name:Value*', attributeMap: caseInsensitiveAttributes }));

    expect(sql).toContain(`LOWER(name) LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['value%']);
  });

  it('wraps the column in UPPER() for "caseSensitive: \'upper\'", and uppercases the bound value', () => {
    const upperCaseAttributes: AttributeMap = { name: { type: 'string', caseSensitive: 'upper' } };
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'name:Value', attributeMap: upperCaseAttributes }));

    expect(sql).toContain(`UPPER(name) LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['VALUE']);
  });

  it('applies a field-level override\'s own "caseSensitive", independent of the outer attribute\'s', () => {
    const mixedCaseAttributes: AttributeMap = {
      search: { type: 'string', fields: ['name', { field: 'description', type: 'string', caseSensitive: false }] },
    };
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'search:Value', attributeMap: mixedCaseAttributes }));

    expect(sql).toContain(`(name LIKE ? ESCAPE '!' OR LOWER(description) LIKE ? ESCAPE '!')`);
    expect(params).toEqual(['Value', 'value']);
  });
});

describe('compile: multi-field attributes', () => {
  it('ORs together each field for a bare-colon value', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'search:Value', attributeMap: multiFieldAttributes }));

    expect(sql).toContain(`(name LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!')`);
    expect(params).toEqual(['Value', 'Value']);
  });

  it('ORs together each field for a wildcard match', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'search:Value*', attributeMap: multiFieldAttributes }));

    expect(sql).toContain(`(name LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!')`);
    expect(params).toEqual(['Value%', 'Value%']);
  });

  it('uses a unique parameter for every field', () => {
    const parameters = compileQuery({ query: 'search:Value', attributeMap: multiFieldAttributes }).getParameters();

    expect(new Set(Object.keys(parameters)).size).toBe(2);
  });

  it('does not add its own extra bracket around a single-field predicate', () => {
    // The outer Brackets wrapping the whole expression is pre-existing/unrelated;
    // a single-field predicate must not additionally double that nesting itself.
    const [sql] = getSqlAndParams(compileQuery({ query: 'status:online' }));

    expect(sql).not.toContain('((status');
  });

  it('inserts a "raw" field verbatim, unescaped and unqualified, leaving other fields bare', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'search:Value', attributeMap: rawFieldAttributes }));

    expect(sql).toContain(`(name LIKE ? ESCAPE '!' OR CAST(price AS TEXT) LIKE ? ESCAPE '!')`);
    expect(params).toEqual(['Value', 'Value']);
  });

  it('applies a "raw" field under a wildcard match too', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'search:Value*', attributeMap: rawFieldAttributes }));

    expect(sql).toContain(`CAST(price AS TEXT) LIKE ? ESCAPE '!'`);
    expect(params).toEqual(['Value%', 'Value%']);
  });
});

describe('compile: field-level type overrides', () => {
  it('converts the overridden field using its own type', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'search:100', attributeMap: typedFieldAttributes }));

    expect(sql).toContain(`name LIKE ? ESCAPE '!'`);
    expect(sql).toContain('price = ?');
    expect(params).toEqual(['100', 100]);
  });

  it('compiles a non-matching overridden field to an unconditional "1 = 0", not an error', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'search:Value', attributeMap: typedFieldAttributes }));

    expect(sql).toContain(`(name LIKE ? ESCAPE '!' OR 1 = 0)`);
    expect(params).toEqual(['Value']);
  });
});

describe('compile: unparseable values compile to "1 = 0" for any attribute, not just multi-field ones', () => {
  it('does not throw, and compiles to an unconditional false', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'id:foo', attributeMap: uuidAttributes }));

    expect(sql).toContain('1 = 0');
    expect(params).toEqual([]);
  });

  it('still compiles normally when the value is valid', () => {
    const [sql, params] = getSqlAndParams(compileQuery({
      query: 'id:550e8400-e29b-41d4-a716-446655440000',
      attributeMap: uuidAttributes,
    }));

    expect(sql).toContain('id = ?');
    expect(params).toEqual(['550e8400-e29b-41d4-a716-446655440000']);
  });
});

describe('compile: "null" attributes', () => {
  it('compiles an "isNull" value to "IS NULL", with no bound parameter', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'assigned:no', attributeMap: nullAttributes }));

    expect(sql).toContain('assigned IS NULL');
    expect(params).toEqual([]);
  });

  it('compiles an "isNotNull" value to "IS NOT NULL", with no bound parameter', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'assigned:yes', attributeMap: nullAttributes }));

    expect(sql).toContain('assigned IS NOT NULL');
    expect(params).toEqual([]);
  });

  it('compiles an unknown value to an unconditional "1 = 0", not an error', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'assigned:maybe', attributeMap: nullAttributes }));

    expect(sql).toContain('1 = 0');
    expect(params).toEqual([]);
  });
});

describe('compile: default field ("_all")', () => {
  it('compiles a bare query against "_all", OR-ing its configured fields', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'Value', attributeMap: defaultFieldAttributes }));

    expect(sql).toContain(`(name LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!')`);
    expect(params).toEqual(['Value', 'Value']);
  });

  it('ANDs multiple bare terms together (free-text search)', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'red shoes', attributeMap: defaultFieldAttributes }));

    expect(sql).toMatch(/\(name LIKE \? ESCAPE '!' OR description LIKE \? ESCAPE '!'\) AND \(name LIKE \? ESCAPE '!' OR description LIKE \? ESCAPE '!'\)/);
    expect(params).toEqual(['red', 'red', 'shoes', 'shoes']);
  });
});

describe('compile: alias', () => {
  it('defaults the alias to the entity\'s table name', () => {
    const [sql] = getSqlAndParams(compileQuery({ query: 'status:online' }));

    expect(sql).toContain('FROM "products" "products"');
    // The alias only affects the FROM/SELECT clauses TypeORM generates on its own —
    // fields are inserted verbatim into WHERE, so the column stays unqualified here.
    expect(sql).toContain('status = ?');
  });

  it('uses an explicitly provided alias instead', () => {
    const [sql] = getSqlAndParams(compileQuery({ query: 'status:online', alias: 'p' }));

    expect(sql).toContain('FROM "products" "p"');
    expect(sql).toContain('status = ?');
  });
});

describe('compile: negation (NOT)', () => {
  // NOT's content is rendered to a single string and wrapped in exactly one
  // "COALESCE(..., FALSE)" — see src/compiler/typeorm.ts's renderNegated — so a NULL
  // column can't make the un-negated expression evaluate to NULL/UNKNOWN, which would
  // otherwise make SQL's NOT(...) also NULL and silently drop that row from the results.
  it('wraps a negated predicate in NOT(COALESCE(..., FALSE))', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'NOT status:online' }));

    expect(sql).toContain('NOT(COALESCE((status = ?), FALSE))');
    expect(params).toEqual(['online']);
  });

  it('wraps a negated group in NOT(COALESCE(..., FALSE)), preserving the AND/OR structure inside', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'NOT (status:online OR status:pending)' }));

    expect(sql).toContain('NOT(COALESCE((status = ? OR status = ?), FALSE))');
    expect(params).toEqual(['online', 'pending']);
  });

  it('combines a negated term with a non-negated one via implicit AND', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'NOT status:online price:>100' }));

    expect(sql).toMatch(/NOT\(COALESCE\(\(status = \?\), FALSE\)\) AND .*price > \?/);
    expect(params).toEqual(['online', 100]);
  });

  it('double negation compiles to nested NOT(COALESCE(...))', () => {
    const [sql] = getSqlAndParams(compileQuery({ query: 'NOT NOT status:online' }));

    expect(sql).toContain('NOT(COALESCE((NOT(COALESCE((status = ?), FALSE))), FALSE))');
  });

  it('negates a multi-field OR group as a whole, not each field independently', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'NOT search:Value', attributeMap: multiFieldAttributes }));

    expect(sql).toContain(`NOT(COALESCE(((name LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!')), FALSE))`);
    expect(params).toEqual(['Value', 'Value']);
  });

  it('negating an unparseable ("1 = 0") predicate compiles to an unconditional true', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'NOT id:foo', attributeMap: uuidAttributes }));

    expect(sql).toContain('NOT(COALESCE((1 = 0), FALSE))');
    expect(params).toEqual([]);
  });
});

describe('compile: "fulltext" attributes', () => {
  const fulltextAttributes: AttributeMap = {
    _all: { type: 'fulltext', dialect: 'to_tsquery', fields: ["to_tsvector('simple', name || ' ' || description)"] },
    status: { type: 'enum', values: ['online', 'offline', 'pending'] },
  };

  it('compiles a single term to "@@ to_tsquery(...)", defaulting the language to "simple", bound as a parameter', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'word1', attributeMap: fulltextAttributes }));

    expect(sql).toContain(`to_tsvector('simple', name || ' ' || description) @@ to_tsquery(?, ?)`);
    expect(params).toEqual(['simple', `'word1'`]);
  });

  it('uses an explicit "language" option instead of the default', () => {
    const attributesWithLanguage: AttributeMap = {
      _all: { type: 'fulltext', dialect: 'to_tsquery', language: 'english', fields: ['search_vector'] },
    };
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'word1', attributeMap: attributesWithLanguage }));

    expect(sql).toContain(`search_vector @@ to_tsquery(?, ?)`);
    expect(params).toEqual(['english', `'word1'`]);
  });

  it('appends ":*" for a trailing-"*" wildcard term', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'word1*', attributeMap: fulltextAttributes }));

    expect(sql).toContain(`@@ to_tsquery(?, ?)`);
    expect(params).toEqual(['simple', `'word1':*`]);
  });

  it('fuses multiple bare AND-ed terms into a single @@ call with one combined parameter', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'word1 word2', attributeMap: fulltextAttributes }));

    expect(sql.match(/@@/g)).toHaveLength(1);
    expect(params).toEqual(['simple', `'word1' & 'word2'`]);
  });

  it('fuses a negated bare term into a "!"-prefixed term in the same combined parameter', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'word1 -word2', attributeMap: fulltextAttributes }));

    expect(sql.match(/@@/g)).toHaveLength(1);
    expect(params).toEqual(['simple', `'word1' & !'word2'`]);
  });

  it('fuses OR-combined bare terms with "|"', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'word1 OR word2', attributeMap: fulltextAttributes }));

    expect(sql.match(/@@/g)).toHaveLength(1);
    expect(params).toEqual(['simple', `'word1' | 'word2'`]);
  });

  it('combines a fused fulltext term with an unrelated predicate via AND, without fusing across them', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'word1 word2 status:online', attributeMap: fulltextAttributes }));

    expect(sql.match(/@@/g)).toHaveLength(1);
    expect(sql).toMatch(/@@ to_tsquery\(\?, \?\).*AND.*status = \?/);
    expect(params).toEqual(['simple', `'word1' & 'word2'`, 'online']);
  });

  it('still fuses fulltext siblings that are not textually adjacent, on either side of a non-fulltext predicate', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'word1 status:online word2', attributeMap: fulltextAttributes }));

    expect(sql.match(/@@/g)).toHaveLength(1);
    expect(params).toEqual(['simple', `'word1' & 'word2'`, 'online']);
  });

  it('fuses fulltext siblings within one OR group, alongside a separate non-fulltext OR group', () => {
    const [sql, params] = getSqlAndParams(compileQuery({
      query: 'word1 word2 OR (status:online OR status:pending)',
      attributeMap: fulltextAttributes,
    }));

    expect(sql.match(/@@/g)).toHaveLength(1);
    expect(sql).toMatch(/@@ to_tsquery\(\?, \?\).*OR.*status = \?.*OR.*status = \?/);
    expect(params).toEqual(['simple', `'word1' & 'word2'`, 'online', 'pending']);
  });

  describe('fusion across explicitly-named fulltext attributes (not just "_all")', () => {
    const twoFulltextAttributes: AttributeMap = {
      title: { type: 'fulltext', dialect: 'to_tsquery', fields: ['title_vector'] },
      body: { type: 'fulltext', dialect: 'to_tsquery', fields: ['body_vector'] },
    };

    it('fuses two predicates against the same named fulltext attribute into a single @@ call', () => {
      const [sql, params] = getSqlAndParams(compileQuery({ query: 'title:word1 title:word2', attributeMap: twoFulltextAttributes }));

      expect(sql.match(/@@/g)).toHaveLength(1);
      expect(sql).toContain(`title_vector @@ to_tsquery(?, ?)`);
      expect(params).toEqual(['simple', `'word1' & 'word2'`]);
    });

    it('does not fuse predicates against two different fulltext attributes', () => {
      const [sql, params] = getSqlAndParams(compileQuery({ query: 'title:word1 body:word2', attributeMap: twoFulltextAttributes }));

      expect(sql.match(/@@/g)).toHaveLength(2);
      expect(sql).toMatch(/title_vector @@ to_tsquery\(\?, \?\).*AND.*body_vector @@ to_tsquery\(\?, \?\)/);
      expect(params).toEqual(['simple', `'word1'`, 'simple', `'word2'`]);
    });
  });
});

describe('compile: "fulltext" attributes with dialect "tsquery"', () => {
  const literalFulltextAttributes: AttributeMap = {
    _all: { type: 'fulltext', dialect: 'tsquery', fields: ["array_to_tsvector(regexp_split_to_array(name, '\\s+'))"] },
  };

  it('compiles to "@@ (:param)::tsquery", with no language parameter bound', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'word1', attributeMap: literalFulltextAttributes }));

    expect(sql).toContain(`array_to_tsvector(regexp_split_to_array(name, '\\s+')) @@ (?)::tsquery`);
    expect(params).toEqual([`'word1'`]);
  });

  it('joins a tokenized multi-word term with "&", not "<->"', () => {
    const [, params] = getSqlAndParams(compileQuery({ query: '"foo bar"', attributeMap: literalFulltextAttributes }));

    expect(params).toEqual([`'foo' & 'bar'`]);
  });

  it('joins with "<->" instead when "phrases: true" is set', () => {
    const phraseAttributes: AttributeMap = {
      _all: { type: 'fulltext', dialect: 'tsquery', phrases: true, fields: ["array_to_tsvector(regexp_split_to_array(name, '\\s+'))"] },
    };

    const [, params] = getSqlAndParams(compileQuery({ query: '"foo bar"', attributeMap: phraseAttributes }));

    expect(params).toEqual([`'foo' <-> 'bar'`]);
  });

  it('appends ":*" only to the last token of a wildcarded multi-word term', () => {
    const [, params] = getSqlAndParams(compileQuery({ query: '"foo bar*"', attributeMap: literalFulltextAttributes }));

    expect(params).toEqual([`'foo' & 'bar':*`]);
  });

  it('fuses multiple bare AND-ed terms into a single @@ call with one combined parameter', () => {
    const [sql, params] = getSqlAndParams(compileQuery({ query: 'word1 word2', attributeMap: literalFulltextAttributes }));

    expect(sql.match(/@@/g)).toHaveLength(1);
    expect(params).toEqual([`'word1' & 'word2'`]);
  });

  it('uses a custom "tokenize" function instead of the default whitespace split', () => {
    const commaTokenizedAttributes: AttributeMap = {
      _all: {
        type: 'fulltext',
        dialect: 'tsquery',
        fields: ["array_to_tsvector(regexp_split_to_array(name, ','))"],
        tokenize: (value) => value.split(','),
      },
    };

    const [, params] = getSqlAndParams(compileQuery({ query: '"foo,bar"', attributeMap: commaTokenizedAttributes }));

    expect(params).toEqual([`'foo' & 'bar'`]);
  });
});

describe('compileCondition', () => {
  function compileConditionQuery(query: string, attributeMap: AttributeMap = attributes): Brackets {
    const validated = validate({ expression: parse(query), attributes: attributeMap });

    return compileCondition(validated);
  }

  it('returns a Brackets fragment, not a full queryBuilder', () => {
    expect(compileConditionQuery('status:online')).toBeInstanceOf(Brackets);
  });

  it('applies correctly when merged via andWhere() onto a queryBuilder built independently', () => {
    const queryBuilder = ProductRepository.createQueryBuilder('products');

    queryBuilder.andWhere(compileConditionQuery('status:online AND price:>100'));

    const [sql, params] = getSqlAndParams(queryBuilder);

    expect(sql).toMatch(/status = \? AND .*price > \?/);
    expect(params).toEqual(['online', 100]);
  });

  it('composes with conditions already present on the queryBuilder, instead of replacing them', () => {
    const queryBuilder = ProductRepository.createQueryBuilder('products').andWhere('products.status = :status', { status: 'online' });

    queryBuilder.andWhere(compileConditionQuery('price:>100'));

    const [sql, params] = getSqlAndParams(queryBuilder);

    expect(sql).toMatch(/"products"\."status" = \?.*AND.*price > \?/);
    expect(params).toEqual(['online', 100]);
  });
});
