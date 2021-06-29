'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

const graphql = require('graphql');
const visitorPluginCommon = require('@graphql-codegen/visitor-plugin-common');
const autoBind = _interopDefault(require('auto-bind'));
const path = require('path');
const gql = _interopDefault(require('graphql-tag'));

function transformPythonComment(comment, indentLevel = 0) {
    if (!comment || comment === '') {
        return '';
    }
    if (visitorPluginCommon.isStringValueNode(comment)) {
        comment = comment.value;
    }
    comment = comment.split('*/').join('*\\/');
    let lines = comment.split('\n');
    if (lines.length === 1) {
        return visitorPluginCommon.indent(`# ${lines[0]}\n`, indentLevel);
    }
    lines = [`"""`, ...lines, `"""\n`];
    return lines.map(line => visitorPluginCommon.indent(line, indentLevel)).join('\n');
}
class PythonDeclarationBlock extends visitorPluginCommon.DeclarationBlock {
    constructor(_config) {
        super({
            enumNameValueSeparator: '=',
            ..._config,
        });
    }
    withComment(comment) {
        const nonEmptyComment = visitorPluginCommon.isStringValueNode(comment) ? !!comment.value : !!comment;
        if (nonEmptyComment) {
            this._comment = transformPythonComment(comment, 0);
        }
        return this;
    }
    get string() {
        let result = '';
        if (this._decorator) {
            result += this._decorator + '\n';
        }
        if (this._kind && this._kind !== 'union') {
            result += 'class ';
        }
        const name = this._name + (this._nameGenerics || '');
        if (name) {
            result += name;
        }
        switch (this._kind) {
            case 'enum':
                result += '(Enum)';
                break;
            case 'union':
                result += ' = Union[';
                break;
        }
        if (this._block) {
            if (this._content) {
                result += this._content;
            }
            const blockWrapper = this._ignoreBlockWrapper ? '' : this._config.blockWrapper;
            const before = ':' + blockWrapper;
            let after = blockWrapper;
            if (this._kind !== 'scalar') {
                after += `\n__GQL_CODEGEN_${name}__ = ${name}`;
            }
            const block = [before, this._block, after].filter(val => !!val).join('\n');
            if (this._methodName) {
                result += `${this._methodName}(${this._config.blockTransformer(block)})`;
            }
            else {
                result += this._config.blockTransformer(block);
            }
        }
        else if (this._content) {
            result += this._content;
            if (this._kind && this._kind === 'union') {
                result += ']';
            }
            result += `\n__GQL_CODEGEN_${name}__ = ${name}`;
        }
        return (this._comment ? this._comment : '') + result + '\n';
    }
}

const PYTHON_SCALARS = {
    ID: 'str',
    String: 'str',
    Boolean: 'bool',
    Int: 'int',
    Float: 'float',
};
const pythonNativeValueTypes = [
    'bool',
    'byte',
    'sbyte',
    'char',
    'decimal',
    'double',
    'float',
    'int',
    'uint',
    'long',
    'ulong',
    'short',
    'ushort',
];

function isValueType(type) {
    // Limitation: only checks the list of known built in value types
    // Eg .NET types and struct types won't be detected correctly
    return pythonNativeValueTypes.includes(type);
}
function getListTypeField(typeNode) {
    if (typeNode.kind === graphql.Kind.LIST_TYPE) {
        return {
            required: false,
            type: getListTypeField(typeNode.type),
        };
    }
    else if (typeNode.kind === graphql.Kind.NON_NULL_TYPE && typeNode.type.kind === graphql.Kind.LIST_TYPE) {
        return Object.assign(getListTypeField(typeNode.type), {
            required: true,
        });
    }
    else if (typeNode.kind === graphql.Kind.NON_NULL_TYPE) {
        return getListTypeField(typeNode.type);
    }
    else {
        return undefined;
    }
}
function getListTypeDepth(listType) {
    if (listType) {
        return getListTypeDepth(listType.type) + 1;
    }
    else {
        return 0;
    }
}
function getListInnerTypeNode(typeNode) {
    if (typeNode.kind === graphql.Kind.LIST_TYPE) {
        return getListInnerTypeNode(typeNode.type);
    }
    else if (typeNode.kind === graphql.Kind.NON_NULL_TYPE && typeNode.type.kind === graphql.Kind.LIST_TYPE) {
        return getListInnerTypeNode(typeNode.type);
    }
    else {
        return typeNode;
    }
}
function wrapFieldType(fieldType, listTypeField, listType = 'IEnumerable') {
    if (listTypeField) {
        const innerType = wrapFieldType(fieldType, listTypeField.type, listType);
        return `${listType}[${innerType}]`;
    }
    else {
        return fieldType.innerTypeName;
    }
}

