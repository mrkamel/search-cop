export type AttributeType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'enum' | 'uuid' | 'null';

/**
 * Validates this field independently against its own declared type, ignoring the
 * outer attribute's type entirely. If the value doesn't fit this type (or, for a
 * wildcard query, this field isn't itself "string"), this field simply doesn't
 * match — the query never errors, and other fields in the group are unaffected.
 */
export type AttributeFieldType = { field: string } & AttributeDefinition;

export type AttributeField = string | AttributeFieldType;

interface BaseAttributeDefinition {
  type: AttributeType;
  /**
   * Underlying columns to match against instead of the attribute's own key, OR'd
   * together (also applies to wildcard matches). Only "=" is supported when set.
   * Defaults to the attribute's own key.
   *
   * Every field is inserted into the SQL verbatim — no escaping, no alias
   * qualification. search-cop doesn't know your column names are safe unquoted
   * identifiers, doesn't know your database's quote character, and doesn't
   * support joins (so there's never a table to disambiguate against) — you do,
   * so you're responsible for quoting (e.g. `'"createdAt"'` to preserve case on
   * Postgres) and qualification (e.g. `'author.name'` after your own `leftJoin`)
   * whenever you need them.
   */
  fields?: AttributeField[];
}

export interface StringAttributeDefinition extends BaseAttributeDefinition {
  type: 'string';
  /** Default: true. When false, "=" and wildcard matches ignore case. */
  caseSensitive?: boolean;
}

export interface UuidAttributeDefinition extends BaseAttributeDefinition {
  type: 'uuid';
}

export interface NumberAttributeDefinition extends BaseAttributeDefinition {
  type: 'number';
}

export interface BooleanAttributeDefinition extends BaseAttributeDefinition {
  type: 'boolean';
}

export interface DateAttributeDefinition extends BaseAttributeDefinition {
  type: 'date';
}

export interface DatetimeAttributeDefinition extends BaseAttributeDefinition {
  type: 'datetime';
}

export interface EnumAttributeDefinition extends BaseAttributeDefinition {
  type: 'enum';
  values: string[];
}

/** Compiles to an `IS NULL`/`IS NOT NULL` check instead of a value comparison — no parameter is bound. */
export interface NullAttributeDefinition extends BaseAttributeDefinition {
  type: 'null';
  /** DSL values that match rows where the field IS NULL. */
  isNull: string[];
  /** DSL values that match rows where the field IS NOT NULL. */
  isNotNull: string[];
}

export type AttributeDefinition =
  | StringAttributeDefinition
  | NumberAttributeDefinition
  | BooleanAttributeDefinition
  | DateAttributeDefinition
  | DatetimeAttributeDefinition
  | EnumAttributeDefinition
  | UuidAttributeDefinition
  | NullAttributeDefinition;

export type AttributeMap = Record<string, AttributeDefinition>;

/** Runtime value type produced by validation, per attribute type. */
export type AttributeValue<T extends AttributeDefinition> = T extends
  | StringAttributeDefinition
  | EnumAttributeDefinition
  | UuidAttributeDefinition
  ? string
  : T extends NumberAttributeDefinition
    ? number
    : T extends BooleanAttributeDefinition | NullAttributeDefinition
      ? boolean
      : T extends DateAttributeDefinition | DatetimeAttributeDefinition
        ? Date
        : never;
