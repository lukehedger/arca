// The Claude Code mod imports this module, so it imports no Node or npm module.

export type CommandPermission = {
  readonly action: 'ask' | 'deny';
  readonly reason: string;
};

const shellCommand = (name: string): RegExp =>
  new RegExp(
    `(?:^|[;&|(\\n]\\s*)(?:(?:command|sudo)\\s+|env(?:\\s+[A-Za-z_][A-Za-z0-9_]*=[^\\s;&|]+)*\\s+)*(?:[^\\s;&|]+/)?${name}\\b([^;&|\\n)]*)`,
    'giu',
  );

const commandArguments = (command: string, name: string): string[][] =>
  [...command.matchAll(shellCommand(name))].map((match) =>
    (match[1] ?? '').trim().split(/\s+/u).filter(Boolean),
  );

const hasShortFlag = (arguments_: readonly string[], flag: string): boolean =>
  arguments_.some(
    (argument) =>
      argument.startsWith('-') &&
      !argument.startsWith('--') &&
      argument.slice(1).includes(flag),
  );

const isDangerousRemovalTarget = (target: string): boolean =>
  /^(?:\/\*?|~(?:\/\*)?\/?|\$HOME(?:\/\*)?\/?|\$\{HOME\}(?:\/\*)?\/?|(?:\.\/)?\.\.(?:\/\.\.)*\/?)$/u.test(
    target.replace(/^['"]|['"]$/gu, ''),
  );

/** Whether a destructive shell command is refused or needs the user's confirmation, or `undefined` when it is neither. */
export const classifyCommandPermission = (
  command: string,
): CommandPermission | undefined => {
  const normalizedCommand = command.replace(/\\\r?\n/gu, '');
  if (normalizedCommand !== command) {
    return classifyCommandPermission(normalizedCommand);
  }
  const wrappedCommands = [
    ...command.matchAll(
      /\b(?:ba|z)?sh\s+-[a-z]*c[a-z]*\s+(?:--\s+)?(['"])(.*?)\1/giu,
    ),
    ...command.matchAll(/\(([^()]*)\)/gu),
    ...command.matchAll(
      /\b(?:[^\s;&|]+\/)?sudo\b((?:\s+(?:-[A-Za-z]+(?:\s+\S+)?))*\s+[^;&|\n]+)/giu,
    ),
  ].map((match) => {
    const wrapped = match[2] ?? match[1] ?? '';
    return wrapped.replace(/^\s*(?:-[A-Za-z]+(?:\s+\S+)?\s*)+/u, '');
  });
  for (const wrapped of wrappedCommands) {
    const permission = classifyCommandPermission(wrapped);
    if (permission !== undefined) return permission;
  }

  for (const arguments_ of commandArguments(command, 'rm')) {
    const isRecursive =
      arguments_.includes('--recursive') ||
      hasShortFlag(arguments_, 'r') ||
      hasShortFlag(arguments_, 'R');
    const isForced =
      arguments_.includes('--force') || hasShortFlag(arguments_, 'f');
    const targets = arguments_.filter((argument) => !argument.startsWith('-'));

    if (isRecursive && isForced && targets.some(isDangerousRemovalTarget)) {
      return {
        action: 'deny',
        reason:
          'Recursive forced removal of a root, home, or parent directory is blocked.',
      };
    }

    if (isRecursive) {
      return {
        action: 'ask',
        reason: 'Recursive file removal requires confirmation.',
      };
    }
  }

  if (/\bgit\b[^;&|\n]*?\breset\b[^;&|\n]*--hard\b/iu.test(command)) {
    return { action: 'deny', reason: '`git reset --hard` is blocked.' };
  }

  if (
    /\bgit\b[^;&|\n]*?\bclean\b[^;&|\n]*(?:--force\b|\s-[a-z]*f[a-z]*\b)/iu.test(
      command,
    )
  ) {
    return { action: 'deny', reason: 'Forced `git clean` is blocked.' };
  }

  if (
    /\bgit\b[^;&|\n]*?\bpush\b[^;&|\n]*(?:--force(?:-with-lease)?\b|\s-[a-z]*f[a-z]*\b|\s['"]?\+\S+)/iu.test(
      command,
    )
  ) {
    return { action: 'deny', reason: 'Force pushes are blocked.' };
  }

  if (/\bgit\b[^;&|\n]*?\bbranch\b[^;&|\n]*\s-[a-z]*D[a-z]*\b/u.test(command)) {
    return { action: 'deny', reason: 'Forced branch deletion is blocked.' };
  }

  if (/\b(?:[^\s;&|]+\/)?sudo\b/iu.test(command)) {
    return { action: 'ask', reason: '`sudo` requires confirmation.' };
  }

  if (/\bchmod\b[^;&|\n]*\b0*777\b/iu.test(command)) {
    return { action: 'ask', reason: '`chmod 777` requires confirmation.' };
  }

  for (const arguments_ of commandArguments(command, 'chown')) {
    if (arguments_.includes('--recursive') || hasShortFlag(arguments_, 'R')) {
      return {
        action: 'ask',
        reason: 'Recursive `chown` requires confirmation.',
      };
    }
  }

  return undefined;
};
