import { Brackets, type ObjectLiteral, type Repository, type SelectQueryBuilder, type WhereExpressionBuilder } from 'typeorm';
import { LIKE_ESCAPE_CHARACTER } from '../validator/types.js';
import type { ValidatedExpression, ValidatedField, ValidatedPredicate } from '../validator/types.js';
import { fuseFulltext } from './fulltext.js';

type Combinator = 'and' | 'or';

interface Rendered {
  sql: string;
  parameters: ObjectLiteral;
}

let parameterCounter = 0;

function nextParameterName(): string {
  parameterCounter += 1;

  return `search_cop_${parameterCounter}`;
}

function buildFulltextCondition(field: { field: string, fulltext: 'postgres_fulltext', term: string, language: string }): Rendered {
  const parameterName = nextParameterName();

  return {
    sql: `${field.field} @@ websearch_to_tsquery('${field.language}', :${parameterName})`,
    parameters: { [parameterName]: field.term },
  };
}

function buildFieldCondition(field: ValidatedField): Rendered {
  if ('alwaysFalse' in field) {
    return { sql: '1 = 0', parameters: {} };
  }

  if ('fulltext' in field) {
    return buildFulltextCondition(field);
  }

  if (!('value' in field)) {
    return { sql: `${field.field} ${field.operator}`, parameters: {} };
  }

  const column = (() => {
    if (field.caseSensitive === true) return field.field;
    if (field.caseSensitive === 'upper') return `UPPER(${field.field})`;

    return `LOWER(${field.field})`;
  })();

  const parameterName = nextParameterName();
  const escapeClause = field.operator === 'LIKE' ? ` ESCAPE '${LIKE_ESCAPE_CHARACTER}'` : '';

  return {
    sql: `${column} ${field.operator} :${parameterName}${escapeClause}`,
    parameters: { [parameterName]: field.value },
  };
}

function applyWhere(
  { builder, combinator, condition, parameters }:
  { builder: WhereExpressionBuilder, combinator: Combinator, condition: string | Brackets, parameters?: ObjectLiteral }
): void {
  if (typeof condition === 'string') {
    if (combinator === 'and') {
      builder.andWhere(condition, parameters);
    } else {
      builder.orWhere(condition, parameters);
    }

    return;
  }

  if (combinator === 'and') {
    builder.andWhere(condition);
  } else {
    builder.orWhere(condition);
  }
}

export interface CompileOptions<Entity extends ObjectLiteral> {
  repository: Repository<Entity>;
  expression: ValidatedExpression;
  alias?: string;
}

export function compile<Entity extends ObjectLiteral>(options: CompileOptions<Entity>): SelectQueryBuilder<Entity> {
  const { repository, expression, alias = repository.metadata.tableName } = options;
  const queryBuilder = repository.createQueryBuilder(alias);

  queryBuilder.andWhere(compileCondition(expression));

  return queryBuilder;
}

export function compileCondition(expression: ValidatedExpression): Brackets {
  const fused = fuseFulltext(expression);

  return new Brackets((builder) => applyExpression({ builder, expression: fused }));
}

function applyExpression(
  { builder, expression }:
  { builder: WhereExpressionBuilder, expression: ValidatedExpression }
): void {
  if (expression.type === 'predicate') {
    applyPredicate({ builder, predicate: expression, combinator: 'and' });
    return;
  }

  if (expression.type === 'not') {
    applyNot({ builder, expression: expression.child, combinator: 'and' });
    return;
  }

  const combinator: Combinator = expression.type === 'and' ? 'and' : 'or';

  expression.children.forEach((child) => {
    if (child.type === 'predicate') {
      applyPredicate({ builder, predicate: child, combinator });
    } else if (child.type === 'not') {
      applyNot({ builder, expression: child.child, combinator });
    } else {
      applyBrackets({ builder, expression: child, combinator });
    }
  });
}

function applyBrackets(
  { builder, expression, combinator }:
  { builder: WhereExpressionBuilder, expression: ValidatedExpression, combinator: Combinator }
): void {
  const brackets = new Brackets((inner) => applyExpression({ builder: inner, expression }));

  applyWhere({ builder, combinator, condition: brackets });
}

// Rendered to a flat string, not nested Brackets — TypeORM's Brackets can't be read back
// as SQL, so a negated group couldn't otherwise be wrapped in one COALESCE(NOT(...), FALSE).
function applyNot(
  { builder, expression, combinator }:
  { builder: WhereExpressionBuilder, expression: ValidatedExpression, combinator: Combinator }
): void {
  const { sql, parameters } = renderNegated(expression);

  applyWhere({ builder, combinator, condition: sql, parameters });
}

// COALESCE guards against a NULL column making NOT(...) itself NULL (dropping the row).
function renderNegated(expression: ValidatedExpression): Rendered {
  const { sql, parameters } = renderPositive(expression);

  return { sql: `NOT(COALESCE((${sql}), FALSE))`, parameters };
}

function renderPositive(expression: ValidatedExpression): Rendered {
  if (expression.type === 'not') {
    return renderNegated(expression.child);
  }

  if (expression.type === 'predicate') {
    return renderPredicate(expression);
  }

  const combinator = expression.type === 'and' ? 'AND' : 'OR';
  const rendered = expression.children.map((child) => {
    const { sql, parameters } = renderPositive(child);
    const wrapped = child.type === 'and' || child.type === 'or' ? `(${sql})` : sql;

    return { sql: wrapped, parameters };
  });

  return {
    sql: rendered.map((value) => value.sql).join(` ${combinator} `),
    parameters: Object.assign({}, ...rendered.map((value) => value.parameters)),
  };
}

function renderPredicate(predicate: ValidatedPredicate): Rendered {
  const rendered = predicate.fields.map(buildFieldCondition);
  const sql = rendered.map((value) => value.sql).join(' OR ');
  const parameters = Object.assign({}, ...rendered.map((value) => value.parameters));

  return rendered.length > 1 ? { sql: `(${sql})`, parameters } : { sql, parameters };
}

function applyPredicate(
  { builder, predicate, combinator }:
  { builder: WhereExpressionBuilder, predicate: ValidatedPredicate, combinator: Combinator }
): void {
  if (predicate.fields.length === 1) {
    for (const field of predicate.fields) {
      applyFieldCondition({ builder, field, combinator });
    }

    return;
  }

  const brackets = new Brackets((inner) => {
    for (const field of predicate.fields) {
      applyFieldCondition({ builder: inner, field, combinator: 'or' });
    }
  });

  applyWhere({ builder, combinator, condition: brackets });
}

function applyFieldCondition(
  { builder, field, combinator }:
  { builder: WhereExpressionBuilder, field: ValidatedField, combinator: Combinator }
): void {
  const { sql, parameters } = buildFieldCondition(field);

  applyWhere({ builder, combinator, condition: sql, parameters });
}
