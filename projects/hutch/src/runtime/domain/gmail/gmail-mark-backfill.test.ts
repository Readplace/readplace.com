import assert from "node:assert/strict";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailMarkBackfillCounts,
	type GmailMarkBackfillRef,
	type GmailMessageId,
	GmailMessageIdSchema,
	type GmailMessageOrigin,
	ZERO_GMAIL_MARK_BACKFILL_COUNTS,
} from "@packages/domain/gmail";
import { ISSUE_OUTPUT_KEY, InboxAddressSchema, MessageIdSchema, NormalizedMessageIdSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger } from "@packages/hutch-logger";
import type { GmailApiResult } from "@packages/provider-contracts/gmail-filters";
import type { GmailMessageCandidate, OpenedGmailMailbox, OpenGmailMailboxResult } from "@packages/provider-contracts/gmail-message-update";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailMarkBackfill, initInMemoryGmailMessageUpdate } from "@packages/test-fixtures/providers/gmail-history-import";
import { initInMemoryGmailMapping } from "@packages/test-fixtures/providers/gmail-mapping";
import { initInMemoryEmailImportCompletion, initInMemoryInboxEmail, initInMemoryInboxEmailLink } from "@packages/test-fixtures/providers/inbox-email";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initGmailMarkBackfillDlqHandler, initGmailMarkBackfillHandler } from "./gmail-mark-backfill";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const SENDER = ForwardableSenderSchema.parse("dan@news.test");
const REF: GmailMarkBackfillRef = { userId: USER, accountEmail: ACCOUNT, senderEmail: SENDER };
const GATEWAY = InboxAddressSchema.parse("gmail-abc123@read.place");
const OPTION_ON = "2026-10-26T12:00:00.000Z";
const LABEL = "Label_42";

type MailboxOperation = "findMessage" | "search" | "findLabelId" | "createLabel" | "modify";

function fakeMailbox() {
	const messages = new Map<GmailMessageId, { messageIdHeader: string; fromHeader: string; labelIds: string[] }>();
	const failNext = new Map<MailboxOperation, GmailApiResult<never>>();
	const beforeModify: (() => void | Promise<void>)[] = [];
	const failure = (operation: MailboxOperation) => {
		const next = failNext.get(operation);
		failNext.delete(operation);
		return next;
	};
	const mailbox: OpenedGmailMailbox = {
		findMessage: async ({ messageId }) => failure("findMessage") ?? { ok: true, value: { found: messages.has(messageId) } },
		searchByRfcMessageId: async ({ senderEmail }) => {
			const failed = failure("search");
			if (failed) return failed;
			const candidates: GmailMessageCandidate[] = [...messages.entries()]
				.filter(([, message]) => message.fromHeader.includes(senderEmail))
				.map(([id, message]) => ({ id, messageIdHeader: message.messageIdHeader, fromHeader: message.fromHeader }));
			return { ok: true, value: candidates };
		},
		findLabelId: async () => failure("findLabelId") ?? { ok: true, value: LABEL },
		createLabel: async () => failure("createLabel") ?? { ok: true, value: { created: LABEL } },
		modifyMessage: async ({ messageId, addLabelIds, removeLabelIds }) => {
			await beforeModify.shift()?.();
			const failed = failure("modify");
			if (failed) return failed;
			const message = messages.get(messageId);
			assert(message);
			message.labelIds = [...message.labelIds.filter((label) => !removeLabelIds.includes(label)), ...addLabelIds];
			return { ok: true, value: undefined };
		},
	};
	return { messages, failNext, beforeModify, mailbox };
}

function receivedAtMessageId(day: number, messageId: string): string {
	return `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z#<${messageId}>`;
}

