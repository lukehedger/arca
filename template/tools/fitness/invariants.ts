export type PropertyResult = {
  readonly invariant: string;
  readonly outcome: 'passed' | 'skipped' | 'failed';
  readonly assertions: number;
};

const TEST_CASE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const PROPERTY_PREFIX = 'invariant: ';

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&apos;': "'",
  '&gt;': '>',
  '&lt;': '<',
  '&quot;': '"',
};

const attribute = (attributes: string, name: string): string | undefined => {
  const value = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];
  return value?.replace(
    /&(amp|apos|gt|lt|quot);/g,
    (entity) => ENTITIES[entity] ?? entity,
  );
};

const outcomeOf = (body: string): PropertyResult['outcome'] => {
  if (/<(failure|error)\b/.test(body)) return 'failed';
  if (/<skipped\b/.test(body)) return 'skipped';
  return 'passed';
};

// Reads the JUnit report of a core test run, so only a property that executed counts as coverage.
export const parsePropertyResults = (junit: string): PropertyResult[] =>
  [...junit.matchAll(TEST_CASE)].flatMap(([, attributes = '', body = '']) => {
    const name = attribute(attributes, 'name') ?? '';
    if (!name.startsWith(PROPERTY_PREFIX)) return [];

    return [
      {
        invariant: name.slice(PROPERTY_PREFIX.length),
        outcome: outcomeOf(body),
        assertions: Number(attribute(attributes, 'assertions') ?? '0'),
      },
    ];
  });

const findingFor = (
  name: string,
  results: readonly PropertyResult[],
): string | undefined => {
  if (
    results.some(
      ({ outcome, assertions }) => outcome === 'passed' && assertions > 0,
    )
  ) {
    return undefined;
  }
  if (results.length === 0) {
    return `Invariant coverage: invariant \`${name}\` has no property test that runs. Add \`invariant('${name}', ...)\` to a test in core/tests.`;
  }
  if (results.some(({ outcome }) => outcome === 'failed')) {
    return `Invariant coverage: the property for invariant \`${name}\` fails. Fix the core or the property.`;
  }
  if (results.some(({ outcome }) => outcome === 'skipped')) {
    return `Invariant coverage: the property for invariant \`${name}\` is skipped. Remove the .skip, .todo or .only that stops it running.`;
  }
  return `Invariant coverage: the property for invariant \`${name}\` checks nothing. Declare it with the \`invariant\` helper from core/tests/invariant.ts.`;
};

export const findUntestedInvariants = (
  invariants: readonly string[],
  results: readonly PropertyResult[],
): string[] =>
  invariants.flatMap((name) => {
    const finding = findingFor(
      name,
      results.filter((result) => result.invariant === name),
    );
    return finding === undefined ? [] : [finding];
  });
