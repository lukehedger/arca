import { describe, expect, test } from 'bun:test';
import { findNestedSources } from '../layout.ts';

describe('findNestedSources', () => {
  test('passes when no top-level directory holds a src directory', () => {
    expect(findNestedSources(() => false)).toEqual([]);
  });

  test('reports each top-level directory that holds a src directory', () => {
    const findings = findNestedSources(
      (path) => path === 'api/src' || path === 'core/src',
    );
    expect(findings).toHaveLength(2);
    expect(findings[0]).toContain('`api/src/` exists');
    expect(findings[1]).toContain('`core/src/` exists');
  });

  test('ignores a src directory inside a package', () => {
    expect(
      findNestedSources((path) => path === 'packages/store/src'),
    ).toEqual([]);
  });
});
