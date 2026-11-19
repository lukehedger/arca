// The Claude Code mod imports this module, so it imports no Node or npm module.
import {
  COMMAND_SUBSTITUTION,
  replaceShellExpansions,
  shellWords,
  shellWordsWithOffsets,
  splitShellCommands,
} from './shell-command.ts';

type AwsCommand = {
  readonly operation: string;
  readonly service: string;
};

type AwsInvocationInspection = {
  readonly commands: readonly (AwsCommand | undefined)[];
  readonly dynamicAwsVariables: readonly string[];
};

const READ_OPERATIONS: Readonly<Record<string, readonly RegExp[]>> = {
  apigateway: [/^get-/u],
  appconfig: [/^(?:get-|list-)/u],
  appconfigdata: [/^(?:get-|list-)/u],
  cloudformation: [/^(?:describe-|detect-|get-|list-)/u],
  cloudwatch: [
    /^(?:describe-alarms|get-metric-data|get-metric-statistics|list-metrics)$/u,
  ],
  'cognito-idp': [/^(?:describe-|get-|list-)/u],
  dynamodb: [/^(?:batch-get-item|describe-table|get-item|query)$/u],
  events: [/^(?:describe-|list-)/u],
  iam: [/^(?:get-|list-|simulate-)/u],
  kms: [/^(?:describe-|get-|list-)/u],
  lambda: [/^(?:get-|list-)/u],
  logs: [
    /^(?:describe-log-groups|filter-log-events|get-log-events|get-query-results|start-live-tail|start-query)$/u,
  ],
  s3: [/^(?:get-|list-)/u],
  s3api: [/^(?:get-|list-)/u],
  secretsmanager: [/^(?:describe-|list-)/u],
  sqs: [/^(?:get-|list-)/u],
  stepfunctions: [/^(?:describe-|get-|list-)/u],
  sts: [/^get-caller-identity$/u],
  xray: [/^(?:batch-get-|get-)/u],
};

const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  '--ca-bundle',
  '--cli-binary-format',
  '--cli-connect-timeout',
  '--cli-read-timeout',
  '--color',
  '--endpoint-url',
  '--output',
  '--profile',
  '--query',
  '--region',
]);

const WRAPPER_OPTIONS_WITH_VALUE: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  env: new Set(['--chdir', '--split-string', '--unset', '-C', '-S', '-u']),
  sudo: new Set([
    '--chdir',
    '--close-from',
    '--group',
    '--host',
    '--prompt',
    '--role',
    '--type',
    '--user',
    '-C',
    '-D',
    '-g',
    '-h',
    '-p',
    '-r',
    '-t',
    '-u',
  ]),
  timeout: new Set(['--kill-after', '--signal', '-k', '-s']),
  xargs: new Set([
    '--arg-file',
    '--delimiter',
    '--eof',
    '--exit',
    '--max-args',
    '--max-chars',
    '--max-lines',
    '--max-procs',
    '--process-slot-var',
    '--replace',
    '-E',
    '-I',
    '-L',
    '-P',
    '-a',
    '-d',
    '-l',
    '-n',
    '-s',
  ]),
};

const BASH_DECODED_QUOTE = /\$['"]/u;

// The shell parser does not decode $'...' or $"...", so these words keep their raw text and fail closed as executables.
// Bash removes a line continuation before it reads the quote, so the raw text drops it too.
const commandWords = (command: string): string[] =>
  shellWordsWithOffsets(command).map((word) => {
    const rawWord = command.slice(word.start, word.end).replaceAll('\\\n', '');
    return BASH_DECODED_QUOTE.test(rawWord) ? rawWord : word.value;
  });

// A case-insensitive volume, the macOS default, resolves AWS or Aws to the aws binary.
const executableName = (token: string): string =>
  (token.split('/').at(-1) ?? '').toLowerCase();

const isAssignment = (token: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*=/u.test(token);

const optionNeedsValue = (
  token: string,
  optionsWithValue: ReadonlySet<string>,
): boolean => optionsWithValue.has(token);

const skipWrapperOptions = (
  tokens: readonly string[],
  start: number,
  optionsWithValue: ReadonlySet<string>,
): number => {
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) return index;
    if (token === '--') return index + 1;
    if (!token.startsWith('-') || token === '-') return index;
    if (optionNeedsValue(token, optionsWithValue)) index += 1;
  }
  return tokens.length;
};

const parseAwsTokens = (tokens: readonly string[]): AwsCommand | undefined => {
  const positional: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) return undefined;
    if (GLOBAL_OPTIONS_WITH_VALUE.has(token)) {
      if (tokens[index + 1] === undefined) return undefined;
      index += 1;
      continue;
    }
    if (
      [...GLOBAL_OPTIONS_WITH_VALUE].some((option) =>
        token.startsWith(`${option}=`),
      )
    ) {
      continue;
    }
    if (token.startsWith('--')) continue;
    positional.push(token.toLowerCase());
    if (positional.length === 2) {
      return { operation: positional[1] ?? '', service: positional[0] ?? '' };
    }
  }
  return undefined;
};

