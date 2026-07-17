import assert from "node:assert";
import {
	AliasNameSchema,
	EmailLinkOrdinalSchema,
	InboxAddressSchema,
	MessageIdSchema,
} from "@packages/domain/inbox";
import type { InboxEmailEntry } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { SESSION_COOKIE_NAME, initResolveLogin } from "@packages/web-session";
import type { ResolveLogin } from "@packages/web-session";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { createInboxApp, PORT } from "./app";

const logger = HutchLogger.from(consoleLogger);

/** Local dev needs no AWS: in-memory stores seeded with a fixed dev user and a
 * couple of example newsletters, and a resolveLogin pinned to that user so
 * every request lands signed in (there is no /login here — hutch owns it). */
const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);

const RECIPIENT = InboxAddressSchema.parse("in-3f9a2c@read.place");

function emailEntry(
	userId: UserId,
	input: { messageId: string; receivedAt: string; senderEmail: string; subject: string },
): InboxEmailEntry {
	const messageId = MessageIdSchema.parse(input.messageId);
	return {
		userId,
		recipientAddress: RECIPIENT,
		senderEmail: input.senderEmail,
		subject: input.subject,
		status: "received",
		rawEmailS3Key: `inbound/${messageId}`,
		bodyS3Key: `content/${messageId}/content.html`,
		messageId,
		receivedAt: input.receivedAt,
		receivedAtMessageId: `${input.receivedAt}#${messageId}`,
	};
}

async function main(): Promise<void> {
	const created = await fixture.auth.createUser({
		email: "dev@readplace.com",
		password: "password123",
	});
	assert(created.ok, "seeding the dev user must succeed on a fresh in-memory store");
	const userId = created.userId;

	await fixture.inboxAddress.inboxAddressStore.createAddress({
		userId,
		domain: fixture.inboxAddress.inboxAddressDomain,
		name: AliasNameSchema.parse("dev"),
	});

	const receivedAt = new Date(Date.now() - 3_600_000).toISOString();
	const withLinks = emailEntry(userId, {
		messageId: "<digest@dev>",
		receivedAt,
		senderEmail: "news@example.com",
		subject: "Weekly digest",
	});
	await fixture.inboxEmail.inboxEmailStore.putEmail(withLinks);
	await fixture.inboxEmail.inboxEmailStore.putEmail(
		emailEntry(userId, {
			messageId: "<welcome@dev>",
			receivedAt: new Date(Date.now() - 7_200_000).toISOString(),
			senderEmail: "hello@example.com",
			subject: "Welcome to the newsletter",
		}),
	);
	await fixture.inboxEmail.inboxEmailLinkStore.putLink({
		userId,
		receivedAtMessageId: withLinks.receivedAtMessageId,
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
		url: "https://example.com/first-post",
		resolvedUrl: undefined,
		status: "crawled",
		title: "An example crawled article",
		excerpt: "A short excerpt stored with the crawl outcome.",
		siteName: "Example",
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: undefined,
	});
	await fixture.inboxEmail.inboxEmailLinkStore.putLink({
		userId,
		receivedAtMessageId: withLinks.receivedAtMessageId,
		ordinal: EmailLinkOrdinalSchema.parse("0001"),
		url: "https://example.com/second-post",
		resolvedUrl: undefined,
		status: "pending",
		title: undefined,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: undefined,
	});
	await fixture.inboxEmail.inboxEmailLinkStore.putLink({
		userId,
		receivedAtMessageId: withLinks.receivedAtMessageId,
		ordinal: EmailLinkOrdinalSchema.parse("0002"),
		url: "https://example.com/unsubscribe?token=dev",
		resolvedUrl: undefined,
		status: "skipped",
		title: undefined,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: "list-unsubscribe",
	});
	await fixture.inboxEmail.inboxEmailLinkStore.putLinksMeta({
		userId,
		receivedAtMessageId: withLinks.receivedAtMessageId,
		meta: { truncated: false },
	});

	// The fixed dev login rides the real session boundary: a session minted at
	// boot is resolved on every request as if its cookie were always present, so
	// the principal is branded by the same code path production uses.
	const sessionId = await fixture.auth.createSession({ userId, emailVerified: true });
	const sessionResolveLogin = initResolveLogin({
		getSessionUserId: fixture.auth.getSessionUserId,
		logger,
	});
	const resolveLogin: ResolveLogin = () =>
		sessionResolveLogin(`${SESSION_COOKIE_NAME}=${sessionId}`);

	const app = createInboxApp(
		{ inboxAddressDomain: fixture.inboxAddress.inboxAddressDomain },
		{
			resolveLogin,
			findUserById: fixture.auth.findUserById,
			markSessionEmailVerified: fixture.auth.markSessionEmailVerified,
			findSubscriptionByUserId: fixture.subscriptionProviders.findByUserId,
			getChangelogBanner: async () => undefined,
			inboxAddressStore: fixture.inboxAddress.inboxAddressStore,
			inboxEmailStore: fixture.inboxEmail.inboxEmailStore,
			inboxEmailLinkStore: fixture.inboxEmail.inboxEmailLinkStore,
			readEmailContent: async () => "<p>Example newsletter body for local dev.</p>",
			logError: (message, error) => logger.error(message, { error }),
			now: () => new Date(),
		},
	);

	app.listen(PORT, () => {
		logger.info(`inbox is running on http://localhost:${PORT}/inbox?feature=email`);
	});
}

void main();
