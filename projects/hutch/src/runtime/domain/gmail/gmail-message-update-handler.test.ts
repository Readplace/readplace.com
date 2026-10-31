import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema, GmailMessageIdSchema, type GmailMessageOrigin } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import type { GmailEmailUpdateFailedLine } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryGmailMessageUpdate } from "@packages/test-fixtures/providers/gmail-history-import";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initGmailMessageUpdateDlqHandler, initGmailMessageUpdateHandler } from "./gmail-message-update-handler";
import type { MarkGmailEmailImportedOutcome } from "./mark-gmail-email-imported";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const RAM = "2026-10-27T00:00:00.000Z#<issue@news.test>";
const NOW = new Date("2026-10-27T01:00:00.000Z");
const ORIGIN: GmailMessageOrigin = { kind: "history", accountEmail: ACCOUNT, gmailMessageId: GmailMessageIdSchema.parse("m1"), senderEmail: ForwardableSenderSchema.parse("dan@news.test") };

const markBody = JSON.stringify({ "detail-type": "MarkGmailEmailImported", detail: { userId: USER, receivedAtMessageId: RAM, origin: ORIGIN } });
const grantedBody = JSON.stringify({ "detail-type": "GmailModifyPermissionGranted", detail: { userId: USER, accountEmail: ACCOUNT } });

function capture() {
	const published: { detailType: string; detail: unknown }[] = [];
	const publishEvent = (async (event, detail) => {
		published.push({ detailType: event.detailType, detail });
	}) as PublishEvent;
	return { published, publishEvent };
}

function run(handler: ReturnType<typeof initGmailMessageUpdateHandler>, bodies: string[]) {
	return handler(buildSqsEvent(bodies.map((body, index) => ({ messageId: `m-${index}`, body }))), buildLambdaContext(), () => {});
}

function handlerWith(outcome: () => Promise<MarkGmailEmailImportedOutcome>) {
	const metricLines: GmailEmailUpdateFailedLine[] = [];
	const updates = initInMemoryGmailMessageUpdate();
	const { published, publishEvent } = capture();
	const logs: { level: string; message: string }[] = [];
	const record = (level: string) => (...args: unknown[]) => {
		logs.push({ level, message: String(args[0]) });
	};
	const handler = initGmailMessageUpdateHandler({
		markImported: outcome,
		listPendingByAccount: updates.listPendingByAccount,
		publishEvent,
		metricLog: { info: () => {}, warn: () => {}, debug: () => {}, error: (line) => { metricLines.push(line); } },
		logger: HutchLogger.from({ info: record("info"), warn: record("warn"), error: record("error"), debug: record("debug") }),
	});
	return { updates, published, metricLines, logs, handler };
}

