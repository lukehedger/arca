import { RemovalPolicy } from 'aws-cdk-lib';
import {
  AccessLogField,
  AccessLogFormat,
  type IAuthorizer,
  LambdaIntegration,
  LogGroupLogDestination,
  MethodLoggingLevel,
  type MethodOptions,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export type HttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

export type Route = {
  readonly authorizationScopes?: readonly string[];
  readonly handler: IFunction;
  readonly method: HttpMethod;
  readonly path: string;
  readonly public?: boolean;
};

export type ApiProps = {
  readonly authorizer?: IAuthorizer;
  readonly description: string;
  readonly name: string;
  readonly routes: readonly Route[];
};

export class Api extends Construct {
  public readonly restApi: RestApi;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    const accessLogs = new LogGroup(this, 'AccessLogs', {
      logGroupName: `/aws/apigateway/${props.name}`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: RetentionDays.ONE_MONTH,
    });

    // Access and execution logging need the account's API Gateway CloudWatch role, which the stack sets once.
    this.restApi = new RestApi(this, 'Resource', {
      cloudWatchRole: false,
      deployOptions: {
        accessLogDestination: new LogGroupLogDestination(accessLogs),
        accessLogFormat: AccessLogFormat.custom(
          JSON.stringify({
            request_id: AccessLogField.contextRequestId(),
            request_time_epoch: AccessLogField.contextRequestTimeEpoch(),
            http_method: AccessLogField.contextHttpMethod(),
            resource_path: AccessLogField.contextResourcePath(),
            status: AccessLogField.contextStatus(),
            response_latency_ms: AccessLogField.contextResponseLatency(),
            integration_latency_ms: AccessLogField.contextIntegrationLatency(),
            integration_status: AccessLogField.contextIntegrationStatus(),
            error_message: AccessLogField.contextErrorMessage(),
            error_response_type: AccessLogField.contextErrorResponseType(),
            client_id: AccessLogField.contextAuthorizerClaims('client_id'),
            xray_trace_id: AccessLogField.contextXrayTraceId(),
          }),
        ),
        dataTraceEnabled: false,
        loggingLevel: MethodLoggingLevel.ERROR,
        metricsEnabled: true,
        stageName: 'live',
        tracingEnabled: true,
      },
      description: props.description,
      restApiName: props.name,
    });

    for (const route of props.routes) {
      this.restApi.root
        .resourceForPath(route.path)
        .addMethod(
          route.method,
          new LambdaIntegration(route.handler, { allowTestInvoke: false }),
          toMethodOptions(props.name, route, props.authorizer),
        );
    }
  }
}

const toMethodOptions = (
  apiName: string,
  route: Route,
  authorizer: IAuthorizer | undefined,
): MethodOptions | undefined => {
  if (route.public && route.authorizationScopes) {
    throw new Error(
      `Route ${route.method} ${route.path} is public, so it cannot require authorisation scopes`,
    );
  }
  if (route.public) return undefined;
  // A route is protected unless it says otherwise, so a missing authoriser fails the synth instead of opening the route.
  if (authorizer === undefined) {
    throw new Error(
      `Route ${route.method} ${route.path} is protected, so Api ${apiName} needs an authorizer. Mark the route public if it needs none.`,
    );
  }

  return {
    authorizationScopes: route.authorizationScopes && [
      ...route.authorizationScopes,
    ],
    authorizer,
  };
};
