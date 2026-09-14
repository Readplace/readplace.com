import assert from "node:assert/strict";
import type { z } from "zod";
import {
	ConfirmGmailForwardingCommand,
	EmailReceivedEvent,
	GmailForwardingConfirmedEvent,
	type HutchEvent,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { AliasNameSchema, GMAIL_FORWARDING_ALIAS, parseEmail } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryGmailHeldMail } from "@packages/test-fixtures/providers/gmail-held-mail";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initInMemoryInboxEmail } from "@packages/test-fixtures/providers/inbox-email";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initConfirmForwardingAddress } from "./confirm-forwarding-address";
import { initConfirmGmailForwardingHandler } from "./confirm-gmail-forwarding-handler";
import { initRouteGmailForwardedEmail } from "./route-gmail-forwarded-email";
import { initInterceptGmailConfirmation } from "../inbox/intercept-gmail-confirmation";
import { initReceiveEmailHandler } from "../inbox/receive-email-handler";

// The whole confirmation leg had never completed once in production or staging
// (commit 3bcecf5a): every hop is unit-tested against stubbed neighbours, so no
// test ran Google's real confirmation message, then a real newsletter, through
// the receive → intercept → confirm → route code the way the deployed workers
// wire it. This test does, meeting the hutch half at the shared event schemas.

const RECEIVED_AT = "2026-08-27T00:00:00.000Z";
// A real capture (2026-08-24) of the vf- confirm link Google mails to the gateway.
const VERIFY_PATH =
	"/mail/vf-%5BANGjdJ_HBdB9U6XGMf6d_lgGyXVy3LZxppBS1h68jxB5p0fvJA3XVbwLd5xcY68i30P2TCd3aE%5D-M8fzAOTZVlVJYOhyQMmbMDWQVks";

type Published = { event: HutchEvent<z.ZodTypeAny>; detail: unknown };

function makeInbox() {
	const now = () => new Date(RECEIVED_AT);
	const addresses = initInMemoryInboxAddress({ now });
	const emails = initInMemoryInboxEmail();
	const senders = initInMemoryGmailSender({ now });
	const heldMail = initInMemoryGmailHeldMail();
	const rawMap = new Map<string, Buffer>();
	const logger = HutchLogger.from(noopLogger);

	// The join point: every publish is validated against its own detailSchema
	// exactly as initEventBridgePublisher does before it hits the wire.
	const published: Published[] = [];
	const publishEvent = (async (event, detail) => {
		published.push({ event, detail: event.detailSchema.parse(detail) });
	}) as PublishEvent;

	const fetchCalls: { url: string; method: string | undefined; body: unknown }[] = [];
	const confirmationFetch: typeof globalThis.fetch = async (input, init) => {
		fetchCalls.push({ url: String(input), method: init?.method, body: init?.body });
		return new Response(
			"<html><head><title>Confirmation Success!</title></head><body><p>ok</p></body></html>",
			{ status: 200, headers: { "content-type": "text/html" } },
		);
	};

	const receive = initReceiveEmailHandler({
		readRawEmail: async (key) => rawMap.get(key),
		findByAddress: addresses.findByAddress,
		putEmail: emails.putEmail,
		parseEmail,
		downloadEmailImages: async () => [],
		storeBody: async () => "content/email/content.html",
		publishEvent,
		interceptGmailConfirmation: initInterceptGmailConfirmation({
			publishConfirmGmailForwarding: (detail) => publishEvent(ConfirmGmailForwardingCommand, detail),
			logger,
		}),
		routeGmailForwardedEmail: initRouteGmailForwardedEmail({ senders, heldMail, logger }),
		logger,
		maxEmailBytes: 20 * 1024 * 1024,
	});

	const confirm = initConfirmGmailForwardingHandler({
		confirmForwardingAddress: initConfirmForwardingAddress({ fetch: confirmationFetch, timeoutMs: 5_000 }),
		publishEvent,
		logger,
	});

	return { addresses, emails, senders, heldMail, rawMap, published, fetchCalls, receive, confirm };
}

function sesNotification(input: { messageId: string; objectKey: string; recipient: string }): string {
	return JSON.stringify({
		mail: { messageId: input.messageId },
		receipt: {
			timestamp: RECEIVED_AT,
			recipients: [input.recipient],
			action: { objectKey: input.objectKey },
		},
	});
}

function asSqsRecord(messageId: string, entry: Published) {
	return {
		messageId,
		body: JSON.stringify({
			"detail-type": entry.event.detailType,
			source: entry.event.source,
			detail: entry.detail,
		}),
	};
}

/** Google's real forwarding confirmation, addressed to the gateway mailbox, with
 * the vf- link on mail-settings.google.com the interceptor rewrites to mail.google.com. */
function googleConfirmationEml(gateway: string): Buffer {
	return Buffer.from(
		[
			"From: Gmail Team <forwarding-noreply@google.com>",
			`To: ${gateway}`,
			"Subject: (Gmail Forwarding Confirmation - Receive Mail from reader@gmail.com",
			"Message-ID: <CAD4-confirmation@mail.gmail.com>",
			"MIME-Version: 1.0",
			'Content-Type: text/plain; charset="UTF-8"',
			"X-Google-Address-Confirmation: IxoQly5DrG25IVlwjJRM-AqecpU",
			"",
			`reader@gmail.com has requested to automatically forward mail to your address ${gateway}.`,
			"",
			"To allow reader@gmail.com to automatically forward mail to your address,",
			"please click the link below to confirm the request:",
			"",
			`https://mail-settings.google.com${VERIFY_PATH}`,
			"",
		].join("\r\n"),
		"utf8",
	);
}