async function harness(opts: { open?: (fake: ReturnType<typeof fakeMailbox>) => OpenGmailMailboxResult | Promise<OpenGmailMailboxResult> } = {}) {
	let clock = new Date(OPTION_ON);
	const now = () => clock;
	const backfills = initInMemoryGmailMarkBackfill();
	const updates = initInMemoryGmailMessageUpdate();
	const connections = initInMemoryGmailConnection({ now });
	const mappings = initInMemoryGmailMapping({ now });
	const inbox = initInMemoryInboxEmail();
	const completions = initInMemoryEmailImportCompletion({ getEmail: inbox.getEmail, listEmailsByUserId: inbox.listEmailsByUserId });
	const links = initInMemoryInboxEmailLink();
	const fake = fakeMailbox();

	await connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });
	await connections.recordAccountEmail({ userId: USER, accountEmail: ACCOUNT });
	await mappings.mapSenderToAddress({ ...REF, mappedAddresses: [GATEWAY], deliveryMode: "issue" });
	await mappings.setMarkImported(REF);
	const started = await backfills.startBackfill({ ...REF, optionEnabledAt: OPTION_ON, now: now() });
	assert(started.started);
	clock = new Date("2026-10-27T00:00:00.000Z");

	const published: { detailType: string; detail: unknown }[] = [];
	const publishFailures: Error[] = [];
	const publishEvent = (async (event, detail) => {
		const failure = publishFailures.shift();
		if (failure) throw failure;
		published.push({ detailType: event.detailType, detail });
	}) as PublishEvent;
	const dispatched: unknown[] = [];
	const logs: { level: string; message: string; context: unknown }[] = [];
	const record = (level: string) => (message: unknown, context: unknown) => {
		logs.push({ level, message: String(message), context });
	};
	const handler = initGmailMarkBackfillHandler({
		backfills,
		updates,
		connections,
		mappings,
		findMarkImportedSince: async (input) => (await mappings.findMapping(input))?.markImportedAt,
		completions,
		links,
		openMailbox: async () => (await opts.open?.(fake)) ?? { ok: true, mailbox: fake.mailbox },
		dispatchPage: async (detail) => {
			dispatched.push(detail);
		},
		publishEvent,
		logger: HutchLogger.from({ info: record("info"), warn: record("warn"), error: record("error"), debug: record("debug") }),
		now,
	});

	async function seedEmail(input: {
		day: number;
		messageId: string;
		senderEmail?: string;
		saved?: boolean;
		selected?: boolean;
		origins?: GmailMessageOrigin[];
		inGmail?: number;
	}) {
		const ram = receivedAtMessageId(input.day, input.messageId);
		await inbox.putEmail({
			userId: USER,
			receivedAtMessageId: ram,
			messageId: MessageIdSchema.parse(`<${input.messageId}>`),
			recipientAddress: GATEWAY,
			gmailDestinationAddresses: [GATEWAY],
			gmailDeliveryMode: "issue",
			senderEmail: input.senderEmail ?? SENDER,
			subject: "Issue",
			status: "received",
			receivedAt: ram.split("#")[0] ?? "",
			rawEmailS3Key: `raw/${input.messageId}`,
			bodyS3Key: `body/${input.messageId}`,
			linkCounts: undefined,
		});
		if (input.selected !== false) await completions.selectOutputs({ userId: USER, receivedAtMessageId: ram, selection: { outputs: [ISSUE_OUTPUT_KEY], truncated: false, selectedAt: ram } });
		if (input.selected !== false && input.saved !== false) await completions.acknowledgeOutput({ userId: USER, receivedAtMessageId: ram, output: ISSUE_OUTPUT_KEY });
		await completions.addGmailOrigins({ userId: USER, receivedAtMessageId: ram, origins: input.origins ?? [] });
		for (let copy = 0; copy < (input.inGmail ?? 1); copy += 1) {
			fake.messages.set(GmailMessageIdSchema.parse(`${input.messageId.replace(/\W/g, "")}${copy}`), {
				messageIdHeader: `<${input.messageId}>`,
				fromHeader: `News <${SENDER}>`,
				labelIds: ["INBOX", "UNREAD"],
			});
		}
		return ram;
	}

	const forwarded = (messageId: string): GmailMessageOrigin => ({
		kind: "forwarded",
		accountEmail: ACCOUNT,
		rfcMessageId: NormalizedMessageIdSchema.parse(messageId),
		senderEmail: SENDER,
	});

	const run = (body: unknown) =>
		handler(buildSqsEvent([{ messageId: "m-0", body: JSON.stringify(body) }]), buildLambdaContext(), () => {});
	const runPage = (page = 0, generation = 1) => run({ detail: { ...REF, generation, page } });
	const job = async () => {
		const found = await backfills.findBackfill(REF);
		assert(found);
		return found;
	};

	return {
		backfills,
		updates,
		connections,
		mappings,
		links,
		fake,
		published,
		publishFailures,
		dispatched,
		logs,
		seedEmail,
		forwarded,
		run,
		runPage,
		job,
		advance: (ms: number) => {
			clock = new Date(clock.getTime() + ms);
		},
	};
}

