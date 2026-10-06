import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { EmailMessage } from "@packages/provider-contracts/email";
import type { GmailMonitoringCheckpoint, GmailNewsletterNotice } from "@packages/provider-contracts/gmail-monitoring";
import { initInMemoryGmailMonitoring } from "./in-memory-gmail-monitoring";

const USER = UserIdSchema.parse("reader-1");
const OTHER = UserIdSchema.parse("reader-2");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const SENDER = ForwardableSenderSchema.parse("news@example.com");
const NOW = new Date("2026-10-04T00:00:00.000Z");
const CHECKPOINT: GmailMonitoringCheckpoint = {
	userId: USER, generation: "generation-1", page: 0, mailboxId: "mailbox-1", accountEmail: ACCOUNT,
	gatewayAddress: InboxAddressSchema.parse("gmail-a7b2c9@read.place"), mode: "baseline", initializing: true,
	historyId: "100", pageToken: undefined, scannedCount: 0, lastCheckedAt: NOW.getTime(),
};
const MESSAGE: EmailMessage = { from: "Readplace <hello@readplace.com>", to: "reader@gmail.com", subject: "Choose a readlist", html: "<p>Choose a readlist</p>", idempotencyKey: "gmail-newsletter-user-sender" };

function fixture() {
	let instant = NOW.getTime();
	return { store: initInMemoryGmailMonitoring({ now: () => new Date(instant) }), advance: (ms: number) => { instant += ms; } };
}

