import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import type { InboxAddress, ParsedEmail } from "@packages/domain/inbox";
import { InboxAddressSchema, MessageIdSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger } from "@packages/hutch-logger";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailHeldMail } from "@packages/test-fixtures/providers/gmail-held-mail";
import { initInMemoryGmailMapping } from "@packages/test-fixtures/providers/gmail-mapping";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { initRouteGmailForwardedEmail } from "./route-gmail-forwarded-email";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const ALIAS = InboxAddressSchema.parse("tldr-b8c3d0@read.place");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const RECEIVED_AT = "2026-08-27T00:00:00.000Z";

function forwardedEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
	return {
		from: TLDR,
		fromName: "TLDR",
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

async function harness(options: { connectedAs?: typeof ACCOUNT | undefined } = { connectedAs: ACCOUNT }) {
	const now = () => new Date(RECEIVED_AT);
	const connections = initInMemoryGmailConnection({ now });
	const mappings = initInMemoryGmailMapping({ now });
	const senders = initInMemoryGmailSender({ now });
	if (options.connectedAs !== undefined) {
		await connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });
		await connections.recordAccountEmail({ userId: USER, accountEmail: options.connectedAs });
	}
	const heldMail = initInMemoryGmailHeldMail();
	const logs: { message: string; data: unknown }[] = [];
	const capture = (...args: unknown[]) => {
		logs.push({ message: String(args[0]), data: args[1] });
	};
	const route = initRouteGmailForwardedEmail({
		connections,
		mappings,
		senders,
		heldMail,
		logger: HutchLogger.from({
			info: capture,
			warn: capture,
			error: capture,
			debug: capture,
		}),
	});
	const run = (
		email: ParsedEmail = forwardedEmail(),
		options: {
			recipientAddress?: InboxAddress;
			purpose?: "gmail-forwarding" | "gmail-mapped";
		} = {},
	) =>
		route({
			userId: USER,
			recipientAddress: options.recipientAddress ?? GATEWAY,
			purpose: options.purpose ?? "gmail-forwarding",
			email,
			receivedAtMessageId: `${RECEIVED_AT}#${email.messageId}`,
			receivedAt: RECEIVED_AT,
			rawEmailS3Key: "raw/user-1/tldr.eml",
		});
	return { run, mappings, senders, heldMail, logs };
}

describe("initRouteGmailForwardedEmail", () => {
	it("delivers to the alias the reader mapped the sender to, with what the reader chose to save", async () => {
		const { run, mappings } = await harness();
		await mappings.mapSenderToAddress({
			userId: USER,
			accountEmail: ACCOUNT,
			senderEmail: TLDR,
			mappedAddresses: [ALIAS],
			deliveryMode: "issue",
		});

		assert.deepEqual(await run(), { destinationAddresses: [ALIAS], deliveryMode: "issue" });
	});

	it("holds mail from a sender mapped only under a Gmail account that is not the connected one", async () => {
		const { run, mappings } = await harness({ connectedAs: GmailAccountEmailSchema.parse("reader@work.example") });
		await mappings.mapSenderToAddress({
			userId: USER,
			accountEmail: ACCOUNT,
			senderEmail: TLDR,
			mappedAddresses: [ALIAS],
			deliveryMode: "links",
		});

		assert.equal(await run(), undefined);
	});

	it("delivers a named-inbox message as addressed once Gmail is no longer connected", async () => {
		const { run, mappings } = await harness({ connectedAs: undefined });
		await mappings.mapSenderToAddress({
			userId: USER,
			accountEmail: ACCOUNT,
			senderEmail: TLDR,
			mappedAddresses: [GATEWAY],
			deliveryMode: "links",
		});

		const delivered = await run(forwardedEmail(), { recipientAddress: ALIAS, purpose: "gmail-mapped" });

		assert.deepEqual(delivered, { destinationAddresses: [ALIAS], deliveryMode: "links" });
	});

	it("holds mail from a sender the reader has not mapped yet", async () => {
		const { run, heldMail } = await harness();

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
		const { run, senders } = await harness();

		await run();
		await run(forwardedEmail({ subject: "TLDR 2026-08-28" }));

		const sender = await senders.findSender({
			userId: USER,
			senderEmail: TLDR,
		});
		assert.equal(sender?.seenCount, 2);
		assert.equal(sender?.lastSubject, "TLDR 2026-08-28");
	});

	it("leaves mail whose sender it cannot read in the gateway inbox", async () => {
		const { run, heldMail } = await harness();

		const delivered = await run(forwardedEmail({ from: "Dan <dan at tldr>" }));

		assert.deepEqual(delivered, { destinationAddresses: [GATEWAY], deliveryMode: "links" });
		assert.deepEqual(
			await heldMail.listHeldMailBySender({
				userId: USER,
				senderEmail: TLDR,
				limit: 5,
			}),
			[],
		);
	});

	it("records a sighting for mail delivered straight to a named inbox from a known sender", async () => {
		const { run, mappings, senders } = await harness();
		await mappings.mapSenderToAddress({
			userId: USER,
			accountEmail: ACCOUNT,
			senderEmail: TLDR,
			mappedAddresses: [ALIAS],
			deliveryMode: "links",
		});

		const delivered = await run(
			forwardedEmail({ subject: "TLDR 2026-08-28" }),
			{
				recipientAddress: ALIAS,
				purpose: "gmail-mapped",
			},
		);

		assert.deepEqual(delivered, { destinationAddresses: [ALIAS], deliveryMode: "links" });
		const sender = await senders.findSender({
			userId: USER,
			senderEmail: TLDR,
		});
		assert.equal(sender?.lastSubject, "TLDR 2026-08-28");
	});

	it("does not mint a sender row for a hand-forwarded message to a named inbox", async () => {
		const { run, senders } = await harness();

		const delivered = await run(forwardedEmail(), {
			recipientAddress: ALIAS,
			purpose: "gmail-mapped",
		});

		assert.deepEqual(delivered, { destinationAddresses: [ALIAS], deliveryMode: "links" });
		assert.equal(
			await senders.findSender({ userId: USER, senderEmail: TLDR }),
			undefined,
		);
	});

	it("delivers a named inbox's mail as addressed, saving links, when its sender is in the filter but never mapped", async () => {
		const { run, mappings, senders } = await harness();
		await mappings.addSenderToFilter({ userId: USER, accountEmail: ACCOUNT, senderEmail: TLDR });

		const delivered = await run(forwardedEmail(), {
			recipientAddress: ALIAS,
			purpose: "gmail-mapped",
		});

		assert.deepEqual(delivered, { destinationAddresses: [ALIAS], deliveryMode: "links" });
		assert.equal((await senders.findSender({ userId: USER, senderEmail: TLDR }))?.seenCount, 1);
	});

	it("logs the held and unreadable paths by user id and never the sender or an inbox address", async () => {
		const { run, logs } = await harness();

		await run();
		await run(forwardedEmail({ from: "Dan <dan at tldr>" }));

		assert.deepEqual(
			logs.map((line) => line.message),
			[
				"[route-gmail-forwarded-email] held an unmapped sender",
				"[route-gmail-forwarded-email] unreadable sender, delivered as addressed",
			],
		);
		for (const line of logs) {
			const serialized = JSON.stringify(line);
			assert.equal(serialized.includes("tldr.tech"), false);
			assert.equal(serialized.includes(GATEWAY), false);
			assert.equal(serialized.includes(ALIAS), false);
			assert.equal(JSON.stringify(line.data).includes(USER), true);
		}
	});
});
