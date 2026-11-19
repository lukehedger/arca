// Every resource name starts with the stack name, so the longest function name still fits Lambda's 64-character limit.
export const MAX_STACK_NAME_LENGTH = 40;

export const PROJECT = '<project>';

const ENVIRONMENT_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// One stack per environment name, so a branch environment never replaces another environment in the same account.
export const stackNameFor = (environment: string): string => {
  if (!ENVIRONMENT_NAME.test(environment)) {
    throw new Error(
      `Environment name ${environment} must be lower-case letters, digits and single hyphens`,
    );
  }

  const stackName = `${PROJECT}-${environment}`;
  if (stackName.length > MAX_STACK_NAME_LENGTH) {
    throw new Error(
      `Stack name ${stackName} is longer than ${MAX_STACK_NAME_LENGTH} characters. Use a shorter environment name.`,
    );
  }

  return stackName;
};
