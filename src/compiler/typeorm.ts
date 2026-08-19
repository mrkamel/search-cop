import { Brackets, NotBrackets, type ObjectLiteral, type Repository, type SelectQueryBuilder, type WhereExpressionBuilder } from 'typeorm';
import type { ValidatedExpression, ValidatedField, ValidatedPredicate } from '../validator/types.js';

type Combinator = 'and' | 'or';

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

  queryBuilder.andWhere(compileCondition(expression));

  return queryBuilder;
}

/**
 * Compiles a validated expression to a standalone `Brackets` fragment instead of a full
 * query. `Brackets`/`NotBrackets` are TypeORM's own portable where-clause primitive — the
 * callback isn't evaluated until it's handed to `.andWhere()`/`.orWhere()` on a real
 * `WhereExpressionBuilder`, so this needs no repository or queryBuilder of its own. Use
 * this to merge search-cop's conditions into a queryBuilder you've already built yourself
 * (with your own joins, aliases, and other `where` conditions already in place).
 */
export function compileCondition(expression: ValidatedExpression): Brackets {
  return new Brackets((builder) => applyExpression({ builder, expression }));
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

  if (combinator === 'and') {
    builder.andWhere(brackets);
  } else {
    builder.orWhere(brackets);
  }
}

function applyNot(
  { builder, expression, combinator }:
  { builder: WhereExpressionBuilder, expression: ValidatedExpression, combinator: Combinator }
): void {
  const brackets = new NotBrackets((inner) => applyExpression({ builder: inner, expression }));

  if (combinator === 'and') {
    builder.andWhere(brackets);
  } else {
    builder.orWhere(brackets);
  }
}

function applyPredicate(
  { builder, predicate, combinator }:
  { builder: WhereExpressionBuilder, predicate: ValidatedPredicate, combinator: Combinator }
): void {
  if (predicate.fields.length === 1) {
    for (const field of predicate.fields) {
      applyFieldCondition({ builder, field, caseSensitive: predicate.caseSensitive, combinator });
    }

    return;
  }

  // Multiple underlying columns for one logical attribute: matches if any field matches
  // (only "=" is supported for multi-field attributes, so this is always an OR).
  const brackets = new Brackets((inner) => {
    for (const field of predicate.fields) {
      applyFieldCondition({ builder: inner, field, caseSensitive: predicate.caseSensitive, combinator: 'or' });
    }
  });

  if (combinator === 'and') {
    builder.andWhere(brackets);
  } else {
    builder.orWhere(brackets);
  }
}

function applyFieldCondition(
  { builder, field, caseSensitive, combinator }:
  { builder: WhereExpressionBuilder, field: ValidatedField, caseSensitive: boolean, combinator: Combinator }
): void {
  // A value that didn't fit its (possibly field-overridden) type — see AttributeFieldType
  // — never errors; it just can never match, so the field contributes an unconditional
  // false to the OR/AND rather than a real comparison.
  if ('alwaysFalse' in field) {
    if (combinator === 'and') {
      builder.andWhere('1 = 0');
    } else {
      builder.orWhere('1 = 0');
    }

    return;
  }

  // "field" (see AttributeField) is inserted into the SQL verbatim — no escaping, no
  // alias qualification. Quoting/qualification, if needed, is the caller's responsibility.
  // The value is already lowercased by the validator when caseSensitive is false, so
  // only the column needs LOWER() here.
  const column = caseSensitive ? field.field : `LOWER(${field.field})`;

  // "null" attributes: an existence check, not a value comparison — no parameter to bind.
  if (!('value' in field)) {
    const condition = `${column} ${field.operator}`;

    if (combinator === 'and') {
      builder.andWhere(condition);
    } else {
      builder.orWhere(condition);
    }

    return;
  }

  const parameterName = nextParameterName();
  const escapeClause = field.operator === 'LIKE' ? " ESCAPE '\\'" : '';
  const condition = `${column} ${field.operator} :${parameterName}${escapeClause}`;
  const parameters = { [parameterName]: field.value };

  if (combinator === 'and') {
    builder.andWhere(condition, parameters);
  } else {
    builder.orWhere(condition, parameters);
  }
}
