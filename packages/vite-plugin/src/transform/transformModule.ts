import MagicString from 'magic-string';
import type {
  CallExpression,
  Node,
  PropertyAccessExpression
} from 'typescript/unstable/ast';
import {
  isCallExpression,
  isPropertyAccessExpression,
  isStringLiteral
} from 'typescript/unstable/ast/is';
import type { API } from 'typescript/unstable/sync';
import type { Logger } from 'vite';
import { aiFunctionSpecs } from '../constants.js';
import {
  inferAccumulatorSchema,
  inferResultShape,
  inferSchema
} from '../functions/inferSchema.js';
import { AIPluginError } from '../errors.js';
import { createTransformError } from '../errorContext.js';
import { generateAiFunction } from '../openai/generateAiFunction.js';
import { translate } from '../translations/en.js';
import type { AIConfig } from '../types.js';

/**
 * A call expression whose callee is a property access, such as `items.sortAi(...)`.
 */
type AiCall = CallExpression & {
  expression: PropertyAccessExpression;
};

/**
 * A text replacement, with offsets into the original source.
 */
type Edit = {
  /** Start offset of the replaced range. */
  start: number;
  /** End offset of the replaced range, exclusive. */
  end: number;
  /** Replacement text. */
  value: string;
};

/**
 * Returns `true` when an AI call expression targets one of the supported array methods.
 *
 * @param node The AST node to check.
 * @returns Whether the node is an AI call that should be compiled.
 */
function isAiCall(node: Node): node is AiCall {
  return (
    isCallExpression(node) &&
    isPropertyAccessExpression(node.expression) &&
    Object.hasOwn(aiFunctionSpecs, node.expression.name.text)
  );
}

/**
 * Finds every supported AI array call in a module, generates or loads its
 * function, and rewrites each call to the matching native array method.
 *
 * @param source The module source; must match the TypeScript project's copy of the file.
 * @param id The module's file path.
 * @param getApi Returns the TypeScript API.
 * @param tsconfigPath Path to the project's `tsconfig.json`.
 * @param config The validated plugin config.
 * @param root The resolved Vite root.
 * @param logger Vite's logger.
 * @returns The rewritten code and source map, or `null` when the module has no AI calls.
 * @throws {AIPluginError} When a call is invalid or the module is not in the TypeScript project.
 */
export async function transformModule(
  source: string,
  id: string,
  getApi: () => API,
  tsconfigPath: string,
  config: AIConfig,
  root: string,
  logger: Logger
) {
  if (!Object.keys(aiFunctionSpecs).some((method) => source.includes(method))) {
    return null;
  }

  const api = getApi();
  const snapshot = api.updateSnapshot({
    fileChanges: { changed: [id] }
  });

  try {
    const project = snapshot.getProject(tsconfigPath);
    const programSource = project?.program.getSourceFile(id);

    if (!project || !programSource) {
      throw new AIPluginError(translate('unableToTypeCheckAiCall', { id }), 'type_check');
    }

    const activeProject = project;
    const activeSource = programSource;

    if (programSource.text !== source) {
      throw new AIPluginError(translate('transformedSourceMismatch', { id }), 'type_check');
    }

    const pending: (() => Promise<Edit[]>)[] = [];

    /**
     * Wraps an error with the source location and call details so the message points
     * at the AI call that failed.
     *
     * @param error The original error.
     * @param node The AI call node that failed.
     * @param spec Spec for the AI method.
     * @param instruction The instruction text, or `undefined` if it is not a string literal.
     * @returns A transform error with location context.
     */
    function wrapError(error: unknown, node: AiCall, spec: (typeof aiFunctionSpecs)[string], instruction: string | undefined): Error {
      const location = activeSource.getLineAndCharacterOfPosition(
        node.getStart(activeSource)
      );
      return createTransformError(error, {
        file: id,
        line: location.line + 1,
        column: location.character + 1,
        method: spec.method,
        instruction: instruction ?? '',
        model: config.model
      });
    }

    /**
     * Validates one AI call and queues its generation work. Nested calls are visited too.
     * The AST is not modified here. Edits are applied after all generation finishes.
     *
     * @param node The node to inspect.
     */
    function visit(node: Node): void {
      if (isAiCall(node)) {
        const spec = aiFunctionSpecs[node.expression.name.text];
        const instructionNode = node.arguments[0];
        const instruction = instructionNode && isStringLiteral(instructionNode)
          ? instructionNode.text
          : undefined;
        const items = node.expression.expression;
        const initialValue = node.arguments[1];
        const acceptsTypeArguments =
          spec.kind === 'map' || spec.kind === 'reduce';

        let generate: () => Promise<string>;

        try {
          if (
            instruction === undefined ||
            node.arguments.length !== (spec.kind === 'reduce' ? 2 : 1) ||
            (node.typeArguments && !acceptsTypeArguments) ||
            (spec.kind === 'reduce' && !initialValue)
          ) {
          throw new AIPluginError(
            translate('invalidInvocation', {
              method: spec.method,
              id
            }),
            'invalid_invocation'
          );
          }

          const schema = inferSchema(
            activeProject.checker,
            items,
            spec.method
          );

          const accumulator = spec.kind === 'reduce' && initialValue
            ? inferAccumulatorSchema(
              activeProject.checker,
              initialValue,
              spec.method,
              node.typeArguments?.[0]
            )
            : undefined;
          const parameterSchemas = accumulator
            ? {
              acc: accumulator,
              item: { kind: 'object' as const, fields: schema }
            }
            : undefined;
          const resultShape = acceptsTypeArguments
            ? inferResultShape(
              activeProject.checker,
              items,
              spec.method,
              spec.kind === 'reduce' ? initialValue : undefined,
              node.typeArguments?.[0]
            )
            : undefined;

          generate = () => generateAiFunction(
            config,
            root,
            spec,
            instruction,
            schema,
            api,
            parameterSchemas,
            resultShape,
            logger
          );
        } catch (error) {
          throw wrapError(error, node, spec, instruction);
        }

        const typeArguments = acceptsTypeArguments && node.typeArguments
          ? `<${node.typeArguments.map((type) => type.getText(programSource)).join(', ')}>`
          : '';

        pending.push(async () => {
          let generated: string;
          try {
            generated = await generate();
          } catch (error) {
            throw wrapError(error, node, spec, instruction);
          }

          const method = `.${spec.replacementMethod}${typeArguments}`;

          // reduceAi keeps its initial value in place so nested AI calls inside
          // it are rewritten by their own edits instead of being overwritten.
          if (spec.kind === 'reduce' && initialValue) {
            return [
              {
                start: items.end,
                end: initialValue.getStart(programSource),
                value: `${method}(${generated}, `
              },
              { start: initialValue.end, end: node.end, value: ')' }
            ];
          }

          return [{ start: items.end, end: node.end, value: `${method}(${generated})` }];
        });

        visit(items);
        if (initialValue) visit(initialValue);
        return;
      }

      node.forEachChild((child) => {
        visit(child);
      });
    }

    visit(programSource);

    if (!pending.length) return null;

    const edits = (await Promise.all(pending.map((task) => task()))).flat();
    const output = new MagicString(source);

    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      output.overwrite(edit.start, edit.end, edit.value);
    }

    return {
      code: output.toString(),
      map: output.generateMap({
        source: id,
        includeContent: true,
        hires: true
      })
    };
  } finally {
    snapshot.dispose();
  }
}
