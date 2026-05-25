import assert from "node:assert/strict";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { StripeEventType } from "@packages/hutch-infra-components";
import {
	type StripeEventHandler,
	initStripeWebhookReceiverHandler,
} from "./stripe-webhook-receiver-handler";
import { UnconfiguredStripeEventError } from "./unconfigured-stripe-event-error";
import { signStripeWebhookHeader } from "./sign-stripe-webhook-header.test-helper";

const TEST_SECRET = "whsec_test_handler_secret";

function buildApiGatewayEvent(params: {
	body: string;
	signatureHeader?: string;
}): APIGatewayProxyEventV2 {
	return {
		version: "2.0",
		routeKey: "POST /webhooks/stripe",
		rawPath: "/webhooks/stripe",
		rawQueryString: "",
		headers: {
			"content-type": "application/json",
			...(params.signatureHeader ? { "stripe-signature": params.signatureHeader } : {}),
		},
		requestContext: {
			accountId: "123456789",
			apiId: "api-id",
			domainName: "test.execute-api.us-east-1.amazonaws.com",
			domainPrefix: "test",
			http: { method: "POST", path: "/webhooks/stripe", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "Stripe/1.0" },
			requestId: "req-id",
			routeKey: "POST /webhooks/stripe",
			stage: "$default",
			time: new Date().toISOString(),
			timeEpoch: Date.now(),
		},
		body: params.body,
		isBase64Encoded: false,
	};
}

function buildStripeEvent(params: { type: string; subscriptionId: string }): string {
	return JSON.stringify({
		id: `evt_${Math.random().toString(36).slice(2)}`,
		type: params.type,
		data: { object: { id: params.subscriptionId } },
	});
}

function buildSignature(rawBody: Buffer, opts?: { secret?: string; timestampSeconds?: number }): string {
	return signStripeWebhookHeader({
		rawBody,
		secret: opts?.secret ?? TEST_SECRET,
		timestampSeconds: opts?.timestampSeconds ?? Math.floor(Date.now() / 1000),
	});
}

function buildEventHandlers(
	overrides: Partial<Record<StripeEventType, StripeEventHandler>> = {},
): Record<StripeEventType, StripeEventHandler> {
	return {
		"customer.subscription.deleted": async () => {},
		...overrides,
	};
}

describe("stripe-webhook-receiver-handler", () => {
	it("returns 400 when Stripe-Signature header is missing", async () => {
		const handler = initStripeWebhookReceiverHandler({
			webhookSecret: TEST_SECRET,
			logger: HutchLogger.from(noopLogger),
			now: () => new Date(),
			eventHandlers: buildEventHandlers(),
		});

		const body = buildStripeEvent({ type: "customer.subscription.deleted", subscriptionId: "sub_1" });
		const result = await handler(buildApiGatewayEvent({ body }), {} as never, () => {});

		assert(result);
		assert.equal(result.statusCode, 400);
	});

	it("returns 400 when the signature does not match", async () => {
		const handler = initStripeWebhookReceiverHandler({
			webhookSecret: TEST_SECRET,
			logger: HutchLogger.from(noopLogger),
			now: () => new Date(),
			eventHandlers: buildEventHandlers(),
		});

		const body = buildStripeEvent({ type: "customer.subscription.deleted", subscriptionId: "sub_1" });
		const rawBody = Buffer.from(body);
		const result = await handler(
			buildApiGatewayEvent({
				body,
				signatureHeader: buildSignature(rawBody, { secret: "whsec_wrong" }),
			}),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.statusCode, 400);
	});

	it("dispatches to the wired event handler and returns 200", async () => {
		const calls: Array<{ subscriptionId: string }> = [];
		const handler = initStripeWebhookReceiverHandler({
			webhookSecret: TEST_SECRET,
			logger: HutchLogger.from(noopLogger),
			now: () => new Date(),
			eventHandlers: buildEventHandlers({
				"customer.subscription.deleted": async ({ stripeEvent }) => {
					calls.push({ subscriptionId: stripeEvent.data.object.id });
				},
			}),
		});

		const body = buildStripeEvent({ type: "customer.subscription.deleted", subscriptionId: "sub_dispatched" });
		const rawBody = Buffer.from(body);
		const result = await handler(
			buildApiGatewayEvent({ body, signatureHeader: buildSignature(rawBody) }),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.statusCode, 200);
		assert.deepStrictEqual(calls, [{ subscriptionId: "sub_dispatched" }]);
	});

	it("throws UnconfiguredStripeEventError for unknown Stripe event types so API Gateway returns 5xx and the operator alarm fires", async () => {
		const handler = initStripeWebhookReceiverHandler({
			webhookSecret: TEST_SECRET,
			logger: HutchLogger.from(noopLogger),
			now: () => new Date(),
			eventHandlers: buildEventHandlers(),
		});

		const body = buildStripeEvent({ type: "invoice.created", subscriptionId: "sub_ignore" });
		const rawBody = Buffer.from(body);

		await assert.rejects(
			async () => {
				await handler(
					buildApiGatewayEvent({ body, signatureHeader: buildSignature(rawBody) }),
					{} as never,
					() => {},
				);
			},
			(error: unknown) => {
				assert(error instanceof UnconfiguredStripeEventError);
				assert.equal(error.type, "invoice.created");
				return true;
			},
		);
	});

	it("propagates downstream handler failures so API Gateway returns 5xx and Stripe retries", async () => {
		const handler = initStripeWebhookReceiverHandler({
			webhookSecret: TEST_SECRET,
			logger: HutchLogger.from(noopLogger),
			now: () => new Date(),
			eventHandlers: buildEventHandlers({
				"customer.subscription.deleted": async () => { throw new Error("EventBridge down"); },
			}),
		});

		const body = buildStripeEvent({ type: "customer.subscription.deleted", subscriptionId: "sub_fail" });
		const rawBody = Buffer.from(body);

		await assert.rejects(
			async () => {
				await handler(
					buildApiGatewayEvent({ body, signatureHeader: buildSignature(rawBody) }),
					{} as never,
					() => {},
				);
			},
			{ message: "EventBridge down" },
		);
	});

	it("decodes base64-encoded bodies before dispatching", async () => {
		const calls: Array<{ subscriptionId: string }> = [];
		const handler = initStripeWebhookReceiverHandler({
			webhookSecret: TEST_SECRET,
			logger: HutchLogger.from(noopLogger),
			now: () => new Date(),
			eventHandlers: buildEventHandlers({
				"customer.subscription.deleted": async ({ stripeEvent }) => {
					calls.push({ subscriptionId: stripeEvent.data.object.id });
				},
			}),
		});

		const body = buildStripeEvent({ type: "customer.subscription.deleted", subscriptionId: "sub_b64" });
		const rawBody = Buffer.from(body);
		const b64Body = rawBody.toString("base64");
		const result = await handler(
			{ ...buildApiGatewayEvent({ body: b64Body, signatureHeader: buildSignature(rawBody) }), isBase64Encoded: true },
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.statusCode, 200);
		assert.deepStrictEqual(calls, [{ subscriptionId: "sub_b64" }]);
	});
});