function counts(overrides: Partial<GmailMarkBackfillCounts>): GmailMarkBackfillCounts {
	return { ...ZERO_GMAIL_MARK_BACKFILL_COUNTS, ...overrides };
}

function contextField(context: unknown, field: string): unknown {
	return typeof context === "object" && context !== null && field in context ? Object.entries(context).find(([key]) => key === field)?.[1] : undefined;
}

function skippedReasons(logs: { message: string; context: unknown }[]): unknown[] {
	return logs.filter((log) => log.message === "[gmail-mark-backfill] page skipped").map((log) => contextField(log.context, "reason"));
}

describe("initGmailMarkBackfillHandler", () => {
	describe("start", () => {
		const start = (generation: number) => ({ "detail-type": "StartGmailMarkBackfill", detail: { ...REF, generation } });

		it("dispatches the first page of a queued backfill", async () => {
			const h = await harness();

			assert.deepEqual(await h.run(start(1)), { batchItemFailures: [] });

			assert.deepEqual(h.dispatched, [{ ...REF, generation: 1, page: 0 }]);
		});

		it("acknowledges a start for a backfill that does not exist", async () => {
			const h = await harness();
			await h.backfills.cancelBackfill({ ...REF, generation: undefined, reason: "option-off", now: new Date() });
			const other = { ...start(1), detail: { ...REF, senderEmail: "kate@news.test", generation: 1 } };

			await h.run(other);

			assert.deepEqual(skippedReasons(h.logs), ["job-missing"]);
		});

		it("acknowledges a start for an older generation", async () => {
			const h = await harness();

			await h.run(start(2));

			assert.deepEqual(skippedReasons(h.logs), ["generation-stale"]);
		});

		it("acknowledges a start for a backfill that is no longer queued", async () => {
			const h = await harness();
			await h.backfills.cancelBackfill({ ...REF, generation: undefined, reason: "option-off", now: new Date() });

			await h.run(start(1));

			assert.deepEqual(skippedReasons(h.logs), ["not-runnable"]);
		});
	});

	it("dispatches the next page a processed page names", async () => {
		const h = await harness();

		await h.run({ "detail-type": "GmailMarkBackfillPageProcessed", detail: { ...REF, nextPage: { generation: 1, page: 3 } } });

		assert.deepEqual(h.dispatched, [{ ...REF, generation: 1, page: 3 }]);
	});

	describe("page guards", () => {
		it("acknowledges a page for a backfill that does not exist", async () => {
			const h = await harness();

			await h.run({ detail: { ...REF, senderEmail: "kate@news.test", generation: 1, page: 0 } });

			assert.deepEqual(skippedReasons(h.logs), ["job-missing"]);
		});

		it("acknowledges a page of an older generation", async () => {
			const h = await harness();

			await h.runPage(0, 2);

			assert.deepEqual(skippedReasons(h.logs), ["generation-stale"]);
		});

		it("acknowledges a page of a finished backfill", async () => {
			const h = await harness();
			await h.backfills.failBackfill({ ...REF, generation: 1, reason: "gmail-rejected", now: new Date() });

			await h.runPage();

			assert.deepEqual(skippedReasons(h.logs), ["not-runnable"]);
		});

		it("acknowledges a page that was already processed", async () => {
			const h = await harness();
			await h.backfills.claimPage({ ...REF, generation: 1, page: 0, now: new Date("2026-10-27T00:00:00.000Z") });
			await h.backfills.savePage({ ...REF, generation: 1, page: 0, cursor: OPTION_ON, counts: ZERO_GMAIL_MARK_BACKFILL_COUNTS, now: new Date() });

			await h.runPage(0);

			assert.deepEqual(skippedReasons(h.logs), ["page-already-processed"]);
		});

		it("acknowledges a page that runs ahead of the backfill", async () => {
			const h = await harness();

			await h.runPage(1);

			assert.deepEqual(skippedReasons(h.logs), ["page-mismatch"]);
		});

		it("acknowledges a page another invocation holds", async () => {
			const h = await harness();
			await h.backfills.claimPage({ ...REF, generation: 1, page: 0, now: new Date("2026-10-27T00:00:00.000Z") });

			await h.runPage();

			assert.deepEqual(skippedReasons(h.logs), ["claim-lost"]);
		});
	});

	describe("re-checks before a page", () => {
		it("cancels when Gmail was disconnected", async () => {
			const h = await harness();
			await h.connections.markDisconnectRequested({ userId: USER });

			await h.runPage();

			assert.deepEqual([(await h.job()).state, (await h.job()).cancelReason], ["cancelled", "disconnected"]);
		});

		it("cancels when Gmail now points to another account", async () => {
			const h = await harness();
			await h.connections.recordAccountEmail({ userId: USER, accountEmail: GmailAccountEmailSchema.parse("someone@gmail.com") });

			await h.runPage();

			assert.equal((await h.job()).cancelReason, "disconnected");
		});

		it("cancels when the mapping was removed", async () => {
			const h = await harness();
			await h.mappings.removeMapping(REF);

			await h.runPage();

			assert.equal((await h.job()).cancelReason, "mapping-removed");
		});

		it("cancels when marking was turned off", async () => {
			const h = await harness();
			await h.mappings.clearMarkImported(REF);

			await h.runPage();

			assert.equal((await h.job()).cancelReason, "option-off");
		});

		it("cancels when marking was turned off and on again", async () => {
			const h = await harness();
			await h.mappings.clearMarkImported(REF);
			await h.mappings.setMarkImported(REF);

			await h.runPage();

			assert.equal((await h.job()).cancelReason, "option-off");
		});
	});

	describe("opening the mailbox", () => {
		it("cancels when the mailbox is no longer connected", async () => {
			const h = await harness({ open: () => ({ ok: false, reason: "not-connected" }) });

			await h.runPage();

			assert.equal((await h.job()).cancelReason, "disconnected");
		});

		it("cancels when the mailbox belongs to another account", async () => {
			const h = await harness({ open: () => ({ ok: false, reason: "account-mismatch" }) });

			await h.runPage();

			assert.equal((await h.job()).cancelReason, "disconnected");
		});

		it("fails as permission revoked when Gmail no longer allows marking", async () => {
			const h = await harness({ open: () => ({ ok: false, reason: "modify-permission-required" }) });

			await h.runPage();

			assert.deepEqual([(await h.job()).state, (await h.job()).failureReason], ["failed", "permission-revoked"]);
		});

		it("records the revoked connection and fails as permission revoked when Google refuses the grant", async () => {
			const h = await harness({ open: () => ({ ok: false, reason: "reauth-required" }) });

			await h.runPage();

			assert.equal((await h.job()).failureReason, "permission-revoked");
			assert.equal((await h.connections.findConnectionByUserId(USER))?.revokedReason, "invalid-grant");
		});

		it("cancels when Google refuses the grant of a connection that was disconnected meanwhile", async () => {
			let disconnect: () => Promise<void> = async () => {};
			const h = await harness({
				open: async () => {
					await disconnect();
					return { ok: false, reason: "reauth-required" };
				},
			});
			disconnect = () => h.connections.markDisconnectRequested({ userId: USER });

			await h.runPage();

			assert.equal((await h.job()).cancelReason, "disconnected");
		});

		it("retries the page while Gmail is unavailable", async () => {
			const h = await harness({ open: () => ({ ok: false, reason: "unavailable", status: 503 }) });

			assert.deepEqual(await h.runPage(), { batchItemFailures: [{ itemIdentifier: "m-0" }] });
			assert.equal((await h.job()).state, "running");
		});

		it("fails as Gmail rejected when the label cannot be resolved", async () => {
			const h = await harness();
			h.fake.failNext.set("findLabelId", { ok: false, reason: "rejected", status: 400, message: "Invalid label" });

			await h.runPage();

			assert.equal((await h.job()).failureReason, "gmail-rejected");
		});

		it("fails as permission revoked when Google refuses the grant while resolving the label", async () => {
			const h = await harness();
			h.fake.failNext.set("findLabelId", { ok: false, reason: "reauth-required" });

			await h.runPage();

			assert.equal((await h.job()).failureReason, "permission-revoked");
		});
	});

	describe("marking emails", () => {
		it("labels a saved email, marks it read and completes the backfill", async () => {
			const h = await harness();
			const ram = await h.seedEmail({ day: 1, messageId: "issue1@news.test" });

			assert.deepEqual(await h.runPage(), { batchItemFailures: [] });

			assert.deepEqual([...h.fake.messages.values()].map((message) => message.labelIds), [["INBOX", LABEL]]);
			assert.equal((await h.updates.find({ userId: USER, origin: h.forwarded("issue1@news.test") }))?.receivedAtMessageId, ram);
			const job = await h.job();
			assert.deepEqual([job.state, job.counts], ["complete", counts({ marked: 1 })]);
		});

		it("marks a history import through its recorded Gmail message", async () => {
			const h = await harness();
			const origin: GmailMessageOrigin = { kind: "history", accountEmail: ACCOUNT, gmailMessageId: GmailMessageIdSchema.parse("issue2newstest0"), senderEmail: SENDER };
			await h.seedEmail({ day: 1, messageId: "issue2@news.test", origins: [origin] });

			await h.runPage();

			assert.deepEqual((await h.job()).counts, counts({ marked: 1 }));
		});

		it("counts an email marked before as already marked", async () => {
			const h = await harness();
			await h.seedEmail({ day: 1, messageId: "issue1@news.test" });
			await h.updates.recordPending({ userId: USER, receivedAtMessageId: "earlier", origin: h.forwarded("issue1@news.test"), now: new Date() });
			await h.updates.markCompleted({ userId: USER, origin: h.forwarded("issue1@news.test"), now: new Date() });

			await h.runPage();

			assert.deepEqual((await h.job()).counts, counts({ alreadyMarked: 1 }));
		});

		it("counts an email whose original was not found before as not found", async () => {
			const h = await harness();
			await h.seedEmail({ day: 1, messageId: "issue1@news.test" });
			await h.updates.recordPending({ userId: USER, receivedAtMessageId: "earlier", origin: h.forwarded("issue1@news.test"), now: new Date() });
			await h.updates.markFailed({ userId: USER, origin: h.forwarded("issue1@news.test"), reason: "original-not-found", now: new Date() });

			await h.runPage();

			assert.deepEqual((await h.job()).counts, counts({ notFound: 1 }));
		});

		it("counts an email that failed before for another reason as failed", async () => {
			const h = await harness();
			await h.seedEmail({ day: 1, messageId: "issue1@news.test" });
			await h.updates.recordPending({ userId: USER, receivedAtMessageId: "earlier", origin: h.forwarded("issue1@news.test"), now: new Date() });
			await h.updates.markFailed({ userId: USER, origin: h.forwarded("issue1@news.test"), reason: "gmail-rejected", now: new Date() });

			await h.runPage();

			assert.deepEqual((await h.job()).counts, counts({ failed: 1 }));
		});

		it("records and counts an email whose original is gone as not found", async () => {
			const h = await harness();
			await h.seedEmail({ day: 1, messageId: "issue1@news.test", inGmail: 0 });

			await h.runPage();

			assert.deepEqual((await h.job()).counts, counts({ notFound: 1 }));
			assert.equal((await h.updates.find({ userId: USER, origin: h.forwarded("issue1@news.test") }))?.status, "failed");
		});

		it("counts an email with more than one possible original as failed", async () => {
			const h = await harness();
			await h.seedEmail({ day: 1, messageId: "issue1@news.test", inGmail: 2 });

			await h.runPage();

			assert.deepEqual((await h.job()).counts, counts({ failed: 1 }));
		});

		it("counts an email once, under the worst outcome of its originals", async () => {
			const h = await harness();
			const found: GmailMessageOrigin = { kind: "history", accountEmail: ACCOUNT, gmailMessageId: GmailMessageIdSchema.parse("issue1newstest0"), senderEmail: SENDER };
			const gone: GmailMessageOrigin = { ...found, gmailMessageId: GmailMessageIdSchema.parse("gone") };
			await h.seedEmail({ day: 1, messageId: "issue1@news.test", origins: [found, gone] });

			await h.runPage();

			assert.deepEqual((await h.job()).counts, counts({ notFound: 1 }));
		});

		it("counts unsaved and unlocatable emails and leaves other emails uncounted", async () => {
			const h = await harness();
			const elsewhere: GmailMessageOrigin = { kind: "history", accountEmail: GmailAccountEmailSchema.parse("someone@gmail.com"), gmailMessageId: GmailMessageIdSchema.parse("x"), senderEmail: SENDER };
			await h.seedEmail({ day: 1, messageId: "unsaved@news.test", saved: false });
			await h.seedEmail({ day: 2, messageId: "elsewhere@news.test", origins: [elsewhere] });
			await h.seedEmail({ day: 3, messageId: "other@news.test", senderEmail: "kate@news.test" });

			await h.runPage();

			assert.deepEqual((await h.job()).counts, counts({ notSaved: 1, unlocatable: 1 }));
		});

		it("reads the links meta of an email saved before selections were recorded", async () => {
			const h = await harness();
			const saved = await h.seedEmail({ day: 2, messageId: "saved@news.test", selected: false });
			const failed = await h.seedEmail({ day: 1, messageId: "failed@news.test", selected: false });
			const meta = { truncated: false, savesHeld: false, issueSave: { readlists: [], held: false } };
			await h.links.putLinksMeta({ userId: USER, receivedAtMessageId: saved, meta: { ...meta, extractionFailed: false } });
			await h.links.putLinksMeta({ userId: USER, receivedAtMessageId: failed, meta: { ...meta, extractionFailed: true } });

			await h.runPage();

			assert.deepEqual((await h.job()).counts, counts({ marked: 1, notSaved: 1 }));
		});

		it("leaves emails received after marking was turned on to the live path", async () => {
			const h = await harness();
			await h.seedEmail({ day: 27, messageId: "later@news.test" });

			await h.runPage();

			assert.deepEqual((await h.job()).counts, ZERO_GMAIL_MARK_BACKFILL_COUNTS);
		});

		it("cancels without saving the page when marking is turned off mid-page", async () => {
			const h = await harness();
			await h.seedEmail({ day: 2, messageId: "issue2@news.test" });
			await h.seedEmail({ day: 1, messageId: "issue1@news.test" });
			h.fake.beforeModify.push(() => {
				void h.mappings.clearMarkImported(REF);
			});

			await h.runPage();

			const job = await h.job();
			assert.deepEqual([job.cancelReason, job.counts, job.page], ["option-off", ZERO_GMAIL_MARK_BACKFILL_COUNTS, 0]);
		});

		it("leaves a newer backfill queued when marking is turned off and on again mid-page", async () => {
			const h = await harness();
			await h.seedEmail({ day: 2, messageId: "issue2@news.test" });
			await h.seedEmail({ day: 1, messageId: "issue1@news.test" });
			h.fake.beforeModify.push(async () => {
				await h.mappings.clearMarkImported(REF);
				await h.backfills.cancelBackfill({ ...REF, generation: undefined, reason: "option-off", now: new Date() });
				await h.mappings.setMarkImported(REF);
				const mapping = await h.mappings.findMapping(REF);
				assert(mapping?.markImportedAt);
				await h.backfills.startBackfill({ ...REF, optionEnabledAt: mapping.markImportedAt, now: new Date() });
			});

			await h.runPage();

			const job = await h.job();
			assert.deepEqual([job.generation, job.state], [2, "queued"]);
		});

		it("fails as permission revoked when Google refuses the grant while marking", async () => {
			const h = await harness();
			await h.seedEmail({ day: 1, messageId: "issue1@news.test" });
			h.fake.failNext.set("modify", { ok: false, reason: "reauth-required" });

			await h.runPage();

			assert.equal((await h.job()).failureReason, "permission-revoked");
		});

		it("retries the page when Gmail is unavailable while marking", async () => {
			const h = await harness();
			await h.seedEmail({ day: 1, messageId: "issue1@news.test" });
			h.fake.failNext.set("modify", { ok: false, reason: "unavailable", status: 503 });

			assert.deepEqual(await h.runPage(), { batchItemFailures: [{ itemIdentifier: "m-0" }] });
		});
	});

	describe("paging", () => {
		it("hands the next page on after 25 marked emails and continues from where it stopped", async () => {
			const h = await harness();
			for (let day = 1; day <= 26; day += 1) await h.seedEmail({ day, messageId: `issue${day}@news.test` });

			await h.runPage(0);

			assert.deepEqual(h.published, [{ detailType: "GmailMarkBackfillPageProcessed", detail: { ...REF, nextPage: { generation: 1, page: 1 } } }]);
			const saved = await h.job();
			assert.deepEqual([saved.page, saved.cursor, saved.counts], [1, receivedAtMessageId(2, "issue2@news.test"), counts({ marked: 25 })]);

			h.advance(60_000);
			await h.runPage(1);

			const finished = await h.job();
			assert.deepEqual([finished.state, finished.counts], ["complete", counts({ marked: 26 })]);
		});

		it("hands the next page on after reading 400 rows", async () => {
			const h = await harness();
			for (let index = 0; index < 401; index += 1) {
				await h.seedEmail({ day: 1 + (index % 25), messageId: `other${index}@news.test`, senderEmail: "kate@news.test" });
			}

			await h.runPage(0);

			assert.deepEqual((await h.job()).page, 1);
		});

		it("hands the next page on when its time budget runs out", async () => {
			const h = await harness();
			await h.seedEmail({ day: 2, messageId: "issue2@news.test" });
			await h.seedEmail({ day: 1, messageId: "issue1@news.test" });
			h.fake.beforeModify.push(() => h.advance(40_000));

			await h.runPage(0);

			const job = await h.job();
			assert.deepEqual([job.page, job.cursor, job.counts], [1, receivedAtMessageId(2, "issue2@news.test"), counts({ marked: 1 })]);
		});

		it("leaves the page unsaved when the next page cannot be handed on", async () => {
			const h = await harness();
			for (let day = 1; day <= 26; day += 1) await h.seedEmail({ day, messageId: `issue${day}@news.test` });
			h.publishFailures.push(new Error("EventBridge down"));

			assert.deepEqual(await h.runPage(0), { batchItemFailures: [{ itemIdentifier: "m-0" }] });

			assert.deepEqual((await h.job()).page, 0);
		});
	});
});