class PythonFieldType {
    constructor(fieldType) {
        Object.assign(this, fieldType);
    }
    get innerTypeName() {
        const nullable = this.baseType.valueType && !this.baseType.required;
        return `${nullable ? 'Optional[' : ''}${this.baseType.type}${nullable ? ']' : ''}`;
    }
    get isOuterTypeRequired() {
        return this.listType ? this.listType.required : this.baseType.required;
    }
}

const defaultSuffix = 'GQL';
class PythonOperationsVisitor extends visitorPluginCommon.ClientSideBaseVisitor {
    constructor(schema, fragments, rawConfig, documents) {
        super(schema, fragments, rawConfig, {
            schema: rawConfig.schema,
            subscriptionsSchema: rawConfig.schemaSubscriptions,
            querySuffix: rawConfig.querySuffix || defaultSuffix,
            mutationSuffix: rawConfig.mutationSuffix || defaultSuffix,
            subscriptionSuffix: rawConfig.subscriptionSuffix || defaultSuffix,
            scalars: visitorPluginCommon.buildScalars(schema, rawConfig.scalars, PYTHON_SCALARS),
        }, documents);
        this._operationsToInclude = [];
        this.overruleConfigSettings();
        autoBind(this);
        this._schemaAST = graphql.parse(graphql.printSchema(schema));
        this._usingNearFileOperations = true;
    }
    // Some settings aren't supported with C#, overruled here
    overruleConfigSettings() {
        if (this.config.documentMode === visitorPluginCommon.DocumentMode.graphQLTag) {
            // C# operations does not (yet) support graphQLTag mode
            this.config.documentMode = visitorPluginCommon.DocumentMode.documentNode;
        }
    }
    _gql(node) {
        const fragments = this._transformFragments(node);
        const doc = this._prepareDocument([graphql.print(node), this._includeFragments(fragments)].join('\n'));
        return doc.replace(/"/g, '\\"');
    }
    _nonScalarPrefix() {
        return this._usingNearFileOperations ? 'Types.' : '';
    }
    _gqlInputSignature(variable) {
        const typeNode = variable.type;
        const innerType = visitorPluginCommon.getBaseTypeNode(typeNode);
        const schemaType = this._schema.getType(innerType.name.value);
        const name = variable.variable.name.value;
        const isInputAScalar = graphql.isScalarType(schemaType);
        const baseType = !isInputAScalar
            ? `${this._nonScalarPrefix()}${innerType.name.value}`
            : this.scalars[schemaType.name] || 'object';
        const listType = getListTypeField(typeNode);
        const required = getListInnerTypeNode(typeNode).kind === graphql.Kind.NON_NULL_TYPE;
        return {
            name: name,
            signature: !listType
                ? `${name}: ${baseType}${!required ? ' = None' : ''}`
                : `${name}: ${'List['.repeat(getListTypeDepth(listType))}${baseType}${']'.repeat(getListTypeDepth(listType))}`,
            value: isInputAScalar ? name : `asdict(${name})`,
        };
    }
    _operationSuffix(operationType) {
        switch (operationType) {
            case 'query':
                return this.config.querySuffix;
            case 'mutation':
                return this.config.mutationSuffix;
            case 'subscription':
                return this.config.subscriptionSuffix;
            default:
                return defaultSuffix;
        }
    }
    getExecuteFunction(isAsync, node) {
        var _a;
        if (!node.name || !node.name.value) {
            return null;
        }
        this._collectedOperations.push(node);
        const documentVariableName = this.convertName(node, {
            suffix: this.config.documentVariableSuffix,
            prefix: this.config.documentVariablePrefix,
            useTypesPrefix: false,
        });
        const operationType = node.operation;
        const operationTypeSuffix = this.config.dedupeOperationSuffix && node.name.value.toLowerCase().endsWith(node.operation)
            ? ''
            : !operationType
                ? ''
                : operationType;
        const operationResultType = this.convertName(node, {
            suffix: operationTypeSuffix + this._parsedConfig.operationResultSuffix,
        });
        const operationVariablesTypes = this.convertName(node, {
            suffix: operationTypeSuffix + 'Variables',
        });
        this._operationsToInclude.push({
            node,
            documentVariableName,
            operationType,
            operationResultType,
            operationVariablesTypes,
        });
        const inputs = (_a = node.variableDefinitions) === null || _a === void 0 ? void 0 : _a.map(v => this._gqlInputSignature(v));
        const hasInputArgs = !!(inputs === null || inputs === void 0 ? void 0 : inputs.length);
        const inputSignatures = hasInputArgs ? inputs.map(sig => sig.signature).join(', ') : '';
        const variables = `{
    ${inputs.map(v => `"${v.name}": ${v.value},`).join('\n      ')}
  }`;
        const resposeClass = `${this.convertName(node.name.value).replace(/_/g, '')}Response`;
        const content = `
${isAsync ? 'async ' : ''}def execute${isAsync ? '_async' : ''}_${this._get_node_name(node)}(${inputSignatures}) -> ${resposeClass}:
  client = _get_client_${isAsync ? 'async' : 'sync'}()
  variables=${variables}
  variables_no_none = {k:v for k,v in variables.items() if v is not None}
${isAsync
            ? `
  response_text_promise = client.execute_async(
    _gql_${this._get_node_name(node)},
    variable_values=variables_no_none,
  )
  response_dict = await response_text_promise`
            : `
  response_dict = client.execute_sync(
    _gql_${this._get_node_name(node)},
    variable_values=variables_no_none,
  )`}

  response_dict = remove_empty(response_dict)
  return from_dict(data_class=${resposeClass}, data=response_dict, config=Config(cast=[Enum], check_types=False))
`;
        // {"researchBox": GetDatapointResponse.researchBox}
        return [content].filter(a => a).join('\n');
    }
    getExecuteFunctionSubscriptions(node) {
        var _a;
        if (!node.name || !node.name.value) {
            return null;
        }
        this._collectedOperations.push(node);
        const documentVariableName = this.convertName(node, {
            suffix: this.config.documentVariableSuffix,
            prefix: this.config.documentVariablePrefix,
            useTypesPrefix: false,
        });
        const operationType = node.operation;
        const operationTypeSuffix = this.config.dedupeOperationSuffix && node.name.value.toLowerCase().endsWith(node.operation)
            ? ''
            : !operationType
                ? ''
                : operationType;
        const operationResultType = this.convertName(node, {
            suffix: operationTypeSuffix + this._parsedConfig.operationResultSuffix,
        });
        const operationVariablesTypes = this.convertName(node, {
            suffix: operationTypeSuffix + 'Variables',
        });
        this._operationsToInclude.push({
            node,
            documentVariableName,
            operationType,
            operationResultType,
            operationVariablesTypes,
        });
        const inputs = (_a = node.variableDefinitions) === null || _a === void 0 ? void 0 : _a.map(v => this._gqlInputSignature(v));
        const hasInputArgs = !!(inputs === null || inputs === void 0 ? void 0 : inputs.length);
        const inputSignatures = hasInputArgs ? inputs.map(sig => sig.signature).join(', ') : '';
        const variables = `{
    ${inputs.map(v => `"${v.name}": ${v.value},`).join('\n      ')}
  }`;
        const resposeClass = `${this.convertName(node.name.value).replace(/_/g, '')}Response`;
        const content = `
async def execute_async_${this._get_node_name(node)}(${inputSignatures}) -> AsyncGenerator[${resposeClass}, None]:
  async with _get_client_subscriptions() as client:
    variables = ${variables}
    variables_no_none = {k:v for k,v in variables.items() if v is not None}
    generator = client.subscribe(
      _gql_${this._get_node_name(node)},
      variable_values=variables_no_none,
    )
    async for response_dict in generator:
        yield from_dict(data_class=${resposeClass}, data=response_dict, config=Config(cast=[Enum], check_types=False))
`;
        return [content].filter(a => a).join('\n');
    }
    _get_node_name(node) {
        return `${this.convertName(node)}_${this._operationSuffix(node.operation)}`.toLowerCase();
    }
    getGQLVar(node) {
        return `
_gql_${this._get_node_name(node)} = gql("""
${this._gql(node)}
""")
`;
    }
    resolveFieldType(typeNode, hasDefaultValue = false) {
        const innerType = visitorPluginCommon.getBaseTypeNode(typeNode);
        const schemaType = this._schema.getType(innerType.name.value);
        const listType = getListTypeField(typeNode);
        const required = getListInnerTypeNode(typeNode).kind === graphql.Kind.NON_NULL_TYPE;
        let result = null;
        if (graphql.isScalarType(schemaType)) {
            if (this.scalars[schemaType.name]) {
                const baseType = this.scalars[schemaType.name];
                result = new PythonFieldType({
                    baseType: {
                        type: baseType,
                        required,
                        valueType: isValueType(baseType),
                    },
                    listType,
                });
            }
            else {
                result = new PythonFieldType({
                    baseType: {
                        type: 'object',
                        required,
                        valueType: false,
                    },
                    listType,
                });
            }
        }
        else if (graphql.isInputObjectType(schemaType)) {
            result = new PythonFieldType({
                baseType: {
                    type: `${this._nonScalarPrefix()}${this.convertName(schemaType.name)}`,
                    required,
                    valueType: false,
                },
                listType,
            });
        }
        else if (graphql.isEnumType(schemaType)) {
            result = new PythonFieldType({
                baseType: {
                    type: `${this._nonScalarPrefix()}${this.convertName(schemaType.name)}`,
                    required,
                    valueType: true,
                },
                listType,
            });
        }
        else {
            result = new PythonFieldType({
                baseType: {
                    type: `${schemaType.name}`,
                    required,
                    valueType: false,
                },
                listType,
            });
        }
        if (hasDefaultValue) {
            // Required field is optional when default value specified, see #4273
            (result.listType || result.baseType).required = false;
        }
        return result;
    }
    _getResponseFieldRecursive(node, parentSchema, fieldAsFragment, prepend, addField) {
        switch (node.kind) {
            case graphql.Kind.OPERATION_DEFINITION: {
                return new PythonDeclarationBlock({})
                    .export()
                    .asKind('class')
                    .withDecorator('@dataclass')
                    .withName(`${this.convertName(prepend).replace(/_/g, '')}Response`)
                    .withBlock(node.selectionSet.selections
                    .map(opr => {
                    if (opr.kind !== graphql.Kind.FIELD) {
                        throw new Error(`Unknown kind; ${opr.kind} in OperationDefinitionNode`);
                    }
                    return this._getResponseFieldRecursive(opr, parentSchema, false);
                })
                    .join('\n')).string;
            }
            case graphql.Kind.FIELD: {
                const fieldSchema = parentSchema.fields.find(f => f.name.value === node.name.value);
                if (!fieldSchema) {
                    throw new Error(`Field schema not found; ${node.name.value}`);
                }
                const responseType = this.resolveFieldType(fieldSchema.type);
                if (!node.selectionSet) {
                    const responseTypeName = wrapFieldType(responseType, responseType.listType, 'List');
                    if (!fieldAsFragment) {
                        return visitorPluginCommon.indentMultiline([`${node.name.value}: "${responseTypeName}"`].join('\n') + '\n');
                    }
                    else {
                        return ''; // `${node.name.value}: "${responseTypeName}"` + '\n';
                    }
                }
                else {
                    const selectionBaseTypeName = `${responseType.baseType.type}Selection`;
                    const selectionType = Object.assign(new PythonFieldType(responseType), {
                        baseType: { type: selectionBaseTypeName },
                    });
                    const selectionTypeName = wrapFieldType(selectionType, selectionType.listType, 'List');
                    const innerClassSchema = this._schemaAST.definitions.find(d => {
                        return ((d.kind === graphql.Kind.OBJECT_TYPE_DEFINITION || d.kind === graphql.Kind.INTERFACE_TYPE_DEFINITION) &&
                            d.name.value === responseType.baseType.type);
                    });
                    if (!innerClassSchema) {
                        throw new Error(`innerClassSchema not found: ${node.name.value}, schema: ${innerClassSchema}, opr.kind: ${node.kind}`);
                    }
                    const fragmentTypes = [graphql.Kind.FRAGMENT_SPREAD, graphql.Kind.INLINE_FRAGMENT];
                    const isSomeChildFragments = node.selectionSet.selections.some(s => fragmentTypes.indexOf(s.kind) !== -1);
                    const nonFragmentChilds = node.selectionSet.selections.flatMap(s => (s.kind !== graphql.Kind.FIELD ? [] : s));
                    if (isSomeChildFragments) {
                        const ret = visitorPluginCommon.indentMultiline([
                            //  innerClassDefinition,
                            ...node.selectionSet.selections.map(s => {
                                return this._getResponseFieldRecursive(s, innerClassSchema, true, undefined, nonFragmentChilds);
                            }),
                            `${node.name.value}: List[Union[${node.selectionSet.selections
                                .flatMap(s => (s.kind === graphql.Kind.FIELD ? [] : s))
                                .map(s => {
                                var _a;
                                if (s.kind === graphql.Kind.INLINE_FRAGMENT) {
                                    return (_a = s.typeCondition) === null || _a === void 0 ? void 0 : _a.name.value;
                                }
                                else if (s.kind === graphql.Kind.FRAGMENT_SPREAD) {
                                    return s.name.value;
                                }
                                //return s.name.value;
                                throw Error('Unknown Type');
                            })
                                .join(', ')}]]`,
                        ].join('\n'));
                        return ret;
                    }
                    else {
                        if (!fieldAsFragment) {
                            const innerClassDefinition = new PythonDeclarationBlock({})
                                .asKind('class')
                                .withDecorator('@dataclass')
                                .withName(selectionBaseTypeName)
                                .withBlock(node.selectionSet.selections
                                .map(s => {
                                return this._getResponseFieldRecursive(s, innerClassSchema, false);
                            })
                                .join('\n')).string;
                            return visitorPluginCommon.indentMultiline([innerClassDefinition, `${node.name.value}: ${selectionTypeName}`].join('\n'));
                        }
                        return '';
                    }
                }
            }
            case graphql.Kind.FRAGMENT_SPREAD: {
                const fragmentSchema = this._fragments.find(f => f.name === node.name.value);
                if (!fragmentSchema) {
                    throw new Error(`Fragment schema not found: ${node.name.value}`);
                }
                const fragmentParentSchema = this._schemaAST.definitions.find(s => s.kind === graphql.Kind.OBJECT_TYPE_DEFINITION && s.name.value === fragmentSchema.node.typeCondition.name.value);
                if (!fragmentParentSchema) {
                    throw new Error(`Fragment schema not found: ${fragmentSchema.node.typeCondition.name.value}`);
                }
                const innerClassDefinition = new PythonDeclarationBlock({})
                    .asKind('class')
                    .withDecorator('@dataclass')
                    .withName(node.name.value)
                    .withBlock(fragmentSchema.node.selectionSet.selections
                    .map(s => {
                    return this._getResponseFieldRecursive(s, fragmentParentSchema, false);
                })
                    .join('\n')).string;
                return innerClassDefinition;
            }
            case graphql.Kind.INLINE_FRAGMENT: {
                const fragmentSchemaName = node.typeCondition.name.value;
                const fragmentSchema = this._schemaAST.definitions.find(s => s.kind === graphql.Kind.OBJECT_TYPE_DEFINITION && s.name.value === fragmentSchemaName);
                if (!fragmentSchema) {
                    throw new Error(`Fragment schema not found; ${fragmentSchemaName}`);
                }
                let block = '\n' +
                    node.selectionSet.selections
                        .map(s => {
                        return this._getResponseFieldRecursive(s, fragmentSchema, false);
                    })
                        .join('\n');
                if (addField) {
                    block =
                        block +
                            '\n' +
                            addField
                                .map(s => {
                                return this._getResponseFieldRecursive(s, fragmentSchema, false);
                            })
                                .join('\n');
                }
                const innerClassDefinition = new PythonDeclarationBlock({})
                    .asKind('class')
                    .withDecorator('@dataclass')
                    .withName(fragmentSchemaName)
                    .withBlock(block).string;
                if (addField) {
                    return innerClassDefinition + '\n';
                }
                return innerClassDefinition + '\n';
            }
        }
    }
    getResponseClass(node) {
        var _a, _b;
        const operationSchema = this._schemaAST.definitions.find(s => s.kind === graphql.Kind.OBJECT_TYPE_DEFINITION && s.name.value.toLowerCase() === node.operation);
        return this._getResponseFieldRecursive(node, operationSchema, false, (_b = (_a = node.name) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : '');
    }
    OperationDefinition(node) {
        return [this.getGQLVar(node), this.getResponseClass(node)]
            .concat(node.operation === 'subscription'
            ? [this.getExecuteFunctionSubscriptions(node)]
            : [this.getExecuteFunction(false, node), this.getExecuteFunction(true, node)])
            .join('\n\n');
    }
}

const getImports = () => {
    return `
from typing import List, Optional, Union, AsyncGenerator, Type
from dataclasses import dataclass
from dataclasses import asdict
from gql import Client, gql
from gql.transport.websockets import WebsocketsTransport
from gql.transport.aiohttp import AIOHTTPTransport
from gql.transport.requests import RequestsHTTPTransport
from dacite import from_dict, Config
from enum import Enum

def remove_empty(dict_or_list):
    if isinstance(dict_or_list, dict):
        for key, value in dict_or_list.items():
            dict_or_list[key] = remove_empty(value)
        return dict_or_list
    elif isinstance(dict_or_list, list):
        for count, object_in_list in enumerate(dict_or_list):
            if object_in_list == {} or object_in_list == [] or object_in_list == None:
                del dict_or_list[count]
        return dict_or_list
    else:
        return dict_or_list

`;
};
const getClientFunction = (config, type) => {
    const transportClass = type === 'sync' ? 'RequestsHTTPTransport' : type === 'async' ? 'AIOHTTPTransport' : 'WebsocketsTransport';
    return `
def _get_client_${type}() -> Client:
  transport = ${transportClass}(url=${type === 'subscriptions' ? config.schemaSubscriptions : config.schema}, headers={${config.headerName !== undefined && config.headerName !== '' ? `${config.headerName}: ${config.headerValue}` : ``}})
  client = Client(transport=transport, fetch_schema_from_transport=False)
  return client
`;
};
const plugin = (schema, documents, config) => {
    const allAst = graphql.concatAST(documents.map(v => v.document));
    const allFragments = [
        ...allAst.definitions.filter(d => d.kind === graphql.Kind.FRAGMENT_DEFINITION).map(fragmentDef => ({
            node: fragmentDef,
            name: fragmentDef.name.value,
            onType: fragmentDef.typeCondition.name.value,
            isExternal: false,
        })),
        ...(config.externalFragments || []),
    ];
    const visitor = new PythonOperationsVisitor(schema, allFragments, config, documents);
    const visitorResult = graphql.visit(allAst, { leave: visitor });
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
const addToSchema = gql `
  directive @namedClient(name: String!) on OBJECT | FIELD
`;
const validate = async (schema, documents, config, outputFile) => {
    if (path.extname(outputFile) !== '.py') {
        throw new Error(`Plugin "python-operations" requires extension to be ".py"!`);
    }
};

exports.PythonOperationsVisitor = PythonOperationsVisitor;
exports.addToSchema = addToSchema;
exports.plugin = plugin;
exports.validate = validate;
//# sourceMappingURL=index.cjs.js.map
