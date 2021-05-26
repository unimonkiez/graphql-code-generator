import {
  ClientSideBaseVisitor,
  ClientSideBasePluginConfig,
  DocumentMode,
  LoadedFragment,
  indentMultiline,
  getBaseTypeNode,
  buildScalars,
} from '@graphql-codegen/visitor-plugin-common';
import autoBind from 'auto-bind';
import {
  OperationDefinitionNode,
  print,
  GraphQLSchema,
  Kind,
  VariableDefinitionNode,
  isScalarType,
  parse,
  printSchema,
  DocumentNode,
  FieldNode,
  FragmentSpreadNode,
  InlineFragmentNode,
  ObjectTypeDefinitionNode,
  isEnumType,
  isInputObjectType,
  TypeNode,
} from 'graphql';
import { PythonOperationsRawPluginConfig } from './config';
import { Types } from '@graphql-codegen/plugin-helpers';
import { PythonDeclarationBlock } from '../../common/declaration-block';
import {
  getListInnerTypeNode,
  PYTHON_SCALARS,
  getListTypeField,
  getListTypeDepth,
  isValueType,
  PythonFieldType,
  wrapFieldType,
} from '../../common/common';

const defaultSuffix = 'GQL';

export interface PythonOperationsPluginConfig extends ClientSideBasePluginConfig {
  schema: string;
  subscriptionsSchema: string;
  querySuffix: string;
  mutationSuffix: string;
  subscriptionSuffix: string;
}

export class PythonOperationsVisitor extends ClientSideBaseVisitor<
  PythonOperationsRawPluginConfig,
  PythonOperationsPluginConfig