describe("initGmailMarkBackfillDlqHandler", () => {
	async function dlq() {
		const backfills = initInMemoryGmailMarkBackfill();
		await backfills.startBackfill({ ...REF, optionEnabledAt: OPTION_ON, now: new Date(OPTION_ON) });
		const logs: { message: string; context: unknown }[] = [];
		const record = (message: unknown, context: unknown) => {
			logs.push({ message: String(message), context });
		};
		const handler = initGmailMarkBackfillDlqHandler({
			failBackfill: backfills.failBackfill,
			logger: HutchLogger.from({ info: record, warn: record, error: record, debug: record }),
			now: () => new Date("2026-10-27T00:00:00.000Z"),
		});
		const run = (body: string) => handler(buildSqsEvent([{ messageId: "m-0", body }]), buildLambdaContext(), () => {});
		return { backfills, logs, run };
	}

	it("fails a dead-lettered page's backfill", async () => {
		const h = await dlq();

		assert.deepEqual(await h.run(JSON.stringify({ detail: { ...REF, generation: 1, page: 0 } })), { batchItemFailures: [] });

		assert.equal((await h.backfills.findBackfill(REF))?.failureReason, "dead-lettered");
	});

	it("fails the backfill a dead-lettered progress event belongs to", async () => {
		const h = await dlq();

		await h.run(JSON.stringify({ "detail-type": "GmailMarkBackfillPageProcessed", detail: { ...REF, nextPage: { generation: 1, page: 2 } } }));

		assert.equal((await h.backfills.findBackfill(REF))?.state, "failed");
	});

	it("leaves a backfill that already stopped unchanged", async () => {
		const h = await dlq();

		const deadLetter = JSON.stringify({ "detail-type": "StartGmailMarkBackfill", detail: { ...REF, generation: 1 } });
		await h.run(deadLetter);
		await h.run(deadLetter);

		assert.deepEqual(h.logs.map((log) => contextField(log.context, "result")), ["failed", "unchanged"]);
	});

	it("retries a record it cannot read", async () => {
		const h = await dlq();

		assert.deepEqual(await h.run("not json"), { batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});
});
