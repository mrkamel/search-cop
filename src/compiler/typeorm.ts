import { Brackets, type ObjectLiteral, type Repository, type SelectQueryBuilder, type WhereExpressionBuilder } from 'typeorm';
import { LIKE_ESCAPE_CHARACTER } from '../validator/types.js';
import type { ValidatedExpression, ValidatedField, ValidatedPredicate } from '../validator/types.js';

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

// Builds the raw SQL + parameter for a single field's comparison — shared by the normal
// (builder-based) path below and the string-rendering path used inside a NOT (see applyNot).
function buildFieldCondition(field: ValidatedField): Rendered {
  if ('alwaysFalse' in field) {
    return { sql: '1 = 0', parameters: {} };
  }

  if (!('value' in field)) {
    // "null" attributes: an existence check, not a value comparison — no case folding, no
    // parameter to bind.
    return { sql: `${field.field} ${field.operator}`, parameters: {} };
  }

  // "field" (see AttributeField) is inserted into the SQL verbatim — no escaping, no
  // alias qualification. Quoting/qualification, if needed, is the caller's responsibility.
  // "caseSensitive" is this field's own — see ValidatedField — since a field-level type
  // override can declare a different one than the outer attribute. The value is already
  // case-folded by the validator to match, so only the column needs folding here —
  // LOWER() for "false"/"lower" (the same fold function, just two spellings for backward
  // compatibility), UPPER() for "upper".
  const column = (() => {
    if (field.caseSensitive === true) return field.field;
    if (field.caseSensitive === 'upper') return `UPPER(${field.field})`;

    return `LOWER(${field.field})`;
  })();

  const parameterName = nextParameterName();
  // See LIKE_ESCAPE_CHARACTER for why this isn't "\".
  const escapeClause = field.operator === 'LIKE' ? ` ESCAPE '${LIKE_ESCAPE_CHARACTER}'` : '';

  return {
    sql: `${column} ${field.operator} :${parameterName}${escapeClause}`,
    parameters: { [parameterName]: field.value },
  };
}

// "condition" is typed as a plain union (rather than overloading this function like
// andWhere/orWhere themselves) so a single runtime check narrows it for both branches below.
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

  applyWhere({ builder, combinator, condition: brackets });
}

// A NOT's content is rendered to a single flat SQL string (see renderNegated) instead of
// nesting TypeORM's NotBrackets around the normal builder-based path below — TypeORM's
// Brackets are opaque builder objects with no way to read back the SQL they'll produce, so
// there's no way to wrap arbitrary nested Brackets in a SQL function afterwards. Rendering
// to a string ourselves lets the whole negated expression be wrapped in exactly one
// COALESCE(..., FALSE), which is what makes the negation NULL-safe (see renderNegated).
function applyNot(
  { builder, expression, combinator }:
  { builder: WhereExpressionBuilder, expression: ValidatedExpression, combinator: Combinator }
): void {
  const { sql, parameters } = renderNegated(expression);

  applyWhere({ builder, combinator, condition: sql, parameters });
}

// Renders "expression", negated, as a NULL-safe SQL boolean expression. Without the
// COALESCE, a NULL column can make the un-negated expression evaluate to NULL/UNKNOWN
// rather than a definite true/false — and SQL's NOT(NULL) is NULL too, so instead of being
// included, that row is silently dropped from the WHERE clause (a NULL value never
// legitimately satisfies a comparison, so its negation should always hold true).
function renderNegated(expression: ValidatedExpression): Rendered {
  const { sql, parameters } = renderPositive(expression);

  return { sql: `NOT(COALESCE((${sql}), FALSE))`, parameters };
}

// Renders "expression" as a plain (non-negated) SQL boolean expression. A "not" node found
// here is the negated form of its own child, so it recurses back into renderNegated —
// this mutual recursion is what makes nested NOTs (e.g. double negation) NULL-safe too,
// without needing any special-casing for how deep the nesting goes.
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
    // A nested "and"/"or" needs explicit parens to preserve its grouping when joined with
    // siblings below — a predicate (single- or multi-field) and a "not" are already
    // self-contained (multi-field wraps its own OR in parens; "not" is wrapped in NOT(...)).
    const wrapped = child.type === 'and' || child.type === 'or' ? `(${sql})` : sql;

    return { sql: wrapped, parameters };
  });

  return {
    sql: rendered.map((r) => r.sql).join(` ${combinator} `),
    parameters: Object.assign({}, ...rendered.map((r) => r.parameters)),
  };
}

function renderPredicate(predicate: ValidatedPredicate): Rendered {
  const rendered = predicate.fields.map(buildFieldCondition);
  const sql = rendered.map((r) => r.sql).join(' OR ');
  const parameters = Object.assign({}, ...rendered.map((r) => r.parameters));

  // Multiple underlying columns for one logical attribute: matches if any field matches
  // (only "=" is supported for multi-field attributes, so this is always an OR) — wrapped
  // in its own parens so it groups correctly when combined with siblings.
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

  // Multiple underlying columns for one logical attribute: matches if any field matches
  // (only "=" is supported for multi-field attributes, so this is always an OR).
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
