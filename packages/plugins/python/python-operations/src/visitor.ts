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
  private _usingNearFileOperations: boolean;

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
    this._usingNearFileOperations = true;
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

    return doc.replace(/"/g, '\\"');
  }

  private _nonScalarPrefix(): string {
    return this._usingNearFileOperations ? 'Types.' : '';
  }

  private _gqlInputSignature(variable: VariableDefinitionNode): { signature: string; value: string; name: string } {
    const typeNode = variable.type;
    const innerType = getBaseTypeNode(typeNode);
    const schemaType = this._schema.getType(innerType.name.value);

    const name = variable.variable.name.value;
    const isInputAScalar = isScalarType(schemaType);
    const baseType = !isInputAScalar
      ? `${this._nonScalarPrefix()}${innerType.name.value}`
      : this.scalars[schemaType.name] || 'object';

    const listType = getListTypeField(typeNode);
    const required = getListInnerTypeNode(typeNode).kind === Kind.NON_NULL_TYPE;

    return {
      name: name,
      signature: !listType
        ? `${name}: ${baseType}${!required ? ' = None' : ''}`
        : `${name}: ${'List['.repeat(getListTypeDepth(listType))}${baseType}${']'.repeat(getListTypeDepth(listType))}`,
      value: isInputAScalar ? name : `asdict(${name})`,
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

    const inputs = node.variableDefinitions?.map(v => this._gqlInputSignature(v));
    const hasInputArgs = !!inputs?.length;
    const inputSignatures = hasInputArgs ? inputs.map(sig => sig.signature).join(', ') : '';
    const variables = `{
    ${inputs.map(v => `"${v.name}": ${v.value},`).join('\n      ')}
  }`;

    const resposeClass = `${this.convertName(node.name.value).replace(/_/g, '')}Response`;

    const content = `
${isAsync ? 'async ' : ''}def execute${isAsync ? '_async' : ''}_${this._get_node_name(
      node
    )}(${inputSignatures}) -> ${resposeClass}:
  client = _get_client_${isAsync ? 'async' : 'sync'}()
  variables=${variables}
  variables_no_none = {k:v for k,v in variables.items() if v is not None}
${
  isAsync
    ? `
  response_text_promise = client.execute_async(
    _gql_${this._get_node_name(node)},
    variable_values=variables_no_none,
  )
  response_dict = await response_text_promise`
    : `
  response_dict = client.execute_sync(
    _gql_${this._get_node_name(node)},
    variable_values=variables_no_none,
  )`
}



  response_dict = remove_empty(response_dict)
  return from_dict(data_class=${resposeClass}, data=response_dict, config=Config(cast=[Enum], check_types=False))
`;

    // {"researchBox": GetDatapointResponse.researchBox}
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

    const inputs = node.variableDefinitions?.map(v => this._gqlInputSignature(v));
    const hasInputArgs = !!inputs?.length;
    const inputSignatures = hasInputArgs ? inputs.map(sig => sig.signature).join(', ') : '';
    const variables = `{
    ${inputs.map(v => `"${v.name}": ${v.value},`).join('\n      ')}
  }`;

    const resposeClass = `${this.convertName(node.name.value).replace(/_/g, '')}Response`;

    const content = `
async def execute_async_${this._get_node_name(node)}(${inputSignatures}) -> AsyncGenerator[${resposeClass}, None]:
  async with _get_client_subscriptions() as client:
    variables = ${variables}
    variables_no_none = {k:v for k,v in variables.items() if v is not None}
    generator = client.subscribe(
      _gql_${this._get_node_name(node)},
      variable_values=variables_no_none,
    )
    async for response_dict in generator:
        yield from_dict(data_class=${resposeClass}, data=response_dict, config=Config(cast=[Enum], check_types=False))
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
          type: `${this._nonScalarPrefix()}${this.convertName(schemaType.name)}`,
          required,
          valueType: false,
        },
        listType,
      });
    } else if (isEnumType(schemaType)) {
      result = new PythonFieldType({
        baseType: {
          type: `${this._nonScalarPrefix()}${this.convertName(schemaType.name)}`,
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
    fieldAsFragment: boolean,
    prepend?: string,
    addField?: string[]
  ): string {
    switch (node.kind) {
      case Kind.OPERATION_DEFINITION: {
        return new PythonDeclarationBlock({})
          .export()
          .asKind('class')
          .withDecorator('@dataclass')
          .withName(`${this.convertName(prepend).replace(/_/g, '')}Response`)
          .withBlock(
            node.selectionSet.selections
              .map(opr => {
                if (opr.kind !== Kind.FIELD) {
                  throw new Error(`Unknown kind; ${opr.kind} in OperationDefinitionNode`);
                }

                return this._getResponseFieldRecursive(opr, parentSchema, false);
              })
              .join('\n')
          ).string;
      }
      case Kind.FIELD: {
        const fieldSchema = parentSchema.fields.find(f => f.name.value === node.name.value);
        if (!fieldSchema) {
          throw new Error(`Field schema not found; ${node.name.value}`);
        }
        const responseType = this.resolveFieldType(fieldSchema.type);

        if (!node.selectionSet) {
          const responseTypeName = wrapFieldType(responseType, responseType.listType, 'List');
          if (!fieldAsFragment) {
            return indentMultiline([`${node.name.value}: "${responseTypeName}"`].join('\n') + '\n');
          } else {
            return ''; // `${node.name.value}: "${responseTypeName}"` + '\n';
          }
        } else {
          const selectionBaseTypeName = `${responseType.baseType.type}Selection`;
          const selectionType = Object.assign(new PythonFieldType(responseType), {
            baseType: { type: selectionBaseTypeName },
          });
          const selectionTypeName = wrapFieldType(selectionType, selectionType.listType, 'List');
          const innerClassSchema = this._schemaAST.definitions.find(d => {
            return (
              (d.kind === Kind.OBJECT_TYPE_DEFINITION || d.kind === Kind.INTERFACE_TYPE_DEFINITION) &&
              d.name.value === responseType.baseType.type
            );
          }) as ObjectTypeDefinitionNode;

          if (!innerClassSchema) {
            throw new Error(
              `innerClassSchema not found: ${node.name.value}, schema: ${innerClassSchema}, opr.kind: ${node.kind}`
            );
          }

          const fragmentTypes: string[] = [Kind.FRAGMENT_SPREAD, Kind.INLINE_FRAGMENT];
          const isSomeChildFragments = node.selectionSet.selections.some(s => fragmentTypes.indexOf(s.kind) !== -1);

          const nonFragmentChilds = node.selectionSet.selections
            .flatMap(s => (s.kind !== Kind.FIELD ? [] : s))
            .map(s => {
              return s.name.value;
            });

          if (isSomeChildFragments) {
            const ret = indentMultiline(
              [
                //  innerClassDefinition,
                ...node.selectionSet.selections.map(s => {
                  return this._getResponseFieldRecursive(s, innerClassSchema, true, undefined, nonFragmentChilds);
                }),
                `${node.name.value}: List[Union[${node.selectionSet.selections
                  .flatMap(s => (s.kind === Kind.FIELD ? [] : s))
                  .map(s => {
                    if (s.kind === Kind.INLINE_FRAGMENT) {
                      return s.typeCondition?.name.value;
                    } else if (s.kind === Kind.FRAGMENT_SPREAD) {
                      return s.name.value;
                    }
                    //return s.name.value;
                    throw Error('Unknown Type');
                  })
                  .join(', ')}]]`,
              ].join('\n')
            );
            return ret;
          } else {
            if (!fieldAsFragment) {
              const innerClassDefinition = new PythonDeclarationBlock({})
                .asKind('class')
                .withDecorator('@dataclass')
                .withName(selectionBaseTypeName)
                .withBlock(
                  node.selectionSet.selections
                    .map(s => {
                      return this._getResponseFieldRecursive(s, innerClassSchema, false);
                    })
                    .join('\n')
                ).string;
              return indentMultiline([innerClassDefinition, `${node.name.value}: ${selectionTypeName}`].join('\n'));
            } else {
              const innerClassDefinition = new PythonDeclarationBlock({})
                .asKind('class')
                .withDecorator('@dataclass')
                .withName(node.name.value)
                .withBlock(
                  '\n' +
                    node.selectionSet.selections
                      .map(s => {
                        return this._getResponseFieldRecursive(s, innerClassSchema, false);
                      })
                      .join('\n')
                ).string;
              return innerClassDefinition + '\n';
            }
          }
        }
      }
      case Kind.FRAGMENT_SPREAD: {
        const fragmentSchema = this._fragments.find(f => f.name === node.name.value);
        if (!fragmentSchema) {
          throw new Error(`Fragment schema not found: ${node.name.value}`);
        }
        const fragmentParentSchema = this._schemaAST.definitions.find(
          s => s.kind === Kind.OBJECT_TYPE_DEFINITION && s.name.value === fragmentSchema.node.typeCondition.name.value
        ) as ObjectTypeDefinitionNode | undefined;
        if (!fragmentParentSchema) {
          throw new Error(`Fragment schema not found: ${fragmentSchema.node.typeCondition.name.value}`);
        }
        const innerClassDefinition = new PythonDeclarationBlock({})
          .asKind('class')
          .withDecorator('@dataclass')
          .withName(node.name.value)
          .withBlock(
            fragmentSchema.node.selectionSet.selections
              .map(s => {
                return this._getResponseFieldRecursive(s, fragmentParentSchema, false);
              })
              .join('\n')
          ).string;
        return innerClassDefinition;
      }
      case Kind.INLINE_FRAGMENT: {
        const fragmentSchemaName = node.typeCondition!.name.value;
        const fragmentSchema = this._schemaAST.definitions.find(
          s => s.kind === Kind.OBJECT_TYPE_DEFINITION && s.name.value === fragmentSchemaName
        ) as ObjectTypeDefinitionNode | undefined;
        if (!fragmentSchema) {
          throw new Error(`Fragment schema not found; ${fragmentSchemaName}`);
        }

        let block =
          '\n' +
          node.selectionSet.selections
            .map(s => {
              return this._getResponseFieldRecursive(s, fragmentSchema, false);
            })
            .join('\n');

        if (addField) {
          block =
            block +
            '\n' +
            addField
              .map(s => {
                return indentMultiline([`${s}: any`].join('\n'));
              })
              .join('\n');
        }

        const innerClassDefinition = new PythonDeclarationBlock({})
          .asKind('class')
          .withDecorator('@dataclass')
          .withName(fragmentSchemaName)
          .withBlock(block).string;

        if (addField) {
          return innerClassDefinition + '\n';
        }

        return innerClassDefinition + '\n';
      }
    }
  }
  private getResponseClass(node: OperationDefinitionNode): string {
    const operationSchema = this._schemaAST.definitions.find(
      s => s.kind === Kind.OBJECT_TYPE_DEFINITION && s.name.value.toLowerCase() === node.operation
    );
    return this._getResponseFieldRecursive(
      node,
      operationSchema as ObjectTypeDefinitionNode,
      false,
      node.name?.value ?? ''
    );
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
