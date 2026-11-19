import { describe, test } from 'bun:test';
import { App, Duration, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Metric } from 'aws-cdk-lib/aws-cloudwatch';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { Api, LambdaFunction, Monitoring } from '../src/index.ts';

const synth = (): Template => {
  // Skipping esbuild keeps synth fast. No test here reads the bundle.
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'eu-west-1' },
  });
  const handler = new LambdaFunction(stack, 'GetOrderFunction', {
    description: 'Returns one order to the order API',
    entry: new URL('fixtures/handler.ts', import.meta.url).pathname,
    functionName: 'get-order',
    memorySize: 512,
    timeout: Duration.seconds(10),
  });
  const api = new Api(stack, 'OrderApi', {
    description: 'Serves orders to any client',
    name: 'order-api',
    routes: [{ handler, method: 'GET', path: 'orders/{orderId}', public: true }],
  });
  new Monitoring(stack, 'Monitoring', {
    alarmTopic: new Topic(stack, 'AlarmTopic', { topicName: 'order-alarms' }),
    api,
    failureMetrics: {
      'order-expiry': new Metric({
        metricName: 'OrderExpiryFailed',
        namespace: 'orders',
      }),
    },
    functions: [handler],
    name: 'orders',
  });
  return Template.fromStack(stack);
};

describe('Monitoring', () => {
  test('alarms on API 5XX responses and on each function error', () => {
    const template = synth();

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'orders-api-server-errors',
      Dimensions: [{ Name: 'ApiName', Value: 'order-api' }],
      MetricName: '5XXError',
      Namespace: 'AWS/ApiGateway',
      Threshold: 5,
      TreatMissingData: 'notBreaching',
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Dimensions: [
        {
          Name: 'FunctionName',
          Value: { Ref: Match.stringLikeRegexp('^GetOrderFunction') },
        },
      ],
      MetricName: 'Errors',
      Namespace: 'AWS/Lambda',
      Threshold: 5,
    });
  });

  test('counts each wide event with a failed assertion in the function log group', () => {
    synth().hasResourceProperties('AWS::Logs::MetricFilter', {
      FilterPattern: '{ $.outcome = "assertion_failed" }',
      LogGroupName: { Ref: Match.stringLikeRegexp('^GetOrderFunctionLogGroup') },
      MetricTransformations: [
        {
          MetricName: 'AssertionFailed',
          MetricNamespace: 'orders',
          MetricValue: '1',
        },
      ],
    });
  });

  test('alarms on a single failed assertion', () => {
    synth().hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'orders-assertion-failed',
      EvaluationPeriods: 1,
      MetricName: 'AssertionFailed',
      Namespace: 'orders',
      Threshold: 1,
      TreatMissingData: 'notBreaching',
    });
  });

  test('alarms on a single occurrence of each failure metric', () => {
    synth().hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'orders-order-expiry-failed',
      EvaluationPeriods: 1,
      MetricName: 'OrderExpiryFailed',
      Threshold: 1,
    });
  });

  test('notifies the topic when the composite error alarm changes state', () => {
    const template = synth();
    const topic = { Ref: Match.stringLikeRegexp('^AlarmTopic') };

    template.hasResourceProperties('AWS::CloudWatch::CompositeAlarm', {
      AlarmActions: [topic],
      AlarmName: 'orders-errors',
      AlarmRule: Match.objectLike({
        'Fn::Join': [
          '',
          Match.arrayWith([
            Match.objectLike({
              'Fn::GetAtt': [
                Match.stringLikeRegexp('AssertionFailedAlarm'),
                'Arn',
              ],
            }),
          ]),
        ],
      }),
      OKActions: [topic],
    });
  });

  test('creates no dashboard', () => {
    synth().resourceCountIs('AWS::CloudWatch::Dashboard', 0);
  });
});
