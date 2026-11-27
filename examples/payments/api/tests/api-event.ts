import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

export type ApiEventRequest = {
  readonly httpMethod: string;
  readonly resource: string;
  readonly pathParameters?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
};

// Fills the path from the resource and its parameters, so a test names only what its route reads.
export const apiEvent = (request: ApiEventRequest): APIGatewayProxyEvent => {
  const pathParameters = request.pathParameters ?? {};
  const path = Object.entries(pathParameters).reduce(
    (current, [name, value]) => current.replace(`{${name}}`, value),
    request.resource,
  );

  return {
    resource: request.resource,
    path,
    httpMethod: request.httpMethod,
    body: request.body ?? null,
    headers: { ...request.headers },
    multiValueHeaders: {},
    isBase64Encoded: false,
    pathParameters: { ...pathParameters },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api',
      authorizer: { claims: { client_id: 'client-1' } },
      protocol: 'HTTP/1.1',
      httpMethod: request.httpMethod,
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: null,
        userArn: null,
      },
      path,
      stage: 'live',
      requestId: 'gateway-request-1',
      requestTimeEpoch: 1_700_000_000_000,
      resourceId: 'resource',
      resourcePath: request.resource,
    },
  };
};

export const lambdaContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'handler',
  functionVersion: '1',
  invokedFunctionArn: 'arn:aws:lambda:eu-west-1:123456789012:function:handler',
  memoryLimitInMB: '512',
  awsRequestId: 'lambda-request-1',
  logGroupName: '/aws/lambda/handler',
  logStreamName: 'stream',
  getRemainingTimeInMillis: () => 10_000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
};
