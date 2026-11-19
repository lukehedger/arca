import { Table } from '@<project>/constructs';
import { type App, CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import { AttributeType } from 'aws-cdk-lib/aws-dynamodb';

export type AppStackProps = StackProps & {
  readonly deletionProtection: boolean;
};

export class AppStack extends Stack {
  constructor(scope: App, id: string, props: AppStackProps) {
    super(scope, id, props);

    const state = this.provisionState(props);

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
}
