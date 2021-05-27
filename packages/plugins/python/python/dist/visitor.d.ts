import {
  DeclarationBlock,
  BaseTypesVisitor,
  ParsedTypesConfig,
  DeclarationKind,
  ParsedScalarsMap,
} from '@graphql-codegen/visitor-plugin-common';
import { PythonPluginConfig } from './config';
import {
  FieldDefinitionNode,
  NamedTypeNode,
  ListTypeNode,
  NonNullTypeNode,
  EnumTypeDefinitionNode,
  GraphQLSchema,
  ObjectTypeDefinitionNode,
  EnumValueDefinitionNode,
  UnionTypeDefinitionNode,
  InterfaceTypeDefinitionNode,
  InputObjectTypeDefinitionNode,
  InputValueDefinitionNode,
} from 'graphql';
export interface PythonPluginParsedConfig extends ParsedTypesConfig {
  scalars: ParsedScalarsMap;
  typenameAsString: boolean;
}
export declare class PyVisitor<
  PyRawConfig extends PythonPluginConfig = PythonPluginConfig,
  PyParsedConfig extends PythonPluginParsedConfig = PythonPluginParsedConfig
> extends BaseTypesVisitor<PyRawConfig, PyParsedConfig> {
  constructor(schema: GraphQLSchema, pluginConfig: PyRawConfig, additionalConfig?: Partial<PyParsedConfig>);
  getWrapperDefinitions(): string[];
  getScalarsImports(): string[];
  protected _getScalar(name: string): string;
  get scalarsDefinition(): string;
  protected clearOptional(str: string): string;
  protected getExportPrefix(): string;
  protected _getTypeForNode(node: NamedTypeNode): string;
  NamedType(node: NamedTypeNode, key: any, parent: any, path: any, ancestors: any): string;
  ListType(node: ListTypeNode): string;
  protected wrapWithListType(str: string): string;
  NonNullType(node: NonNullTypeNode): string;
  getObjectTypeDeclarationBlock(
    node: ObjectTypeDefinitionNode,
    originalNode: ObjectTypeDefinitionNode
  ): DeclarationBlock;
  FieldDefinition(node: FieldDefinitionNode, key?: number | string, parent?: any): string;
  getInputObjectDeclarationBlock(node: InputObjectTypeDefinitionNode): DeclarationBlock;
  getArgumentsObjectDeclarationBlock(
    node: InterfaceTypeDefinitionNode | ObjectTypeDefinitionNode,
    name: string,
    field: FieldDefinitionNode
  ): DeclarationBlock;
  getFieldComment(node: FieldDefinitionNode): string;
  InputValueDefinition(node: InputValueDefinitionNode): string;
  protected buildEnumValuesBlock(typeName: string, values: ReadonlyArray<EnumValueDefinitionNode>): string;
  getInterfaceTypeDeclarationBlock(
    node: InterfaceTypeDefinitionNode,
    originalNode: InterfaceTypeDefinitionNode
  ): DeclarationBlock;
  protected mergeInterfaces(interfaces: string[]): string;
  protected _buildTypeImport(identifier: string, source: string): string;
  handleEnumValueMapper(
    typeIdentifier: string,
    importIdentifier: string | null,
    sourceIdentifier: string | null,
    sourceFile: string | null
  ): string[];
  getEnumsImports(): string[];
  getDataclassesImports(): string[];
  EnumTypeDefinition(node: EnumTypeDefinitionNode): string;
  UnionTypeDefinition(node: UnionTypeDefinitionNode, key: string | number | undefined, parent: any): string;
  protected getPunctuation(declarationKind: DeclarationKind): string;
}
