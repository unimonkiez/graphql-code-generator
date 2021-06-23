import { Types, PluginFunction } from '@graphql-codegen/plugin-helpers';
import { GraphQLSchema } from 'graphql';
import { PythonPluginConfig } from './config';
export * from '../../common/variables-to-object';
export * from './visitor';
export * from './config';
export * from './introspection-visitor';
export declare const plugin: PluginFunction<PythonPluginConfig, Types.ComplexPluginOutput>;
export declare function includeIntrospectionDefinitions(
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config: PythonPluginConfig
): string[];