const mentionsAwsInHeredocBody = (body: string): boolean => {
  const unquoted = body.replaceAll(/[\\'"]/gu, '');
  return (
    /(?<![\w.:])aws(?![\w./:-])/u.test(unquoted) ||
    /(?:^|[;&|`]|\$\()[\s(]*(?:\S*\/)?aws(?![\w./:-])/imu.test(unquoted)
  );
};

const collectShellCommandTokens = (
  command: string,
  includeTopLevel = true,
): { readonly complete: boolean; readonly tokenLists: readonly string[][] } => {
  const parsed = replaceShellExpansions(command);
  if (!parsed.complete) return { complete: false, tokenLists: [] };
  // A heredoc body is data only if bash ends it on the same line as this parser, so a mention fails closed.
  if (parsed.heredocBodies.some(mentionsAwsInHeredocBody)) {
    return { complete: false, tokenLists: [] };
  }

  const topLevel = includeTopLevel
    ? splitShellCommands(parsed.command)
        .map(commandWords)
        .filter((tokens) => tokens.length > 0)
    : [];
  const nested = parsed.expansions.flatMap((expansion) => {
    if (expansion.kind === 'arithmetic') {
      return collectShellCommandTokens(expansion.body, false);
    }
    return collectShellCommandTokens(expansion.body);
  });
  if (nested.some((result) => !result.complete)) {
    return { complete: false, tokenLists: [] };
  }
  return {
    complete: true,
    tokenLists: [...topLevel, ...nested.flatMap((result) => result.tokenLists)],
  };
};

const variableName = (token: string): string | undefined => {
  const match = token.match(
    /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/u,
  );
  return match?.[1] ?? match?.[2];
};

const containsAwsExecutableToken = (tokens: readonly string[]): boolean =>
  tokens.some((token) => executableName(token) === 'aws');

const mentionsAwsToken = (tokens: readonly string[]): boolean =>
  tokens.some((token) => token.toLowerCase() === 'aws') ||
  /(?:^|[^\w:./-])aws(?:[^\w:./-]|$)/u.test(tokens.join(' '));

const NON_EXECUTING_AWS_ARGUMENT_COMMANDS = new Set([
  'echo',
  'grep',
  'printf',
  'rg',
]);

const inspectExecutable = (
  tokens: readonly string[],
  start: number,
  dynamicAwsVariables: ReadonlySet<string>,
): readonly (AwsCommand | undefined)[] => {
  const token = tokens[start];
  if (token === undefined) return [];
  if (BASH_DECODED_QUOTE.test(token)) return [undefined];
  const dynamicVariable = variableName(token);
  if (
    dynamicVariable !== undefined &&
    dynamicAwsVariables.has(dynamicVariable)
  ) {
    return [undefined];
  }

  const executable = executableName(token);
  if (executable === 'aws') return [parseAwsTokens(tokens.slice(start + 1))];
  if (executable === 'command') {
    const commandIndex = skipWrapperOptions(tokens, start + 1, new Set());
    return inspectExecutable(tokens, commandIndex, dynamicAwsVariables);
  }
  if (executable === 'env') {
    const optionEnd = skipWrapperOptions(
      tokens,
      start + 1,
      WRAPPER_OPTIONS_WITH_VALUE.env ?? new Set(),
    );
    const commandIndex = tokens.findIndex(
      (candidate, index) => index >= optionEnd && !isAssignment(candidate),
    );
    return commandIndex < 0
      ? containsAwsExecutableToken(tokens.slice(start + 1))
        ? [undefined]
        : []
      : inspectExecutable(tokens, commandIndex, dynamicAwsVariables);
  }
  if (executable === 'timeout') {
    const durationIndex = skipWrapperOptions(
      tokens,
      start + 1,
      WRAPPER_OPTIONS_WITH_VALUE.timeout ?? new Set(),
    );
    const commandIndex = durationIndex + 1;
    return tokens[durationIndex] === undefined
      ? containsAwsExecutableToken(tokens.slice(start + 1))
        ? [undefined]
        : []
      : inspectExecutable(tokens, commandIndex, dynamicAwsVariables);
  }
  if (executable === 'sudo' || executable === 'xargs') {
    const commandIndex = skipWrapperOptions(
      tokens,
      start + 1,
      WRAPPER_OPTIONS_WITH_VALUE[executable] ?? new Set(),
    );
    return commandIndex >= tokens.length
      ? containsAwsExecutableToken(tokens.slice(start + 1))
        ? [undefined]
        : []
      : inspectExecutable(tokens, commandIndex, dynamicAwsVariables);
  }
  if (executable === 'eval') {
    const nested = collectShellCommandTokens(tokens.slice(start + 1).join(' '));
    if (!nested.complete) return [undefined];
    return nested.tokenLists.flatMap(
      (nestedTokens) =>
        inspectCommandTokens(nestedTokens, dynamicAwsVariables).commands,
    );
  }
  if (executable === 'find') {
    const executionIndexes = tokens.flatMap((candidate, index) =>
      ['-exec', '-execdir', '-ok', '-okdir'].includes(candidate) ? [index] : [],
    );
    return executionIndexes.flatMap((index) =>
      inspectExecutable(tokens, index + 1, dynamicAwsVariables),
    );
  }
  if (['bash', 'sh', 'zsh'].includes(executable)) {
    const commandOptionIndex = tokens.findIndex(
      (candidate, index) =>
        index > start && /^-[a-z]*c[a-z]*$/u.test(candidate),
    );
    const nestedCommand = tokens[commandOptionIndex + 1];
    if (commandOptionIndex < 0 || nestedCommand === undefined) return [];
    const nested = collectShellCommandTokens(nestedCommand);
    if (!nested.complete) return [undefined];
    return nested.tokenLists.flatMap(
      (nestedTokens) =>
        inspectCommandTokens(nestedTokens, dynamicAwsVariables).commands,
    );
  }
  if (NON_EXECUTING_AWS_ARGUMENT_COMMANDS.has(executable)) return [];
  return mentionsAwsToken(tokens.slice(start + 1)) ? [undefined] : [];
};

const inspectCommandTokens = (
  tokens: readonly string[],
  existingDynamicAwsVariables: ReadonlySet<string>,
): AwsInvocationInspection => {
  const assignments = tokens.filter(isAssignment);
  const assignedAwsVariables = assignments.flatMap((assignment) => {
    const separator = assignment.indexOf('=');
    const name = assignment.slice(0, separator);
    const value = shellWords(assignment.slice(separator + 1))[0] ?? '';
    return executableName(value) === 'aws' ? [name] : [];
  });
  const dynamicAwsVariables = new Set([
    ...existingDynamicAwsVariables,
    ...assignedAwsVariables,
  ]);
  const executableIndex = tokens.findIndex((token) => !isAssignment(token));
  if (executableIndex < 0) {
    return { commands: [], dynamicAwsVariables: [...dynamicAwsVariables] };
  }
  return {
    commands: inspectExecutable(tokens, executableIndex, dynamicAwsVariables),
    dynamicAwsVariables: [...dynamicAwsVariables],
  };
};

const inspectAwsInvocations = (
  command: string,
): readonly (AwsCommand | undefined)[] => {
  const shellCommands = collectShellCommandTokens(command);
  if (!shellCommands.complete) return [undefined];

  const inspections = shellCommands.tokenLists.reduce<AwsInvocationInspection>(
    (result, tokens) => {
      const inspection = inspectCommandTokens(
        tokens,
        new Set(result.dynamicAwsVariables),
      );
      return {
        commands: [...result.commands, ...inspection.commands],
        dynamicAwsVariables: inspection.dynamicAwsVariables,
      };
    },
    { commands: [], dynamicAwsVariables: [] },
  );
  if (inspections.commands.length > 0) return inspections.commands;

  const executableTokens = shellCommands.tokenLists.flatMap((tokens) => {
    const executableIndex = tokens.findIndex((token) => !isAssignment(token));
    return executableIndex < 0 ? [] : [tokens[executableIndex] ?? ''];
  });
  const hasDynamicExecutable = executableTokens.some(
    (token) => token === COMMAND_SUBSTITUTION || token.startsWith('$'),
  );
  const hasAwsMention = shellCommands.tokenLists.some((tokens) =>
    containsAwsExecutableToken(tokens),
  );
  const dynamicExecutableNamesAws = executableTokens.some(
    (token) =>
      token.startsWith('$') &&
      /(?:^|[^a-z0-9_])aws(?:[^a-z0-9_]|$)/iu.test(token),
  );
  return (hasDynamicExecutable && hasAwsMention) || dynamicExecutableNamesAws
    ? [undefined]
    : [];
};

/**
 * `true` when every AWS CLI call in the command is an approved read, `false`
 * when any call is not or cannot be identified, and `undefined` when the
 * command calls no AWS CLI.
 */
export const isAllowedAwsCommand = (command: string): boolean | undefined => {
  const invocations = inspectAwsInvocations(command);
  if (invocations.length === 0) return undefined;
  if (
    /\b(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)\s*=/u.test(
      command,
    )
  ) {
    return false;
  }

  return invocations.every((parsed) => {
    if (parsed === undefined) return false;
    if (parsed.service === 'dynamodb' && parsed.operation === 'scan') {
      return false;
    }
    if (
      parsed.service === 'secretsmanager' &&
      parsed.operation === 'get-secret-value'
    ) {
      return false;
    }
    return (READ_OPERATIONS[parsed.service] ?? []).some((pattern) =>
      pattern.test(parsed.operation),
    );
  });
};
