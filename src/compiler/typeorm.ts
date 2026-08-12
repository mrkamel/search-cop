import { Brackets, type ObjectLiteral, type Repository, type SelectQueryBuilder, type WhereExpressionBuilder } from 'typeorm';
import type { ValidatedExpression, ValidatedPredicate } from '../validator/types.js';

type Combinator = 'and' | 'or';

let parameterCounter = 0;

function nextParameterName(): string {
  parameterCounter += 1;

  return `search_cop_${parameterCounter}`;
}

export function compile<Entity extends ObjectLiteral>(
  repository: Repository<Entity>,
  expression: ValidatedExpression,
): SelectQueryBuilder<Entity> {
  const alias = repository.metadata.name;
  const queryBuilder = repository.createQueryBuilder(alias);

  queryBuilder.where(new Brackets((builder) => applyExpression(builder, alias, expression)));

  return queryBuilder;
}

function applyExpression(builder: WhereExpressionBuilder, alias: string, expression: ValidatedExpression): void {
  if (expression.type === 'predicate') {
    applyPredicate(builder, alias, expression, 'and');
    return;
  }

  const combinator: Combinator = expression.type === 'and' ? 'and' : 'or';

  expression.children.forEach((child) => {
    if (child.type === 'predicate') {
      applyPredicate(builder, alias, child, combinator);
    } else {
      applyBrackets(builder, alias, child, combinator);
    }
  });
}

function applyBrackets(builder: WhereExpressionBuilder, alias: string, expression: ValidatedExpression, combinator: Combinator): void {
  const brackets = new Brackets((inner) => applyExpression(inner, alias, expression));

  if (combinator === 'and') {
    builder.andWhere(brackets);
  } else {
    builder.orWhere(brackets);
  }
}

function applyPredicate(builder: WhereExpressionBuilder, alias: string, predicate: ValidatedPredicate, combinator: Combinator): void {
  const parameterName = nextParameterName();
  const isLike = predicate.operator === 'LIKE' || predicate.operator === 'NOT LIKE';
  const escapeClause = isLike ? " ESCAPE '\\'" : '';
  const condition = `${alias}.${predicate.field} ${predicate.operator} :${parameterName}${escapeClause}`;
  const parameters = { [parameterName]: predicate.value };

  if (combinator === 'and') {
    builder.andWhere(condition, parameters);
  } else {
    builder.orWhere(condition, parameters);
  }
}
