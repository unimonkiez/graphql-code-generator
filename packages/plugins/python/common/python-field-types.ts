export interface BaseTypeField {
  type: string;
  valueType: boolean;
  required: boolean;
}

export interface ListTypeField {
  required: boolean;
  type: ListTypeField;
}

export interface PythonField {
  baseType: BaseTypeField;
  listType?: ListTypeField;
}

export class PythonFieldType implements PythonField {
  baseType: BaseTypeField;
  listType?: ListTypeField;

  constructor(fieldType: PythonField) {
    Object.assign(this, fieldType);
  }

  get innerTypeName(): string {
    const nullable = !this.baseType.required;
    return `${nullable ? 'Optional[' : ''}${this.baseType.type}${nullable ? ']' : ''}`;
  }

  get isOuterTypeRequired(): boolean {
    return this.listType ? this.listType.required : this.baseType.required;
  }
}
