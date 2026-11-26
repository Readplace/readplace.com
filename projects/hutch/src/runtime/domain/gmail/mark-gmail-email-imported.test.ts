import assert from "node:assert/strict";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	GmailHistoryImportJobIdSchema,
	type GmailMessageId,
	GmailMessageIdSchema,
	type GmailMessageOrigin,
} from "@packages/domain/gmail";
import { InboxAddressSchema, NormalizedMessageIdSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { GmailApiResult } from "@packages/provider-contracts/gmail-filters";
import type { GmailMessageCandidate, OpenedGmailMailbox, OpenGmailMailboxResult } from "@packages/provider-contracts/gmail-message-update";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailMessageUpdate } from "@packages/test-fixtures/providers/gmail-history-import";
import { initMarkGmailEmailImported } from "./mark-gmail-email-imported";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const RAM = "2026-10-27T00:00:00.000Z#<issue@news.test>";
const NOW = new Date("2026-10-27T01:00:00.000Z");
const MESSAGE = GmailMessageIdSchema.parse("18c2f0a1b2c3d4e5");
const HISTORY: GmailMessageOrigin = { kind: "history", accountEmail: ACCOUNT, gmailMessageId: MESSAGE, senderEmail: ForwardableSenderSchema.parse("dan@news.test") };
const FORWARDED: GmailMessageOrigin = {
	kind: "forwarded",
	accountEmail: ACCOUNT,
	senderEmail: ForwardableSenderSchema.parse("dan@news.test"),
	rfcMessageId: NormalizedMessageIdSchema.parse("issue@news.test"),
};

interface FakeMailbox {
	messages: Map<GmailMessageId, { labelIds: string[]; messageIdHeader: string; fromHeader: string }>;
	labels: { id: string; name: string }[];
	calls: string[];
	failNext: Map<string, GmailApiResult<never>>;
	createConflictWithLabel: { id: string; name: string } | undefined;
	createConflictLeavesNoLabel: boolean;
}

function fakeMailbox(): FakeMailbox & { mailbox: OpenedGmailMailbox } {
	const state: FakeMailbox = {
		messages: new Map([[MESSAGE, { labelIds: ["INBOX", "UNREAD", "CATEGORY_UPDATES"], messageIdHeader: "<issue@news.test>", fromHeader: "News <dan@news.test>" }]]),
		labels: [],
		calls: [],
		failNext: new Map(),
		createConflictWithLabel: undefined,
		createConflictLeavesNoLabel: false,
	};
	const failure = (name: string) => {
		const next = state.failNext.get(name);
		state.failNext.delete(name);
		return next;
	};
	const mailbox: OpenedGmailMailbox = {
		findMessage: async ({ messageId }) => {
			const message = state.messages.get(messageId);
			return failure("findMessage") ?? { ok: true, value: message ? { found: true, labelIds: message.labelIds } : { found: false } };
		},
		searchByRfcMessageId: async ({ senderEmail }) => {
			state.calls.push("search");
			const failed = failure("search");
			if (failed) return failed;
			const candidates: GmailMessageCandidate[] = [...state.messages.entries()]
				.filter(([, message]) => message.fromHeader.includes(senderEmail))
				.map(([id, message]) => ({ id, messageIdHeader: message.messageIdHeader, fromHeader: message.fromHeader }));
			return { ok: true, value: candidates };
		},
		findLabelId: async ({ name }) => {
			state.calls.push("find-label");
			return failure("findLabelId") ?? { ok: true, value: state.labels.find((label) => label.name === name)?.id };
		},
		createLabel: async ({ name }) => {
			state.calls.push("create-label");
			const failed = failure("createLabel");
			if (failed) return failed;
			if (state.createConflictLeavesNoLabel) return { ok: true, value: { conflict: true } };
			if (state.createConflictWithLabel !== undefined) {
				state.labels.push(state.createConflictWithLabel);
				return { ok: true, value: { conflict: true } };
			}
			state.labels.push({ id: "Label_42", name });
			return { ok: true, value: { created: "Label_42" } };
		},
		modifyMessage: async ({ messageId, addLabelIds, removeLabelIds }) => {
			state.calls.push(`modify:${messageId}:+${addLabelIds.join(",")}:-${removeLabelIds.join(",")}`);
			const failed = failure("modify");
			if (failed) return failed;
			const message = state.messages.get(messageId);
			assert(message);
			message.labelIds = [...new Set([...message.labelIds.filter((label) => !removeLabelIds.includes(label)), ...addLabelIds])];
			return { ok: true, value: undefined };
		},
	};
	return Object.assign(state, { mailbox });
}

