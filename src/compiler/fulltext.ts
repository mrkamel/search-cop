import type { FulltextEngine, ValidatedExpression, ValidatedField, ValidatedPredicate } from '../validator/types.js';

type Combinator = 'and' | 'or';

interface FulltextTerm {
  value: string;
  negated: boolean;
}

type FulltextField = { field: string, fulltext: FulltextEngine, term: string, language: string };

type FulltextCombiner = (options: { combinator: Combinator, terms: FulltextTerm[] }) => string;

function quoteIfNeeded(value: string): string {
  const sanitized = value.replace(/"/g, '');

  return /\s/.test(sanitized) ? `"${sanitized}"` : sanitized;
}

function combinePostgresWebsearch({ combinator, terms }: { combinator: Combinator, terms: FulltextTerm[] }): string {
  const rendered = terms.map((term) => (term.negated ? `-${quoteIfNeeded(term.value)}` : quoteIfNeeded(term.value)));

  return rendered.join(combinator === 'or' ? ' OR ' : ' ');
}

const COMBINERS: Record<FulltextEngine, FulltextCombiner> = {
  postgres_fulltext: combinePostgresWebsearch,
};

function isFulltextField(field: ValidatedField): field is FulltextField {
  return 'fulltext' in field;
}

interface FulltextCandidate {
  engine: FulltextEngine;
  language: string;
  fieldShape: string[];
  values: string[];
  negated: boolean;
  position?: number;
}

function candidateKey(candidate: FulltextCandidate): string {
  return [candidate.engine, candidate.language, ...candidate.fieldShape].join(' ');
}

function asFulltextCandidate(child: ValidatedExpression): FulltextCandidate | null {
  if (child.type === 'predicate' && child.fields.length > 0 && child.fields.every(isFulltextField)) {
    const fields = child.fields as FulltextField[];
    const { fulltext: engine, language } = fields[0]!;

    return {
      engine,
      language,
      fieldShape: fields.map((field) => field.field),
      values: fields.map((field) => field.term),
      negated: false,
      position: child.position,
    };
  }

  if (child.type === 'not' && child.child.type === 'predicate' && child.child.fields.length === 1) {
    const field = child.child.fields[0]!;

    if (isFulltextField(field)) {
      return {
        engine: field.fulltext,
        language: field.language,
        fieldShape: [field.field],
        values: [field.term],
        negated: true,
        position: child.child.position,
      };
    }
  }

  return null;
}

function buildFusedPredicate({ combinator, group }: { combinator: Combinator, group: FulltextCandidate[] }): ValidatedPredicate {
  const { engine, language, fieldShape, position } = group[0]!;
  const combine = COMBINERS[engine];

  const fields: ValidatedField[] = fieldShape.map((field, index) => ({
    field,
    fulltext: engine,
    language,
    term: combine({
      combinator,
      terms: group.map((candidate) => ({ value: candidate.values[index] as string, negated: candidate.negated })),
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

    groups.set(key, [...(groups.get(key) ?? []), candidate]);
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
