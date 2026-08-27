import assert from "node:assert/strict";
import type { ParsedEmail } from "@packages/domain/inbox";
import {
	AliasNameSchema,
	buildInboxAddress,
	generateInboxToken,
	type InboxAddressEntry,
	type InboxAddressPurpose,
	MessageIdSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { GOOGLE_FORWARDING_SENDER } from "./google-confirmation-link";
import {
	type InterceptionRecipient,
	initInterceptGmailConfirmation,
} from "./intercept-gmail-confirmation";

const OWNER = UserIdSchema.parse("00000000000000000000000000000001");
const VERIFY_PATH = "/mail/vf-%5BANGjdJ_redacted%5D-M8fzAOTZ";

function confirmationEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
	return {
		from: GOOGLE_FORWARDING_SENDER,
		subject: "(Gmail Forwarding Confirmation - Receive Mail from reader@gmail.com",
		text: `please confirm:\n\nhttps://mail-settings.google.com${VERIFY_PATH}\n`,
		html: `<pre>https://mail-settings.google.com${VERIFY_PATH}</pre>`,
		messageId: MessageIdSchema.parse("<confirm@mail.gmail.com>"),
		receivedAt: "2026-08-27T00:00:00.000Z",
		inlineImages: [],
		listUnsubscribeUrls: [],
		googleAddressConfirmation: "IxoQly5DrG25IVlwjJRM-AqecpU",
		...overrides,
	};
}

function recipient(
	overrides: Partial<Omit<InboxAddressEntry, "purpose">> & {
		purpose?: InboxAddressPurpose;
	} = {},
): InterceptionRecipient {
	const token = generateInboxToken();
	const resolved: InboxAddressEntry = {
		address: buildInboxAddress({ name: AliasNameSchema.parse("gmail"), token, domain: "read.place" }),
		userId: OWNER,
		name: AliasNameSchema.parse("gmail"),
		token,
		createdAt: "2026-08-27T00:00:00.000Z",
		disabledAt: undefined,
		purpose: "gmail-forwarding",
		...overrides,
	};
	return { recipientAddress: resolved.address, resolved, userId: resolved.userId };
}

function harness() {
	const published: { userId: string; forwardingAddress: string; verifyUrl: string }[] = [];
	const intercept = initInterceptGmailConfirmation({
		publishConfirmGmailForwarding: async (detail) => {
			published.push(detail);
		},
		logger: HutchLogger.from(noopLogger),
	});
	return { intercept, published };
}

describe("initInterceptGmailConfirmation", () => {
	it("dispatches the confirmation for a live gateway address and claims the message", async () => {
		const { intercept, published } = harness();
		const gateway = recipient();

		const handled = await intercept({
			email: confirmationEmail(),
			resolvedRecipients: [gateway],
		});

		assert.equal(handled, true);
		assert.deepEqual(published, [
			{
				userId: OWNER,
				forwardingAddress: gateway.recipientAddress,
				verifyUrl: `https://mail.google.com${VERIFY_PATH}`,
			},
		]);
	});

	it("leaves an ordinary newsletter to the normal flow", async () => {
		const { intercept, published } = harness();

		const handled = await intercept({
			email: confirmationEmail({
				from: "news@example.com",
				googleAddressConfirmation: undefined,
				text: "no confirmation here",
			}),
			resolvedRecipients: [recipient({ purpose: "user-alias" })],
		});

		assert.equal(handled, false);
		assert.deepEqual(published, []);
	});

	it("leaves a confirmation addressed to a user alias to the normal flow", async () => {
		const { intercept, published } = harness();

		const handled = await intercept({
			email: confirmationEmail(),
			resolvedRecipients: [recipient({ purpose: "user-alias" })],
		});

		assert.equal(handled, false);
		assert.deepEqual(published, []);
	});

	it("never dispatches for a disabled gateway address", async () => {
		const { intercept, published } = harness();

		const handled = await intercept({
			email: confirmationEmail(),
			resolvedRecipients: [recipient({ disabledAt: "2026-08-27T01:00:00.000Z" })],
		});

		assert.equal(handled, false);
		assert.deepEqual(published, []);
	});

	it("never dispatches for an unknown recipient", async () => {
		const { intercept, published } = harness();
		const gateway = recipient();

		const handled = await intercept({
			email: confirmationEmail(),
			resolvedRecipients: [{ ...gateway, resolved: undefined }],
		});

		assert.equal(handled, false);
		assert.deepEqual(published, []);
	});

	it("never dispatches a co-addressed confirmation", async () => {
		const { intercept, published } = harness();

		const handled = await intercept({
			email: confirmationEmail(),
			resolvedRecipients: [recipient(), recipient()],
		});

		assert.equal(handled, false);
		assert.deepEqual(published, []);
	});
});
