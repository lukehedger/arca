import { describe, expect, test } from 'bun:test';
import {
  destinationOf,
  fillPlaceholders,
  type Profile,
  renderFile,
  resolveBlocks,
} from './bootstrap.ts';

const greenfield: Profile = {
  name: 'orders',
  title: 'Orders',
  owner: '@org/team',
  state: 'event-sourcing',
  appDir: undefined,
};

const migration: Profile = { ...greenfield, state: 'crud', appDir: 'next' };

describe('resolveBlocks', () => {
  test('keeps the blocks whose flag is set and drops every marker', () => {
    const text = [
      'before',
      '<!-- if: event-sourcing -->',
      'events',
      '<!-- if: crud -->',
      'records',
      '<!-- end -->',
      'after',
    ].join('\n');

    expect(resolveBlocks('DOMAIN.md', text, new Set(['crud']))).toBe(
      'before\nrecords\nafter',
    );
  });

  test('reads the comment style of each file type', () => {
    const typescript = '// if: migration\nmigrated\n// end\nkept';
    const yaml = '    # if: greenfield\n    fresh\n    # end\nkept';

    expect(resolveBlocks('a.ts', typescript, new Set(['greenfield']))).toBe('kept');
    expect(resolveBlocks('a.yml', yaml, new Set(['greenfield']))).toBe(
      '    fresh\nkept',
    );
    expect(resolveBlocks('CODEOWNERS', '# if: crud\nx\n# end', new Set())).toBe('');
  });

  test('leaves files without a comment style untouched', () => {
    expect(resolveBlocks('a.json', '// if: crud', new Set())).toBe('// if: crud');
  });

  test('ignores a comment that only looks like a marker', () => {
    expect(resolveBlocks('a.yml', '# Mondays, if: needed\nx', new Set())).toBe(
      '# Mondays, if: needed\nx',
    );
  });

  test.each([
    ['an unknown flag', '// if: graphql\nx\n// end', 'unknown flag graphql'],
    ['an end outside a block', 'x\n// end', 'end marker outside a block'],
    ['a block that never ends', '// if: crud\nx', 'has no end marker'],
  ])('rejects %s', (_case, text, message) => {
    expect(() => resolveBlocks('a.ts', text, new Set())).toThrow(message);
  });
});

describe('fillPlaceholders', () => {
  test('fills every placeholder that has a value', () => {
    expect(
      fillPlaceholders('a.md', '<project> by <owner>', {
        '<project>': 'orders',
        '<owner>': '@org/team',
      }),
    ).toBe('orders by @org/team');
  });

  test('rejects a placeholder with no value in this profile', () => {
    expect(() =>
      fillPlaceholders('a.md', 'cd <app-dir>', { '<app-dir>': undefined }),
    ).toThrow('<app-dir> has no value');
  });
});

describe('renderFile', () => {
  test('drops a file that belongs to the other mode', () => {
    expect(
      renderFile('src/crud.ts', '// if: crud\nexport {};\n// end\n', greenfield),
    ).toBeUndefined();
  });

  test('fills the app root and workflow prefix for each profile', () => {
    const text = 'working-directory: <app-root>\nname: <workflow-prefix>ci';

    expect(renderFile('ci.yml', text, greenfield)).toBe(
      'working-directory: .\nname: ci',
    );
    expect(renderFile('ci.yml', text, migration)).toBe(
      'working-directory: next\nname: next-ci',
    );
  });
});

describe('destinationOf', () => {
  test('keeps every path for a new project', () => {
    expect(destinationOf('.github/workflows/ci.yml', greenfield)).toBe(
      '.github/workflows/ci.yml',
    );
    expect(destinationOf('core/index.ts', greenfield)).toBe(
      'core/index.ts',
    );
  });

  test('places automation at the repository root for a migration', () => {
    expect(destinationOf('.github/workflows/ci.yml', migration)).toBe(
      '.github/workflows/next-ci.yml',
    );
    expect(destinationOf('.github/CODEOWNERS', migration)).toBe(
      '.github/CODEOWNERS',
    );
    expect(destinationOf('.claude/settings.json', migration)).toBe(
      'next/.claude/settings.json',
    );
  });
});
