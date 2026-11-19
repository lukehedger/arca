// The Claude Code mod imports this module, so it imports no Node or npm module.
import { isAllowedAwsCommand } from './aws-command.ts';
import {
  type CommandPermission,
  classifyCommandPermission,
} from './destructive-command.ts';

export type { CommandPermission };

export const AWS_REFUSAL =
  'wren may only run read-only AWS operations. Follow the aws skill and propose any change for the user to apply.';

/**
 * Whether wren must refuse a shell command or ask the user before it runs.
 * `undefined` means the command runs without either.
 */
export const commandPermission = (
  command: string,
): CommandPermission | undefined => {
  if (isAllowedAwsCommand(command) === false) {
    return { action: 'deny', reason: AWS_REFUSAL };
  }
  return classifyCommandPermission(command);
};
