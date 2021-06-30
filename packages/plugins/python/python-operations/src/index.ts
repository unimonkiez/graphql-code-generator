import { Types, PluginValidateFn, PluginFunction } from '@graphql-codegen/plugin-helpers';
import { visit, GraphQLSchema, concatAST, Kind, FragmentDefinitionNode } from 'graphql';
import { LoadedFragment } from '@graphql-codegen/visitor-plugin-common';
import { PythonOperationsVisitor } from './visitor';
import { extname } from 'path';
import gql from 'graphql-tag';
import { PythonOperationsRawPluginConfig } from './config';

const getImports = () => {
  return `
from typing import Any, List, Dict, Optional, Union, AsyncGenerator, Type
from dataclasses import dataclass
from dataclasses import asdict
from gql import gql
from gql import Client as GqlClient
from gql.transport.websockets import WebsocketsTransport
from gql.transport.aiohttp import AIOHTTPTransport
from gql.transport.requests import RequestsHTTPTransport
from dacite import from_dict, Config
from enum import Enum

def remove_empty(dict_or_list):
    if isinstance(dict_or_list, dict):
        for key, value in dict_or_list.items():
            if value == {} or value == []:
              del dict_or_list[key]
            else:
              dict_or_list[key] = remove_empty(value)
        return dict_or_list
    elif isinstance(dict_or_list, list):
        for count, object_in_list in enumerate(dict_or_list):
            if object_in_list == {} or object_in_list == []:
                del dict_or_list[count]
        for count, object_in_list in enumerate(dict_or_list):
            dict_or_list[count] = remove_empty(object_in_list)
        return dict_or_list
    else:
        return dict_or_list

`;
};

const getClient = () => {
  return `
class Client:
  def __init__(self, url: str, headers: Optional[Dict[str, Any]] = None):
    self.__http_transport = RequestsHTTPTransport(url=url, headers=headers)
    self.__client = GqlClient(transport=self.__http_transport, fetch_schema_from_transport=False)
    
    self.__async_transport = AIOHTTPTransport(url=url, headers=headers)
    self.__async_client = GqlClient(transport=self.__async_transport, fetch_schema_from_transport=False)

    self.__websocket_transport = WebsocketsTransport(url=url, headers=headers)
    self.__websocket_client = GqlClient(transport=self.__websocket_transport, fetch_schema_from_transport=False)
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
    content: [getImports(), getClient(), ...visitorResult.definitions.filter(t => typeof t === 'string')]
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
