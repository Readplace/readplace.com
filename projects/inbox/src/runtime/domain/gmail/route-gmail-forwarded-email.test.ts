import assert from "node:assert/strict";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import type { ParsedEmail } from "@packages/domain/inbox";
import { InboxAddressSchema, MessageIdSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryGmailHeldMail } from "@packages/test-fixtures/providers/gmail-held-mail";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { initRouteGmailForwardedEmail } from "./route-gmail-forwarded-email";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const ALIAS = InboxAddressSchema.parse("tldr-b8c3d0@read.place");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const RECEIVED_AT = "2026-08-27T00:00:00.000Z";

function forwardedEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
	return {
		from: TLDR,
		subject: "TLDR 2026-08-27",
		text: "today's links",
		html: "<p>today's links</p>",
		messageId: MessageIdSchema.parse("<tldr@mail.tldr.tech>"),
		receivedAt: RECEIVED_AT,
		inlineImages: [],
		listUnsubscribeUrls: [],
		googleAddressConfirmation: undefined,
		...overrides,
	};
}

function harness() {
	const senders = initInMemoryGmailSender({ now: () => new Date(RECEIVED_AT) });
	const heldMail = initInMemoryGmailHeldMail();
	const route = initRouteGmailForwardedEmail({
		senders,
		heldMail,
		logger: HutchLogger.from(noopLogger),
	});
	const run = (email: ParsedEmail = forwardedEmail()) =>
		route({
			userId: USER,
			gatewayAddress: GATEWAY,
			email,
			receivedAtMessageId: `${RECEIVED_AT}#${email.messageId}`,
			receivedAt: RECEIVED_AT,
			rawEmailS3Key: "raw/user-1/tldr.eml",
		});
	return { run, senders, heldMail };
}

describe("initRouteGmailForwardedEmail", () => {
	it("delivers to the alias the reader mapped the sender to", async () => {
		const { run, senders } = harness();
		await senders.mapSenderToAddress({ userId: USER, senderEmail: TLDR, mappedAddress: ALIAS });

		assert.equal(await run(), ALIAS);
	});

	it("holds mail from a sender the reader has not mapped yet", async () => {
		const { run, heldMail } = harness();

		assert.equal(await run(), undefined);

		const held = await heldMail.listHeldMailBySender({
			userId: USER,
			senderEmail: TLDR,
			limit: 5,
		});
		assert.deepEqual(held, [
			{
				userId: USER,
				receivedAtMessageId: `${RECEIVED_AT}#<tldr@mail.tldr.tech>`,
				senderEmail: TLDR,
				subject: "TLDR 2026-08-27",
				receivedAt: RECEIVED_AT,
				rawEmailS3Key: "raw/user-1/tldr.eml",
				recipientAddress: GATEWAY,
			},
		]);
	});

	it("records every sighting so the reader can recognise the sender", async () => {
		const { run, senders } = harness();

		await run();
		await run(forwardedEmail({ subject: "TLDR 2026-08-28" }));

		const sender = await senders.findSender({ userId: USER, senderEmail: TLDR });
		assert.equal(sender?.seenCount, 2);
		assert.equal(sender?.lastSubject, "TLDR 2026-08-28");
		assert.equal(sender?.addedToFilterAt, undefined);
	});

	it("leaves mail whose sender it cannot read in the gateway inbox", async () => {
		const { run, heldMail } = harness();

		const delivered = await run(forwardedEmail({ from: "Dan <dan at tldr>" }));

		assert.equal(delivered, GATEWAY);
		assert.deepEqual(
			await heldMail.listHeldMailBySender({ userId: USER, senderEmail: TLDR, limit: 5 }),
			[],
		);
	});
});
