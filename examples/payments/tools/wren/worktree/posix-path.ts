// The Claude Code mod cannot import `node:path`, so the code it shares with the host uses these.

const normaliseSegments = (segments: readonly string[]): string[] => {
  const normalised: string[] = [];
  for (const segment of segments) {
    if (segment === '..') normalised.pop();
    else if (segment !== '' && segment !== '.') normalised.push(segment);
  }
  return normalised;
};

export const isAbsolutePath = (path: string): boolean => path.startsWith('/');

/** Needs an absolute argument, because a mod has no working directory to resolve against. */
export const resolvePath = (...paths: readonly string[]): string => {
  const start = paths.findLastIndex(isAbsolutePath);
  if (start === -1) {
    throw new Error(`Cannot resolve ${paths.join(', ')}: no absolute path`);
  }
  const segments = paths
    .slice(start)
    .flatMap((path) => path.split('/'))
    .filter((segment) => segment !== '');
  return `/${normaliseSegments(segments).join('/')}`;
};

export const joinPath = (base: string, ...paths: readonly string[]): string => {
  if (!isAbsolutePath(base)) {
    throw new Error(`Cannot join onto ${base}: not an absolute path`);
  }
  const segments = [base, ...paths].flatMap((path) => path.split('/'));
  return `/${normaliseSegments(segments).join('/')}`;
};

export const basenamePath = (path: string): string =>
  path.replace(/\/+$/u, '').split('/').at(-1) ?? '';

export const dirnamePath = (path: string): string => {
  const trimmed = path.replace(/\/+$/u, '');
  const separator = trimmed.lastIndexOf('/');
  if (separator === -1) return isAbsolutePath(path) ? '/' : '.';
  if (separator === 0) return '/';
  return trimmed.slice(0, separator);
};
