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
import { aiFunctionSpecs } from '../constants.js';
import {
  inferAccumulatorSchema,
  inferSchema
} from '../functions/inferSchema.js';
import { createTransformError } from '../errorContext.js';
import { generateAiFunction } from '../openai/generateAiFunction.js';
import { translate } from '../translations/en.js';
import type { AIConfig } from '../types.js';

function isAiCall(
  node: Node
): node is CallExpression & {
  expression: PropertyAccessExpression;
} {
  return (
    isCallExpression(node) &&
    isPropertyAccessExpression(node.expression) &&
    Object.hasOwn(aiFunctionSpecs, node.expression.name.text)
  );
}

export async function transformModule(
  source: string,
  id: string,
  getApi: () => API,
  tsconfigPath: string,
  config: AIConfig,
  root: string
) {
  if (
    id.includes('node_modules') ||
    !/\.[jt]sx?$/.test(id) ||
    !Object.keys(aiFunctionSpecs).some((method) => source.includes(method))
  ) {
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
      throw new Error(translate('unableToTypeCheckAiCall', { id }));
    }

    const activeProject = project;
    const activeSource = programSource;

    if (programSource.text !== source) {
      throw new Error(
        translate('transformedSourceMismatch', { id })
      );
    }

    let hasAiCall = false;

    function findAiCall(node: Node): void {
      if (isAiCall(node)) {
        hasAiCall = true;
        return;
      }

      node.forEachChild(findAiCall);
    }

    findAiCall(programSource);

    if (!hasAiCall) return null;

    const replacements: {
      start: number;
      end: number;
      value: string;
    }[] = [];

    async function visit(node: Node): Promise<void> {
      if (isAiCall(node)) {
        const spec = aiFunctionSpecs[node.expression.name.text];
        const instructionNode = node.arguments[0];
        const items = node.expression.expression;
        const initialValue = node.arguments[1];

        try {
          if (
            !instructionNode ||
            !isStringLiteral(instructionNode) ||
            node.arguments.length !== (spec.kind === 'reduce' ? 2 : 1) ||
            (node.typeArguments &&
              spec.kind !== 'map' &&
              spec.kind !== 'reduce')
          ) {
            throw new Error(
              translate('invalidInvocation', {
                method: spec.method,
                id
              })
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
          const generated = await generateAiFunction(
            config,
            root,
            spec,
            instructionNode.text,
            schema,
            api,
            parameterSchemas
          );

          const typeArguments =
            (spec.kind === 'map' || spec.kind === 'reduce') &&
            node.typeArguments
            ? `<${node.typeArguments.map((type) => type.getText(programSource)).join(', ')}>`
            : '';
          const reducerArguments = spec.kind === 'reduce'
            ? `, ${initialValue?.getText(programSource)}`
            : '';

          // Rewrite only the method tail so nested receiver calls stay intact.
          replacements.push({
            start: items.end,
            end: node.end,
            value: `.${spec.replacementMethod}${typeArguments}(${generated}${reducerArguments})`
          });
        } catch (error) {
          const location = activeSource.getLineAndCharacterOfPosition(
            node.getStart(activeSource)
          );
          throw createTransformError(error, {
            file: id,
            line: location.line + 1,
            column: location.character + 1,
            method: spec.method,
            instruction: instructionNode && isStringLiteral(instructionNode)
              ? instructionNode.text
              : '',
            model: config.model
          });
        }

        await visit(items);
        return;
      }

      const children: Node[] = [];
      node.forEachChild((child) => {
        children.push(child);
      });

      for (const child of children) {
        await visit(child);
      }
    }

    await visit(programSource);

    if (!replacements.length) return null;

    const output = new MagicString(source);

    for (const replacement of replacements.sort(
      (a, b) => b.start - a.start
    )) {
      output.overwrite(
        replacement.start,
        replacement.end,
        replacement.value
      );
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
