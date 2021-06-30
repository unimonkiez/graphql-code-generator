import {
  ClientSideBaseVisitor,
  ClientSideBasePluginConfig,
  LoadedFragment,
} from '@graphql-codegen/visitor-plugin-common';
import { OperationDefinitionNode, GraphQLSchema, TypeNode } from 'graphql';
import { PythonOperationsRawPluginConfig } from './config';
import { Types } from '@graphql-codegen/plugin-helpers';
import { PythonFieldType } from '../../common/common';
export interface PythonOperationsPluginConfig extends ClientSideBasePluginConfig {
  schema: string;
  subscriptionsSchema: string;
  querySuffix: string;
  mutationSuffix: string;
  subscriptionSuffix: string;
  generateAsync?: boolean;
}
export declare class PythonOperationsVisitor extends ClientSideBaseVisitor<
  PythonOperationsRawPluginConfig,
  PythonOperationsPluginConfig
> {
  private _operationsToInclude;
  private _schemaAST;
  private _usingNearFileOperations;
  constructor(
    schema: GraphQLSchema,
    fragments: LoadedFragment[],
    rawConfig: PythonOperationsRawPluginConfig,
    documents?: Types.DocumentFile[]
  );
  private overruleConfigSettings;
  protected _gql(node: OperationDefinitionNode): string;
  private _nonScalarPrefix;
  private _gqlInputSignature;
  private _operationSuffix;
  private getExecuteFunctionSignature;
  private getExecuteFunctionBody;
  private getExecuteFunctionSubscriptionsSignature;
  private getExecuteFunctionSubscriptionsBody;
  private _get_node_name;
  private getGQLVar;
  protected resolveFieldType(typeNode: TypeNode, hasDefaultValue?: Boolean): PythonFieldType;
  private _getResponseFieldRecursive;
  private getResponseClass;
  OperationDefinition(node: OperationDefinitionNode): string;
}