async function harness(
	opts: {
		open?: (fake: ReturnType<typeof fakeMailbox>) => OpenGmailMailboxResult;
		connectedAs?: typeof ACCOUNT | undefined;
		mapped?: boolean;
	} = {},
) {
	const updates = initInMemoryGmailMessageUpdate();
	const connections = initInMemoryGmailConnection({ now: () => NOW });
	const connectedAs = "connectedAs" in opts ? opts.connectedAs : ACCOUNT;
	if (connectedAs !== undefined) {
		await connections.createConnection({ userId: USER, gatewayAddress: InboxAddressSchema.parse("gmail-abc123@read.place") });
		await connections.recordAccountEmail({ userId: USER, accountEmail: connectedAs });
	}
	const fake = fakeMailbox();
	const opened: { accountEmail: string }[] = [];
	const gateChecks: unknown[] = [];
	const mapped = opts.mapped ?? true;
	const mark = initMarkGmailEmailImported({
		updates,
		isSenderMapped: async (input) => {
			gateChecks.push(input);
			return mapped;
		},
		connections,
		openMailbox: async (input) => {
			opened.push({ accountEmail: input.accountEmail });
			return opts.open?.(fake) ?? { ok: true, mailbox: fake.mailbox };
		},
		now: () => NOW,
	});
	return { updates, connections, fake, opened, gateChecks, mark: (origin: GmailMessageOrigin = HISTORY, supplemental?: true) => mark({ userId: USER, receivedAtMessageId: RAM, origin, ...(supplemental ? { supplemental } : {}) }) };
}