function newsletterEml(input: { gateway: string; messageId: string }): Buffer {
	return Buffer.from(
		[
			"From: TLDR <dan@tldr.tech>",
			`To: ${input.gateway}`,
			"Subject: TLDR 2026-08-27",
			`Message-ID: ${input.messageId}`,
			"MIME-Version: 1.0",
			'Content-Type: text/plain; charset="UTF-8"',
			"",
			"today's links: https://example.com/a",
			"",
		].join("\r\n"),
		"utf8",
	);
}

describe("gmail forwarding chain (inbox half)", () => {
	it("confirms Google's forwarding request from the gateway mailbox to the confirmed fact", async () => {
		const { addresses, emails, published, fetchCalls, rawMap, receive, confirm } = makeInbox();
		const userId = UserIdSchema.parse("00000000000000000000000000000001");
		const gateway = (
			await addresses.createAddress({
				userId,
				domain: "read.place",
				name: GMAIL_FORWARDING_ALIAS,
				purpose: "gmail-forwarding",
			})
		).address;

		const objectKey = "inbound/confirmation";
		rawMap.set(objectKey, googleConfirmationEml(gateway));

		const received = await receive(
			buildSqsEvent([
				{ messageId: "ses-1", body: sesNotification({ messageId: "ses-msg-1", objectKey, recipient: gateway }) },
			]),
			buildLambdaContext(),
			() => {},
		);

		assert(received);
		assert.deepEqual(received.batchItemFailures, []);
		assert.deepEqual((await emails.listEmailsByUserId({ userId, cursor: undefined, pageSize: 10 })).emails, []);
		assert.equal(published.length, 1);
		assert.equal(published[0].event, ConfirmGmailForwardingCommand);
		assert.deepEqual(published[0].detail, {
			userId,
			forwardingAddress: gateway,
			verifyUrl: `https://mail.google.com${VERIFY_PATH}`,
		});

		const confirmed = await confirm(
			buildSqsEvent([asSqsRecord("cmd-1", published[0])]),
			buildLambdaContext(),
			() => {},
		);

		assert(confirmed);
		assert.deepEqual(confirmed.batchItemFailures, []);
		assert.deepEqual(fetchCalls, [
			{ url: `https://mail.google.com${VERIFY_PATH}`, method: "POST", body: undefined },
		]);
		assert.equal(published.length, 2);
		assert.equal(published[1].event, GmailForwardingConfirmedEvent);
		assert.deepEqual(published[1].detail, { userId, forwardingAddress: gateway });
	});

	it("holds a forwarded newsletter until the sender is mapped, then delivers it as the mapped inbox", async () => {
		const { addresses, emails, senders, heldMail, published, rawMap, receive } = makeInbox();
		const userId = UserIdSchema.parse("00000000000000000000000000000001");
		const senderEmail = ForwardableSenderSchema.parse("dan@tldr.tech");
		const gateway = (
			await addresses.createAddress({
				userId,
				domain: "read.place",
				name: GMAIL_FORWARDING_ALIAS,
				purpose: "gmail-forwarding",
			})
		).address;

		const firstKey = "inbound/newsletter-1";
		rawMap.set(firstKey, newsletterEml({ gateway, messageId: "<tldr-1@mail.tldr.tech>" }));
		const firstRun = await receive(
			buildSqsEvent([
				{ messageId: "ses-1", body: sesNotification({ messageId: "ses-msg-1", objectKey: firstKey, recipient: gateway }) },
			]),
			buildLambdaContext(),
			() => {},
		);

		assert(firstRun);
		assert.deepEqual(firstRun.batchItemFailures, []);
		assert.deepEqual((await emails.listEmailsByUserId({ userId, cursor: undefined, pageSize: 10 })).emails, []);
		assert.equal(published.length, 0);
		const held = await heldMail.listHeldMailBySender({ userId, senderEmail, limit: 5 });
		assert.equal(held.length, 1);
		assert.equal((await senders.findSender({ userId, senderEmail }))?.seenCount, 1);

		// The reader maps the sender to a new named inbox — exactly the three writes
		// the hutch senders/add page makes.
		const mapped = (
			await addresses.createAddress({
				userId,
				domain: "read.place",
				name: AliasNameSchema.parse("tldr"),
				purpose: "gmail-mapped",
			})
		).address;
		await senders.mapSenderToAddress({ userId, senderEmail, mappedAddress: mapped });
		await senders.addSenderToFilter({ userId, senderEmail });

		const secondKey = "inbound/newsletter-2";
		rawMap.set(secondKey, newsletterEml({ gateway, messageId: "<tldr-2@mail.tldr.tech>" }));
		const secondRun = await receive(
			buildSqsEvent([
				{ messageId: "ses-2", body: sesNotification({ messageId: "ses-msg-2", objectKey: secondKey, recipient: gateway }) },
			]),
			buildLambdaContext(),
			() => {},
		);

		assert(secondRun);
		assert.deepEqual(secondRun.batchItemFailures, []);
		const rows = (await emails.listEmailsByUserId({ userId, cursor: undefined, pageSize: 10 })).emails;
		assert.equal(rows.length, 1);
		assert.equal(rows[0].recipientAddress, mapped);
		assert.equal(rows[0].status, "received");
		assert.equal(published.length, 1);
		assert.equal(published[0].event, EmailReceivedEvent);
		assert.deepEqual(published[0].detail, {
			userId,
			receivedAtMessageId: `${RECEIVED_AT}#<tldr-2@mail.tldr.tech>`,
			recipientAddress: mapped,
			origin: "receive",
		});
	});
});
