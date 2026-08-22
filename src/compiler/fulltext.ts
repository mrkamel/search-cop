import type { FulltextEngine, ValidatedExpression, ValidatedField, ValidatedPredicate } from '../validator/types.js';

type Combinator = 'and' | 'or';

type FulltextTerm = {
  value: string,
  wildcard: boolean,
  negated: boolean,
};

type FulltextField = {
  field: string,
  fulltext: FulltextEngine,
  term: string,
  wildcard: boolean,
  language: string,
};

type FulltextCandidate = {
  engine: FulltextEngine,
  languages: string[],
  fieldShape: string[],
  values: string[],
  wildcard: boolean,
  negated: boolean,
  position?: number,
};

const COMBINERS: Record<FulltextEngine, FulltextCombiner> = {
  postgres_fulltext: combinePostgresTsquery,
};

const CONDITION_RENDERERS: Record<FulltextEngine, FulltextConditionRenderer> = {
  postgres_fulltext: ({ field, parameterName, languageParameterName }) => `${field} @@ to_tsquery(:${languageParameterName}, :${parameterName})`,
};

type FulltextCombiner = (options: { combinator: Combinator, terms: FulltextTerm[] }) => string;

function quoteTsqueryLexeme(word: string): string {
  return `'${word.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

function renderPostgresTsqueryTerm({ value, wildcard }: { value: string, wildcard: boolean }): string {
  if (!wildcard) return quoteTsqueryLexeme(value);

  const words = value.split(/\s+/).filter((word) => word.length > 0).map(quoteTsqueryLexeme);
  const lastIndex = words.length - 1;

  words[lastIndex] = `${words[lastIndex]}:*`;

  return words.join(' <-> ');
}

function combinePostgresTsquery({ combinator, terms }: { combinator: Combinator, terms: FulltextTerm[] }): string {
  const rendered = terms.map((term) => {
    const value = renderPostgresTsqueryTerm(term);

    return term.negated ? `!${value}` : value;
  });

  return rendered.join(combinator === 'or' ? ' | ' : ' & ');
}

export function combineFulltextTerms(
  { engine, combinator, terms }:
  { engine: FulltextEngine, combinator: Combinator, terms: FulltextTerm[] },
): string {
  return COMBINERS[engine]({ combinator, terms });
}

type FulltextConditionRenderer = (options: { field: string, parameterName: string, languageParameterName: string }) => string;

export function renderFulltextCondition(
  { engine, field, parameterName, languageParameterName }:
  { engine: FulltextEngine, field: string, parameterName: string, languageParameterName: string },
): string {
  return CONDITION_RENDERERS[engine]({ field, parameterName, languageParameterName });
}

function isFulltextField(field: ValidatedField): field is FulltextField {
  return 'fulltext' in field && 'term' in field;
}

function candidateKey(candidate: FulltextCandidate): string {
  return JSON.stringify([candidate.engine, candidate.fieldShape, candidate.languages]);
}

function asFulltextCandidate(child: ValidatedExpression): FulltextCandidate | null {
  if (child.type === 'predicate' && child.fields.length > 0 && child.fields.every(isFulltextField)) {
    const fields = child.fields as FulltextField[];
    const { fulltext: engine, wildcard } = fields[0]!;

    return {
      engine,
      languages: fields.map((field) => field.language),
      fieldShape: fields.map((field) => field.field),
      values: fields.map((field) => field.term),
      wildcard,
      negated: false,
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
        negated: true,
        position: child.child.position,
      };
    }
  }

  return null;
}

function buildFusedPredicate({ combinator, group }: { combinator: Combinator, group: FulltextCandidate[] }): ValidatedPredicate {
  const { engine, languages, fieldShape, position } = group[0]!;

  const fields: ValidatedField[] = fieldShape.map((field, index) => ({
    field,
    fulltext: engine,
    language: languages[index] as string,
    combinedQuery: combineFulltextTerms({
      engine,
      combinator,
      terms: group.map((candidate) => ({ value: candidate.values[index] as string, wildcard: candidate.wildcard, negated: candidate.negated })),
    }),
  }));

  return { type: 'predicate', fields, position };
}

function fuseSiblings({ combinator, children }: { combinator: Combinator, children: ValidatedExpression[] }): ValidatedExpression[] {
  const slots = children.map((child) => ({ child, candidate: asFulltextCandidate(child) }));
  const groups = new Map<string, FulltextCandidate[]>();

  slots.forEach(({ candidate }) => {
    if (!candidate) return;

    const key = candidateKey(candidate);
    const group = groups.get(key);

    if (group) {
      group.push(candidate);
    } else {
      groups.set(key, [candidate]);
    }
  });

  const emitted = new Set<string>();

  return slots.flatMap(({ child, candidate }) => {
    if (!candidate) return [fuseFulltext(child)];

    const key = candidateKey(candidate);
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
