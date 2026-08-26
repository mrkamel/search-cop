export type AttributeType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'enum' | 'uuid' | 'null' | 'fulltext' | 'tag';
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
  autoWildcards?: boolean;
  autoLeftWildcard?: boolean;
  autoRightWildcard?: boolean;
  allowWildcards?: boolean;
  allowLeftWildcard?: boolean;
  allowRightWildcard?: boolean;
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

// Redirects a "field:value" predicate into a literal fulltext term against another attribute —
// "status:online" with { type: 'tag', attribute: 'tags' } compiles exactly as if the query had
// been "tags:\"status:online\"" against that (normally dialect: 'tsquery') fulltext attribute.
export interface TagAttributeDefinition extends BaseAttributeDefinition {
  type: 'tag';
  attribute: string;
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
  | FulltextAttributeDefinition
  | TagAttributeDefinition;

export type AttributeMap = Record<string, AttributeDefinition>;

export type AttributeValue<T extends AttributeDefinition> = T extends
  | StringAttributeDefinition
  | EnumAttributeDefinition
  | UuidAttributeDefinition
  | FulltextAttributeDefinition
  | TagAttributeDefinition
  ? string
  : T extends NumberAttributeDefinition
    ? number
    : T extends BooleanAttributeDefinition
      ? boolean
      : T extends DateAttributeDefinition | DatetimeAttributeDefinition
        ? Date
        : never;
