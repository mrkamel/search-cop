import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { search } from '../src/index.js';
import { AppDataSource } from './support/AppDataSource.js';
import { createArticle } from './support/factories.js';
import { ArticleRepository } from './support/ArticleRepository.js';
import type { AttributeMap } from '../src/attributes/types.js';

const attributes: AttributeMap = {
  _all: {
    type: 'fulltext',
    dialect: 'to_tsquery',
    fields: ["to_tsvector('simple', title || ' ' || body)"],
  },
};

const namedFieldAttributes: AttributeMap = {
  title: { type: 'fulltext', dialect: 'to_tsquery', fields: ["to_tsvector('simple', title)"] },
  body: { type: 'fulltext', dialect: 'to_tsquery', fields: ["to_tsvector('simple', body)"] },
};

const multiFieldAttributes: AttributeMap = {
  _all: {
    type: 'fulltext',
    dialect: 'to_tsquery',
    fields: ["to_tsvector('simple', title)", "to_tsvector('simple', body)"],
  },
};

const englishAttributes: AttributeMap = {
  _all: {
    type: 'fulltext',
    dialect: 'to_tsquery',
    language: 'english',
    fields: ["to_tsvector('english', title || ' ' || body)"],
  },
};

const withOtherAttributes: AttributeMap = { ...attributes, id: { type: 'number' } };

