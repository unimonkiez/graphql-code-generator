import { RawClientSideBasePluginConfig } from '@graphql-codegen/visitor-plugin-common';

/**
 * @description This plugin generates C# `class` based on your GraphQL operations.
 */
export interface PythonOperationsRawPluginConfig extends RawClientSideBasePluginConfig {
  /**
   * @description Allows to define a custom suffix for query operations.
   * @default GQL
   *
   * @exampleMarkdown
   * ```yml
   * config:
   *   querySuffix: 'QueryService'
   * ```
   */
  querySuffix?: string;
  /**
   * @description Allows to define a custom suffix for mutation operations.
   * @default GQL
   *
   * @exampleMarkdown
   * ```yml
   * config:
   *   mutationSuffix: 'MutationService'
   * ```
   */
  mutationSuffix?: string;
  /**
   * @description Allows to define a custom suffix for Subscription operations.
   * @default GQL
   *
   * @exampleMarkdown
   * ```yml
   * config:
   *   subscriptionSuffix: 'SubscriptionService'
   * ```
   */
  subscriptionSuffix?: string;

  /**
   * @description Allows to define a custom schemaUrl.
   * @default Same from codegen.yml
   *
   * @exampleMarkdown
   * ```yml
   * config:
   *   schemaOverride: "https://rickandmortyapi.com/graphql"
   * ```
   */
  schema: string;
  /**
   * @description Allows to define a custom schemaUrl for subscriptions.
   * @default Same from codegen.yml
   *
   * @exampleMarkdown
   * ```yml
   * config:
   *   schemaSubscriptionsOverride: "wss://rickandmortyapi.com/graphql"
   * ```
   */
  schemaSubscriptions: string;
  /**
   * @description Allows to define a custom header to send with the request
   * @default Same from codegen.yml
   *
   * @exampleMarkdown
   * ```yml
   * config:
   *   headerNameOverride: "X-AUTH"
   * ```
   */
  headerName: string;
  /**
   * @description Allows to define a custom header value to send with the request
   * @default Same from codegen.yml
   *
   * @exampleMarkdown
   * ```yml
   * config:
   *   headerValueOverride: "X-AUTH"
   * ```
   */
  headerValue: string;
  /**
   * @description Allows to disable async generation.
   * @default true
   *
   * @exampleMarkdown
   * ```yml
   * config:
   *   generateAsync: false
   * ```
   */
  generateAsync?: boolean;
}
