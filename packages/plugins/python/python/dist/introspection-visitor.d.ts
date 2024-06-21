import { GraphQLSchema, GraphQLNamedType, EnumTypeDefinitionNode, ObjectTypeDefinitionNode } from 'graphql';
import { PyVisitor } from './visitor';
import { PythonPluginConfig } from './config';
export declare class TsIntrospectionVisitor extends PyVisitor {
  private typesToInclude;
  constructor(schema: GraphQLSchema, pluginConfig: PythonPluginConfig, typesToInclude: GraphQLNamedType[]);
  DirectiveDefinition(): any;
  ObjectTypeDefinition(node: ObjectTypeDefinitionNode, key: string | number, parent: any): string;
  EnumTypeDefinition(node: EnumTypeDefinitionNode): string;
}
