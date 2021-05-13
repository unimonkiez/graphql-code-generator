import {
  ClientSideBaseVisitor,
  ClientSideBasePluginConfig,
  DocumentMode,
  LoadedFragment,
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
} from 'graphql';
import { PythonOperationsRawPluginConfig } from './config';
import { Types } from '@graphql-codegen/plugin-helpers';
import { getListInnerTypeNode, PYTHON_SCALARS, getListTypeField, getListTypeDepth } from '../../common/common';

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
    const baseType = !isScalarType(schemaType) ? innerType.name.value : this.scalars[schemaType.name] || 'object';

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

  private getExecuteFunction(isAsync: boolean, node: OperationDefinitionNode) : string {
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
    const inputs = hasInputArgs
      ? inputSignatures.map(sig => sig.signature).join(', ')
      : '';
    const variables = `{
      ${node.variableDefinitions?.map(v => `"${v.variable.name.value}": ${v.variable.name.value},`).join('\n      ')}
    }`;

    const content = `
${isAsync ? 'async ': ''}def execute${isAsync ? '_async' : ''}_${this._get_node_name(node)}(${inputs}) -> Any:
  client = _get_client()
${isAsync ? `
  response_text_promise = client.execute_async(
    _gql_${this._get_node_name(node)},
    variable_values=${variables},
  )
  response_text = await response_text_promise` : `
  response_text = client.execute_sync(
    _gql_${this._get_node_name(node)},
    variable_values=${variables},
  )`}
  return send_algo_result.from_json(json.dumps(response_text))  # type: ignore
`;
    return [content].filter(a => a).join('\n');
  }

  private getClientFunction(node: OperationDefinitionNode): string {
    return `
def _get_client() -> Client:
  transport = AIOHTTPTransport(url=${this.config.schema})
  client = Client(transport=transport, fetch_schema_from_transport=False)
  return client
`;
  }
  private _get_node_name(node: OperationDefinitionNode): String {
    return `${this.convertName(node)}_${this._operationSuffix(node.operation)}`.toLowerCase()
  }
  private getGQLVar(node: OperationDefinitionNode): string {
    return `
_gql_${this._get_node_name(node)} = gql("""
${this._gql(node)}
""")
`;
  }

  public OperationDefinition(node: OperationDefinitionNode): string {
    return [
      this.getGQLVar(node),
      this.getClientFunction(node),
      this.getExecuteFunction(true, node),
      this.getExecuteFunction(false, node),
    ].join('\n\n');
  }
}
