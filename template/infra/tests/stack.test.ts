import { describe, expect, test } from 'bun:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AccountStack } from '../account-stack.ts';
import { AppStack, type ConfigEnvironment } from '../stack.ts';

const env = { account: '123456789012', region: 'eu-west-1' };

const synth = (
  configEnvironment: ConfigEnvironment,
  deletionProtection = false,
): Template =>
  Template.fromStack(
    new AppStack(new App(), 'app', {
      configEnvironment,
      deletionProtection,
      env,
    }),
  );

describe('AppStack', () => {
  test('creates the state table with the keys the store writes', () => {
    synth('test').hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      TableName: 'app-state',
    });
  });

  test('names the table after the stack, so environments in one account stay apart', () => {
    const names = ['sample-pr-1', 'sample-pr-2'].map((stackName) =>
      Template.fromStack(
        new AppStack(new App(), stackName, {
          configEnvironment: 'test',
          deletionProtection: false,
          env,
        }),
      ).findResources('AWS::DynamoDB::GlobalTable'),
    );

    expect(
      names.map(
        (resources) => Object.values(resources)[0]?.Properties.TableName,
      ),
    ).toEqual(['sample-pr-1-state', 'sample-pr-2-state']);
  });

  test('outputs the state table name for the integration tests', () => {
    synth('test').hasOutput('StateTableName', {
      Value: { Ref: Match.stringLikeRegexp('StateTable') },
    });
  });

  test.each([true, false])(
    'sets deletion protection to %p when asked',
    (deletionProtection) => {
      synth('test', deletionProtection).hasResourceProperties(
        'AWS::DynamoDB::GlobalTable',
        {
          Replicas: [
            Match.objectLike({ DeletionProtectionEnabled: deletionProtection }),
          ],
        },
      );
    },
  );

  test.each(['test', 'production'] as const)(
    'deploys every %s config profile',
    (configEnvironment) => {
      synth(configEnvironment).hasResourceProperties(
        'AWS::AppConfig::ConfigurationProfile',
        { Name: 'feature-flags' },
      );
    },
  );
});

describe('AccountStack', () => {
  test('gives API Gateway a role to write logs to CloudWatch', () => {
    const template = Template.fromStack(
      new AccountStack(new App(), 'account', { env }),
    );

    template.hasResourceProperties('AWS::ApiGateway::Account', {
      CloudWatchRoleArn: { 'Fn::GetAtt': [Match.anyValue(), 'Arn'] },
    });
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { Service: 'apigateway.amazonaws.com' },
          }),
        ],
      },
    });
  });
});
