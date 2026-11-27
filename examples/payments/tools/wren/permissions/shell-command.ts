// The Claude Code mod imports this module, so it imports no Node or npm module.

/** The word that stands in for a command substitution, so a caller can see where one was. */
export const COMMAND_SUBSTITUTION = 'WREN_COMMAND_SUBSTITUTION';
const ARITHMETIC_EXPANSION = 'WREN_ARITHMETIC_EXPANSION';
const HEREDOC = 'WREN_HEREDOC';

export type ShellExpansion = {
  readonly body: string;
  readonly kind: 'arithmetic' | 'backtick' | 'command';
};

type ShellExpansionResult = {
  readonly command: string;
  readonly complete: boolean;
  readonly expansions: readonly ShellExpansion[];
  readonly heredocBodies: readonly string[];
};

type ParenthesisedExpansion = {
  readonly body: string;
  readonly end: number;
};

const readParenthesisedExpansion = (
  command: string,
  start: number,
  arithmetic: boolean,
): ParenthesisedExpansion | undefined => {
  const contentStart = start + (arithmetic ? 3 : 2);
  let depth = arithmetic ? 2 : 1;
  let doubleQuotedCommandDepth = 0;
  let quote: 'double' | 'single' | undefined;

  for (let index = contentStart; index < command.length; index += 1) {
    const character = command[index];
    if (character === undefined) continue;
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (quote === 'single') {
      if (character === "'") quote = undefined;
      continue;
    }
    if (character === "'") {
      if (quote === undefined) quote = 'single';
      continue;
    }
    if (character === '"') {
      quote = quote === 'double' ? undefined : 'double';
      continue;
    }
    if (quote === 'double') {
      if (character === '$' && command[index + 1] === '(') {
        const nestedArithmetic = command[index + 2] === '(';
        const addedDepth = nestedArithmetic ? 2 : 1;
        depth += addedDepth;
        doubleQuotedCommandDepth += addedDepth;
        index += nestedArithmetic ? 2 : 1;
        continue;
      }
      if (character === ')' && doubleQuotedCommandDepth > 0) {
        depth -= 1;
        doubleQuotedCommandDepth -= 1;
      }
      continue;
    }
    if (character === '(') {
      depth += 1;
      continue;
    }
    if (character !== ')') continue;

    depth -= 1;
    if (depth !== 0) continue;
    const bodyEnd = arithmetic ? index - 1 : index;
    return { body: command.slice(contentStart, bodyEnd), end: index };
  }

  return undefined;
};

const readBacktickExpansion = (
  command: string,
  start: number,
): ParenthesisedExpansion | undefined => {
  for (let index = start + 1; index < command.length; index += 1) {
    if (command[index] === '\\') {
      index += 1;
      continue;
    }
    if (command[index] === '`') {
      return { body: command.slice(start + 1, index), end: index };
    }
  }
  return undefined;
};

type Heredoc = {
  readonly delimiter: string;
  readonly expandsBody: boolean;
  readonly stripsTabs: boolean;
};

type HeredocOperator = {
  readonly end: number;
  readonly heredoc: Heredoc;
};

const readHeredocOperator = (
  command: string,
  start: number,
): HeredocOperator | undefined => {
  const stripsTabs = command[start + 2] === '-';
  let index = start + (stripsTabs ? 3 : 2);
  while (command[index] === ' ' || command[index] === '\t') index += 1;

  const delimiter: string[] = [];
  let quoted = false;
  let quote: 'double' | 'single' | undefined;
  for (; index < command.length; index += 1) {
    const character = command[index];
    if (character === undefined) continue;
    if (quote === undefined && /[ \t\n;&|<>()]/u.test(character)) break;
    if (character === '\\' && quote !== 'single') {
      quoted = true;
      index += 1;
      delimiter.push(command[index] ?? '');
      continue;
    }
    if (character === "'" && quote !== 'double') {
      quoted = true;
      quote = quote === 'single' ? undefined : 'single';
      continue;
    }
    if (character === '"' && quote !== 'single') {
      quoted = true;
      quote = quote === 'double' ? undefined : 'double';
      continue;
    }
    delimiter.push(character);
  }

  if (quote !== undefined || delimiter.length === 0) return undefined;
  return {
    end: index,
    heredoc: {
      delimiter: delimiter.join(''),
      expandsBody: !quoted,
      stripsTabs,
    },
  };
};

