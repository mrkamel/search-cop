export type AttributeType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'enum';

interface BaseAttributeDefinition {
  type: AttributeType;
}

export interface StringAttributeDefinition extends BaseAttributeDefinition {
  type: 'string';
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
  | EnumAttributeDefinition;

export type AttributeMap = Record<string, AttributeDefinition>;

/** Runtime value type produced by validation, per attribute type. */
export type AttributeValue<T extends AttributeDefinition> = T extends
  | StringAttributeDefinition
  | EnumAttributeDefinition
  ? string
  : T extends NumberAttributeDefinition
    ? number
    : T extends BooleanAttributeDefinition
      ? boolean
      : T extends DateAttributeDefinition | DatetimeAttributeDefinition
        ? Date
        : never;