describe("initInMemoryGmailMonitoring", () => {
	it("fences stale initialization and continuations and retries expired page claims", async () => {
		const { store, advance } = fixture();
		const claim = { userId: USER, generation: CHECKPOINT.generation, page: 0 };
		assert.equal(await store.findCheckpoint(USER), undefined);
		assert.equal(await store.claimPage(claim), false);
		assert.equal(await store.saveCheckpoint({ previous: CHECKPOINT, next: CHECKPOINT }), false);
		assert.equal(await store.startRun({ checkpoint: CHECKPOINT, previous: undefined }), true);
		assert.equal(await store.startRun({ checkpoint: CHECKPOINT, previous: undefined }), false);
		assert.equal(await store.startRun({ checkpoint: CHECKPOINT, previous: { ...CHECKPOINT, generation: "old" } }), false);
		assert.equal(await store.claimPage({ ...claim, generation: "old" }), false);
		assert.equal(await store.claimPage({ ...claim, page: 1 }), false);
		assert.equal(await store.claimPage(claim), true);
		assert.equal(await store.claimPage(claim), false);
		advance(120_000);
		assert.equal(await store.claimPage(claim), true);
		const next = { ...CHECKPOINT, page: 1, pageToken: "next" };
		assert.equal(await store.saveCheckpoint({ previous: CHECKPOINT, next }), true);
		assert.equal(await store.saveCheckpoint({ previous: CHECKPOINT, next }), false);
		assert.equal(await store.observeSender({ checkpoint: CHECKPOINT, observation: { email: SENDER, name: undefined, approved: true }, notify: true }), false);
		assert.equal(await store.claimPage({ ...claim, page: 1 }), true);
		const finished: GmailMonitoringCheckpoint = { ...next, page: 2, mode: "complete" };
		assert.equal(await store.saveCheckpoint({ previous: next, next: finished }), true);
		assert.equal(await store.claimPage({ ...claim, page: 2 }), false);
		const restarted = { ...CHECKPOINT, generation: "generation-2" };
		assert.equal(await store.startRun({ checkpoint: restarted, previous: finished }), true);
		assert.equal(await store.claimPage({ ...claim, generation: "generation-2" }), true);
		assert.deepEqual(await store.findCheckpoint(USER), restarted);
	});

	it("retains unapproved observations without creating baseline notices and scopes candidates to the current mailbox", async () => {
		const { store } = fixture();
		assert.deepEqual(await store.listObservedSenders({ userId: USER, accountEmail: ACCOUNT }), []);
		assert.deepEqual(await store.listObservations({ userId: USER, mailboxId: CHECKPOINT.mailboxId }), { observations: [], nextPageToken: undefined });
		await store.startRun({ checkpoint: CHECKPOINT, previous: undefined });
		const observation = { email: SENDER, name: "Newsletter", approved: false, lastMessageAt: 1000 };
		assert.equal(await store.observeSender({ checkpoint: CHECKPOINT, observation, notify: false }), true);
		assert.deepEqual(await store.findObservation({ userId: USER, mailboxId: CHECKPOINT.mailboxId, senderEmail: SENDER }), observation);
		assert.equal(await store.findObservation({ userId: OTHER, mailboxId: CHECKPOINT.mailboxId, senderEmail: SENDER }), undefined);
		assert.deepEqual(await store.listObservedSenders({ userId: USER, accountEmail: GmailAccountEmailSchema.parse("READER@GMAIL.COM") }), [{ email: SENDER, name: "Newsletter" }]);
		assert.equal(await store.findNotice({ userId: USER, senderEmail: SENDER }), undefined);
		const changed = { ...CHECKPOINT, generation: "generation-2", mailboxId: "mailbox-2", accountEmail: GmailAccountEmailSchema.parse("other@gmail.com") };
		await store.startRun({ checkpoint: changed, previous: CHECKPOINT });
		assert.deepEqual(await store.listObservedSenders({ userId: USER, accountEmail: ACCOUNT }), []);
		assert.deepEqual(await store.listObservedSenders({ userId: USER, accountEmail: changed.accountEmail }), []);
	});

	it("claims notices once and preserves the original retry payload and first-attempt timestamp", async () => {
		const { store, advance } = fixture();
		await store.startRun({ checkpoint: CHECKPOINT, previous: undefined });
		await store.observeSender({ checkpoint: CHECKPOINT, observation: { email: SENDER, name: "Newsletter", approved: true }, notify: true });
		const pending = await store.findNotice({ userId: USER, senderEmail: SENDER });
		assert(pending);
		assert.equal(await store.claimNotice({ notice: { ...pending, mailboxId: "old-mailbox" }, message: MESSAGE }), undefined);
		assert.equal(await store.claimNotice({ notice: { ...pending, senderEmail: ForwardableSenderSchema.parse("missing@example.com") }, message: MESSAGE }), undefined);
		const first = await store.claimNotice({ notice: pending, message: MESSAGE });
		assert(first);
		assert.equal(first.status, "sending");
		assert.equal(first.firstAttemptAt, NOW.getTime());
		assert.equal(first.claimUntil, NOW.getTime() + 120_000);
		assert.equal(await store.claimNotice({ notice: pending, message: MESSAGE }), undefined);
		await store.cancelNotice({ userId: USER, senderEmail: SENDER });
		assert.equal((await store.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "sending");
		advance(120_000);
		const retry = await store.claimNotice({ notice: first, message: { ...MESSAGE, subject: "Changed catalog title" } });
		assert(retry);
		assert.deepEqual(retry.message, MESSAGE);
		assert.equal(retry.firstAttemptAt, first.firstAttemptAt);
		assert.equal(retry.claimUntil, NOW.getTime() + 240_000);
		await store.markNoticeSent({ userId: USER, senderEmail: SENDER });
		assert.equal((await store.findNotice({ userId: USER, senderEmail: SENDER }))?.claimUntil, undefined);
		assert.equal(await store.claimNotice({ notice: retry, message: MESSAGE }), undefined);
		await store.observeSender({ checkpoint: CHECKPOINT, observation: { email: SENDER, name: "Renamed", approved: true }, notify: true });
		assert.equal((await store.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "sent");
		const reconnected = { ...CHECKPOINT, generation: "generation-2", mailboxId: "mailbox-2" };
		await store.startRun({ checkpoint: reconnected, previous: CHECKPOINT });
		await store.observeSender({ checkpoint: reconnected, observation: { email: SENDER, name: undefined, approved: true }, notify: true });
		assert.equal((await store.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "sent");
		await store.markNoticeSent({ userId: OTHER, senderEmail: SENDER });
		await store.cancelNotice({ userId: OTHER, senderEmail: SENDER });
	});

	it("marks a pending notice sent when a grouped email announced it without claiming it", async () => {
		const { store } = fixture();
		await store.startRun({ checkpoint: CHECKPOINT, previous: undefined });
		await store.observeSender({ checkpoint: CHECKPOINT, observation: { email: SENDER, name: undefined, approved: true }, notify: true });
		await store.markNoticeSent({ userId: USER, senderEmail: SENDER });
		assert.equal((await store.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "sent");
	});

	it("claims one grouped notice per reader at a time, keeps its email across retries and spaces sends by the caller's interval", async () => {
		const { store, advance } = fixture();
		const other = ForwardableSenderSchema.parse("other@example.com");
		assert.equal(await store.findNoticeBatch(USER), undefined);
		const first = await store.claimNoticeBatch({ userId: USER, senders: [SENDER], message: MESSAGE, lastSentBefore: 0 });
		assert.deepEqual(first, { userId: USER, status: "sending", senders: [SENDER], message: MESSAGE, firstAttemptAt: NOW.getTime(), claimUntil: NOW.getTime() + 120_000 });
		assert.equal(await store.claimNoticeBatch({ userId: USER, senders: [SENDER], message: MESSAGE, lastSentBefore: 0 }), undefined);
		advance(120_000);
		assert.deepEqual(await store.claimNoticeBatch({ userId: USER, senders: [other], message: { ...MESSAGE, subject: "Changed" }, lastSentBefore: 0 }), { ...first, claimUntil: NOW.getTime() + 240_000 });
		await store.finishNoticeBatch(USER);
		await store.finishNoticeBatch(USER);
		await store.finishNoticeBatch(OTHER);
		assert.deepEqual(await store.findNoticeBatch(USER), { userId: USER, status: "idle", lastSentAt: NOW.getTime() + 120_000 });
		assert.equal(await store.findNoticeBatch(OTHER), undefined);
		assert.equal(await store.claimNoticeBatch({ userId: USER, senders: [other], message: MESSAGE, lastSentBefore: NOW.getTime() + 119_999 }), undefined);
		assert.deepEqual(await store.claimNoticeBatch({ userId: USER, senders: [other], message: MESSAGE, lastSentBefore: NOW.getTime() + 120_000 }), { userId: USER, status: "sending", senders: [other], message: MESSAGE, firstAttemptAt: NOW.getTime() + 120_000, claimUntil: NOW.getTime() + 240_000 });
	});

	it("reopens only unsent cancelled notices when a sender qualifies again", async () => {
		const { store } = fixture();
		await store.startRun({ checkpoint: CHECKPOINT, previous: undefined });
		const observation = { email: SENDER, name: undefined, approved: true };
		await store.observeSender({ checkpoint: CHECKPOINT, observation, notify: true });
		await store.observeSender({ checkpoint: CHECKPOINT, observation, notify: true });
		assert.equal((await store.listNotices({ userId: USER })).notices.length, 1);
		await store.cancelNotice({ userId: USER, senderEmail: SENDER });
		const cancelled = await store.findNotice({ userId: USER, senderEmail: SENDER });
		assert(cancelled);
		assert.equal(cancelled.status, "cancelled");
		await store.markNoticeSent({ userId: USER, senderEmail: SENDER });
		assert.equal((await store.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "cancelled");
		assert.equal(await store.claimNotice({ notice: cancelled, message: MESSAGE }), undefined);
		await store.observeSender({ checkpoint: CHECKPOINT, observation, notify: false });
		assert.equal((await store.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "cancelled");
		await store.observeSender({ checkpoint: CHECKPOINT, observation, notify: true });
		assert.equal((await store.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "pending");
	});

	it("rejects a stale mailbox claim after an unsent notice is replaced by a reconnected mailbox", async () => {
		const { store } = fixture();
		await store.startRun({ checkpoint: CHECKPOINT, previous: undefined });
		const observation = { email: SENDER, name: undefined, approved: true };
		await store.observeSender({ checkpoint: CHECKPOINT, observation, notify: true });
		const oldNotice = await store.findNotice({ userId: USER, senderEmail: SENDER });
		assert(oldNotice);
		await store.cancelNotice({ userId: USER, senderEmail: SENDER });
		const next = { ...CHECKPOINT, generation: "second", mailboxId: "mailbox-2", accountEmail: GmailAccountEmailSchema.parse("other@gmail.com") };
		await store.startRun({ checkpoint: next, previous: CHECKPOINT });
		await store.observeSender({ checkpoint: next, observation, notify: true });
		assert.equal(await store.claimNotice({ notice: oldNotice, message: MESSAGE }), undefined);
		const current = await store.findNotice({ userId: USER, senderEmail: SENDER });
		assert(current);
		assert.equal((await store.claimNotice({ notice: current, message: MESSAGE }))?.mailboxId, next.mailboxId);
	});

	it.each([
		{ mailboxId: "mailbox-2" },
		{ gatewayAddress: InboxAddressSchema.parse("gmail-new123@read.place") },
		{ accountEmail: GmailAccountEmailSchema.parse("other@gmail.com") },
	])("replaces an eligible pending notice for a changed connection while rejecting stale claims: %p", async (changed) => {
		const { store } = fixture();
		const observation = { email: SENDER, name: undefined, approved: true };
		await store.startRun({ checkpoint: CHECKPOINT, previous: undefined });
		await store.observeSender({ checkpoint: CHECKPOINT, observation, notify: true });
		const oldNotice = await store.findNotice({ userId: USER, senderEmail: SENDER });
		assert(oldNotice);
		const next = { ...CHECKPOINT, ...changed, generation: "second" };
		await store.startRun({ checkpoint: next, previous: CHECKPOINT });
		await store.observeSender({ checkpoint: next, observation, notify: false });
		assert.deepEqual(await store.findNotice({ userId: USER, senderEmail: SENDER }), oldNotice);
		await store.observeSender({ checkpoint: next, observation, notify: true });
		const pending = await store.findNotice({ userId: USER, senderEmail: SENDER });
		assert(pending);
		assert.equal(pending.status, "pending");
		assert.equal(pending.mailboxId, next.mailboxId);
		assert.equal(pending.gatewayAddress, next.gatewayAddress);
		assert.equal(pending.accountEmail, next.accountEmail);
		assert.equal(pending.firstAttemptAt, undefined);
		assert.equal(pending.message, undefined);
		assert.equal(await store.claimNotice({ notice: oldNotice, message: MESSAGE }), undefined);
		assert(await store.claimNotice({ notice: pending, message: MESSAGE }));
	});

	it.each(["sending", "sent"])("keeps a %s receipt across a changed mailbox, account and gateway", async (status) => {
		const { store } = fixture();
		const observation = { email: SENDER, name: undefined, approved: true };
		await store.startRun({ checkpoint: CHECKPOINT, previous: undefined });
		await store.observeSender({ checkpoint: CHECKPOINT, observation, notify: true });
		const pending = await store.findNotice({ userId: USER, senderEmail: SENDER });
		assert(pending);
		assert(await store.claimNotice({ notice: pending, message: MESSAGE }));
		if (status === "sent") await store.markNoticeSent({ userId: USER, senderEmail: SENDER });
		const original = await store.findNotice({ userId: USER, senderEmail: SENDER });
		const next = { ...CHECKPOINT, generation: "second", mailboxId: "mailbox-2", accountEmail: GmailAccountEmailSchema.parse("other@gmail.com"), gatewayAddress: InboxAddressSchema.parse("gmail-new123@read.place") };
		await store.startRun({ checkpoint: next, previous: CHECKPOINT });
		await store.observeSender({ checkpoint: next, observation, notify: true });
		assert.deepEqual(await store.findNotice({ userId: USER, senderEmail: SENDER }), original);
	});

	it("paginates observations and notices, and erases all mailbox and receipt state for only one user", async () => {
		const { store } = fixture();
		for (const userId of [USER, OTHER]) {
			const checkpoint = { ...CHECKPOINT, userId };
			await store.startRun({ checkpoint, previous: undefined });
			for (let index = 0; index < 26; index += 1) {
				await store.observeSender({ checkpoint, observation: { email: ForwardableSenderSchema.parse(`sender${index}@example.com`), name: undefined, approved: true }, notify: true });
			}
		}
		const first = await store.listObservations({ userId: USER, mailboxId: CHECKPOINT.mailboxId });
		assert.equal(first.observations.length, 25);
		assert.equal(first.nextPageToken, "25");
		assert.equal((await store.listObservations({ userId: USER, mailboxId: CHECKPOINT.mailboxId, pageToken: first.nextPageToken })).observations.length, 1);
		const notices = await store.listNotices({ userId: USER });
		assert.equal(notices.notices.length, 25);
		const lastNotices = await store.listNotices({ userId: USER, pageToken: notices.nextPageToken });
		assert.equal(lastNotices.notices.length, 1);
		assert.equal(lastNotices.nextPageToken, undefined);
		const previous = await store.findCheckpoint(USER);
		assert(previous);
		await store.startRun({ checkpoint: { ...previous, mailboxId: "mailbox-2", generation: "second" }, previous });
		await store.observeSender({ checkpoint: { ...previous, mailboxId: "mailbox-2", generation: "second" }, observation: { email: SENDER, name: undefined, approved: false }, notify: false });
		await store.claimNoticeBatch({ userId: USER, senders: [SENDER], message: MESSAGE, lastSentBefore: 0 });
		await store.claimNoticeBatch({ userId: OTHER, senders: [SENDER], message: MESSAGE, lastSentBefore: 0 });
		await store.deleteAllByUserId(USER);
		await store.deleteAllByUserId(USER);
		assert.equal(await store.findCheckpoint(USER), undefined);
		assert.equal(await store.findNoticeBatch(USER), undefined);
		assert.equal((await store.findNoticeBatch(OTHER))?.status, "sending");
		assert.deepEqual((await store.listObservations({ userId: USER, mailboxId: CHECKPOINT.mailboxId })).observations, []);
		assert.deepEqual((await store.listObservations({ userId: USER, mailboxId: "mailbox-2" })).observations, []);
		assert.deepEqual((await store.listNotices({ userId: USER })).notices, []);
		assert.equal((await store.listNotices({ userId: OTHER })).notices.length, 25);
		assert.equal((await store.listObservations({ userId: OTHER, mailboxId: CHECKPOINT.mailboxId })).observations.length, 25);
		const missing: GmailNewsletterNotice = { userId: USER, senderEmail: SENDER, accountEmail: ACCOUNT, gatewayAddress: CHECKPOINT.gatewayAddress, mailboxId: CHECKPOINT.mailboxId, status: "pending", message: undefined, firstAttemptAt: undefined, claimUntil: undefined };
		assert.equal(await store.claimNotice({ notice: missing, message: MESSAGE }), undefined);
	});
});
