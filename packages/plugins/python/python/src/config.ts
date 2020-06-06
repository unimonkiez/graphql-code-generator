import { RawTypesConfig } from '@graphql-codegen/visitor-plugin-common';

/**
 * @description This plugin generates the base TypeScript types, based on your GraphQL schema.
 *
 * The types generated by this plugin are simple, and refers to the exact structure of your schema, and it's used as the base types for other plugins (such as `typescript-operations` / `typescript-resolvers`)
 */
export interface PythonPluginConfig extends RawTypesConfig {}