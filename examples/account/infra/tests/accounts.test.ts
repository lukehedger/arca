import { describe, test } from 'bun:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AppStack } from '../src/stack.ts';

const template = Template.fromStack(
  new AppStack(new App(), 'sample-pr-1', {
    configEnvironment: 'test',
    deletionProtection: false,
    env: { account: '123456789012', region: 'eu-west-1' },
  }),
);

describe('accounts API', () => {
  test('points the accounts function at the state table', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'sample-pr-1-accounts',
      Environment: {
        Variables: Match.objectLike({
          STATE_TABLE_NAME: { Ref: Match.stringLikeRegexp('StateTable') },
        }),
      },
    });
  });

  test('lets the accounts function read and write the state table', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['dynamodb:Query', 'dynamodb:PutItem']),
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  test('routes POST /accounts/{accountId}/commands behind Cognito', () => {
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'POST',
      AuthorizationType: 'COGNITO_USER_POOLS',
    });
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: '{accountId}',
    });
  });
});
