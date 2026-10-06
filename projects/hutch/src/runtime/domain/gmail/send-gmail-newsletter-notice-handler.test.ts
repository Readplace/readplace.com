import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { ForwardableSenderSchema, GmailAccountEmailSchema, type ForwardableSender } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { NewsletterNameSchema, type DetectNewsletters } from "@packages/domain/newsletter-catalog";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { GmailNewsletterNoticeProcessedEvent, SendGmailNewsletterNoticeCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { ReadlistDefinitionData } from "@packages/provider-contracts/article-store";
import type { GmailMonitoringCheckpoint } from "@packages/provider-contracts/gmail-monitoring";
import type { EmailMessage } from "@packages/provider-contracts/email";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailMonitoring } from "@packages/test-fixtures/providers/gmail-monitoring";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initSendGmailNewsletterNoticeHandler } from "./send-gmail-newsletter-notice-handler";

const USER = UserIdSchema.parse("reader");
const SENDER = ForwardableSenderSchema.parse("letter@example.com");
const SECOND = ForwardableSenderSchema.parse("digest@another.example");
const THIRD = ForwardableSenderSchema.parse("news@wildcard.example");
const ACCOUNT = GmailAccountEmailSchema.parse("gmail-user@gmail.com");
const GATEWAY = InboxAddressSchema.parse("gmail-reader@read.place");
const NOW = Date.parse("2026-10-04T00:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1_000;
const WORK: ReadlistDefinitionData = { slug: ReadlistSlugSchema.parse("work"), label: "Work", createdAt: new Date(NOW) };

function recognizing(newsletters: [ForwardableSender, string | undefined][]): DetectNewsletters {
	return async () => ({
		status: "available",
		recognized: new Map(newsletters.map(([from, name]) => [from, name === undefined ? { from, name: undefined, source: "catalog", match: "domain-wildcard" } : { from, name: NewsletterNameSchema.parse(name), source: "catalog", match: "exact" }])),
	});
}

async function harness() {
	let instant = NOW;
	const now = () => new Date(instant);
	const connections = initInMemoryGmailConnection({ now });
	const monitoring = initInMemoryGmailMonitoring({ now });
	const senders = initInMemoryGmailSender({ now });
	await connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });
	await connections.recordAccountEmail({ userId: USER, accountEmail: ACCOUNT });
	const checkpoint: GmailMonitoringCheckpoint = { userId: USER, generation: "run", page: 0, mailboxId: "mailbox", accountEmail: ACCOUNT, gatewayAddress: GATEWAY, mode: "arrivals", initializing: false, historyId: "100", pageToken: undefined, scannedCount: 0, lastCheckedAt: NOW };
	await monitoring.startRun({ checkpoint, previous: undefined });
	const observe = (senderEmail: ForwardableSender) => monitoring.observeSender({ checkpoint, observation: { email: senderEmail, name: undefined, approved: true }, notify: true });
	await observe(SENDER);
	const published: { event: unknown; detail: unknown }[] = [];
	const sent: EmailMessage[] = [];
	const deps = { connections, monitoring, senders, detectNewsletters: recognizing([[SENDER, "Example Letter"], [SECOND, "Another Digest"], [THIRD, undefined]]), listReadlistDefinitions: async (): Promise<ReadlistDefinitionData[]> => [WORK], findEmailByUserId: async (): Promise<string | null> => "readplace-account@example.com", sendEmail: async (message: EmailMessage) => { sent.push(message); }, founderAvatarUrl: "https://static.test/fayner.jpg", appOrigin: "https://readplace.test", now, publishEvent: (async (event, detail) => { published.push({ event, detail }); }) as PublishEvent, logger: HutchLogger.from(noopLogger) };
	async function run(records = [{ messageId: "notice", body: JSON.stringify({ detail: { userId: USER } }) }]) {
		const response = await initSendGmailNewsletterNoticeHandler(deps)(buildSqsEvent(records), buildLambdaContext(), () => {}); assert(response); return response;
	}
	const status = async (senderEmail: ForwardableSender) => (await monitoring.findNotice({ userId: USER, senderEmail }))?.status;
	return { deps, checkpoint, connections, monitoring, senders, sent, published, run, observe, status, advance: (ms = 120_001) => { instant += ms; } };
}

