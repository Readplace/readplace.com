import type { Context } from "aws-lambda";

export function buildLambdaContext(): Context {
	return {
		callbackWaitsForEmptyEventLoop: true,
		functionName: "test",
		functionVersion: "1",
		invokedFunctionArn: "arn:aws:lambda:ap-southeast-2:123456789:function:test",
		memoryLimitInMB: "128",
		awsRequestId: "test-request-id",
		logGroupName: "/aws/lambda/test",
		logStreamName: "test-stream",
		getRemainingTimeInMillis: () => 30000,
		done: () => {},
		fail: () => {},
		succeed: () => {},
	};
}
