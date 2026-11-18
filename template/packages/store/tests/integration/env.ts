// Integration tests run against a disposable environment, so a missing value means they were started the wrong way.
export const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set. Run integration tests with \`bun env:test\`, which reads it from the disposable environment.`,
    );
  }

  return value;
};
