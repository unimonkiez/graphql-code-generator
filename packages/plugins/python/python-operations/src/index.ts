import { Types, PluginValidateFn, PluginFunction } from '@graphql-codegen/plugin-helpers';
import { visit, GraphQLSchema, concatAST, Kind, FragmentDefinitionNode } from 'graphql';
import { LoadedFragment } from '@graphql-codegen/visitor-plugin-common';
import { PythonOperationsVisitor } from './visitor';
import { extname } from 'path';
import gql from 'graphql-tag';
import { PythonOperationsRawPluginConfig } from './config';

const getImports = () => {
  return `
from typing import Any, Callable, Mapping, List, Optional, Dict
from dataclasses import dataclass, field
from dataclasses_json import dataclass_json  # type: ignore
from gql import Client, WebsocketsTransport, AIOHTTPTransport, gql  # type: ignore
import json
`;
}

const getClientFunction = (config: PythonOperationsRawPluginConfig) => {
  return `
def _get_client() -> Client:
transport = AIOHTTPTransport(url=${config.schema})
client = Client(transport=transport, fetch_schema_from_transport=False)
return client
`;
}

const getClientSubscriptionsFunction = (config: PythonOperationsRawPluginConfig) => {
  return `
def _get_client_subscriptions() -> Client:
transport = WebsocketsTransport(url=${config.schemaSubscriptions})
client = Client(transport=transport, fetch_schema_from_transport=False)
return client
`;
}
export const plugin: PluginFunction<PythonOperationsRawPluginConfig> = (
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config,
) => {
  const allAst = concatAST(documents.map(v => v.document));
  const allFragments: LoadedFragment[] = [
    ...(allAst.definitions.filter(d => d.kind === Kind.FRAGMENT_DEFINITION) as FragmentDefinitionNode[]).map(
      fragmentDef => ({
        node: fragmentDef,
        name: fragmentDef.name.value,
        onType: fragmentDef.typeCondition.name.value,
        isExternal: false,
      })
    ),
    ...(config.externalFragments || []),
  ];

  const visitor = new PythonOperationsVisitor(schema, allFragments, config, documents);
  const visitorResult = visit(allAst, { leave: visitor });
  return {
    prepend: [],
    content: [
      getImports(),
      getClientFunction(config),
      getClientSubscriptionsFunction(config),
      ...visitorResult.definitions.filter(t => typeof t === 'string'),
    ]
      .filter(a => a)
      .join('\n'),
  };
};

export const addToSchema = gql`
  directive @namedClient(name: String!) on OBJECT | FIELD
`;

export const validate: PluginValidateFn<any> = async (
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config,
  outputFile: string
) => {
  if (extname(outputFile) !== '.py') {
    throw new Error(`Plugin "python-operations" requires extension to be ".py"!`);
  }
};

export { PythonOperationsVisitor };
