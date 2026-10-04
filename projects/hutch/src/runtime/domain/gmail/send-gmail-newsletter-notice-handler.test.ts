import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { NewsletterNameSchema, type DetectNewsletters } from "@packages/domain/newsletter-catalog";
import { GmailNewsletterNoticeProcessedEvent, SendGmailNewsletterNoticeCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
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
const ACCOUNT = GmailAccountEmailSchema.parse("gmail-user@gmail.com");
const GATEWAY = InboxAddressSchema.parse("gmail-reader@read.place");
const NOW = Date.parse("2026-10-04T00:00:00Z");

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
	await monitoring.observeSender({ checkpoint, observation: { email: SENDER, name: "Letter", approved: true }, notify: true });
	const published: { event: unknown; detail: unknown }[] = [];
	const sent: EmailMessage[] = [];
	const detectNewsletters: DetectNewsletters = async () => ({ status: "available", recognized: new Map([[SENDER, { from: SENDER, name: NewsletterNameSchema.parse("Example Letter"), source: "catalog", match: "exact" }]]) });
	const deps = { connections, monitoring, senders, detectNewsletters, findEmailByUserId: async (): Promise<string | null> => "readplace-account@example.com", sendEmail: async (message: EmailMessage) => { sent.push(message); }, founderAvatarUrl: "https://static.test/fayner.jpg", appOrigin: "https://readplace.test", now, publishEvent: (async (event, detail) => { published.push({ event, detail }); }) as PublishEvent, logger: HutchLogger.from(noopLogger) };
	async function run(records = [{ messageId: "notice", body: JSON.stringify({ detail: { userId: USER, senderEmail: SENDER } }) }]) {
		const response = await initSendGmailNewsletterNoticeHandler(deps)(buildSqsEvent(records), buildLambdaContext(), () => {}); assert(response); return response;
	}
	return { deps, checkpoint, connections, monitoring, senders, sent, published, run, advance: (ms = 120_001) => { instant += ms; } };
}

describe("approved Gmail newsletter notices", () => {
	it("sends once to the Readplace account email with a tracked sender-selected CTA and a permanent receipt", async () => {
		const h = await harness();
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent.length, 1);
		const message = h.sent[0];
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
		assert.equal((await h.monitoring.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "sent");
		await h.run();
		assert.equal(h.sent.length, 1);
		assert.deepEqual(h.published, [0, 1].map(() => ({ event: GmailNewsletterNoticeProcessedEvent, detail: { userId: USER, senderEmail: SENDER, outcome: "sent" } })));
	});
	it("supports nameless wildcard recognition and escapes catalog text in the email", async () => {
		const h = await harness();
		h.deps.detectNewsletters = async () => ({ status: "available", recognized: new Map([[SENDER, { from: SENDER, name: undefined, source: "catalog", match: "domain-wildcard" }]]) });
		await h.run(); assert.equal(h.sent[0].subject, `Choose readlists for ${SENDER}`);
		assert.match(h.sent[0].html, /Readplace recognizes this newsletter/);
		const other = await harness();
		other.deps.detectNewsletters = async () => ({ status: "available", recognized: new Map([[SENDER, { from: SENDER, name: NewsletterNameSchema.parse("<script>alert(1)</script>"), source: "catalog", match: "exact" }]]) });
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
		if (condition === "unapproved") h.deps.detectNewsletters = async () => ({ status: "available", recognized: new Map() });
		if (condition === "missing-email") h.deps.findEmailByUserId = async () => null;
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent.length, 0);
		assert.equal((await h.monitoring.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "cancelled");
		assert.deepEqual(h.published, [{ event: GmailNewsletterNoticeProcessedEvent, detail: { userId: USER, senderEmail: SENDER, outcome: "suppressed" } }]);
	});
	it("does not send an absent or cancelled pending notice", async () => {
		const h = await harness(); await h.monitoring.cancelNotice({ userId: USER, senderEmail: SENDER }); await h.run();
		await h.monitoring.deleteAllByUserId(USER); await h.run();
		assert.equal(h.sent.length, 0);
		assert.equal(h.published.length, 2);
	});
	it("retries catalog failures without claiming or mutating the pending notice", async () => {
		const h = await harness(); h.deps.detectNewsletters = async () => ({ status: "unavailable" });
		assert.deepEqual(await h.run(), { batchItemFailures: [{ itemIdentifier: "notice" }] });
		assert.equal((await h.monitoring.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "pending");
		assert.equal(h.sent.length, 0);
	});
	it("reuses the exact persisted payload after ambiguous transport failure despite catalog and user-email changes", async () => {
		const h = await harness();
		h.deps.sendEmail = async (message) => { h.sent.push(message); throw new Error("Transport timed out after acceptance"); };
		assert.deepEqual(await h.run(), { batchItemFailures: [{ itemIdentifier: "notice" }] });
		const first = h.sent[0];
		assert.equal((await h.monitoring.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "sending");
		h.advance();
		h.deps.findEmailByUserId = async () => "renamed-account@example.com";
		h.deps.detectNewsletters = async () => ({ status: "available", recognized: new Map([[SENDER, { from: SENDER, name: NewsletterNameSchema.parse("Renamed"), source: "catalog", match: "exact" }]]) });
		h.deps.sendEmail = async (message) => { h.sent.push(message); };
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.deepEqual(h.sent[1], first);
		assert.equal((await h.monitoring.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "sent");
	});
	it("retries an already claimed single-readlist notice with its original payload and retry key", async () => {
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
		assert.equal((await h.monitoring.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "sending");
	});
	it("event publication failure retries using the sent receipt rather than resending", async () => {
		const h = await harness(); h.deps.publishEvent = async () => { throw new Error("EventBridge failed"); };
		assert.deepEqual(await h.run(), { batchItemFailures: [{ itemIdentifier: "notice" }] });
		h.deps.publishEvent = async () => {};
		assert.deepEqual(await h.run(), { batchItemFailures: [] });
		assert.equal(h.sent.length, 1);
	});
	it("fails malformed records independently of valid tagged EventBridge commands", async () => {
		const h = await harness();
		assert.deepEqual(await h.run([
			{ messageId: "bad", body: "invalid" },
			{ messageId: "valid", body: JSON.stringify({ "detail-type": SendGmailNewsletterNoticeCommand.detailType, detail: { userId: USER, senderEmail: SENDER } }) },
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
		assert.equal((await h.monitoring.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "sent");
	});
});
