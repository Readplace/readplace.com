import assert from "node:assert/strict";
import type { Handler, SQSEvent, SQSBatchResponse } from "aws-lambda";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { UserIdSchema, type UserId } from "@packages/domain/user";
import { CheckGmailNewslettersCommand, GmailNewsletterAccountsCheckedEvent, MonitorGmailNewslettersCommand, GmailNewsletterMonitoringProgressedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { GmailMonitoringPage } from "@packages/provider-contracts/gmail-monitoring";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initGmailNewsletterMonitorHandler } from "./gmail-newsletter-monitor-handler";
import type { GmailMonitoringProgress, MonitorGmailNewsletters } from "./monitor-gmail-newsletters";

const USER = UserIdSchema.parse("reader-1");
const OTHER = UserIdSchema.parse("reader-2");
const SENDER = ForwardableSenderSchema.parse("news@example.com");
const NEXT: GmailMonitoringPage = { userId: USER, generation: "generation-1", page: 1 };

function body(event: { detailType: string }, detail: unknown) {
	return JSON.stringify({ "detail-type": event.detailType, detail });
}

async function run(handler: Handler<SQSEvent, SQSBatchResponse>, records: { messageId: string; body: string }[]) {
	const response = await handler(buildSqsEvent(records), buildLambdaContext(), () => {});
	assert(response);
	return response;
}

function harness() {
	const published: { event: unknown; detail: unknown }[] = [];
	const accountsQueries: { pageToken?: string }[] = [];
	const checked: { accountsPageToken?: string }[] = [];
	const dispatched: { userId: UserId; continuation?: { generation: string; page: number } }[] = [];
	const notices: { userId: UserId }[] = [];
	const started: UserId[] = [];
	const pages: GmailMonitoringPage[] = [];
	let result: GmailMonitoringProgress = { nextPage: NEXT, notices: [SENDER] };
	const monitor: MonitorGmailNewsletters = {
		start: async (userId) => { started.push(userId); return result; },
		page: async (input) => { pages.push(input); return result; },
	};
	const publishEvent: PublishEvent = async (event, detail) => { published.push({ event, detail }); };
	const deps: Parameters<typeof initGmailNewsletterMonitorHandler>[0] = {
		monitor,
		listConnectedAccounts: async (input) => { accountsQueries.push(input); return { userIds: [USER, OTHER], nextPageToken: "next-accounts" }; },
		dispatchCheck: async (input) => { checked.push(input); },
		dispatchMonitor: async (input) => { dispatched.push(input); },
		dispatchNotice: async (input) => { notices.push(input); },
		publishEvent,
		logger: HutchLogger.from(noopLogger),
	};
	return { deps, published, accountsQueries, checked, dispatched, notices, started, pages, complete: () => { result = { nextPage: undefined, notices: [] }; } };
}

