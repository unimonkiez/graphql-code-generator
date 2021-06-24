import { Types, PluginValidateFn, PluginFunction } from '@graphql-codegen/plugin-helpers';
import { visit, GraphQLSchema, concatAST, Kind, FragmentDefinitionNode } from 'graphql';
import { LoadedFragment } from '@graphql-codegen/visitor-plugin-common';
import { PythonOperationsVisitor } from './visitor';
import { extname } from 'path';
import gql from 'graphql-tag';
import { PythonOperationsRawPluginConfig } from './config';

const getImports = () => {
  return `
from typing import List, Optional, Union, AsyncGenerator
from dataclasses import dataclass
from dataclasses import asdict
from gql import Client, gql
from gql.transport.websockets import WebsocketsTransport
from gql.transport.aiohttp import AIOHTTPTransport
from gql.transport.requests import RequestsHTTPTransport
from dacite import from_dict, Config
from enum import Enum
`;
};

const getClientFunction = (config: PythonOperationsRawPluginConfig, type: 'sync' | 'async' | 'subscriptions') => {
  const transportClass =
    type === 'sync' ? 'RequestsHTTPTransport' : type === 'async' ? 'AIOHTTPTransport' : 'WebsocketsTransport';
  return `
def _get_client_${type}() -> Client:
  transport = ${transportClass}(url=${
    type === 'subscriptions' ? config.schemaSubscriptions : config.schema
  }, headers={${
    config.headerName !== undefined && config.headerName !== '' ? `${config.headerName}: ${config.headerValue}` : ``
  }})
  client = Client(transport=transport, fetch_schema_from_transport=False)
  return client
`;
};

export const plugin: PluginFunction<PythonOperationsRawPluginConfig> = (
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config
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
      getClientFunction(config, 'sync'),
      getClientFunction(config, 'async'),
      getClientFunction(config, 'subscriptions'),
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
