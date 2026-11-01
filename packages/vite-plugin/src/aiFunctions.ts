export interface AIFunctionSpec {
  kind: 'sort' | 'filter' | 'map' | 'reduce';
  method: string;
  replacementMethod: 'toSorted' | 'filter' | 'map' | 'reduce';
  outputField: string;
  schemaName: string;
  role: string;
  signature: string;
  parameters: readonly string[];
  globals?: readonly string[];
  allowedMethods: readonly string[];
  rules: readonly string[];
}

export interface ResultShape {
  fields: Record<string, string>;
  optionalFields: string[];
}

export type AIFunctionParameterSchema =
  | {
    kind: 'scalar';
    type: string;
  }
  | {
    kind: 'object';
    fields: Record<string, string>;
  }
  | {
    kind: 'array';
    elementType: string;
    elementFields?: Record<string, string>;
  };
