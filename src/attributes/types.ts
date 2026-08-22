export type AttributeType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'enum' | 'uuid' | 'null' | 'fulltext';
export type AttributeFieldType = { field: string } & AttributeDefinition;
export type AttributeField = string | AttributeFieldType;

interface BaseAttributeDefinition {
  type: AttributeType;
  // Inserted into SQL verbatim — no escaping, no alias qualification. Quote/qualify yourself.
  fields?: AttributeField[];
}

export interface StringAttributeDefinition extends BaseAttributeDefinition {
  type: 'string';
  caseSensitive?: boolean | 'lower' | 'upper';
  wildcards?: boolean;
  leftWildcard?: boolean;
  rightWildcard?: boolean;
}

export interface FulltextAttributeDefinition extends BaseAttributeDefinition {
  type: 'fulltext';
  dialect: 'to_tsquery' | 'tsquery';
  language?: string;
  tokenize?: (value: string) => string[];
  phrases?: boolean;
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
  values: string[] | Record<string, string>;
}

export interface NullAttributeDefinition extends BaseAttributeDefinition {
  type: 'null';
  isNull: string[];
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
  | NullAttributeDefinition
  | FulltextAttributeDefinition;

export type AttributeMap = Record<string, AttributeDefinition>;

export type AttributeValue<T extends AttributeDefinition> = T extends
  | StringAttributeDefinition
  | EnumAttributeDefinition
  | UuidAttributeDefinition
  | FulltextAttributeDefinition
  ? string
  : T extends NumberAttributeDefinition
    ? number
    : T extends BooleanAttributeDefinition
      ? boolean
      : T extends DateAttributeDefinition | DatetimeAttributeDefinition
        ? Date
        : never;
