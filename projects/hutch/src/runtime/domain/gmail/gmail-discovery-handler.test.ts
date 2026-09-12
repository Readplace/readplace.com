import assert from "node:assert/strict";
import type { Handler, SQSEvent, SQSBatchResponse } from "aws-lambda";
import { GmailAccountEmailSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { DiscoverGmailSendersPageCommand, GmailSenderDiscoveryProgressedEvent, StartGmailSenderDiscoveryCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryGmailDiscovery } from "@packages/test-fixtures/providers/gmail-discovery";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initGmailDiscoveryDlqHandler, initGmailDiscoveryHandler } from "./gmail-discovery-handler";
import type { DiscoverGmailSenders, GmailDiscoveryPage } from "./discover-gmail-senders";

const USER = UserIdSchema.parse("user-1");
const NEXT = { userId: USER, generation: "run-1", page: 0 };
const NOW = new Date("2026-09-12T00:00:00.000Z");

function body(event: { detailType: string }, detail: unknown = { userId: USER }) {
	return JSON.stringify({ "detail-type": event.detailType, detail });
}

async function run(handler: Handler<SQSEvent, SQSBatchResponse>, records: { messageId: string; body: string }[]) {
	const response = await handler(buildSqsEvent(records), buildLambdaContext(), () => {});
	assert(response);
	return response;
}

function harness() {
	const discovery = initInMemoryGmailDiscovery({ now: () => NOW });
	const published: { event: unknown; detail: unknown }[] = [];
	const started: string[] = [];
	const pages: GmailDiscoveryPage[] = [];
	const dispatched: GmailDiscoveryPage[] = [];
	const discover: DiscoverGmailSenders = {
		start: async (userId) => { started.push(userId); return NEXT; },
		page: async (input) => { pages.push(input); return undefined; },
	};
	const deps = {
		discovery, discover,
		dispatchPage: async (input: GmailDiscoveryPage) => { dispatched.push(input); },
		publishEvent: (async (event, detail) => { published.push({ event, detail }); }) as PublishEvent,
		logger: HutchLogger.from(noopLogger),
	};
	const startState = () => discovery.startDiscovery({ userId: USER, accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"), gatewayAddress: InboxAddressSchema.parse("gmail-a7b2c9@read.place"), generation: "run-1", mode: "full", historyId: "100" });
	return { ...deps, deps, published, started, pages, dispatched, startState };
}

describe("initGmailDiscoveryHandler", () => {
	it("processes commands into progress facts and reacts to facts with delayed page dispatch", async () => {
		const h = harness();
		const response = await run(initGmailDiscoveryHandler(h.deps), [
			{ messageId: "start", body: body(StartGmailSenderDiscoveryCommand) },
			{ messageId: "progress", body: body(GmailSenderDiscoveryProgressedEvent, { userId: USER, nextPage: NEXT }) },
			{ messageId: "page", body: JSON.stringify({ detail: NEXT }) },
			{ messageId: "complete", body: body(GmailSenderDiscoveryProgressedEvent) },
		]);
		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(h.started, [USER]);
		assert.deepEqual(h.pages, [NEXT]);
		assert.deepEqual(h.dispatched, [NEXT]);
		assert.deepEqual(h.published, [
			{ event: GmailSenderDiscoveryProgressedEvent, detail: { userId: USER, nextPage: NEXT } },
			{ event: GmailSenderDiscoveryProgressedEvent, detail: { userId: USER, nextPage: undefined } },
		]);
	});

	it("returns only failed records for retries after malformed payloads or a publish failure", async () => {
		const h = harness();
		h.deps.publishEvent = async () => { throw new Error("EventBridge unavailable"); };
		assert.deepEqual(await run(initGmailDiscoveryHandler(h.deps), [
			{ messageId: "bad", body: "not json" },
			{ messageId: "start", body: body(StartGmailSenderDiscoveryCommand) },
			{ messageId: "complete", body: body(GmailSenderDiscoveryProgressedEvent) },
		]), { batchItemFailures: [{ itemIdentifier: "bad" }, { itemIdentifier: "start" }] });
	});
});

describe("initGmailDiscoveryDlqHandler", () => {
	it("marks exhausted current start, page and progress work failed and publishes a terminal fact", async () => {
		for (const recordBody of [body(StartGmailSenderDiscoveryCommand), body(DiscoverGmailSendersPageCommand, NEXT), body(GmailSenderDiscoveryProgressedEvent, { userId: USER, nextPage: NEXT }), body(GmailSenderDiscoveryProgressedEvent)]) {
			const h = harness();
			await h.startState();
			assert.deepEqual(await run(initGmailDiscoveryDlqHandler(h.deps), [{ messageId: "exhausted", body: recordBody }]), { batchItemFailures: [] });
			const state = await h.discovery.findDiscoveryByUserId(USER);
			assert.equal(state?.state, "failed");
			assert.match(state?.error ?? "", /Try again to continue/);
			assert.deepEqual(h.published, [{ event: GmailSenderDiscoveryProgressedEvent, detail: { userId: USER } }]);
		}
	});

	it("ignores deleted, completed and stale generations or pages without stopping current work", async () => {
		const h = harness();
		const handler = initGmailDiscoveryDlqHandler(h.deps);
		await run(handler, [{ messageId: "deleted", body: body(StartGmailSenderDiscoveryCommand) }]);
		await h.startState();
		await run(handler, [
			{ messageId: "generation", body: body(DiscoverGmailSendersPageCommand, { ...NEXT, generation: "old" }) },
			{ messageId: "page", body: body(GmailSenderDiscoveryProgressedEvent, { userId: USER, nextPage: { ...NEXT, page: 3 } }) },
		]);
		const previous = await h.discovery.findDiscoveryByUserId(USER);
		assert(previous);
		assert.equal(previous.state, "running");
		await h.discovery.savePage({ previous, senders: [], mode: "history", pageToken: undefined, historyId: "200", state: "complete", scannedMessages: 0, estimatedTotalMessages: undefined });
		await run(handler, [{ messageId: "completed", body: body(StartGmailSenderDiscoveryCommand) }]);
		assert.equal((await h.discovery.findDiscoveryByUserId(USER))?.state, "complete");
		assert.deepEqual(h.published, []);
	});

	it("keeps malformed DLQ messages retryable and does not discard other records", async () => {
		const h = harness();
		await h.startState();
		assert.deepEqual(await run(initGmailDiscoveryDlqHandler(h.deps), [
			{ messageId: "bad", body: body(DiscoverGmailSendersPageCommand, { userId: USER, generation: "run-1", page: -1 }) },
			{ messageId: "good", body: body(StartGmailSenderDiscoveryCommand) },
		]), { batchItemFailures: [{ itemIdentifier: "bad" }] });
		assert.equal((await h.discovery.findDiscoveryByUserId(USER))?.state, "failed");
	});
});
