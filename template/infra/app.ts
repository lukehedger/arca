import { App } from 'aws-cdk-lib';
import { AppStack } from './stack.ts';

const readRequiredEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined)
    throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const readBoolean = (name: string): boolean => {
  const value = readRequiredEnv(name);
  if (value !== 'true' && value !== 'false')
    throw new Error(`${name} must be true or false, not ${value}`);
  return value === 'true';
};

const env = {
  account: readRequiredEnv('CDK_DEFAULT_ACCOUNT'),
  region: readRequiredEnv('CDK_DEFAULT_REGION'),
};

const app = new App();

new AppStack(app, '<project>', {
  deletionProtection: readBoolean('DELETION_PROTECTION'),
  env,
});
