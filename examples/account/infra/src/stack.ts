import { profiles, toDeployableProfile } from '@<project>/config';
import { Api, Config, LambdaFunction, Table } from '@<project>/constructs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type App,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { AttributeType } from 'aws-cdk-lib/aws-dynamodb';

export type ConfigEnvironment = 'production' | 'test';

export type AppStackProps = StackProps & {
  readonly configEnvironment: ConfigEnvironment;
  readonly deletionProtection: boolean;
};

const HANDLERS = join(import.meta.dirname, '../../api/src');

const CONFIG_ENVIRONMENTS = join(
  import.meta.dirname,
  '../../packages/config/environments',
);

export class AppStack extends Stack {
  constructor(scope: App, id: string, props: AppStackProps) {
    super(scope, id, props);

    const state = this.provisionState(props);
    this.provisionConfig(props);
    this.provisionAccountsApi(props, state);

    // The environment tool reads this output to point the integration tests at the table.
    new CfnOutput(this, 'StateTableName', { value: state.tableName });
  }

  private provisionState(props: AppStackProps): Table {
    return new Table(this, 'StateTable', {
      deletionProtection: props.deletionProtection,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      tableName: `${this.stackName}-state`,
    });
  }

  private provisionAccountsApi(props: AppStackProps, state: Table): Api {
    const userPool = new UserPool(this, 'UserPool', {
      deletionProtection: props.deletionProtection,
      removalPolicy: props.deletionProtection
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
      selfSignUpEnabled: false,
      userPoolName: `${this.stackName}-users`,
    });

    const accounts = new LambdaFunction(this, 'AccountsFunction', {
      description: 'Runs account commands through the core',
      entry: join(HANDLERS, 'accounts/lambda.ts'),
      environment: { STATE_TABLE_NAME: state.tableName },
      functionName: `${this.stackName}-accounts`,
      memorySize: 512,
      timeout: Duration.seconds(10),
    });
    state.grantReadWriteData(accounts);

    return new Api(this, 'Api', {
      description: 'The accounts API',
      name: `${this.stackName}-api`,
      routes: [
        {
          handler: accounts,
          method: 'POST',
          path: '/accounts/{accountId}/commands',
        },
      ],
      userPoolArns: [userPool.userPoolArn],
    });
  }

  private provisionConfig(props: AppStackProps): Config {
    return new Config(this, 'RuntimeConfig', {
      applicationName: this.stackName,
      profiles: profiles.map((profile) =>
        toDeployableProfile(
          profile,
          readFileSync(
            join(
              CONFIG_ENVIRONMENTS,
              props.configEnvironment,
              `${profile.name}.json`,
            ),
            'utf8',
          ),
        ),
      ),
    });
  }
}
