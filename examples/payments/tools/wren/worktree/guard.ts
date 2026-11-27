// The Claude Code mod imports this module, so it imports no Node or npm module.
import { isAbsolutePath, resolvePath } from './posix-path.ts';

/** The Git checkout a directory belongs to. */
export type Checkout = {
  /** The top of the checkout the directory is in. */
  readonly root: string;
  /** The top of the repository's primary checkout. */
  readonly primaryRoot: string;
};

export const ENTER_WORKTREE =
  'wren makes every change in a worktree. Call EnterWorktree first, then repeat this call with paths inside the new worktree.';

const isWorktree = (checkout: Checkout): boolean =>
  checkout.root !== checkout.primaryRoot;

const isWithin = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}/`);

const outsideWorktree = (path: string, checkout: Checkout): string =>
  `${path} is outside this session's worktree at ${checkout.root}. Change the copy inside the worktree.`;

/**
 * The reason to refuse a change to `path`, or `undefined` to allow it. A path
 * outside the repository, such as a scratch file, is always allowed.
 */
export const pathRefusal = (
  path: string,
  cwd: string,
  checkout: Checkout,
): string | undefined => {
  const absolute = isAbsolutePath(path)
    ? resolvePath(path)
    : resolvePath(cwd, path);
  if (isWorktree(checkout) && isWithin(absolute, checkout.root))
    return undefined;
  if (!isWithin(absolute, checkout.primaryRoot)) return undefined;
  if (!isWorktree(checkout)) return ENTER_WORKTREE;
  return outsideWorktree(absolute, checkout);
};

const isShellPathBoundary = (character: string | undefined): boolean =>
  character === undefined || /[\s"'`$&|;()<>[\]{},:=]/u.test(character);

const startsPathAt = (command: string, index: number, root: string): boolean =>
  isShellPathBoundary(command[index - 1]) &&
  command.startsWith(root, index) &&
  (command[index + root.length] === '/' ||
    isShellPathBoundary(command[index + root.length]));

/**
 * The reason to refuse a shell command, or `undefined` to allow it. Shell
 * syntax can hide a change anywhere, so every command needs a worktree, and an
 * absolute path into another checkout of the repository is refused.
 */
export const commandRefusal = (
  command: string,
  checkout: Checkout,
): string | undefined => {
  if (!isWorktree(checkout)) return ENTER_WORKTREE;
  for (let index = 0; index < command.length; index += 1) {
    if (startsPathAt(command, index, checkout.root)) {
      index += checkout.root.length - 1;
      continue;
    }
    if (startsPathAt(command, index, checkout.primaryRoot)) {
      return outsideWorktree(checkout.primaryRoot, checkout);
    }
  }
  return undefined;
};
