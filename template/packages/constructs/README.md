# @<project>/constructs

The L3 CDK constructs that `infra/` builds the stack from. Each one wires an AWS primitive the same way every time, so the stack states only what differs.

## Public API

- `LambdaFunction` extends `NodejsFunction`. It applies ARM64, Node.js 24, a minified ESM bundle built by esbuild, active X-Ray tracing and its own log group with three-month retention. Requires `description`, `entry`, `functionName`, `memorySize` and `timeout`. Optional `environment` and `durableConfig`, which makes it a durable function.
- `Api` is the one REST API. Each `Route` maps a `method` and `path` to a `handler`. Every route sits behind the API's `authorizer` unless it sets `public: true`. Any API Gateway authoriser works, such as Cognito, a Lambda authoriser or IAM. A protected route on an API with no `authorizer` fails the synth, so a missing authoriser never opens a route. A protected route can require `authorizationScopes`. The stage traces requests and writes JSON access logs without request or response payloads. Requires `description`, `name` and `routes`.
- `Table` extends `TableV2` with on-demand billing, point-in-time recovery and an AWS managed KMS key. A table with `deletionProtection` is retained when the stack is deleted. One without it is deleted with the stack. Requires `deletionProtection`, `partitionKey` and `tableName`.
- `Monitoring` holds the alarms the architecture depends on. It alarms on API 5XX responses and on each function's errors. A metric filter on each function's log group counts the wide events with the `assertion_failed` outcome, and one failed assertion fires `assertionFailedAlarm`. Each entry in `failureMetrics` alarms on one occurrence, for failures that no Lambda error shows, such as a durable execution that recorded FAILED. The composite `errorAlarm` fires when any of these alarms fires. It notifies `alarmTopic` on ALARM and OK. Requires `alarmTopic`, `api`, `functions` and `name`. Create it only where someone acts on its alarms.

## Example

```ts
const getOrder = new LambdaFunction(this, 'GetOrderFunction', {
  description: 'Returns one order to API clients',
  entry: join(import.meta.dirname, '../../api/orders/get-order.ts'),
  functionName: 'get-order',
  memorySize: 512,
  timeout: Duration.seconds(10),
});
table.grantReadData(getOrder);

const api = new Api(this, 'OrderApi', {
  authorizer,
  description: 'Serves orders to authenticated clients',
  name: 'order-api',
  routes: [{ handler: getOrder, method: 'GET', path: 'orders/{orderId}' }],
});

if (props.enableAlarms) {
  new Monitoring(this, 'Monitoring', {
    alarmTopic,
    api,
    functions: [getOrder],
    name: 'orders',
  });
}
```

The API sets no account-level CloudWatch role. API Gateway logging needs one, so set it once per account.
