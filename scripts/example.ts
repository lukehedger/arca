import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { type Profile, renderFile } from './template.ts';

const EXAMPLES = join(import.meta.dirname, '../examples');

const listFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? listFiles(join(directory, entry.name))
        : [join(directory, entry.name)],
    ),
  );
  return nested.flat();
};

// Lays an example over a bootstrapped project. The example replaces any file it also holds.
export const applyExample = async (
  name: string,
  appRoot: string,
  profile: Profile,
): Promise<readonly string[]> => {
  const source = join(EXAMPLES, name);
  const files = (await listFiles(source)).filter(
    (path) => relative(source, path) !== 'README.md',
  );

  return Promise.all(
    files.map(async (path) => {
      const file = relative(source, path);
      const content = renderFile(file, await readFile(path, 'utf8'), profile);
      const destination = join(appRoot, file);
      if (content === undefined) {
        await rm(destination, { force: true });
      } else {
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, content);
      }
      return file;
    }),
  );
};
