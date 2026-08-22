import type { FulltextEngine, ValidatedExpression, ValidatedField, ValidatedPredicate } from '../validator/types.js';

type Combinator = 'and' | 'or';

type FulltextTerm =
  | { value: string, wildcard: boolean, negated: boolean }
  | { raw: string, negated: boolean };

type FulltextField = {
  field: string,
  fulltext: FulltextEngine,
  term: string,
  wildcard: boolean,
  phrases: boolean,
  language: string,
  tokenize?: (value: string) => string[],
};

type FusedFulltextField = {
  field: string,
  fulltext: FulltextEngine,
  combinedQuery: string,
  language: string,
};

type FulltextCandidate = {
  engine: FulltextEngine,
  languages: string[],
  fieldShape: string[],
  values: string[],
  wildcard: boolean,
  phrases: boolean,
  tokenize?: (value: string) => string[],
  negated: boolean,
  // true when `values` are already-rendered tsquery text rather than raw terms needing quoting.
  raw: boolean,
  position?: number,
};

type FulltextCombinerOptions = {
  combinator: Combinator,
  terms: FulltextTerm[],
  phrases: boolean,
  tokenize?: (value: string) => string[],
};

type FulltextCombiner = (options: FulltextCombinerOptions) => string;

function quoteTsqueryLexeme(word: string): string {
  return `'${word.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

function joinLexemes({ words, phrases }: { words: string[], phrases: boolean }): string {
  return words.join(phrases ? ' <-> ' : ' & ');
}

function combineTerms(
  { combinator, terms, renderTerm }:
  { combinator: Combinator, terms: FulltextTerm[], renderTerm: (term: { value: string, wildcard: boolean, negated: boolean }) => string },
): string {
  const rendered = terms.map((term) => {
    if ('raw' in term) return term.negated ? `!(${term.raw})` : `(${term.raw})`;

    const value = renderTerm(term);

    return term.negated ? `!${value}` : value;
  });

  return rendered.join(combinator === 'or' ? ' | ' : ' & ');
}

// to_tsquery() re-tokenizes lexemes itself, so splitting is only needed to place ":*" for wildcards.
function renderToTsqueryTerm({ value, wildcard, phrases }: { value: string, wildcard: boolean, phrases: boolean }): string {
  if (!wildcard) return quoteTsqueryLexeme(value);

  const words = value.split(/\s+/).filter((word) => word.length > 0).map(quoteTsqueryLexeme);
  const lastIndex = words.length - 1;

  words[lastIndex] = `${words[lastIndex]}:*`;

  return joinLexemes({ words, phrases });
}

function combineToTsquery({ combinator, terms, phrases }: FulltextCombinerOptions): string {
  return combineTerms({ combinator, terms, renderTerm: (term) => renderToTsqueryTerm({ value: term.value, wildcard: term.wildcard, phrases }) });
}

// Raw ::tsquery cast takes lexemes literally, so `tokenize` (not Postgres) controls splitting.
function renderTsqueryLiteralTerm(
  { value, wildcard, phrases, tokenize }:
  { value: string, wildcard: boolean, phrases: boolean, tokenize: (value: string) => string[] },
): string {
  const words = tokenize(value).map(quoteTsqueryLexeme);
  const lastIndex = words.length - 1;

  if (wildcard) words[lastIndex] = `${words[lastIndex]}:*`;

  return joinLexemes({ words, phrases });
}

function combineTsqueryLiteral({ combinator, terms, phrases, tokenize }: FulltextCombinerOptions): string {
  return combineTerms({
    combinator,
    terms,
    renderTerm: (term) => renderTsqueryLiteralTerm({ value: term.value, wildcard: term.wildcard, phrases, tokenize: tokenize! }),
  });
}

const COMBINERS: Record<FulltextEngine, FulltextCombiner> = {
  to_tsquery: combineToTsquery,
  tsquery: combineTsqueryLiteral,
};

const CONDITION_RENDERERS: Record<FulltextEngine, FulltextConditionRenderer> = {
  to_tsquery: ({ field, parameterName, languageParameterName }) => `${field} @@ to_tsquery(:${languageParameterName}, :${parameterName})`,
  tsquery: ({ field, parameterName }) => `${field} @@ (:${parameterName})::tsquery`,
};

export function combineFulltextTerms(
  { engine, combinator, terms, phrases, tokenize }:
  { engine: FulltextEngine, combinator: Combinator, terms: FulltextTerm[], phrases: boolean, tokenize?: (value: string) => string[] },
): string {
  return COMBINERS[engine]({ combinator, terms, phrases, tokenize });
}

type FulltextConditionRenderer = (options: { field: string, parameterName: string, languageParameterName?: string }) => string;

export function renderFulltextCondition(
  { engine, field, parameterName, languageParameterName }:
  { engine: FulltextEngine, field: string, parameterName: string, languageParameterName?: string },
): string {
  return CONDITION_RENDERERS[engine]({ field, parameterName, languageParameterName });
}

function isFulltextField(field: ValidatedField): field is FulltextField {
  return 'fulltext' in field && 'term' in field;
}

function isFusedFulltextField(field: ValidatedField): field is FusedFulltextField {
  return 'fulltext' in field && 'combinedQuery' in field;
}

// Excludes "phrases" - a raw candidate's phrase-joining is already baked into its rendered text.
function candidateShapeKey(candidate: FulltextCandidate): string {
  return JSON.stringify([candidate.engine, candidate.fieldShape, candidate.languages]);
}

function asFulltextCandidate(child: ValidatedExpression): FulltextCandidate | null {
  if (child.type === 'predicate' && child.fields.length > 0 && child.fields.every(isFulltextField)) {
    const fields = child.fields as FulltextField[];
    const { fulltext: engine, wildcard, phrases, tokenize } = fields[0]!;

    return {
      engine,
      languages: fields.map((field) => field.language),
      fieldShape: fields.map((field) => field.field),
      values: fields.map((field) => field.term),
      wildcard,
      phrases,
      tokenize,
      negated: false,
      raw: false,
      position: child.position,
    };
  }

  // Lets an already-fused nested group fold into an enclosing group (cross AND/OR-boundary fusion).
  if (child.type === 'predicate' && child.fields.length > 0 && child.fields.every(isFusedFulltextField)) {
    const fields = child.fields as FusedFulltextField[];

    return {
      engine: fields[0]!.fulltext,
      languages: fields.map((field) => field.language),
      fieldShape: fields.map((field) => field.field),
      values: fields.map((field) => field.combinedQuery),
      wildcard: false,
      phrases: false,
      negated: false,
      raw: true,
      position: child.position,
    };
  }

  if (child.type === 'not' && child.child.type === 'predicate' && child.child.fields.length === 1) {
    const field = child.child.fields[0]!;

    if (isFulltextField(field)) {
      return {
        engine: field.fulltext,
        languages: [field.language],
        fieldShape: [field.field],
        values: [field.term],
        wildcard: field.wildcard,
        phrases: field.phrases,
        tokenize: field.tokenize,
        negated: true,
        raw: false,
        position: child.child.position,
      };
    }
  }

  return null;
}

function buildFusedPredicate({ combinator, group }: { combinator: Combinator, group: FulltextCandidate[] }): ValidatedPredicate {
  const { engine, languages, fieldShape, position } = group[0]!;
  // Raw candidates carry no real phrases/tokenize - prefer a non-raw member if one exists.
  const { phrases, tokenize } = group.find((candidate) => !candidate.raw) ?? group[0]!;

  const fields: ValidatedField[] = fieldShape.map((field, index) => ({
    field,
    fulltext: engine,
    language: languages[index] as string,
    combinedQuery: combineFulltextTerms({
      engine,
      combinator,
      terms: group.map((candidate) => (
        candidate.raw
          ? { raw: candidate.values[index] as string, negated: candidate.negated }
          : { value: candidate.values[index] as string, wildcard: candidate.wildcard, negated: candidate.negated }
      )),
      phrases,
      tokenize,
    }),
  }));

  return { type: 'predicate', fields, position };
}

// Lets a fused nested group (single-child AND/OR) be recognized as a candidate one level up.
function unwrapSingleChild(expression: ValidatedExpression): ValidatedExpression {
  if ((expression.type === 'and' || expression.type === 'or') && expression.children.length === 1) {
    return unwrapSingleChild(expression.children[0]!);
  }

  return expression;
}

function fuseSiblings({ combinator, children }: { combinator: Combinator, children: ValidatedExpression[] }): ValidatedExpression[] {
  const fusedChildren = children.map((child) => fuseFulltext(child));
  const slots = fusedChildren.map((child) => ({ child, candidate: asFulltextCandidate(unwrapSingleChild(child)) }));

  // Raw candidates adopt a same-shape non-raw sibling's "phrases" so they can still join its group.
  const canonicalPhrases = new Map<string, boolean>();

  slots.forEach(({ candidate }) => {
    if (!candidate || candidate.raw) return;

    const shape = candidateShapeKey(candidate);

    if (!canonicalPhrases.has(shape)) canonicalPhrases.set(shape, candidate.phrases);
  });

  function groupKey(candidate: FulltextCandidate): string {
    const shape = candidateShapeKey(candidate);
    const phrases = candidate.raw ? canonicalPhrases.get(shape) ?? 'raw' : candidate.phrases;

    return `${shape}::${phrases}`;
  }

  const groups = new Map<string, FulltextCandidate[]>();

  slots.forEach(({ candidate }) => {
    if (!candidate) return;

    const key = groupKey(candidate);
    const group = groups.get(key);

    if (group) {
      group.push(candidate);
    } else {
      groups.set(key, [candidate]);
    }
  });

  const emitted = new Set<string>();

  return slots.flatMap(({ child, candidate }) => {
    if (!candidate) return [child];

    const key = groupKey(candidate);
    const group = groups.get(key)!;

    if (group.length === 1) return [child];
    if (emitted.has(key)) return [];

    emitted.add(key);

    return [buildFusedPredicate({ combinator, group })];
  });
}

export function fuseFulltext(expression: ValidatedExpression): ValidatedExpression {
  if (expression.type === 'predicate') return expression;
  if (expression.type === 'not') return { type: 'not', child: fuseFulltext(expression.child) };

  return { type: expression.type, children: fuseSiblings({ combinator: expression.type, children: expression.children }) };
}
