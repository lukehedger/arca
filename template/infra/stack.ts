import { Table } from '@<project>/constructs';
import { type App, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnAccount } from 'aws-cdk-lib/aws-apigateway';
import { AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';

export type AppStackProps = StackProps & {
  readonly deletionProtection: boolean;
};

export class AppStack extends Stack {
  constructor(scope: App, id: string, props: AppStackProps) {
    super(scope, id, props);

    this.provisionApiGatewayLogging();
    this.provisionState(props);
  }

  // API Gateway holds one CloudWatch role per account and region. The account holds only this stack, so the stack owns it.
  private provisionApiGatewayLogging(): CfnAccount {
    const role = new Role(this, 'ApiGatewayCloudWatchRole', {
      assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
      description:
        'Lets API Gateway write access and execution logs to CloudWatch',
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonAPIGatewayPushToCloudWatchLogs',
        ),
      ],
    });

    return new CfnAccount(this, 'ApiGatewayAccount', {
      cloudWatchRoleArn: role.roleArn,
    });
  }

  private provisionState(props: AppStackProps): Table {
    return new Table(this, 'StateTable', {
      deletionProtection: props.deletionProtection,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      tableName: '<project>-state',
    });
  }
}