describe.skipIf(process.env.DATABASE !== 'postgres')('search: postgres fulltext (requires DATABASE=postgres)', () => {
  beforeAll(async () => {
    await AppDataSource.initialize();
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  afterEach(async () => {
    await ArticleRepository.clear();
  });

  it('matches a single term against the title or body', async () => {
    const match = await createArticle({ title: 'Name', body: 'Description' });

    await createArticle({ title: 'other', body: 'unknown' });

    const articles = await search({ repository: ArticleRepository, query: 'Name', attributes }).getMany();

    expect(articles.map((article) => article.id)).toEqual([match.id]);
  });

  it('fuses multiple bare AND-ed terms into a single combined match', async () => {
    const match = await createArticle({ title: 'Name Description', body: 'other' });

    await createArticle({ title: 'Name', body: 'other' });
    await createArticle({ title: 'Description', body: 'other' });

    const articles = await search({ repository: ArticleRepository, query: 'Name Description', attributes }).getMany();

    expect(articles.map((article) => article.id)).toEqual([match.id]);
  });

  it('fuses a negated bare term, excluding rows that contain it', async () => {
    const match = await createArticle({ title: 'Name', body: 'other' });

    await createArticle({ title: 'Name Description', body: 'other' });

    const articles = await search({ repository: ArticleRepository, query: 'Name -Description', attributes }).getMany();

    expect(articles.map((article) => article.id)).toEqual([match.id]);
  });

  it('fuses OR-combined bare terms', async () => {
    const first = await createArticle({ title: 'Name', body: 'other' });
    const second = await createArticle({ title: 'Description', body: 'other' });

    await createArticle({ title: 'unknown', body: 'other' });

    const articles = await search({ repository: ArticleRepository, query: 'Name OR Description', attributes }).getMany();

    expect(articles.map((article) => article.id).sort()).toEqual([first.id, second.id].sort());
  });

  describe('combined with non-fulltext predicates', () => {
    it('combines a fused fulltext term with an unrelated predicate via AND', async () => {
      const match = await createArticle({ title: 'Name Description', body: 'other' });
      const excluded = await createArticle({ title: 'Name Description', body: 'unknown' });

      const articles = await search({
        repository: ArticleRepository,
        query: `Name Description id:${match.id}`,
        attributes: withOtherAttributes,
      }).getMany();

      expect(articles.map((article) => article.id)).toEqual([match.id]);
      expect(articles.map((article) => article.id)).not.toContain(excluded.id);
    });

    it('still fuses fulltext siblings that are not textually adjacent in the query', async () => {
      const match = await createArticle({ title: 'Name Description', body: 'other' });

      await createArticle({ title: 'Name', body: 'other' });
      await createArticle({ title: 'Description', body: 'other' });

      const articles = await search({
        repository: ArticleRepository,
        query: `Name id:${match.id} Description`,
        attributes: withOtherAttributes,
      }).getMany();

      expect(articles.map((article) => article.id)).toEqual([match.id]);
    });

    it('combines a fulltext term with an unrelated predicate via OR', async () => {
      const fulltextMatch = await createArticle({ title: 'Name', body: 'other' });
      const idMatch = await createArticle({ title: 'unknown', body: 'other' });

      const excluded = await createArticle({ title: 'unknown', body: 'other' });

      const articles = await search({
        repository: ArticleRepository,
        query: `Name OR id:${idMatch.id}`,
        attributes: withOtherAttributes,
      }).getMany();

      expect(articles.map((article) => article.id).sort()).toEqual([fulltextMatch.id, idMatch.id].sort());
      expect(articles.map((article) => article.id)).not.toContain(excluded.id);
    });

    it('combines a fused fulltext term with a negated unrelated predicate', async () => {
      const match = await createArticle({ title: 'Name Description', body: 'other' });
      const excluded = await createArticle({ title: 'Name Description', body: 'other' });

      const articles = await search({
        repository: ArticleRepository,
        query: `Name Description -id:${excluded.id}`,
        attributes: withOtherAttributes,
      }).getMany();

      expect(articles.map((article) => article.id)).toEqual([match.id]);
    });

    it('fuses fulltext siblings within a group, alongside a separate non-fulltext OR group', async () => {
      const match = await createArticle({ title: 'Name Description', body: 'other' });
      const idMatch = await createArticle({ title: 'unknown', body: 'other' });

      await createArticle({ title: 'Name', body: 'other' });
      await createArticle({ title: 'unknown', body: 'other' });

      const articles = await search({
        repository: ArticleRepository,
        query: `Name Description OR (id:${idMatch.id} OR id:0)`,
        attributes: withOtherAttributes,
      }).getMany();

      expect(articles.map((article) => article.id).sort()).toEqual([match.id, idMatch.id].sort());
    });
  });

  it('fuses two predicates against the same explicitly-named fulltext attribute', async () => {
    const match = await createArticle({ title: 'Name Description', body: 'other' });

    await createArticle({ title: 'Name', body: 'Description' });

    const articles = await search({
      repository: ArticleRepository,
      query: 'title:Name title:Description',
      attributes: namedFieldAttributes,
    }).getMany();

    expect(articles.map((article) => article.id)).toEqual([match.id]);
  });

  it('does not fuse predicates against two different fulltext attributes', async () => {
    const match = await createArticle({ title: 'Name', body: 'Description' });

    await createArticle({ title: 'Name', body: 'other' });
    await createArticle({ title: 'other', body: 'Description' });

    const articles = await search({
      repository: ArticleRepository,
      query: 'title:Name body:Description',
      attributes: namedFieldAttributes,
    }).getMany();

    expect(articles.map((article) => article.id)).toEqual([match.id]);
  });

  it('ORs across multiple fields declared on one fulltext attribute', async () => {
    const titleMatch = await createArticle({ title: 'Name', body: 'other' });
    const bodyMatch = await createArticle({ title: 'other', body: 'Name' });

    await createArticle({ title: 'unknown', body: 'other' });

    const articles = await search({ repository: ArticleRepository, query: 'Name', attributes: multiFieldAttributes }).getMany();

    expect(articles.map((article) => article.id).sort()).toEqual([titleMatch.id, bodyMatch.id].sort());
  });

  // English stemming needs real word forms to demonstrate — bland placeholders can't show a stem relationship.
  it('uses the "language" option to control stemming', async () => {
    const match = await createArticle({ title: 'running', body: 'other' });

    const englishHits = await search({ repository: ArticleRepository, query: 'run', attributes: englishAttributes }).getMany();
    const simpleHits = await search({ repository: ArticleRepository, query: 'run', attributes }).getMany();

    expect(englishHits.map((article) => article.id)).toEqual([match.id]);
    expect(simpleHits.map((article) => article.id)).toEqual([]);
  });

  describe('wildcards', () => {
    it('matches a trailing-"*" prefix term against a word it starts with', async () => {
      const match = await createArticle({ title: 'Description', body: 'other' });

      await createArticle({ title: 'other', body: 'unknown' });

      const articles = await search({ repository: ArticleRepository, query: 'Desc*', attributes }).getMany();

      expect(articles.map((article) => article.id)).toEqual([match.id]);
    });

    it('does not match a word it is not a prefix of', async () => {
      await createArticle({ title: 'Description', body: 'other' });

      const articles = await search({ repository: ArticleRepository, query: 'scription*', attributes }).getMany();

      expect(articles.map((article) => article.id)).toEqual([]);
    });

    it('fuses a wildcard term together with a plain term', async () => {
      const match = await createArticle({ title: 'Name Description', body: 'other' });

      await createArticle({ title: 'Name', body: 'other' });

      const articles = await search({ repository: ArticleRepository, query: 'Name Desc*', attributes }).getMany();

      expect(articles.map((article) => article.id)).toEqual([match.id]);
    });
  });

  describe('special characters in a search term', () => {
    it('matches a term containing a literal single quote, without erroring', async () => {
      const match = await createArticle({ title: "Name's article", body: 'other' });

      const articles = await search({ repository: ArticleRepository, query: `"Name's"`, attributes }).getMany();

      expect(articles.map((article) => article.id)).toEqual([match.id]);
    });

    it('does not let a term containing "&" corrupt a fused query', async () => {
      const match = await createArticle({ title: 'Name', body: 'other' });
      const decoy = await createArticle({ title: 'Description', body: 'other' });

      const articles = await search({ repository: ArticleRepository, query: `Name "foo & bar"`, attributes }).getMany();

      expect(articles.map((article) => article.id)).toEqual([]);
      expect(articles.map((article) => article.id)).not.toContain(match.id);
      expect(articles.map((article) => article.id)).not.toContain(decoy.id);
    });
  });

  describe('dialect: "tsquery" (literal, tokenizer-controlled matching)', () => {
    const literalAttributes: AttributeMap = {
      _all: {
        type: 'fulltext',
        dialect: 'tsquery',
        fields: ["array_to_tsvector(regexp_split_to_array(title || ' ' || body, '\\s+'))"],
      },
    };

    it('matches a single term', async () => {
      const match = await createArticle({ title: 'Name', body: 'Description' });

      await createArticle({ title: 'other', body: 'unknown' });

      const articles = await search({ repository: ArticleRepository, query: 'Name', attributes: literalAttributes }).getMany();

      expect(articles.map((article) => article.id)).toEqual([match.id]);
    });

    it('fuses multiple bare AND-ed terms into a single combined match', async () => {
      const match = await createArticle({ title: 'Name Description', body: 'other' });

      await createArticle({ title: 'Name', body: 'other' });
      await createArticle({ title: 'Description', body: 'other' });

      const articles = await search({ repository: ArticleRepository, query: 'Name Description', attributes: literalAttributes }).getMany();

      expect(articles.map((article) => article.id)).toEqual([match.id]);
    });

    it('fuses a negated bare term, excluding rows that contain it', async () => {
      const match = await createArticle({ title: 'Name', body: 'other' });

      await createArticle({ title: 'Name Description', body: 'other' });

      const articles = await search({ repository: ArticleRepository, query: 'Name -Description', attributes: literalAttributes }).getMany();

      expect(articles.map((article) => article.id)).toEqual([match.id]);
    });

    it('matches a trailing-"*" prefix term against a word it starts with', async () => {
      const match = await createArticle({ title: 'Description', body: 'other' });

      await createArticle({ title: 'other', body: 'unknown' });

      const articles = await search({ repository: ArticleRepository, query: 'Desc*', attributes: literalAttributes }).getMany();

      expect(articles.map((article) => article.id)).toEqual([match.id]);
    });

    it('matches a term containing a literal single quote or "&", without erroring', async () => {
      const match = await createArticle({ title: "Name's & Co", body: 'other' });

      const quoteHits = await search({ repository: ArticleRepository, query: `"Name's"`, attributes: literalAttributes }).getMany();
      const ampersandHits = await search({ repository: ArticleRepository, query: '"&"', attributes: literalAttributes }).getMany();

      expect(quoteHits.map((article) => article.id)).toEqual([match.id]);
      expect(ampersandHits.map((article) => article.id)).toEqual([match.id]);
    });

    // The motivating scenario: a token containing ":" or "&" survives as one literal lexeme
    // end-to-end, unlike "to_tsquery"/"to_tsvector" which would split it into two words.
    it('matches a token containing ":" or "&" as a single literal lexeme, not two words', async () => {
      const colonMatch = await createArticle({ title: 'status:online', body: 'other' });
      const ampersandMatch = await createArticle({ title: 'foo&bar', body: 'other' });

      const decoy = await createArticle({ title: 'status online foo bar', body: 'other' });

      const colonHits = await search({ repository: ArticleRepository, query: '"status:online"', attributes: literalAttributes }).getMany();
      const ampersandHits = await search({ repository: ArticleRepository, query: '"foo&bar"', attributes: literalAttributes }).getMany();

      expect(colonHits.map((article) => article.id)).toEqual([colonMatch.id]);
      expect(colonHits.map((article) => article.id)).not.toContain(decoy.id);
      expect(ampersandHits.map((article) => article.id)).toEqual([ampersandMatch.id]);
      expect(ampersandHits.map((article) => article.id)).not.toContain(decoy.id);
    });

    it('never matches a multi-token term with "phrases: true" against a position-less vector', async () => {
      const phraseAttributes: AttributeMap = {
        _all: {
          type: 'fulltext',
          dialect: 'tsquery',
          phrases: true,
          fields: ["array_to_tsvector(regexp_split_to_array(title || ' ' || body, '\\s+'))"],
        },
      };

      await createArticle({ title: 'Name Description', body: 'other' });

      const articles = await search({ repository: ArticleRepository, query: '"Name Description"', attributes: phraseAttributes }).getMany();

      expect(articles.map((article) => article.id)).toEqual([]);
    });

    it('uses a custom "tokenize" function to control what counts as a token', async () => {
      const commaAttributes: AttributeMap = {
        _all: {
          type: 'fulltext',
          dialect: 'tsquery',
          fields: ["array_to_tsvector(regexp_split_to_array(title, ','))"],
          tokenize: (value) => value.split(','),
        },
      };

      const match = await createArticle({ title: 'foo,bar', body: 'other' });

      await createArticle({ title: 'foo bar', body: 'other' });

      const articles = await search({ repository: ArticleRepository, query: '"foo,bar"', attributes: commaAttributes }).getMany();

      expect(articles.map((article) => article.id)).toEqual([match.id]);
    });
  });
});
