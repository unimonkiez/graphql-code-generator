import { PluginValidateFn, PluginFunction } from '@graphql-codegen/plugin-helpers';
import { PythonOperationsVisitor } from './visitor';
import { PythonOperationsRawPluginConfig } from './config';
export declare const plugin: PluginFunction<PythonOperationsRawPluginConfig>;
export declare const addToSchema: import('graphql').DocumentNode;
export declare const validate: PluginValidateFn<any>;
export { PythonOperationsVisitor };
