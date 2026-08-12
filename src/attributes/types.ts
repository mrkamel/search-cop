export type AttributeType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'enum' | 'uuid';

export interface AttributeRawField {
  /**
   * Inserted verbatim into the SQL, with no escaping and no alias-qualification —
   * full responsibility is on you for quoting, dialect-specific syntax (e.g. `CAST`
   * type names), and referencing the right column unambiguously. Useful for
   * anything a plain column name can't express — casting a stricter-typed column
   * (uuid, integer) to text so it can be searched alongside string fields without
   * the database rejecting a non-matching value, cleaning up a type's text
   * representation (e.g. trimming a trailing ".0"), computed/concatenated columns,
   * and so on.
   */
  raw: string;
}

export type AttributeField = string | AttributeRawField;

interface BaseAttributeDefinition {
  type: AttributeType;
  /**
   * Underlying columns to match against instead of the attribute's own key,
   * OR'd together (also applies to wildcard matches). Only "=" is supported
   * when set. Defaults to the attribute's own key.
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

export type AttributeDefinition =
  | StringAttributeDefinition
  | NumberAttributeDefinition
  | BooleanAttributeDefinition
  | DateAttributeDefinition
  | DatetimeAttributeDefinition
  | EnumAttributeDefinition
  | UuidAttributeDefinition;

export type AttributeMap = Record<string, AttributeDefinition>;

/** Runtime value type produced by validation, per attribute type. */
export type AttributeValue<T extends AttributeDefinition> = T extends
  | StringAttributeDefinition
  | EnumAttributeDefinition
  | UuidAttributeDefinition
  ? string
  : T extends NumberAttributeDefinition
    ? number
    : T extends BooleanAttributeDefinition
      ? boolean
      : T extends DateAttributeDefinition | DatetimeAttributeDefinition
        ? Date
        : never;
