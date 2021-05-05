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
  visit,
  GraphQLSchema,
  Kind,
  VariableDefinitionNode,
  isScalarType,
} from 'graphql';
import { PythonOperationsRawPluginConfig } from './config';
import { Types } from '@graphql-codegen/plugin-helpers';
import { getListInnerTypeNode, C_SHARP_SCALARS, getListTypeField, getListTypeDepth } from '../../common/common';

const defaultSuffix = 'GQL';
const R_NAME = /name:\s*"([^"]+)"/;

function R_DEF(directive: string) {
  return new RegExp(`\\s+\\@${directive}\\([^)]+\\)`, 'gm');
}

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
        scalars: buildScalars(schema, rawConfig.scalars, C_SHARP_SCALARS),
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

  private _operationHasDirective(operation: string | OperationDefinitionNode, directive: string) {
    if (typeof operation === 'string') {
      return operation.includes(`${directive}`);
    }

    let found = false;

    visit(operation, {
      Directive(node) {
        if (node.name.value === directive) {
          found = true;
        }
      },
    });

    return found;
  }

  private _extractDirective(operation: OperationDefinitionNode, directive: string) {
    const directives = print(operation).match(R_DEF(directive));

    if (directives.length > 1) {
      throw new Error(`The ${directive} directive used multiple times in '${operation.name}' operation`);
    }

    return directives[0];
  }

  private _namedClient(operation: OperationDefinitionNode): string {
    let name: string;

    if (this._operationHasDirective(operation, 'namedClient')) {
      name = this._extractNamedClient(operation);
    } else {
      name = 'UVV';
    }

    return name ? `client = '${name}';` : '';
  }

  private _extractNamedClient(operation: OperationDefinitionNode): string {
    const [, name] = this._extractDirective(operation, 'namedClient').match(R_NAME);

    return name;
  }

  protected _gql(node: OperationDefinitionNode): string {
    const fragments = this._transformFragments(node);
    const doc = this._prepareDocument([print(node), this._includeFragments(fragments)].join('\n'));

    return doc.replace(/"/g, '"""');
  }

  private _getDocumentNodeVariable(node: OperationDefinitionNode, documentVariableName: string): string {
    return this.config.documentMode === DocumentMode.external ? `Operations.${node.name.value}` : documentVariableName;
  }

  private _gqlInputSignature(variable: VariableDefinitionNode): { signature: string; required: boolean } {
    const typeNode = variable.type;
    const innerType = getBaseTypeNode(typeNode);
    const schemaType = this._schema.getType(innerType.name.value);

    const name = variable.variable.name.value;
    const baseType = !isScalarType(schemaType) ? innerType.name.value : this.scalars[schemaType.name] || 'object';

    const listType = getListTypeField(typeNode);
    const required = getListInnerTypeNode(typeNode).kind === Kind.NON_NULL_TYPE;

    return {
      required: listType ? listType.required : required,
      signature: !listType
        ? `${name}=(${baseType})`
        : `${name}=(${baseType}${'[]'.repeat(getListTypeDepth(listType))})`,
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

    let documentString = '';
    if (this.config.documentMode !== DocumentMode.external) {
      const gqlBlock = indentMultiline(this._gql(node), 4);
      documentString = `${
        this.config.noExport ? '' : 'public'
      } static string ${documentVariableName} = @"\n${gqlBlock}";`;
    }

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

    const serviceName = `${this.convertName(node)}${this._operationSuffix(operationType)}`;
    this._operationsToInclude.push({
      node,
      documentVariableName,
      operationType,
      operationResultType,
      operationVariablesTypes,
    });

    const inputSignatures = node.variableDefinitions?.map(v => this._gqlInputSignature(v));
    const hasInputArgs = !!inputSignatures?.length;
    const inputArgsHint = hasInputArgs
      ? `
      /// <para>Required variables:<br/> { ${inputSignatures
        .filter(sig => sig.required)
        .map(sig => sig.signature)
        .join(', ')} }</para>
      /// <para>Optional variables:<br/> { ${inputSignatures
        .filter(sig => !sig.required)
        .map(sig => sig.signature)
        .join(', ')} }</para>`
      : '';

    // Should use ObsoleteAttribute but VS treats warnings as errors which would be super annoying so use remarks comment instead
    const obsoleteMessage = '/// <remarks>This method is obsolete. Use Request instead.</remarks>';

    const content = `
public class ${serviceName} {
  /// <summary>
  /// ${serviceName}.Request ${inputArgsHint}
  /// </summary>
  public static GraphQLRequest Request(${hasInputArgs ? 'object variables = null' : ''}) {
    return new GraphQLRequest {
      Query = ${this._getDocumentNodeVariable(node, documentVariableName)},
      OperationName = "${node.name.value}"${
  hasInputArgs
    ? `,
      Variables = variables`
    : ''
}
    };
  }

  ${obsoleteMessage}
  public static GraphQLRequest get${serviceName}() {
    return Request();
  }
  ${this._namedClient(node)}
  ${documentString}
}
    `;
    return [content].filter(a => a).join('\n');
  }

  private getClientFunction(node: OperationDefinitionNode): string {
    return `
    def _get_client(
      ${node.variableDefinitions.map(variableDefinition => `
${variableDefinition.variable.name.value}: Types.${variableDefinition.type.kind},`).join('\n      ')}
  ) -> send_algo_result:
      transport = AIOHTTPTransport(url=${this.config.schema})
      client = Client(transport=transport, fetch_schema_from_transport=False)
      variables = {
          "token": token,
          "result": {
              "recv_time": recv_time,
              "red_peaks": params_demo_out["red_peaks"],
              "blue_peaks": params_demo_out["blue_peaks"],
              "red_peaks_skeleton": params_demo_out["red_peaks_skeleton"],
              "blue_peaks_skeleton": params_demo_out["blue_peaks_skeleton"],
              "first_clk": first_clk,
              "duration": duration,
              "red_max": params_demo_out["red_max"],
              "blue_max": params_demo_out["blue_max"],
              "red_skeleton_max": params_demo_out["red_skeleton_max"],
              "blue_skeleton_max": params_demo_out["blue_skeleton_max"],
              "i_max": params_demo_out["i_max"],
              "i_mean": params_demo_out["i_mean"],
              "q_max": params_demo_out["q_max"],
              "q_mean": params_demo_out["q_mean"],
              "snr": params_demo_out["snr"],
              "gain": gain,
              "freq": freq,
              "is_detect_red": params_demo_out["is_detect_red"],
              "is_detect_blue": params_demo_out["is_detect_blue"],
              "is_clock_alignment": params_demo_out["is_clock_alignment"],
              "iteration_num": iteration_num,
              "gps_detected": gps_detected,
              "gps_locked": gps_locked,
              "rssi": rssi,
          },
      }
`;
  }

  public OperationDefinition(node: OperationDefinitionNode): string {
    return [
      this.getClientFunction(node),
      this.getExecuteFunction(true, node),
      this.getExecuteFunction(false, node),
    ].join('\n\n');
  }
}
