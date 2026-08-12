import { Brackets, type ObjectLiteral, type Repository, type SelectQueryBuilder, type WhereExpressionBuilder } from 'typeorm';
import type { ValidatedExpression, ValidatedPredicate } from '../validator/types.js';

type Combinator = 'and' | 'or';

// Quotes a table/column/alias name for the connection's SQL dialect (e.g. double
// quotes for Postgres/SQLite, backticks for MySQL) — the same escaping TypeORM's
// own query builder uses internally, called explicitly so identifier quoting is
// this compiler's responsibility rather than an incidental side effect of how
// TypeORM happens to post-process raw WHERE fragments.
type Escape = (name: string) => string;

let parameterCounter = 0;

function nextParameterName(): string {
  parameterCounter += 1;

  return `search_cop_${parameterCounter}`;
}

export interface CompileOptions<Entity extends ObjectLiteral> {
  repository: Repository<Entity>;
  expression: ValidatedExpression;
  /** SQL alias used for the entity's table in the generated query. Defaults to the table name. */
  alias?: string;
}

export function compile<Entity extends ObjectLiteral>(options: CompileOptions<Entity>): SelectQueryBuilder<Entity> {
  const { repository, expression, alias = repository.metadata.tableName } = options;
  const queryBuilder = repository.createQueryBuilder(alias);
  const escape: Escape = (name) => queryBuilder.escape(name);

  queryBuilder.where(new Brackets((builder) => applyExpression(builder, alias, escape, expression)));

  return queryBuilder;
}

function applyExpression(builder: WhereExpressionBuilder, alias: string, escape: Escape, expression: ValidatedExpression): void {
  if (expression.type === 'predicate') {
    applyPredicate(builder, alias, escape, expression, 'and');
    return;
  }

  const combinator: Combinator = expression.type === 'and' ? 'and' : 'or';

  expression.children.forEach((child) => {
    if (child.type === 'predicate') {
      applyPredicate(builder, alias, escape, child, combinator);
    } else {
      applyBrackets(builder, alias, escape, child, combinator);
    }
  });
}

function applyBrackets(
  builder: WhereExpressionBuilder,
  alias: string,
  escape: Escape,
  expression: ValidatedExpression,
  combinator: Combinator,
): void {
  const brackets = new Brackets((inner) => applyExpression(inner, alias, escape, expression));

  if (combinator === 'and') {
    builder.andWhere(brackets);
  } else {
    builder.orWhere(brackets);
  }
}

function applyPredicate(
  builder: WhereExpressionBuilder,
  alias: string,
  escape: Escape,
  predicate: ValidatedPredicate,
  combinator: Combinator,
): void {
  if (predicate.fields.length === 1) {
    for (const field of predicate.fields) {
      applyFieldCondition(builder, alias, escape, field, predicate, combinator);
    }

    return;
  }

  // Multiple underlying columns for one logical attribute: matches if any field matches
  // (only "=" is supported for multi-field attributes, so this is always an OR).
  const brackets = new Brackets((inner) => {
    for (const field of predicate.fields) {
      applyFieldCondition(inner, alias, escape, field, predicate, 'or');
    }
  });

  if (combinator === 'and') {
    builder.andWhere(brackets);
  } else {
    builder.orWhere(brackets);
  }
}

function applyFieldCondition(
  builder: WhereExpressionBuilder,
  alias: string,
  escape: Escape,
  field: string,
  predicate: ValidatedPredicate,
  combinator: Combinator,
): void {
  const parameterName = nextParameterName();
  const escapeClause = predicate.operator === 'LIKE' ? " ESCAPE '\\'" : '';
  const qualifiedColumn = `${escape(alias)}.${escape(field)}`;
  // The value is already lowercased by the validator when caseSensitive is false,
  // so only the column needs LOWER() here.
  const column = predicate.caseSensitive ? qualifiedColumn : `LOWER(${qualifiedColumn})`;
  const condition = `${column} ${predicate.operator} :${parameterName}${escapeClause}`;
  const parameters = { [parameterName]: predicate.value };

  if (combinator === 'and') {
    builder.andWhere(condition, parameters);
  } else {
    builder.orWhere(condition, parameters);
  }
}