describe("initGmailNewsletterMonitorHandler", () => {
	it("announces bounded connected-account pages for scheduled and explicit check commands", async () => {
		const h = harness();
		assert.deepEqual(await run(initGmailNewsletterMonitorHandler(h.deps), [
			{ messageId: "scheduled", body: JSON.stringify({ detail: {} }) },
			{ messageId: "next-page", body: body(CheckGmailNewslettersCommand, { accountsPageToken: "cursor" }) },
		]), { batchItemFailures: [] });
		assert.deepEqual(h.accountsQueries, [{ pageToken: undefined }, { pageToken: "cursor" }]);
		assert.deepEqual(h.published, [
			{ event: GmailNewsletterAccountsCheckedEvent, detail: { userIds: [USER, OTHER], nextAccountsPageToken: "next-accounts" } },
			{ event: GmailNewsletterAccountsCheckedEvent, detail: { userIds: [USER, OTHER], nextAccountsPageToken: "next-accounts" } },
		]);
		assert.deepEqual(h.dispatched, []);
		assert.deepEqual(h.checked, []);
	});

	it("turns account-page facts into user commands and the next check, and ends enumeration when the cursor ends", async () => {
		const h = harness();
		await run(initGmailNewsletterMonitorHandler(h.deps), [
			{ messageId: "accounts", body: body(GmailNewsletterAccountsCheckedEvent, { userIds: [USER, OTHER], nextAccountsPageToken: "next-accounts" }) },
			{ messageId: "last-page", body: body(GmailNewsletterAccountsCheckedEvent, { userIds: [] }) },
		]);
		assert.deepEqual(h.dispatched, [{ userId: USER }, { userId: OTHER }]);
		assert.deepEqual(h.checked, [{ accountsPageToken: "next-accounts" }]);
		assert.deepEqual(h.published, []);
		assert.deepEqual(h.accountsQueries, []);
	});

	it("publishes monitoring results for new and continuation commands before dispatching follow-up work", async () => {
		const h = harness();
		const handler = initGmailNewsletterMonitorHandler(h.deps);
		await run(handler, [
			{ messageId: "new-check", body: JSON.stringify({ detail: { userId: USER } }) },
			{ messageId: "continue", body: body(MonitorGmailNewslettersCommand, { userId: USER, continuation: { generation: NEXT.generation, page: NEXT.page } }) },
		]);
		assert.deepEqual(h.started, [USER]);
		assert.deepEqual(h.pages, [NEXT]);
		assert.deepEqual(h.published, [
			{ event: GmailNewsletterMonitoringProgressedEvent, detail: { userId: USER, nextPage: NEXT, notices: [SENDER] } },
			{ event: GmailNewsletterMonitoringProgressedEvent, detail: { userId: USER, nextPage: NEXT, notices: [SENDER] } },
		]);
		assert.deepEqual(h.dispatched, []);
		assert.deepEqual(h.notices, []);
		h.complete();
		await run(handler, [{ messageId: "complete", body: body(MonitorGmailNewslettersCommand, { userId: USER }) }]);
		assert.deepEqual(h.published[2], { event: GmailNewsletterMonitoringProgressedEvent, detail: { userId: USER, nextPage: undefined, notices: [] } });
	});

	it("routes monitoring facts into one notification command per page of waiting notices and page continuations, and stops at completion", async () => {
		const h = harness();
		await run(initGmailNewsletterMonitorHandler(h.deps), [
			{ messageId: "progress", body: body(GmailNewsletterMonitoringProgressedEvent, { userId: USER, nextPage: { generation: NEXT.generation, page: NEXT.page }, notices: [SENDER, ForwardableSenderSchema.parse("digest@example.com")] }) },
			{ messageId: "complete", body: body(GmailNewsletterMonitoringProgressedEvent, { userId: USER, notices: [] }) },
		]);
		assert.deepEqual(h.dispatched, [{ userId: USER, continuation: { generation: NEXT.generation, page: NEXT.page } }]);
		assert.deepEqual(h.notices, [{ userId: USER }]);
		assert.deepEqual(h.published, []);
	});

	it("keeps only malformed and failed records retryable while processing other records", async () => {
		const h = harness();
		h.deps.publishEvent = async () => { throw new Error("EventBridge unavailable"); };
		assert.deepEqual(await run(initGmailNewsletterMonitorHandler(h.deps), [
			{ messageId: "bad-json", body: "not json" },
			{ messageId: "bad-page", body: body(MonitorGmailNewslettersCommand, { userId: USER, continuation: { generation: NEXT.generation, page: -1 } }) },
			{ messageId: "check-fact", body: JSON.stringify({ detail: {} }) },
			{ messageId: "monitor-fact", body: body(MonitorGmailNewslettersCommand, { userId: USER }) },
			{ messageId: "complete", body: body(GmailNewsletterMonitoringProgressedEvent, { userId: USER, notices: [] }) },
		]), { batchItemFailures: [{ itemIdentifier: "bad-json" }, { itemIdentifier: "bad-page" }, { itemIdentifier: "check-fact" }, { itemIdentifier: "monitor-fact" }] });
		const dispatchFailure = harness();
		dispatchFailure.deps.dispatchNotice = async () => { throw new Error("SQS unavailable"); };
		assert.deepEqual(await run(initGmailNewsletterMonitorHandler(dispatchFailure.deps), [
			{ messageId: "notice-dispatch", body: body(GmailNewsletterMonitoringProgressedEvent, { userId: USER, notices: [SENDER] }) },
			{ messageId: "healthy-accounts", body: body(GmailNewsletterAccountsCheckedEvent, { userIds: [] }) },
		]), { batchItemFailures: [{ itemIdentifier: "notice-dispatch" }] });
	});
});
