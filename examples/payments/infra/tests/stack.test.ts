import { describe, expect, test } from 'bun:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AppStack } from '../stack.ts';

const env = { account: '123456789012', region: 'eu-west-1' };

const synth = (deletionProtection = false): Template =>
  Template.fromStack(
    new AppStack(new App(), 'app', { deletionProtection, env }),
  );

describe('AppStack', () => {
  test('creates the state table with the keys the store writes', () => {
    synth().hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      TableName: 'payments-state',
    });
  });

  test('gives API Gateway a role to write logs to CloudWatch', () => {
    const template = synth();

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

  // Each environment is its own account, so a name built from the stack name or account scopes a resource to one environment.
  test('synthesises the same template in every account', () => {
    const templates = [
      { id: 'app', env },
      { id: 'other', env: { ...env, account: '210987654321' } },
    ].map(({ id, env }) =>
      Template.fromStack(
        new AppStack(new App(), id, { deletionProtection: false, env }),
      ).toJSON(),
    );

    expect(templates[1]).toEqual(templates[0]);
  });

  test.each([true, false])(
    'sets deletion protection to %p when asked',
    (deletionProtection) => {
      synth(deletionProtection).hasResourceProperties(
        'AWS::DynamoDB::GlobalTable',
        {
          Replicas: [
            Match.objectLike({ DeletionProtectionEnabled: deletionProtection }),
          ],
        },
      );
    },
  );
});