type HeredocBody = {
  readonly expandsBody: boolean;
  readonly text: string;
};

type HeredocBodies = {
  readonly bodies: readonly HeredocBody[];
  readonly end: number;
};

const readHeredocBodies = (
  command: string,
  start: number,
  heredocs: readonly Heredoc[],
): HeredocBodies | undefined => {
  const bodies: HeredocBody[] = [];
  let bodyStart = start;
  for (const heredoc of heredocs) {
    let lineStart = bodyStart;
    let bodyEnd: number | undefined;
    while (bodyEnd === undefined) {
      const newline = command.indexOf('\n', lineStart);
      const lineEnd = newline < 0 ? command.length : newline;
      const line = command.slice(lineStart, lineEnd);
      if (
        (heredoc.stripsTabs ? line.replace(/^\t+/u, '') : line) ===
        heredoc.delimiter
      ) {
        bodyEnd = lineStart;
      } else if (newline < 0) {
        return undefined;
      }
      lineStart = lineEnd + 1;
    }
    bodies.push({
      expandsBody: heredoc.expandsBody,
      text: command.slice(bodyStart, bodyEnd),
    });
    bodyStart = Math.min(lineStart, command.length);
  }
  return { bodies, end: bodyStart };
};

const replaceHeredocBodyExpansions = (
  body: string,
): Omit<ShellExpansionResult, 'complete' | 'heredocBodies'> | undefined => {
  const expansions: ShellExpansion[] = [];
  const output: string[] = [];

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === undefined) continue;
    if (character === '\\') {
      output.push(body.slice(index, index + 2));
      index += 1;
      continue;
    }
    if (character === '$' && body[index + 1] === '(') {
      const arithmetic = body[index + 2] === '(';
      const expansion = readParenthesisedExpansion(body, index, arithmetic);
      if (expansion === undefined) return undefined;
      expansions.push({
        body: expansion.body,
        kind: arithmetic ? 'arithmetic' : 'command',
      });
      output.push(arithmetic ? ARITHMETIC_EXPANSION : COMMAND_SUBSTITUTION);
      index = expansion.end;
      continue;
    }
    if (character === '`') {
      const expansion = readBacktickExpansion(body, index);
      if (expansion === undefined) return undefined;
      expansions.push({ body: expansion.body, kind: 'backtick' });
      output.push(COMMAND_SUBSTITUTION);
      index = expansion.end;
      continue;
    }
    output.push(character);
  }

  return { command: output.join(''), expansions };
};

export const replaceShellExpansions = (
  command: string,
): ShellExpansionResult => {
  const expansions: ShellExpansion[] = [];
  const heredocBodies: string[] = [];
  const heredocs: Heredoc[] = [];
  const output: string[] = [];
  let quote: 'double' | 'single' | undefined;
  const incomplete = (): ShellExpansionResult => ({
    command,
    complete: false,
    expansions,
    heredocBodies,
  });

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === undefined) continue;
    if (character === '\\') {
      output.push(character);
      const next = command[index + 1];
      if (next !== undefined) {
        output.push(next);
        index += 1;
      }
      continue;
    }
    if (quote === 'single') {
      output.push(character);
      if (character === "'") quote = undefined;
      continue;
    }
    if (character === "'" && quote === undefined) {
      quote = 'single';
      output.push(character);
      continue;
    }
    if (character === '"') {
      quote = quote === 'double' ? undefined : 'double';
      output.push(character);
      continue;
    }
    if (quote === undefined && command.startsWith('<<<', index)) {
      output.push('<<<');
      index += 2;
      continue;
    }
    if (quote === undefined && command.startsWith('<<', index)) {
      const operator = readHeredocOperator(command, index);
      if (operator === undefined) return incomplete();
      heredocs.push(operator.heredoc);
      output.push(HEREDOC);
      index = operator.end - 1;
      continue;
    }
    if (quote === undefined && character === '\n' && heredocs.length > 0) {
      const result = readHeredocBodies(command, index + 1, heredocs);
      if (result === undefined) return incomplete();
      for (const body of result.bodies) {
        if (!body.expandsBody) {
          heredocBodies.push(body.text);
          continue;
        }
        const replaced = replaceHeredocBodyExpansions(body.text);
        if (replaced === undefined) return incomplete();
        heredocBodies.push(replaced.command);
        expansions.push(...replaced.expansions);
      }
      heredocs.length = 0;
      output.push(character);
      index = result.end - 1;
      continue;
    }
    if (character === '$' && command[index + 1] === '(') {
      const arithmetic = command[index + 2] === '(';
      const expansion = readParenthesisedExpansion(command, index, arithmetic);
      if (expansion === undefined) return incomplete();
      expansions.push({
        body: expansion.body,
        kind: arithmetic ? 'arithmetic' : 'command',
      });
      output.push(arithmetic ? ARITHMETIC_EXPANSION : COMMAND_SUBSTITUTION);
      index = expansion.end;
      continue;
    }
    if (character === '`') {
      const expansion = readBacktickExpansion(command, index);
      if (expansion === undefined) return incomplete();
      expansions.push({ body: expansion.body, kind: 'backtick' });
      output.push(COMMAND_SUBSTITUTION);
      index = expansion.end;
      continue;
    }
    output.push(character);
  }

  if (heredocs.length > 0) return incomplete();
  return {
    command: output.join(''),
    complete: true,
    expansions,
    heredocBodies,
  };
};

