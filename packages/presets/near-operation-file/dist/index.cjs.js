'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

const addPlugin = _interopDefault(require('@graphql-codegen/add'));
const path = require('path');
const graphql = require('graphql');
const parsePath = _interopDefault(require('parse-filepath'));
const pluginHelpers = require('@graphql-codegen/plugin-helpers');
const visitorPluginCommon = require('@graphql-codegen/visitor-plugin-common');

function defineFilepathSubfolder(baseFilePath, folder) {
    const parsedPath = parsePath(baseFilePath);
    return path.join(parsedPath.dir, folder, parsedPath.base).replace(/\\/g, '/');
}
function appendExtensionToFilePath(baseFilePath, extension) {
    const parsedPath = parsePath(baseFilePath);
    return path.join(parsedPath.dir, parsedPath.name + extension).replace(/\\/g, '/');
}
function extractExternalFragmentsInUse(documentNode, fragmentNameToFile, result = {}, level = 0) {
    const ignoreList = new Set();
    // First, take all fragments definition from the current file, and mark them as ignored
    graphql.visit(documentNode, {
        enter: {
            FragmentDefinition: (node) => {
                ignoreList.add(node.name.value);
            },
        },
    });
    // Then, look for all used fragments in this document
    graphql.visit(documentNode, {
        enter: {
            FragmentSpread: (node) => {
                if (!ignoreList.has(node.name.value)) {
                    if (result[node.name.value] === undefined ||
                        (result[node.name.value] !== undefined && level < result[node.name.value])) {
                        result[node.name.value] = level;
                        if (fragmentNameToFile[node.name.value]) {
                            extractExternalFragmentsInUse(fragmentNameToFile[node.name.value].node, fragmentNameToFile, result, level + 1);
                        }
                    }
                }
            },
        },
    });
    return result;
}

/**
 * Used by `buildFragmentResolver` to  build a mapping of fragmentNames to paths, importNames, and other useful info
 */
function buildFragmentRegistry({ generateFilePath }, { documents, config }, schemaObject) {
    const baseVisitor = new visitorPluginCommon.BaseVisitor(config, {
        scalars: visitorPluginCommon.buildScalarsFromConfig(schemaObject, config),
        dedupeOperationSuffix: visitorPluginCommon.getConfigValue(config.dedupeOperationSuffix, false),
        omitOperationSuffix: visitorPluginCommon.getConfigValue(config.omitOperationSuffix, false),
        fragmentVariablePrefix: visitorPluginCommon.getConfigValue(config.fragmentVariablePrefix, ''),
        fragmentVariableSuffix: visitorPluginCommon.getConfigValue(config.fragmentVariableSuffix, 'FragmentDoc'),
    });
    const getFragmentImports = (possbileTypes, name) => {
        const fragmentImports = [];
        fragmentImports.push({ name: baseVisitor.getFragmentVariableName(name), kind: 'document' });
        const fragmentSuffix = baseVisitor.getFragmentSuffix(name);
        if (possbileTypes.length === 1) {
            fragmentImports.push({
                name: baseVisitor.convertName(name, {
                    useTypesPrefix: true,
                    suffix: fragmentSuffix,
                }),
                kind: 'type',
            });
        }
        else if (possbileTypes.length !== 0) {
            possbileTypes.forEach(typeName => {
                fragmentImports.push({
                    name: baseVisitor.convertName(name, {
                        useTypesPrefix: true,
                        suffix: `_${typeName}_${fragmentSuffix}`,
                    }),
                    kind: 'type',
                });
            });
        }
        return fragmentImports;
    };
    const duplicateFragmentNames = [];
    const registry = documents.reduce((prev, documentRecord) => {
        const fragments = documentRecord.document.definitions.filter(d => d.kind === graphql.Kind.FRAGMENT_DEFINITION);
        if (fragments.length > 0) {
            for (const fragment of fragments) {
                const schemaType = schemaObject.getType(fragment.typeCondition.name.value);
                if (!schemaType) {
                    throw new Error(`Fragment "${fragment.name.value}" is set on non-existing type "${fragment.typeCondition.name.value}"!`);
                }
                const possibleTypes = visitorPluginCommon.getPossibleTypes(schemaObject, schemaType);
                const filePath = generateFilePath(documentRecord.location);
                const imports = getFragmentImports(possibleTypes.map(t => t.name), fragment.name.value);
                if (prev[fragment.name.value] && graphql.print(fragment) !== graphql.print(prev[fragment.name.value].node)) {
                    duplicateFragmentNames.push(fragment.name.value);
                }
                prev[fragment.name.value] = {
                    filePath,
                    imports,
                    onType: fragment.typeCondition.name.value,
                    node: fragment,
                };
            }
        }
        return prev;
    }, {});
    if (duplicateFragmentNames.length) {
        throw new Error(`Multiple fragments with the name(s) "${duplicateFragmentNames.join(', ')}" were found.`);
    }
    return registry;
}
/**
 *  Builds a fragment "resolver" that collects `externalFragments` definitions and `fragmentImportStatements`
 */
