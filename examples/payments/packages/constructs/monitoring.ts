import type { Outcome } from '@payments/telemetry';
import { Duration } from 'aws-cdk-lib';
import {
  Alarm,
  AlarmRule,
  ComparisonOperator,
  CompositeAlarm,
  type IMetric,
  Metric,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { FilterPattern, MetricFilter } from 'aws-cdk-lib/aws-logs';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import type { Api } from './api.ts';
import type { LambdaFunction } from './lambda-function.ts';

const PERIOD = Duration.minutes(5);

const ASSERTION_FAILED_METRIC = 'AssertionFailed';
// Typed so the filter fails to compile if telemetry renames the outcome, instead of silently matching nothing.
const ASSERTION_FAILED_OUTCOME: Outcome = 'assertion_failed';

export type MonitoringProps = {
  readonly alarmTopic: ITopic;
  readonly api: Api;
  // Keyed by what failed, such as webhook-replay. Each counts failures no Lambda error shows, so one occurrence alarms.
  readonly failureMetrics?: Readonly<Record<string, IMetric>>;
  readonly functions: readonly LambdaFunction[];
  readonly name: string;
};

export class Monitoring extends Construct {
  public readonly assertionFailedAlarm: Alarm;
  public readonly errorAlarm: CompositeAlarm;

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);

    const { restApi } = props.api;

    const serverErrorAlarm = new Alarm(this, 'ApiServerErrorAlarm', {
      alarmDescription: `The ${props.name} API returned at least five 5XX responses in each of three five-minute periods`,
      alarmName: `${props.name}-api-server-errors`,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 3,
      metric: restApi.metricServerError({ period: PERIOD, statistic: 'Sum' }),
      threshold: 5,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    const functionErrorAlarms = props.functions.map(
      (fn) =>
        new Alarm(this, `${fn.node.id}ErrorAlarm`, {
          alarmDescription: `${fn.functionName} failed at least five invocations in each of three five-minute periods`,
          alarmName: `${fn.functionName}-errors`,
          comparisonOperator:
            ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          evaluationPeriods: 3,
          metric: fn.metricErrors({ period: PERIOD, statistic: 'Sum' }),
          threshold: 5,
          treatMissingData: TreatMissingData.NOT_BREACHING,
        }),
    );

    // The handler maps a failed assertion to a 500, so only the wide event's outcome tells it apart from any other fault.
    for (const fn of props.functions) {
      new MetricFilter(this, `${fn.node.id}AssertionFailedFilter`, {
        filterPattern: FilterPattern.stringValue(
          '$.outcome',
          '=',
          ASSERTION_FAILED_OUTCOME,
        ),
        logGroup: fn.logGroup,
        metricName: ASSERTION_FAILED_METRIC,
        metricNamespace: props.name,
        metricValue: '1',
      });
    }

    this.assertionFailedAlarm = new Alarm(this, 'AssertionFailedAlarm', {
      alarmDescription: `A core assertion failed in ${props.name}, so a state the domain rules out occurred`,
      alarmName: `${props.name}-assertion-failed`,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      metric: new Metric({
        metricName: ASSERTION_FAILED_METRIC,
        namespace: props.name,
        period: PERIOD,
        statistic: 'Sum',
      }),
      threshold: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    const failureAlarms = Object.entries(props.failureMetrics ?? {}).map(
      ([failure, metric]) =>
        new Alarm(this, `${failure}-failure-alarm`, {
          alarmDescription: `${props.name} recorded a ${failure} failure, which no Lambda error shows`,
          alarmName: `${props.name}-${failure}-failed`,
          comparisonOperator:
            ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          evaluationPeriods: 1,
          metric,
          threshold: 1,
          treatMissingData: TreatMissingData.NOT_BREACHING,
        }),
    );

    this.errorAlarm = new CompositeAlarm(this, 'ErrorAlarm', {
      alarmDescription: `${props.name} is failing requests or invocations. The child alarm in ALARM names the source`,
      alarmRule: AlarmRule.anyOf(
        serverErrorAlarm,
        this.assertionFailedAlarm,
        ...functionErrorAlarms,
        ...failureAlarms,
      ),
      compositeAlarmName: `${props.name}-errors`,
    });
    const notify = new SnsAction(props.alarmTopic);
    this.errorAlarm.addAlarmAction(notify);
    this.errorAlarm.addOkAction(notify);
  }
}