describe("initGmailMessageUpdateHandler", () => {
	const fact = { userId: USER, receivedAtMessageId: RAM, originKind: "history" };

	it("publishes that the Gmail original was marked", async () => {
		const h = handlerWith(async () => ({ kind: "marked" }));

		assert.deepEqual(await run(h.handler, [markBody]), { batchItemFailures: [] });
		assert.deepEqual(h.published, [{ detailType: "GmailEmailMarkedImported", detail: { ...fact, outcome: "marked" } }]);
	});

	it("acknowledges a deferral instead of failing the record", async () => {
		const h = handlerWith(async () => ({ kind: "deferred", reason: "permission-required" }));

		assert.deepEqual(await run(h.handler, [markBody]), { batchItemFailures: [] });
		assert.deepEqual(h.published, [{ detailType: "GmailEmailUpdateDeferred", detail: { ...fact, reason: "permission-required" } }]);
	});

	it("publishes a recorded failure", async () => {
		const h = handlerWith(async () => ({ kind: "failed", reason: "ambiguous-original" }));

		await run(h.handler, [markBody]);
		assert.deepEqual(h.published, [{ detailType: "GmailEmailUpdateFailed", detail: { ...fact, reason: "ambiguous-original" } }]);
		assert.deepEqual(h.metricLines, [{
			level: "ERROR",
			message: "[gmail-message-update] Gmail original not updated",
			event: "gmail_email_update_failed",
			reason: "ambiguous-original",
			originKind: "history",
			userId: USER,
		}]);
	});

	it("acknowledges an email whose sender has marking off, publishing nothing", async () => {
		const h = handlerWith(async () => ({ kind: "skipped" }));

		assert.deepEqual(await run(h.handler, [markBody]), { batchItemFailures: [] });
		assert.deepEqual(
			{ published: h.published, metricLines: h.metricLines, logs: h.logs },
			{ published: [], metricLines: [], logs: [{ level: "info", message: "[gmail-message-update] marking is off for the sender" }] },
		);
	});

	it("publishes a missing original as a failure but warns instead of metering it", async () => {
		const h = handlerWith(async () => ({ kind: "failed", reason: "original-not-found" }));

		await run(h.handler, [markBody]);
		assert.deepEqual(
			{ published: h.published, metricLines: h.metricLines, warnings: h.logs.filter((log) => log.level === "warn") },
			{
				published: [{ detailType: "GmailEmailUpdateFailed", detail: { ...fact, reason: "original-not-found" } }],
				metricLines: [],
				warnings: [{ level: "warn", message: "[gmail-message-update] Gmail original not found" }],
			},
		);
	});

	it("publishes nothing and logs no failure metric for an update that already failed", async () => {
		const h = handlerWith(async () => ({ kind: "already-failed", reason: "original-not-found" }));

		assert.deepEqual(await run(h.handler, [markBody]), { batchItemFailures: [] });
		assert.deepEqual(h.published, []);
		assert.deepEqual(h.metricLines, []);
	});

	it("fails the record on a transient error so SQS retries it", async () => {
		const h = handlerWith(async () => {
			throw new Error("Gmail unavailable (503)");
		});

		assert.deepEqual(await run(h.handler, [markBody]), { batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});

	it("re-requests every pending update of the granted account", async () => {
		const h = handlerWith(async () => ({ kind: "marked" }));
		await h.updates.recordPending({ userId: USER, receivedAtMessageId: RAM, origin: ORIGIN, now: NOW });
		const other = { ...ORIGIN, accountEmail: GmailAccountEmailSchema.parse("other@gmail.com") };
		await h.updates.recordPending({ userId: USER, receivedAtMessageId: "other", origin: other, now: NOW });

		await run(h.handler, [grantedBody]);

		assert.deepEqual(h.published, [{ detailType: "MarkGmailEmailImported", detail: { userId: USER, receivedAtMessageId: RAM, origin: ORIGIN } }]);
	});

	it("fails a record it cannot parse", async () => {
		const h = handlerWith(async () => ({ kind: "marked" }));

		assert.deepEqual(await run(h.handler, ["{}"]), { batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});
});

describe("initGmailMessageUpdateDlqHandler", () => {
	function dlq() {
		const updates = initInMemoryGmailMessageUpdate();
		const { published, publishEvent } = capture();
		const metricLines: GmailEmailUpdateFailedLine[] = [];
		const handler = initGmailMessageUpdateDlqHandler({
			markFailed: updates.markFailed,
			publishEvent,
			metricLog: { info: () => {}, warn: () => {}, debug: () => {}, error: (line) => { metricLines.push(line); } },
			logger: HutchLogger.from(noopLogger),
			now: () => NOW,
		});
		return { updates, published, metricLines, handler };
	}

	it("records an exhausted update as failed and publishes the failure", async () => {
		const h = dlq();
		await h.updates.recordPending({ userId: USER, receivedAtMessageId: RAM, origin: ORIGIN, now: NOW });

		await run(h.handler, [markBody]);

		assert.equal((await h.updates.find({ userId: USER, origin: ORIGIN }))?.status, "failed");
		assert.deepEqual(h.published, [
			{ detailType: "GmailEmailUpdateFailed", detail: { userId: USER, receivedAtMessageId: RAM, originKind: "history", reason: "dead-lettered" } },
		]);
		assert.deepEqual(h.metricLines.map(({ event, reason }) => ({ event, reason })), [{ event: "gmail_email_update_failed", reason: "dead-lettered" }]);
	});

	it("never turns a completed update into a failure", async () => {
		const h = dlq();
		await h.updates.recordPending({ userId: USER, receivedAtMessageId: RAM, origin: ORIGIN, now: NOW });
		await h.updates.markCompleted({ userId: USER, origin: ORIGIN, now: NOW });

		await run(h.handler, [markBody]);

		assert.equal((await h.updates.find({ userId: USER, origin: ORIGIN }))?.status, "completed");
		assert.deepEqual(h.published, []);
		assert.deepEqual(h.metricLines, []);
	});

	it("reports an update that already failed only once", async () => {
		const h = dlq();
		await h.updates.recordPending({ userId: USER, receivedAtMessageId: RAM, origin: ORIGIN, now: NOW });

		await run(h.handler, [markBody]);
		await run(h.handler, [markBody]);

		assert.equal(h.published.length, 1);
		assert.equal(h.metricLines.length, 1);
	});

	it("acknowledges a dead-lettered permission resume, leaving its updates pending", async () => {
		const h = dlq();
		await h.updates.recordPending({ userId: USER, receivedAtMessageId: RAM, origin: ORIGIN, now: NOW });

		assert.deepEqual(await run(h.handler, [grantedBody]), { batchItemFailures: [] });
		assert.equal((await h.updates.find({ userId: USER, origin: ORIGIN }))?.status, "pending");
		assert.deepEqual(h.published, []);
	});

	it("fails a dead letter it cannot parse", async () => {
		const h = dlq();

		assert.deepEqual(await run(h.handler, ["not json"]), { batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});
});