function buildFragmentResolver(collectorOptions, presetOptions, schemaObject) {
    const fragmentRegistry = buildFragmentRegistry(collectorOptions, presetOptions, schemaObject);
    const { baseOutputDir } = presetOptions;
    const { baseDir, typesImport } = collectorOptions;
    function resolveFragments(generatedFilePath, documentFileContent) {
        const fragmentsInUse = extractExternalFragmentsInUse(documentFileContent, fragmentRegistry);
        const externalFragments = [];
        // fragment files to import names
        const fragmentFileImports = {};
        for (const fragmentName of Object.keys(fragmentsInUse)) {
            const level = fragmentsInUse[fragmentName];
            const fragmentDetails = fragmentRegistry[fragmentName];
            if (fragmentDetails) {
                // add top level references to the import object
                // we don't checkf or global namespace because the calling config can do so
                if (level === 0) {
                    if (fragmentFileImports[fragmentDetails.filePath] === undefined) {
                        fragmentFileImports[fragmentDetails.filePath] = fragmentDetails.imports;
                    }
                    else {
                        fragmentFileImports[fragmentDetails.filePath].push(...fragmentDetails.imports);
                    }
                }
                externalFragments.push({
                    level,
                    isExternal: true,
                    name: fragmentName,
                    onType: fragmentDetails.onType,
                    node: fragmentDetails.node,
                });
            }
        }
        return {
            externalFragments,
            fragmentImports: Object.entries(fragmentFileImports).map(([fragmentsFilePath, identifiers]) => ({
                baseDir,
                baseOutputDir,
                outputPath: generatedFilePath,
                importSource: {
                    path: fragmentsFilePath,
                    identifiers,
                },
                typesImport,
            })),
        };
    }
    return resolveFragments;
}

/**
 * Transform the preset's provided documents into single-file generator sources, while resolving fragment and user-defined imports
 *
 * Resolves user provided imports and fragment imports using the `DocumentImportResolverOptions`.
 * Does not define specific plugins, but rather returns a string[] of `importStatements` for the calling plugin to make use of
 */
function resolveDocumentImports(presetOptions, schemaObject, importResolverOptions) {
    const resolveFragments = buildFragmentResolver(importResolverOptions, presetOptions, schemaObject);
    const { baseOutputDir, documents } = presetOptions;
    const { generateFilePath, schemaTypesSource, baseDir, typesImport } = importResolverOptions;
    return documents.map(documentFile => {
        try {
            const generatedFilePath = generateFilePath(documentFile.location);
            const importStatements = [];
            const { externalFragments, fragmentImports } = resolveFragments(generatedFilePath, documentFile.document);
            if (pluginHelpers.isUsingTypes(documentFile.document, externalFragments.map(m => m.name), schemaObject)) {
                const schemaTypesImportStatement = visitorPluginCommon.generateImportStatement({
                    baseDir,
                    importSource: visitorPluginCommon.resolveImportSource(schemaTypesSource),
                    baseOutputDir,
                    outputPath: generatedFilePath,
                    typesImport,
                });
                importStatements.unshift(schemaTypesImportStatement);
            }
            return {
                filename: generatedFilePath,
                documents: [documentFile],
                importStatements,
                fragmentImports,
                externalFragments,
            };
        }
        catch (e) {
            throw new pluginHelpers.DetailedError(`Unable to validate GraphQL document!`, `
  File ${documentFile.location} caused error:
    ${e.message || e.toString()}
        `, documentFile.location);
        }
    });
}

const preset = {
    buildGeneratesSection: options => {
        var _a;
        const schemaObject = options.schemaAst
            ? options.schemaAst
            : graphql.buildASTSchema(options.schema, options.config);
        const baseDir = options.presetConfig.cwd || process.cwd();
        const extension = options.presetConfig.extension || '.generated.ts';
        const folder = options.presetConfig.folder || '';
        const importTypesNamespace = options.presetConfig.importTypesNamespace || 'Types';
        const importAllFragmentsFrom = options.presetConfig.importAllFragmentsFrom || null;
        const baseTypesPath = options.presetConfig.baseTypesPath;
        if (!baseTypesPath) {
            throw new Error(`Preset "near-operation-file" requires you to specify "baseTypesPath" configuration and point it to your base types file (generated by "typescript" plugin)!`);
        }
        const shouldAbsolute = !baseTypesPath.startsWith('~');
        const pluginMap = {
            ...options.pluginMap,
            add: addPlugin,
        };
        const sources = resolveDocumentImports(options, schemaObject, {
            baseDir,
            generateFilePath(location) {
                const newFilePath = defineFilepathSubfolder(location, folder);
                return appendExtensionToFilePath(newFilePath, extension);
            },
            schemaTypesSource: {
                path: shouldAbsolute ? path.join(options.baseOutputDir, baseTypesPath) : baseTypesPath,
                namespace: importTypesNamespace,
            },
            typesImport: (_a = options.config.useTypeImports) !== null && _a !== void 0 ? _a : false,
        });
        return sources.map(({ importStatements, externalFragments, fragmentImports, ...source }) => {
            let fragmentImportsArr = fragmentImports;
            if (importAllFragmentsFrom) {
                fragmentImportsArr = fragmentImports.map(t => {
                    const newImportSource = typeof importAllFragmentsFrom === 'string'
                        ? { ...t.importSource, path: importAllFragmentsFrom }
                        : importAllFragmentsFrom(t.importSource, source.filename);
                    return {
                        ...t,
                        importSource: newImportSource || t.importSource,
                    };
                });
            }
            const plugins = [
                // TODO/NOTE I made globalNamespace include schema types - is that correct?
                ...(options.config.globalNamespace
                    ? []
                    : importStatements.map(importStatement => ({ add: { content: importStatement } }))),
                ...options.plugins,
            ];
            const config = {
                ...options.config,
                // This is set here in order to make sure the fragment spreads sub types
                // are exported from operations file
                exportFragmentSpreadSubTypes: true,
                namespacedImportName: importTypesNamespace,
                externalFragments,
                fragmentImports: fragmentImportsArr,
            };
            return {
                ...source,
                plugins,
                pluginMap,
                config,
                schema: options.schema,
                schemaAst: schemaObject,
                skipDocumentsValidation: true,
            };
        });
    },
};

exports.default = preset;
exports.preset = preset;
exports.resolveDocumentImports = resolveDocumentImports;
//# sourceMappingURL=index.cjs.js.map
