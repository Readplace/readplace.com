/* c8 ignore start -- composition root, no logic to test */
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initDynamoDbArticleCrawl } from "./providers/article-crawl/dynamodb-article-crawl";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import {
	initReaderStreamHandler,
	type ReaderStreamRequest,
	type ReaderStreamResponse,
} from "./reader-stream/reader-stream-handler";
import { requireEnv } from "./domain/require-env";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const usersTable = requireEnv("DYNAMODB_USERS_TABLE");
const sessionsTable = requireEnv("DYNAMODB_SESSIONS_TABLE");

const dynamoClient = createDynamoDocumentClient();

const { findArticleCrawlStatus } = initDynamoDbArticleCrawl({
	client: dynamoClient,
	tableName: articlesTable,
});

const { getSessionUserId } = initDynamoDbAuth({
	client: dynamoClient,
	usersTableName: usersTable,
	sessionsTableName: sessionsTable,
});

const handlerFn = initReaderStreamHandler({
	findArticleCrawlStatus,
	getSessionUserId,
	logger: HutchLogger.from(consoleLogger),
	now: () => Date.now(),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	pollIntervalMs: 250,
	connectionMaxMs: 60_000,
});

/**
 * Adapter: `awslambda.streamifyResponse` invokes the handler with the raw
 * APIGatewayProxyEventV2 (or LambdaFunctionUrlEvent) and a `ResponseStream`.
 * We translate to the testable handler's `ReaderStreamRequest` /
 * `ReaderStreamResponse` shape so the handler stays free of the Lambda
 * runtime's globals — those don't exist in jest.
 *
 * The `awslambda` global is only present in the Node Lambda runtime, so
 * we look it up dynamically and accept that this file is only c8-ignored
 * — exercised by deployment + production canary, not unit tests.
 */
type LambdaStreamifyResponse = (
	handler: (event: unknown, stream: LambdaResponseStream) => Promise<void>,
) => unknown;

interface LambdaResponseStream {
	write(chunk: string | Uint8Array): void;
	end(): void;
	setContentType(type: string): void;
}

interface AwsLambdaGlobal {
	streamifyResponse: LambdaStreamifyResponse;
	HttpResponseStream: {
		from(
			stream: LambdaResponseStream,
			metadata: { statusCode: number; headers: Record<string, string> },
		): LambdaResponseStream;
	};
}

interface LambdaFunctionUrlEvent {
	rawQueryString?: string;
	cookies?: string[];
	headers?: Record<string, string | undefined>;
}

declare const awslambda: AwsLambdaGlobal | undefined;

function buildRequest(event: LambdaFunctionUrlEvent): ReaderStreamRequest {
	const queryString = event.rawQueryString ?? "";
	const cookieHeader = event.cookies && event.cookies.length > 0
		? event.cookies.join("; ")
		: event.headers?.cookie;
	return { queryString, cookieHeader };
}

function buildResponse(stream: LambdaResponseStream): ReaderStreamResponse {
	let headersWritten = false;
	let pendingHeaders: Record<string, string> = {};

	const ensureHeaders = (): void => {
		if (headersWritten) return;
		headersWritten = true;
		// awslambda.HttpResponseStream.from is the only way to set status +
		// headers on a streaming response — calling it later in the lifecycle
		// throws "ResponseStream not yet initialized". So we defer until the
		// first write and apply whatever headers the handler set via setHeaders.
		const aws = (typeof awslambda !== "undefined" ? awslambda : undefined);
		if (!aws) return;
		const _ = aws.HttpResponseStream.from(stream, {
			statusCode: 200,
			headers: pendingHeaders,
		});
		void _;
	};

	return {
		setHeaders: (h) => { pendingHeaders = h; },
		write: (frame) => {
			ensureHeaders();
			stream.write(frame);
		},
		end: () => {
			ensureHeaders();
			stream.end();
		},
	};
}

const adapted = async (event: unknown, stream: LambdaResponseStream): Promise<void> => {
	const request = buildRequest(event as LambdaFunctionUrlEvent);
	const response = buildResponse(stream);
	await handlerFn(request, response);
};

export const handler = (typeof awslambda !== "undefined"
	? awslambda.streamifyResponse(adapted)
	: adapted) as unknown;
/* c8 ignore stop */