> {
  private _operationsToInclude: {
    node: OperationDefinitionNode;
    documentVariableName: string;
    operationType: string;
    operationResultType: string;
    operationVariablesTypes: string;
  }[] = [];

  private _schemaAST: DocumentNode;

  constructor(
    schema: GraphQLSchema,
    fragments: LoadedFragment[],
    rawConfig: PythonOperationsRawPluginConfig,
    documents?: Types.DocumentFile[]
  ) {
    super(
      schema,
      fragments,
      rawConfig,
      {
        schema: rawConfig.schema,
        subscriptionsSchema: rawConfig.schemaSubscriptions,
        querySuffix: rawConfig.querySuffix || defaultSuffix,
        mutationSuffix: rawConfig.mutationSuffix || defaultSuffix,
        subscriptionSuffix: rawConfig.subscriptionSuffix || defaultSuffix,
        scalars: buildScalars(schema, rawConfig.scalars, PYTHON_SCALARS),
      },
      documents
    );

    this.overruleConfigSettings();
    autoBind(this);

    this._schemaAST = parse(printSchema(schema));
  }

  // Some settings aren't supported with C#, overruled here
  private overruleConfigSettings() {
    if (this.config.documentMode === DocumentMode.graphQLTag) {
      // C# operations does not (yet) support graphQLTag mode
      this.config.documentMode = DocumentMode.documentNode;
    }
  }

  protected _gql(node: OperationDefinitionNode): string {
    const fragments = this._transformFragments(node);
    const doc = this._prepareDocument([print(node), this._includeFragments(fragments)].join('\n'));

    return doc.replace(/"/g, '"""');
  }

  private _gqlInputSignature(variable: VariableDefinitionNode): { signature: string } {
    const typeNode = variable.type;
    const innerType = getBaseTypeNode(typeNode);
    const schemaType = this._schema.getType(innerType.name.value);

    const name = variable.variable.name.value;
    const baseType = !isScalarType(schemaType)
      ? `Types.${innerType.name.value}`
      : this.scalars[schemaType.name] || 'object';

    const listType = getListTypeField(typeNode);
    const required = getListInnerTypeNode(typeNode).kind === Kind.NON_NULL_TYPE;

    return {
      signature: !listType
        ? `${name}: ${!required ? 'Optional[' : ''}${baseType}${!required ? ']' : ''}`
        : `${name}: ${baseType}${'[]'.repeat(getListTypeDepth(listType))}`,
    };
  }

  private _operationSuffix(operationType: string): string {
    switch (operationType) {
      case 'query':
        return this.config.querySuffix;
      case 'mutation':
        return this.config.mutationSuffix;
      case 'subscription':
        return this.config.subscriptionSuffix;
      default:
        return defaultSuffix;
    }
  }

  private getExecuteFunction(isAsync: boolean, node: OperationDefinitionNode): string {
    if (!node.name || !node.name.value) {
      return null;
    }

    this._collectedOperations.push(node);

    const documentVariableName = this.convertName(node, {
      suffix: this.config.documentVariableSuffix,
      prefix: this.config.documentVariablePrefix,
      useTypesPrefix: false,
    });

    const operationType: string = node.operation;
    const operationTypeSuffix: string =
      this.config.dedupeOperationSuffix && node.name.value.toLowerCase().endsWith(node.operation)
        ? ''
        : !operationType
        ? ''
        : operationType;

    const operationResultType: string = this.convertName(node, {
      suffix: operationTypeSuffix + this._parsedConfig.operationResultSuffix,
    });
    const operationVariablesTypes: string = this.convertName(node, {
      suffix: operationTypeSuffix + 'Variables',
    });

    this._operationsToInclude.push({
      node,
      documentVariableName,
      operationType,
      operationResultType,
      operationVariablesTypes,
    });

    const inputSignatures = node.variableDefinitions?.map(v => this._gqlInputSignature(v));
    const hasInputArgs = !!inputSignatures?.length;
    const inputs = hasInputArgs ? inputSignatures.map(sig => sig.signature).join(', ') : '';
    const variables = `{
      ${node.variableDefinitions?.map(v => `"${v.variable.name.value}": ${v.variable.name.value},`).join('\n      ')}
    }`;

    const resposeClass = `${this.convertName(node.name.value).replace(/_/g, '')}Response`;

    const content = `
${isAsync ? 'async ' : ''}def execute${isAsync ? '_async' : ''}_${this._get_node_name(
      node
    )}(${inputs}) -> ${resposeClass}:
  client = _get_client_${isAsync ? 'async ' : 'sync'}()
${
  isAsync
    ? `
  response_text_promise = client.execute_async(
    _gql_${this._get_node_name(node)},
    variable_values=${variables},
  )
  response_dict = await response_text_promise`
    : `
  response_dict = client.execute_sync(
    _gql_${this._get_node_name(node)},
    variable_values=${variables},
  )`
}
  return from_dict(data_class=${resposeClass}, data=response_dict)
`;
    return [content].filter(a => a).join('\n');
  }

  private getExecuteFunctionSubscriptions(node: OperationDefinitionNode): string {
    if (!node.name || !node.name.value) {
      return null;
    }

    this._collectedOperations.push(node);

    const documentVariableName = this.convertName(node, {
      suffix: this.config.documentVariableSuffix,
      prefix: this.config.documentVariablePrefix,
      useTypesPrefix: false,
    });

    const operationType: string = node.operation;
    const operationTypeSuffix: string =
      this.config.dedupeOperationSuffix && node.name.value.toLowerCase().endsWith(node.operation)
        ? ''
        : !operationType
        ? ''
        : operationType;

    const operationResultType: string = this.convertName(node, {
      suffix: operationTypeSuffix + this._parsedConfig.operationResultSuffix,
    });
    const operationVariablesTypes: string = this.convertName(node, {
      suffix: operationTypeSuffix + 'Variables',
    });

    this._operationsToInclude.push({
      node,
      documentVariableName,
      operationType,
      operationResultType,
      operationVariablesTypes,
    });

    const inputSignatures = node.variableDefinitions?.map(v => this._gqlInputSignature(v));
    const hasInputArgs = !!inputSignatures?.length;
    const inputs = hasInputArgs ? inputSignatures.map(sig => sig.signature).join(', ') : '';
    const variables = `{
      ${node.variableDefinitions?.map(v => `"${v.variable.name.value}": ${v.variable.name.value},`).join('\n      ')}
    }`;

    const resposeClass = `${this.convertName(node.name.value).replace(/_/g, '')}Response`;

    const content = `
  async def execute_async_${this._get_node_name(node)}(${inputs}) -> ${resposeClass}:
    async with _get_client_subscriptions() as client:
      variables = ${variables}
      generator = client.subscribe(
          gql(register_ue.__QUERY__),
          variable_values=variables,
      )
      async for response_text in generator:
          yield ${resposeClass}.from_json(json.dumps(response_text))
`;
    return [content].filter(a => a).join('\n');
  }

  private _get_node_name(node: OperationDefinitionNode): String {
    return `${this.convertName(node)}_${this._operationSuffix(node.operation)}`.toLowerCase();
  }
  private getGQLVar(node: OperationDefinitionNode): string {
    return `
_gql_${this._get_node_name(node)} = gql("""
${this._gql(node)}
""")
`;
  }
  protected resolveFieldType(typeNode: TypeNode, hasDefaultValue: Boolean = false): PythonFieldType {
    const innerType = getBaseTypeNode(typeNode);
    const schemaType = this._schema.getType(innerType.name.value);
    const listType = getListTypeField(typeNode);
    const required = getListInnerTypeNode(typeNode).kind === Kind.NON_NULL_TYPE;

    let result: PythonFieldType = null;

    if (isScalarType(schemaType)) {
      if (this.scalars[schemaType.name]) {
        const baseType = this.scalars[schemaType.name];
        result = new PythonFieldType({
          baseType: {
            type: baseType,
            required,
            valueType: isValueType(baseType),
          },
          listType,
        });
      } else {
        result = new PythonFieldType({
          baseType: {
            type: 'object',
            required,
            valueType: false,
          },
          listType,
        });
      }
    } else if (isInputObjectType(schemaType)) {
      result = new PythonFieldType({
        baseType: {
          type: `${this.convertName(schemaType.name)}`,
          required,
          valueType: false,
        },
        listType,
      });
    } else if (isEnumType(schemaType)) {
      result = new PythonFieldType({
        baseType: {
          type: this.convertName(schemaType.name),
          required,
          valueType: true,
        },
        listType,
      });
    } else {
      result = new PythonFieldType({
        baseType: {
          type: `${schemaType.name}`,
          required,
          valueType: false,
        },
        listType,
      });
    }

    if (hasDefaultValue) {
      // Required field is optional when default value specified, see #4273
      (result.listType || result.baseType).required = false;
    }

    return result;
  }
  private _getResponseFieldRecursive(
    node: OperationDefinitionNode | FieldNode | FragmentSpreadNode | InlineFragmentNode,
    parentSchema: ObjectTypeDefinitionNode,
    prepend?: string
  ): string {
    switch (node.kind) {
      case Kind.OPERATION_DEFINITION: {
        return `@dataclass
${
  new PythonDeclarationBlock({})
    .export()
    .asKind('class')
    .withName(`${this.convertName(prepend).replace(/_/g, '')}Response`)
    .withBlock(
      '\n' +
        node.selectionSet.selections
          .map(opr => {
            if (opr.kind !== Kind.FIELD) {
              throw new Error(`Unknown kind; ${opr.kind} in OperationDefinitionNode`);
            }
            return this._getResponseFieldRecursive(opr, parentSchema);
          })
          .join('\n')
    ).string
}`;
      }
      case Kind.FIELD: {
        const fieldSchema = parentSchema.fields.find(f => f.name.value === node.name.value);
        if (!fieldSchema) {
          throw new Error(`Field schema not found; ${node.name.value}`);
        }
        const responseType = this.resolveFieldType(fieldSchema.type);

        if (!node.selectionSet) {
          const responseTypeName = wrapFieldType(responseType, responseType.listType, 'List');
          return indentMultiline([`${node.name.value}: ${responseTypeName}`].join('\n') + '\n');
          // } else if (node) {
        } else {
          const selectionBaseTypeName = `${responseType.baseType.type}Selection`;
          const selectionType = Object.assign(new PythonFieldType(responseType), {
            baseType: { type: selectionBaseTypeName },
          });
          const selectionTypeName = wrapFieldType(selectionType, selectionType.listType, 'List');
          const innerClassSchema = this._schemaAST.definitions.find(
            d => d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === responseType.baseType.type
          ) as ObjectTypeDefinitionNode;

          const innerClassDefinition = new PythonDeclarationBlock({})
            .asKind('class')
            .withName(selectionBaseTypeName)
            .withBlock(
              '\n' +
                node.selectionSet.selections
                  .map(s => {
                    return this._getResponseFieldRecursive(s, innerClassSchema);
                  })
                  .join('\n')
            ).string;
          return indentMultiline(
            ['@dataclass', innerClassDefinition, `${node.name.value}: ${selectionTypeName}`].join('\n') + '\n'
          );
        }
      }
      case Kind.FRAGMENT_SPREAD: {
        const fragmentSchema = this._fragments.find(f => f.name === node.name.value);
        if (!fragmentSchema) {
          throw new Error(`Fragment schema not found; ${node.name.value}`);
        }
        return fragmentSchema.node.selectionSet.selections
          .map(s => {
            return this._getResponseFieldRecursive(s, parentSchema);
          })
          .join('\n');
      }
      case Kind.INLINE_FRAGMENT: {
        const fragmentSchemaName = node.typeCondition!.name.value;
        const fragmentSchema = this._schemaAST.definitions.find(
          s => s.kind === Kind.OBJECT_TYPE_DEFINITION && s.name.value === fragmentSchemaName
        ) as ObjectTypeDefinitionNode | undefined;
        if (!fragmentSchema) {
          throw new Error(`Fragment schema not found; ${fragmentSchemaName}`);
        }

        const innerClassDefinition = new PythonDeclarationBlock({})
          .asKind('class')
          .withName(fragmentSchemaName)
          .withBlock(
            '\n' +
              node.selectionSet.selections
                .map(s => {
                  return this._getResponseFieldRecursive(s, fragmentSchema);
                })
                .join('\n')
          ).string;
        return indentMultiline(['@dataclass', innerClassDefinition].join('\n') + '\n');
      }
    }
  }
  private getResponseClass(node: OperationDefinitionNode): string {
    const operationSchema = this._schemaAST.definitions.find(
      s => s.kind === Kind.OBJECT_TYPE_DEFINITION && s.name.value.toLowerCase() === node.operation
    );
    return this._getResponseFieldRecursive(node, operationSchema as ObjectTypeDefinitionNode, node.name?.value ?? '');
  }

  public OperationDefinition(node: OperationDefinitionNode): string {
    return [this.getGQLVar(node), this.getResponseClass(node)]
      .concat(
        node.operation === 'subscription'
          ? [this.getExecuteFunctionSubscriptions(node)]
          : [this.getExecuteFunction(false, node), this.getExecuteFunction(true, node)]
      )
      .join('\n\n');
  }
}