function links(html: string) {
	return [...parseHTML(html).document.querySelectorAll("a")].map((anchor) => {
		const url = new URL(anchor.getAttribute("href") ?? "");
		return { text: anchor.textContent, sender: url.searchParams.get("readlist_choice_for"), utmContent: url.searchParams.get("utm_content") };
	});
}

const sentEvent = (senderEmail: ForwardableSender) => ({ event: GmailNewsletterNoticeProcessedEvent, detail: { userId: USER, senderEmail, outcome: "sent" } });

describe("approved Gmail newsletter notices", () => {
	it("sends one newsletter's notice to the Readplace account email with a tracked sender-selected CTA and a permanent receipt", async () => {
		const h = await harness();
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent.length, 1);
		const message = h.sent[0];
		assert.equal(message.from, "Readplace <readplace@readplace.com>");
		assert.equal(message.replyTo, "fayner@readplace.com");
		assert.equal(message.to, "readplace-account@example.com");
		assert.equal(message.subject, "Choose readlists for Example Letter");
		assert.match(message.text ?? "", /letter@example.com/);
		assert.match(message.text ?? "", /future emails/);
		assert.match(message.text ?? "", /earlier unread messages from the last 30 days/);
		assert.match(message.idempotencyKey ?? "", /^gmail-newsletter\/[a-f0-9]{64}$/);
		const document = parseHTML(message.html).document;
		const link = document.querySelector("a"); assert(link);
		assert.equal(link.textContent, "Choose readlists");
		const url = new URL(link.getAttribute("href") ?? "");
		assert.equal(url.pathname, "/newsletters/gmail");
		assert.equal(url.searchParams.get("sender"), SENDER);
		assert.equal(url.searchParams.get("notification"), "1");
		assert.equal(url.searchParams.get("readlist_choice_for"), SENDER);
		assert.equal(url.searchParams.get("utm_medium"), "email");
		assert.equal(await h.status(SENDER), "sent");
		await h.run();
		assert.equal(h.sent.length, 1);
		assert.deepEqual(h.published, [sentEvent(SENDER)]);
	});
	it("groups every newsletter waiting for a notice into one email that links each to its own readlist choice", async () => {
		const h = await harness();
		await h.observe(SECOND);
		await h.observe(THIRD);
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent.length, 1);
		const [message] = h.sent;
		assert.equal(message.subject, "Choose readlists for 3 newsletters");
		assert.deepEqual(links(message.html), [
			{ text: "Another Digest", sender: SECOND, utmContent: "choose-readlist" },
			{ text: SECOND, sender: SECOND, utmContent: "choose-readlist" },
			{ text: "Example Letter", sender: SENDER, utmContent: "choose-readlist" },
			{ text: SENDER, sender: SENDER, utmContent: "choose-readlist" },
			{ text: THIRD, sender: THIRD, utmContent: "choose-readlist" },
			{ text: "Choose readlists", sender: null, utmContent: "choose-readlists" },
		]);
		assert.match(message.text ?? "", /^Example Letter \(letter@example\.com\): https:\/\/readplace\.test\/newsletters\/gmail\?sender=letter%40example\.com/m);
		assert.deepEqual([await h.status(SENDER), await h.status(SECOND), await h.status(THIRD)], ["sent", "sent", "sent"]);
		assert.deepEqual(h.published, [sentEvent(SECOND), sentEvent(SENDER), sentEvent(THIRD)]);
	});
	it("holds newsletters found within three days of the last notice, then sends them together in one email", async () => {
		const h = await harness();
		await h.run();
		await h.observe(SECOND);
		await h.observe(THIRD);
		h.advance(3 * DAY_MS - 1);
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent.length, 1);
		assert.equal(await h.status(SECOND), "pending");
		h.advance(1);
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent.length, 2);
		assert.equal(h.sent[1].subject, "Choose readlists for 2 newsletters");
		assert.deepEqual(links(h.sent[1].html).map((link) => link.sender), [SECOND, SECOND, THIRD, null]);
		assert.deepEqual(h.published, [sentEvent(SENDER), sentEvent(SECOND), sentEvent(THIRD)]);
	});
	it("holds every notice while All is the reader's only readlist, then announces them together once the reader adds another", async () => {
		const h = await harness();
		await h.observe(SECOND);
		h.deps.listReadlistDefinitions = async () => [];
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent.length, 0);
		assert.deepEqual([await h.status(SENDER), await h.status(SECOND)], ["pending", "pending"]);
		assert.equal(await h.monitoring.findNoticeBatch(USER), undefined);
		assert.deepEqual(h.published, []);
		h.deps.listReadlistDefinitions = async () => [WORK];
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent.length, 1);
		assert.equal(h.sent[0].subject, "Choose readlists for 2 newsletters");
		assert.deepEqual(h.published, [sentEvent(SECOND), sentEvent(SENDER)]);
	});
	it("leaves out a newsletter that no longer qualifies and announces the rest", async () => {
		const h = await harness();
		await h.observe(SECOND);
		await h.senders.addSenderToFilter({ userId: USER, senderEmail: SECOND });
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent.length, 1);
		assert.equal(h.sent[0].subject, "Choose readlists for Example Letter");
		assert.equal(await h.status(SECOND), "cancelled");
		assert.deepEqual(h.published, [{ event: GmailNewsletterNoticeProcessedEvent, detail: { userId: USER, senderEmail: SECOND, outcome: "suppressed" } }, sentEvent(SENDER)]);
	});
	it("supports nameless wildcard recognition and escapes catalog text in the email", async () => {
		const h = await harness();
		h.deps.detectNewsletters = recognizing([[SENDER, undefined]]);
		await h.run(); assert.equal(h.sent[0].subject, `Choose readlists for ${SENDER}`);
		assert.match(h.sent[0].html, /Readplace recognizes this newsletter/);
		const other = await harness();
		other.deps.detectNewsletters = recognizing([[SENDER, "<script>alert(1)</script>"]]);
		await other.run();
		assert.match(other.sent[0].html, /&lt;script&gt;alert/);
	});
	it.each(["mapped", "revoked", "disconnecting", "disconnected", "changed-account", "changed-gateway", "changed-checkpoint", "unapproved", "missing-email"])("suppresses %s immediately before sending", async (condition) => {
		const h = await harness();
		if (condition === "mapped") await h.senders.addSenderToFilter({ userId: USER, senderEmail: SENDER });
		if (condition === "revoked") await h.connections.markRevoked({ userId: USER, reason: "invalid-grant" });
		if (condition === "disconnecting") await h.connections.markDisconnectRequested({ userId: USER });
		if (condition === "disconnected") await h.connections.deleteConnection(USER);
		if (condition === "changed-account") await h.connections.recordAccountEmail({ userId: USER, accountEmail: GmailAccountEmailSchema.parse("other@gmail.com") });
		if (condition === "changed-gateway") await h.connections.createConnection({ userId: USER, gatewayAddress: InboxAddressSchema.parse("gmail-others@read.place") });
		if (condition === "changed-checkpoint") await h.monitoring.startRun({ checkpoint: { ...h.checkpoint, mailboxId: "new-mailbox" }, previous: h.checkpoint });
		if (condition === "unapproved") h.deps.detectNewsletters = recognizing([]);
		if (condition === "missing-email") h.deps.findEmailByUserId = async () => null;
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent.length, 0);
		assert.equal(await h.status(SENDER), "cancelled");
		assert.equal(await h.monitoring.findNoticeBatch(USER), undefined);
		assert.deepEqual(h.published, [{ event: GmailNewsletterNoticeProcessedEvent, detail: { userId: USER, senderEmail: SENDER, outcome: "suppressed" } }]);
	});
	it("sends nothing when no newsletter is waiting for a notice", async () => {
		const h = await harness(); await h.monitoring.cancelNotice({ userId: USER, senderEmail: SENDER }); await h.run();
		await h.monitoring.deleteAllByUserId(USER); await h.run();
		assert.equal(h.sent.length, 0);
		assert.deepEqual(h.published, []);
	});
	it("retries catalog failures without claiming or mutating the pending notice", async () => {
		const h = await harness(); h.deps.detectNewsletters = async () => ({ status: "unavailable" });
		assert.deepEqual(await h.run(), { batchItemFailures: [{ itemIdentifier: "notice" }] });
		assert.equal(await h.status(SENDER), "pending");
		assert.equal(await h.monitoring.findNoticeBatch(USER), undefined);
		assert.equal(h.sent.length, 0);
	});
	it("reuses the exact persisted payload after ambiguous transport failure despite catalog and user-email changes", async () => {
		const h = await harness();
		h.deps.sendEmail = async (message) => { h.sent.push(message); throw new Error("Transport timed out after acceptance"); };
		assert.deepEqual(await h.run(), { batchItemFailures: [{ itemIdentifier: "notice" }] });
		const first = h.sent[0];
		assert.equal((await h.monitoring.findNoticeBatch(USER))?.status, "sending");
		assert.deepEqual(await h.run(), { batchItemFailures: [{ itemIdentifier: "notice" }] });
		assert.equal(h.sent.length, 1);
		h.advance();
		h.deps.findEmailByUserId = async () => "renamed-account@example.com";
		h.deps.detectNewsletters = recognizing([[SENDER, "Renamed"]]);
		h.deps.sendEmail = async (message) => { h.sent.push(message); };
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.deepEqual(h.sent[1], first);
		assert.equal(await h.status(SENDER), "sent");
		assert.equal((await h.monitoring.findNoticeBatch(USER))?.status, "idle");
	});
	it("retries a notice claimed before notices were grouped with its original payload and retry key", async () => {
		const h = await harness();
		const notice = await h.monitoring.findNotice({ userId: USER, senderEmail: SENDER });
		assert(notice);
		const original: EmailMessage = {
			from: "Fayner from Readplace <fayner@readplace.com>",
			to: "readplace-account@example.com",
			subject: "Choose a readlist for Example Letter",
			html: '<a href="https://readplace.test/newsletters/gmail?notification=1">Choose a readlist</a>',
			text: "Choose a readlist",
			idempotencyKey: "gmail-newsletter/original-key",
		};
		await h.monitoring.claimNotice({ notice, message: original });
		h.advance();

		assert.deepEqual(await h.run(), { batchItemFailures: [] });

		assert.deepEqual(h.sent, [original]);
		assert.equal(await h.status(SENDER), "sent");
		assert.deepEqual(h.published, [sentEvent(SENDER)]);
	});
	it("accepts a command queued before notices were grouped that still names one sender", async () => {
		const h = await harness();
		await h.observe(SECOND);
		assert.deepEqual(await h.run([{ messageId: "queued", body: JSON.stringify({ detail: { userId: USER, senderEmail: SENDER } }) }]), { batchItemFailures: [] });
		assert.equal(h.sent.length, 1);
		assert.equal(h.sent[0].subject, "Choose readlists for 2 newsletters");
	});
	it("serializes concurrent deliveries, then acknowledges duplicates against a sent receipt", async () => {
		const h = await harness();
		const responses = await Promise.all([h.run(), h.run()]);
		assert.equal(h.sent.length, 1);
		assert.equal(responses.flatMap((response) => response.batchItemFailures).length, 1);
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent.length, 1);
	});
	it("never retries unresolved delivery outside the provider window and leaves it failed for DLQ review", async () => {
		const h = await harness();
		h.deps.sendEmail = async (message) => { h.sent.push(message); throw new Error("Ambiguous acceptance"); };
		await h.run(); h.advance(24 * 60 * 60 * 1_000);
		assert.deepEqual(await h.run(), { batchItemFailures: [{ itemIdentifier: "notice" }] });
		assert.equal(h.sent.length, 1);
		assert.equal((await h.monitoring.findNoticeBatch(USER))?.status, "sending");
	});
	it("retries event publication without resending an email the provider already accepted", async () => {
		const h = await harness();
		const publishEvent = h.deps.publishEvent;
		h.deps.publishEvent = async () => { throw new Error("EventBridge failed"); };
		assert.deepEqual(await h.run(), { batchItemFailures: [{ itemIdentifier: "notice" }] });
		assert.equal((await h.monitoring.findNoticeBatch(USER))?.status, "sending");
		h.deps.publishEvent = publishEvent;
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent.length, 1);
		assert.deepEqual(h.published, [sentEvent(SENDER)]);
		assert.equal((await h.monitoring.findNoticeBatch(USER))?.status, "idle");
	});
	it("settles a delivered notice email whose bookkeeping failed for longer than the provider window, and keeps notifying the reader", async () => {
		const h = await harness();
		const publishEvent = h.deps.publishEvent;
		h.deps.publishEvent = async () => { throw new Error("EventBridge outage"); };
		await h.run();
		h.advance(DAY_MS + 1);
		h.deps.publishEvent = publishEvent;
		await h.observe(SECOND);
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent.length, 1);
		assert.equal((await h.monitoring.findNoticeBatch(USER))?.status, "idle");
		assert.equal(await h.status(SECOND), "pending");
		h.advance(3 * DAY_MS);
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent[1]?.subject, "Choose readlists for Another Digest");
	});
	it("records only the listed newsletters that were sent when settling a delivered notice email", async () => {
		const h = await harness();
		await h.observe(SECOND);
		const message: EmailMessage = { from: "Readplace <readplace@readplace.com>", to: "readplace-account@example.com", subject: "Choose readlists for 2 newsletters", html: "<p>Choose readlists</p>", idempotencyKey: "gmail-newsletter/settled" };
		await h.monitoring.claimNoticeBatch({ userId: USER, senders: [SENDER, SECOND], message, lastSentBefore: 0 });
		await h.monitoring.cancelNotice({ userId: USER, senderEmail: SENDER });
		await h.monitoring.markNoticeSent({ userId: USER, senderEmail: SECOND });
		h.advance();
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.deepEqual(h.sent, []);
		assert.deepEqual(h.published, [sentEvent(SECOND)]);
		assert.equal(await h.status(SENDER), "cancelled");
		assert.equal((await h.monitoring.findNoticeBatch(USER))?.status, "idle");
	});
	it("reads every page of a reader's waiting notices", async () => {
		const h = await harness();
		const bulk = Array.from({ length: 26 }, (_, index) => ForwardableSenderSchema.parse(`news${String(index).padStart(2, "0")}@bulk.example`));
		for (const senderEmail of bulk) await h.observe(senderEmail);
		h.deps.detectNewsletters = recognizing([[SENDER, "Example Letter"], ...bulk.map((senderEmail): [ForwardableSender, string | undefined] => [senderEmail, undefined])]);
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent.length, 1);
		assert.equal(h.sent[0].subject, "Choose readlists for 27 newsletters");
		assert.deepEqual(new Set(links(h.sent[0].html).map((link) => link.sender)), new Set([SENDER, ...bulk, null]));
		assert.deepEqual(await Promise.all([SENDER, ...bulk].map((senderEmail) => h.status(senderEmail))), Array.from({ length: 27 }, () => "sent"));
	});
	it("fails malformed records independently of valid tagged EventBridge commands", async () => {
		const h = await harness();
		assert.deepEqual(await h.run([
			{ messageId: "bad", body: "invalid" },
			{ messageId: "valid", body: JSON.stringify({ "detail-type": SendGmailNewsletterNoticeCommand.detailType, detail: { userId: USER } }) },
		]), { batchItemFailures: [{ itemIdentifier: "bad" }] });
		assert.equal(h.sent.length, 1);
	});
});

describe("provider acceptance and receipt retries", () => {
	it("sends one provider email after acceptance is ambiguous and the queue retries with the same idempotency key", async () => {
		const h = await harness();
		const accepted = new Map<string, EmailMessage>();
		let requests = 0;
		h.deps.sendEmail = async (message) => {
			assert(message.idempotencyKey);
			if (!accepted.has(message.idempotencyKey)) accepted.set(message.idempotencyKey, message);
			requests++;
			if (requests === 1) throw new Error("Provider accepted the email but its response timed out");
		};
		await h.run(); h.advance();
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(requests, 2);
		assert.equal(accepted.size, 1);
		assert.equal(await h.status(SENDER), "sent");
	});
});