export const splitShellCommands = (command: string): string[] => {
  const commands: string[] = [];
  const current: string[] = [];
  const heredocs: Heredoc[] = [];
  let quote: 'double' | 'single' | undefined;

  const finishCommand = (): void => {
    const part = current.join('').trim();
    if (part !== '') commands.push(part);
    current.length = 0;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === undefined) continue;
    if (character === '\\') {
      current.push(character);
      const next = command[index + 1];
      if (next !== undefined) {
        current.push(next);
        index += 1;
      }
      continue;
    }
    if (quote === 'single') {
      current.push(character);
      if (character === "'") quote = undefined;
      continue;
    }
    if (character === "'" && quote === undefined) {
      quote = 'single';
      current.push(character);
      continue;
    }
    if (character === '"') {
      quote = quote === 'double' ? undefined : 'double';
      current.push(character);
      continue;
    }
    if (quote === undefined && command.startsWith('<<<', index)) {
      current.push('<<<');
      index += 2;
      continue;
    }
    if (quote === undefined && command.startsWith('<<', index)) {
      const operator = readHeredocOperator(command, index);
      if (operator !== undefined) {
        heredocs.push(operator.heredoc);
        current.push(command.slice(index, operator.end));
        index = operator.end - 1;
        continue;
      }
    }
    if (quote === undefined && /[;&|\n]/u.test(character)) {
      finishCommand();
      if (character === '\n' && heredocs.length > 0) {
        const result = readHeredocBodies(command, index + 1, heredocs);
        // Bash reads an unterminated heredoc body to the end of the input.
        if (result === undefined) return commands;
        heredocs.length = 0;
        index = result.end - 1;
      }
      continue;
    }
    if (quote === undefined && (character === '(' || character === ')')) {
      finishCommand();
      continue;
    }
    current.push(character);
  }

  finishCommand();
  return commands;
};

export type ShellWord = {
  readonly end: number;
  readonly start: number;
  readonly value: string;
};

export const shellWordsWithOffsets = (command: string): ShellWord[] => {
  const words: ShellWord[] = [];
  const current: string[] = [];
  let quote: 'double' | 'single' | undefined;
  let start = 0;

  const finishWord = (end: number): void => {
    if (current.length > 0) {
      words.push({ end, start, value: current.join('') });
    }
    current.length = 0;
    start = end + 1;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === undefined) continue;
    if (character === '\\') {
      const next = command[index + 1];
      if (next === '\n') {
        index += 1;
        continue;
      }
      if (next !== undefined) {
        current.push(next);
        index += 1;
      }
      continue;
    }
    if (quote === 'single') {
      if (character === "'") quote = undefined;
      else current.push(character);
      continue;
    }
    if (character === "'" && quote === undefined) {
      quote = 'single';
      continue;
    }
    if (character === '"') {
      quote = quote === 'double' ? undefined : 'double';
      continue;
    }
    if (quote === undefined && /\s/u.test(character)) {
      finishWord(index);
      continue;
    }
    current.push(character);
  }

  finishWord(command.length);
  return words;
};

export const shellWords = (command: string): string[] =>
  shellWordsWithOffsets(command).map((word) => word.value);