describe("initMarkGmailEmailImported", () => {
	it("asks the mapping of the email's account and sender whether the sender is configured", async () => {
		const h = await harness();

		await h.mark(FORWARDED);

		assert.deepEqual(h.gateChecks, [{ userId: USER, accountEmail: ACCOUNT, senderEmail: FORWARDED.senderEmail }]);
	});

	it("skips the email without recording or touching Gmail when its sender is no longer configured", async () => {
		const h = await harness({ mapped: false });

		assert.deepEqual(await h.mark(), { kind: "skipped" });

		assert.deepEqual({ records: h.updates.all(), opened: h.opened, calls: h.fake.calls }, { records: [], opened: [], calls: [] });
	});

	it("marks the same Gmail message after a second import and ignores old and new redeliveries", async () => {
		const h = await harness();
		assert.deepEqual(await h.mark(), { kind: "marked" });
		const original = h.fake.messages.get(MESSAGE);
		assert(original);
		original.labelIds.push("UNREAD");

		assert.deepEqual(await h.mark(), { kind: "already-marked" });
		assert.ok(original.labelIds.includes("UNREAD"));
		assert.deepEqual(await h.mark(HISTORY, true), { kind: "marked" });
		assert.equal(original.labelIds.includes("UNREAD"), false);
		original.labelIds.push("UNREAD");

		assert.deepEqual(await h.mark(HISTORY, true), { kind: "already-marked" });
		assert.ok(original.labelIds.includes("UNREAD"));
		assert.equal(h.fake.calls.filter((call) => call.startsWith("modify:")).length, 2);
	});

	it("leaves Gmail unread when the sender is no longer configured for the second import", async () => {
		const h = await harness({ mapped: false });
		assert.deepEqual(await h.mark(HISTORY, true), { kind: "skipped" });
		assert.ok(h.fake.messages.get(MESSAGE)?.labelIds.includes("UNREAD"));
		assert.deepEqual(h.fake.calls, []);
		assert.deepEqual(h.updates.all(), []);
	});

		it("discards a pending update left from before the sender was removed", async () => {
		const updates = initInMemoryGmailMessageUpdate();
		await updates.recordPending({ userId: USER, receivedAtMessageId: RAM, origin: HISTORY, now: NOW });
		const mark = initMarkGmailEmailImported({
			updates,
			isSenderMapped: async () => false,
			connections: initInMemoryGmailConnection({ now: () => NOW }),
			openMailbox: async () => ({ ok: false, reason: "not-connected" }),
			now: () => NOW,
		});

		assert.deepEqual(await mark({ userId: USER, receivedAtMessageId: RAM, origin: HISTORY }), { kind: "skipped" });

		assert.deepEqual(updates.all(), []);
	});

	it("creates the label on first use, adds it and removes UNREAD in one request, then records completion", async () => {
		const h = await harness();

		assert.deepEqual(await h.mark(), { kind: "marked" });

		assert.deepEqual(h.fake.calls, ["find-label", "create-label", `modify:${MESSAGE}:+Label_42:-UNREAD`]);
		assert.deepEqual(h.fake.messages.get(MESSAGE)?.labelIds, ["INBOX", "CATEGORY_UPDATES", "Label_42"]);
		assert.equal((await h.updates.find({ userId: USER, origin: HISTORY }))?.status, "completed");
	});

	for (const origin of [HISTORY, FORWARDED]) {
		it(`settles an already-read ${origin.kind} original without creating a label or changing the message`, async () => {
			const h = await harness();
			const message = h.fake.messages.get(MESSAGE);
			assert(message);
			message.labelIds = ["INBOX", "CATEGORY_UPDATES"];

			assert.deepEqual(await h.mark(origin), { kind: "already-read" });
			assert.deepEqual(h.fake.calls, origin.kind === "forwarded" ? ["search"] : []);
			assert.deepEqual(message.labelIds, ["INBOX", "CATEGORY_UPDATES"]);
			assert.equal((await h.updates.find({ userId: USER, origin }))?.status, "completed");
			message.labelIds.push("UNREAD");

			assert.deepEqual(await h.mark(origin), { kind: "already-read" });
			assert.ok(message.labelIds.includes("UNREAD"));
			assert.deepEqual(h.fake.calls, origin.kind === "forwarded" ? ["search"] : []);
		});
	}

	it("rechecks the original after permission is granted", async () => {
		let granted = false;
		const h = await harness({ open: (fake) => granted ? { ok: true, mailbox: fake.mailbox } : { ok: false, reason: "modify-permission-required" } });
		assert.deepEqual(await h.mark(), { kind: "deferred", reason: "permission-required" });
		const message = h.fake.messages.get(MESSAGE);
		assert(message);
		message.labelIds = ["INBOX"];
		granted = true;

		assert.deepEqual(await h.mark(), { kind: "already-read" });
		assert.deepEqual(h.fake.calls, []);
	});

	it("reuses a label already named imported-to-readplace", async () => {
		const h = await harness();
		h.fake.labels.push({ id: "Label_7", name: "imported-to-readplace" });

		await h.mark();

		assert.deepEqual(h.fake.calls, ["find-label", `modify:${MESSAGE}:+Label_7:-UNREAD`]);
	});

	it("reuses the label another worker created first when its own creation conflicts", async () => {
		const h = await harness();
		h.fake.createConflictWithLabel = { id: "Label_9", name: "imported-to-readplace" };

		assert.deepEqual(await h.mark(), { kind: "marked" });

		assert.deepEqual(h.fake.calls, ["find-label", "create-label", "find-label", `modify:${MESSAGE}:+Label_9:-UNREAD`]);
	});

	it("retries when a conflicting label creation leaves no label to reuse", async () => {
		const h = await harness();
		h.fake.createConflictLeavesNoLabel = true;

		await assert.rejects(h.mark(), /imported label/);
		assert.equal((await h.updates.find({ userId: USER, origin: HISTORY }))?.status, "pending");
	});

	it("answers a later request for a completed update without touching Gmail", async () => {
		const h = await harness();
		await h.mark();
		h.fake.calls.length = 0;

		assert.deepEqual(await h.mark(), { kind: "already-marked" });
		assert.deepEqual(h.fake.calls, []);
	});

	it("keeps the update pending and touches nothing while modify permission is missing", async () => {
		const h = await harness({ open: () => ({ ok: false, reason: "modify-permission-required" }) });

		assert.deepEqual(await h.mark(), { kind: "deferred", reason: "permission-required" });

		assert.equal((await h.updates.find({ userId: USER, origin: HISTORY }))?.status, "pending");
		assert.deepEqual(h.fake.calls, []);
	});

	it("records the update pending before it checks permission, so a grant that lands meanwhile finds it", async () => {
		const h = await harness({
			open: () => {
				assert.equal(h.updates.all().length, 1);
				return { ok: false, reason: "modify-permission-required" };
			},
		});

		await h.mark();
	});

	for (const reason of ["not-connected", "account-mismatch", "reauth-required"] as const) {
		it(`defers while the captured account cannot be opened (${reason})`, async () => {
			const h = await harness({ open: () => ({ ok: false, reason }) });

			assert.deepEqual(await h.mark(), { kind: "deferred", reason: "account-unavailable" });
			assert.equal((await h.updates.find({ userId: USER, origin: HISTORY }))?.status, "pending");
		});
	}

	it("defers without opening a mailbox when the reader has since connected a different account", async () => {
		const h = await harness({ connectedAs: GmailAccountEmailSchema.parse("other@gmail.com") });

		assert.deepEqual(await h.mark(), { kind: "deferred", reason: "account-unavailable" });
		assert.deepEqual(h.opened, []);
	});

	it("defers without opening a mailbox when Gmail is disconnected", async () => {
		const h = await harness({ connectedAs: undefined });

		assert.deepEqual(await h.mark(), { kind: "deferred", reason: "account-unavailable" });
		assert.deepEqual(h.opened, []);
	});

	it("does not create pending work for a connection being disconnected", async () => {
		const h = await harness();
		await h.connections.markDisconnectRequested({ userId: USER });

		assert.deepEqual(await h.mark(), { kind: "deferred", reason: "account-unavailable" });
		assert.deepEqual(h.updates.all(), []);
		assert.deepEqual(h.opened, []);
	});

	it("discards pending work if disconnect begins while the update is queued", async () => {
		const h = await harness();
		const claim = h.updates.claimPending;
		h.updates.claimPending = async (input) => {
			await h.connections.markDisconnectRequested({ userId: USER });
			return claim(input);
		};

		assert.deepEqual(await h.mark(), { kind: "deferred", reason: "account-unavailable" });
		assert.deepEqual(h.updates.all(), []);
		assert.deepEqual(h.opened, []);
	});

	it("defers while the connection's grant is revoked", async () => {
		const h = await harness();
		await h.connections.markRevoked({ userId: USER, reason: "invalid-grant" });

		assert.deepEqual(await h.mark(), { kind: "deferred", reason: "account-unavailable" });
	});

	it("retries a transient failure to open the mailbox", async () => {
		const h = await harness({ open: () => ({ ok: false, reason: "unavailable", status: 503 }) });

		await assert.rejects(h.mark(), /503/);
	});

	it("records a history message Gmail no longer has as failed, never guessing another", async () => {
		const h = await harness();
		h.fake.messages.clear();

		assert.deepEqual(await h.mark(), { kind: "failed", reason: "original-not-found" });
		assert.equal((await h.updates.find({ userId: USER, origin: HISTORY }))?.status, "failed");
		assert.equal(h.fake.calls.some((call) => call.startsWith("modify")), false);
	});

	it("answers a failed update as already failed without touching Gmail again", async () => {
		const h = await harness();
		h.fake.messages.clear();
		await h.mark();
		const callsAfterFailure = h.fake.calls.length;

		assert.deepEqual(await h.mark(), { kind: "already-failed", reason: "original-not-found" });
		assert.equal(h.fake.calls.length, callsAfterFailure);
	});

	it("reports an update as already failed if the dead-letter handler settled it first", async () => {
		const h = await harness();
		h.fake.mailbox.findMessage = async () => {
			await h.updates.markFailed({ userId: USER, origin: HISTORY, reason: "dead-lettered", now: NOW });
			return { ok: true, value: { found: false } };
		};

		assert.deepEqual(await h.mark(), { kind: "already-failed", reason: "original-not-found" });
	});

	it("serializes duplicate deliveries of a Gmail update", async () => {
		const h = await harness();
		const attempts = [h.mark(), h.mark()];

		await assert.rejects(attempts[1], /another worker/);
		assert.deepEqual(await attempts[0], { kind: "marked" });
		assert.deepEqual(await h.mark(), { kind: "already-marked" });
		assert.equal(h.fake.calls.filter((call) => call.startsWith("modify")).length, 1);
	});

	it("honors a fresh unread-import job after a user changes the original back to unread", async () => {
		const h = await harness();
		const message = h.fake.messages.get(MESSAGE);
		assert(message);
		const first = { ...HISTORY, jobId: GmailHistoryImportJobIdSchema.parse("00000000000000000000000000000001") };
		const fresh = { ...HISTORY, jobId: GmailHistoryImportJobIdSchema.parse("00000000000000000000000000000002") };

		assert.deepEqual(await h.mark(first), { kind: "marked" });
		message.labelIds.push("UNREAD");
		assert.deepEqual(await h.mark(first), { kind: "already-marked" });
		assert.ok(message.labelIds.includes("UNREAD"));

		assert.deepEqual(await h.mark(fresh), { kind: "marked" });
		assert.deepEqual(message.labelIds, ["INBOX", "CATEGORY_UPDATES", "Label_42"]);
		message.labelIds.push("UNREAD");
		assert.deepEqual(await h.mark(fresh), { kind: "already-marked" });
		assert.ok(message.labelIds.includes("UNREAD"));
		assert.equal(h.fake.calls.filter((call) => call.startsWith("modify")).length, 2);
	});

	it("labels a forwarded email's original when exactly one message matches its Message-ID and sender", async () => {
		const h = await harness();

		assert.deepEqual(await h.mark(FORWARDED), { kind: "marked" });
		assert.deepEqual(h.fake.calls.at(-1), `modify:${MESSAGE}:+Label_42:-UNREAD`);
	});

	it("records a forwarded email whose original is ambiguous as failed and changes nothing", async () => {
		const h = await harness();
		h.fake.messages.set(GmailMessageIdSchema.parse("abc"), { labelIds: ["UNREAD"], messageIdHeader: "<issue@news.test>", fromHeader: "dan@news.test" });

		assert.deepEqual(await h.mark(FORWARDED), { kind: "failed", reason: "ambiguous-original" });
		assert.equal(h.fake.calls.some((call) => call.startsWith("modify")), false);
	});

	it("ignores search results whose Message-ID or sender do not match the forwarded email", async () => {
		const h = await harness();
		h.fake.messages.set(MESSAGE, { labelIds: ["UNREAD"], messageIdHeader: "<other@news.test>", fromHeader: "dan@news.test" });
		h.fake.messages.set(GmailMessageIdSchema.parse("abc"), { labelIds: ["UNREAD"], messageIdHeader: "<issue@news.test>", fromHeader: "dan@news.test, eve@news.test" });
		h.fake.messages.set(GmailMessageIdSchema.parse("def"), { labelIds: ["UNREAD"], messageIdHeader: "not a message id", fromHeader: "dan@news.test" });

		assert.deepEqual(await h.mark(FORWARDED), { kind: "failed", reason: "original-not-found" });
	});

	it("treats a candidate without headers as no match", async () => {
		const h = await harness();
		h.fake.mailbox.searchByRfcMessageId = async () => ({ ok: true, value: [{ id: MESSAGE, messageIdHeader: undefined, fromHeader: undefined }] });

		assert.deepEqual(await h.mark(FORWARDED), { kind: "failed", reason: "original-not-found" });
	});

	it("retries a transient Gmail failure and leaves the update pending", async () => {
		const h = await harness();
		h.fake.failNext.set("modify", { ok: false, reason: "unavailable", status: 429 });

		await assert.rejects(h.mark(), /429/);
		assert.equal((await h.updates.find({ userId: USER, origin: HISTORY }))?.status, "pending");
	});

	it("defers when Gmail stops accepting the grant mid-update", async () => {
		const h = await harness();
		h.fake.failNext.set("findLabelId", { ok: false, reason: "reauth-required" });

		assert.deepEqual(await h.mark(), { kind: "deferred", reason: "account-unavailable" });
	});

	it("records a refused change as failed", async () => {
		const h = await harness();
		h.fake.failNext.set("modify", { ok: false, reason: "rejected", status: 400, message: "Invalid label" });

		assert.deepEqual(await h.mark(), { kind: "failed", reason: "gmail-rejected" });
		assert.equal((await h.updates.find({ userId: USER, origin: HISTORY }))?.status, "failed");
	});

	for (const step of ["findMessage", "search", "createLabel"] as const) {
		it(`stops at a refused ${step} without changing the message`, async () => {
			const h = await harness();
			h.fake.failNext.set(step, { ok: false, reason: "rejected", status: 403, message: "Forbidden" });

			const outcome = await h.mark(step === "search" ? FORWARDED : HISTORY);

			assert.deepEqual(outcome, { kind: "failed", reason: "gmail-rejected" });
			assert.equal(h.fake.calls.some((call) => call.startsWith("modify")), false);
		});
	}

	it("stops when re-listing labels after a conflict is refused", async () => {
		const h = await harness();
		h.fake.createConflictWithLabel = { id: "Label_9", name: "imported-to-readplace" };
		let lookups = 0;
		const findLabelId = h.fake.mailbox.findLabelId;
		h.fake.mailbox.findLabelId = async (input) => {
			lookups += 1;
			return lookups === 2 ? { ok: false, reason: "rejected", status: 403, message: "Forbidden" } : findLabelId(input);
		};

		assert.deepEqual(await h.mark(), { kind: "failed", reason: "gmail-rejected" });
	});
});
