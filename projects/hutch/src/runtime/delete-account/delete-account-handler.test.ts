import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import {
	AliasNameSchema,
	DELETED_ACCOUNT_INBOX_OWNER,
	EmailLinkOrdinalSchema,
	InboxAddressSchema,
	MessageIdSchema,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryAuth } from "@packages/test-fixtures/providers/auth";
import { initInMemoryDigestQueue } from "@packages/test-fixtures/providers/digest-queue";
import {
	initInMemoryInboxAddress,
} from "@packages/test-fixtures/providers/inbox-address";
import {
	initInMemoryInboxEmail,
	initInMemoryInboxEmailLink,
} from "@packages/test-fixtures/providers/inbox-email";
import { initInMemoryIosOnboardingSignal } from "@packages/test-fixtures/providers/ios-onboarding-signal";
import {
	createRevokeAllUserOAuthTokens,
	initInMemoryOAuthModel,
} from "@packages/test-fixtures/providers/oauth";
import { initInMemoryReaderReadyState } from "@packages/test-fixtures/providers/reader-ready-state";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initDeleteAccountHandler } from "./delete-account-handler";
import { initNoopRevokeExternalIdpTokens } from "./revoke-external-idp-tokens";

const SEED_NOW = new Date("2026-07-05T00:00:00.000Z");
const COOLDOWN_MS = 1000 * 60 * 60 * 24 * 365;

function bodyFor(userId: string): string {
	return JSON.stringify({ detail: { userId } });
}

function articleMetadata(title: string) {
	return { title, siteName: "example.com", excerpt: "An excerpt", wordCount: 100 };
}

function sorted(values: string[]): string[] {
	return [...values].sort();
}

function buildSubject() {
	const auth = initInMemoryAuth({
		hashPassword: async (password) => `hashed:${password}`,
		verifyPassword: async (password, stored) => stored === `hashed:${password}`,
	});
	const oauthDeps = initInMemoryOAuthModel();
	const articleStore = initInMemoryArticleStore();
	const digest = initInMemoryDigestQueue();
	const readerReady = initInMemoryReaderReadyState();
	const onboarding = initInMemoryIosOnboardingSignal();
	const subs = initInMemorySubscriptionProviders({ now: () => SEED_NOW });
	const inboxEmail = initInMemoryInboxEmail();
	const inboxLink = initInMemoryInboxEmailLink();
	const inboxAddress = initInMemoryInboxAddress({ now: () => SEED_NOW });

	const cancelStripeCalls: Array<{ subscriptionId: string }> = [];
	const deleteCustomerCalls: Array<{ customerId: string }> = [];
	const deleteSubscriptionCalls: UserId[] = [];
	const trialEndCalls: UserId[] = [];
	const deferredCancelCalls: UserId[] = [];
	const trialFeedbackCalls: UserId[] = [];
	const rawEmailDeleteArgs: string[][] = [];
	const bodyEmailDeleteArgs: string[][] = [];
	const deleteExportsCalls: UserId[] = [];
	const passwordResetCalls: string[] = [];
	const revokeIdpCalls: UserId[] = [];

	// The noop is exercised through this wrapper so its own logging line stays
	// covered while the spy still records each invocation.
	const noopRevoke = initNoopRevokeExternalIdpTokens({ logger: HutchLogger.from(noopLogger) });

	// Test-only failure injection: the article-store fake throws for any user id
	// added here, so a batch can carry one poisoned record beside a healthy one.
	const articleDeleteThrowIds = new Set<string>();

	const handler = initDeleteAccountHandler({
		findEmailByUserId: auth.findEmailByUserId,
		findSubscriptionByUserId: subs.findByUserId,
		cancelStripeSubscription: async ({ subscriptionId }: { subscriptionId: string }) => {
			cancelStripeCalls.push({ subscriptionId });
		},
		deleteStripeCustomer: async ({ customerId }: { customerId: string }) => {
			deleteCustomerCalls.push({ customerId });
		},
		deleteSubscription: async ({ userId }: { userId: UserId }) => {
			deleteSubscriptionCalls.push(userId);
			await subs.deleteSubscription({ userId });
		},
		deleteTrialEndSchedule: async ({ userId }: { userId: UserId }) => {
			trialEndCalls.push(userId);
		},
		deleteDeferredCancellationSchedule: async ({ userId }: { userId: UserId }) => {
			deferredCancelCalls.push(userId);
		},
		deleteTrialFeedbackEmailSchedule: async ({ userId }: { userId: UserId }) => {
			trialFeedbackCalls.push(userId);
		},
		deleteAllInboxEmails: inboxEmail.deleteAllEmailsByUserId,
		deleteAllInboxLinks: inboxLink.deleteAllLinksByUserId,
		tombstoneInboxAddresses: inboxAddress.tombstoneUserAddresses,
		deleteRawEmailObjects: async (keys: string[]) => {
			rawEmailDeleteArgs.push(keys);
		},
		deleteEmailContentObjects: async (keys: string[]) => {
			bodyEmailDeleteArgs.push(keys);
		},
		deleteAllUserArticles: async (userId: UserId) => {
			if (articleDeleteThrowIds.has(userId)) {
				throw new Error("simulated deleteAllUserArticles failure");
			}
			await articleStore.deleteAllUserArticles(userId);
		},
		deleteDigestByUser: digest.deleteDigestByUser,
		deleteReaderReadyState: readerReady.deleteReaderReadyState,
		deleteOnboarding: onboarding.deleteOnboarding,
		deleteUserExports: async (userId: UserId) => {
			deleteExportsCalls.push(userId);
		},
		deletePasswordResetTokensByEmail: async (email: string) => {
			passwordResetCalls.push(email);
		},
		revokeExternalIdpTokens: async (userId: UserId) => {
			revokeIdpCalls.push(userId);
			await noopRevoke(userId);
		},
		revokeAllUserOAuthTokens: createRevokeAllUserOAuthTokens(oauthDeps),
		destroyUserSessions: auth.destroyUserSessions,
		closeUserAccount: auth.closeUserAccount,
		logger: HutchLogger.from(noopLogger),
	});

	return {
		handler,
		auth,
		oauthDeps,
		articleStore,
		digest,
		readerReady,
		onboarding,
		subs,
		inboxEmail,
		inboxLink,
		inboxAddress,
		cancelStripeCalls,
		deleteCustomerCalls,
		deleteSubscriptionCalls,
		trialEndCalls,
		deferredCancelCalls,
		trialFeedbackCalls,
		rawEmailDeleteArgs,
		bodyEmailDeleteArgs,
		deleteExportsCalls,
		passwordResetCalls,
		revokeIdpCalls,
		failArticleDeleteFor: (userId: UserId): void => {
			articleDeleteThrowIds.add(userId);
		},
	};
}

type Subject = ReturnType<typeof buildSubject>;

interface SeededAccount {
	userId: UserId;
	email: string;
	address: string;
	ramA: string;
	ramB: string;
	rawKeys: string[];
	bodyKeys: string[];
	sessionId: string;
}

async function seedAccount(
	s: Subject,
	opts: {
		label: string;
		email: string;
		subscription: "active" | "trialing" | "none";
	},
): Promise<SeededAccount> {
	const { label, email, subscription } = opts;
	const subscriptionId = `sub_${label}`;
	const customerId = `cus_${label}`;

	const created = await s.auth.createUser({ email, password: "password-123" });
	assert(created.ok, "expected the seeded user to be created");
	const userId = created.userId;
	const storedEmail = await s.auth.findEmailByUserId(userId);
	assert(storedEmail !== null, "expected the seeded user to resolve an email");
	const sessionId = await s.auth.createSession({ userId, emailVerified: true });

	await s.articleStore.saveArticle({
		userId,
		url: `https://example.com/${label}/article`,
		metadata: articleMetadata(`${label} article`),
		estimatedReadTime: MinutesSchema.parse(4),
	});

	await s.digest.enqueueDigestItem({
		userId,
		url: `https://example.com/${label}/digest`,
		enqueuedAt: SEED_NOW.toISOString(),
		retentionMs: COOLDOWN_MS,
	});

	const claimed = await s.readerReady.claimReaderReadyEmailSlot({
		userId,
		now: SEED_NOW,
		cooldownMs: COOLDOWN_MS,
	});
	assert(claimed, "expected the reader-ready slot to seed as claimed");

	await s.onboarding.recordIosSavedArticle({ userId });

	if (subscription === "active") {
		await s.subs.upsertActive({ userId, subscriptionId, customerId });
	} else if (subscription === "trialing") {
		await s.subs.upsertTrialing({ userId, trialEndsAt: "2026-08-01T00:00:00.000Z" });
	}

	const ramA = `2026-07-05T00:00:00.000Z#<${label}-a@x>`;
	const ramB = `2026-07-04T00:00:00.000Z#<${label}-b@x>`;
	const rawKeyA = `inbound/${label}-a`;
	const rawKeyB = `inbound/${label}-b`;
	const bodyKeyA = `content/${label}-a.html`;
	const recipientAddress = InboxAddressSchema.parse("in-3f9a2c@read.place");

	await s.inboxEmail.putEmail({
		userId,
		receivedAtMessageId: ramA,
		messageId: MessageIdSchema.parse(`<${label}-a@x>`),
		recipientAddress,
		senderEmail: "news@example.com",
		subject: "Received newsletter",
		status: "received",
		receivedAt: "2026-07-05T00:00:00.000Z",
		rawEmailS3Key: rawKeyA,
		bodyS3Key: bodyKeyA,
	});
	await s.inboxEmail.putEmail({
		userId,
		receivedAtMessageId: ramB,
		messageId: MessageIdSchema.parse(`<${label}-b@x>`),
		recipientAddress,
		senderEmail: "spam@example.com",
		subject: "Rejected message",
		status: "rejected",
		receivedAt: "2026-07-04T00:00:00.000Z",
		rawEmailS3Key: rawKeyB,
		bodyS3Key: undefined,
	});

	await s.inboxLink.putLink({
		userId,
		receivedAtMessageId: ramA,
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
		url: `https://example.com/${label}/link`,
		status: "pending",
		title: undefined,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
	});
	await s.inboxLink.putLinksMeta({
		userId,
		receivedAtMessageId: ramA,
		meta: { truncated: true },
	});

	const addressEntry = await s.inboxAddress.createAddress({
		userId,
		domain: "read.place",
		name: AliasNameSchema.parse("news"),
	});

	s.oauthDeps.userIdIndex.set(userId, new Set([`at-${label}`]));

	return {
		userId,
		email: storedEmail,
		address: addressEntry.address,
		ramA,
		ramB,
		rawKeys: [rawKeyA, rawKeyB],
		bodyKeys: [bodyKeyA],
		sessionId,
	};
}

/** A present reader-ready slot blocks a same-instant claim (returns false); an
 * absent slot allows it (returns true). This is the only readable signal the
 * fixture exposes, so deletion is inferred from a now-allowed claim. */
async function readerReadySlotPresent(s: Subject, userId: UserId): Promise<boolean> {
	const claimed = await s.readerReady.claimReaderReadyEmailSlot({
		userId,
		now: SEED_NOW,
		cooldownMs: COOLDOWN_MS,
	});
	return !claimed;
}

async function run(s: Subject, records: Array<{ messageId: string; body: string }>) {
	const result = await s.handler(buildSqsEvent(records), buildLambdaContext(), () => {});
	assert(result, "handler must return an SQSBatchResponse");
	return result;
}

describe("delete-account handler", () => {
	it("scrubs every user-owned store for the deleted account and leaves a second account untouched", async () => {
		const s = buildSubject();
		const victim = await seedAccount(s, {
			label: "u1",
			email: "u1@example.com",
			subscription: "active",
		});
		const bystander = await seedAccount(s, {
			label: "u2",
			email: "u2@example.com",
			subscription: "active",
		});

		const result = await run(s, [{ messageId: "msg-u1", body: bodyFor(victim.userId) }]);

		assert.deepEqual(result.batchItemFailures, []);

		// Victim: every store now returns empty / none.
		assert.equal((await s.articleStore.findArticlesByUser({ userId: victim.userId })).total, 0);
		assert.equal((await s.digest.listDigestItemsByUser(victim.userId)).length, 0);
		assert.equal(await readerReadySlotPresent(s, victim.userId), false);
		assert.deepEqual(await s.onboarding.getIosAppSignals({ userId: victim.userId }), {
			installed: false,
			savedArticle: false,
		});
		assert.equal(await s.subs.findByUserId(victim.userId), undefined);
		assert.equal((await s.inboxEmail.listEmailsByUserId(victim.userId)).length, 0);
		const victimLinks = await s.inboxLink.listLinksByEmail({
			userId: victim.userId,
			receivedAtMessageId: victim.ramA,
		});
		assert.equal(victimLinks.links.length, 0);
		assert.equal(victimLinks.meta, undefined);

		// Inbox address is tombstoned, not deleted: the row survives under the
		// reserved sentinel owner and no longer resolves for the victim.
		const tombstoned = await s.inboxAddress.findByAddress(InboxAddressSchema.parse(victim.address));
		assert(tombstoned, "expected the tombstoned address row to survive");
		assert.equal(tombstoned.userId, DELETED_ACCOUNT_INBOX_OWNER);
		assert.equal((await s.inboxAddress.listAddressesByUserId(victim.userId)).length, 0);

		// OAuth grants, sessions, and the identity row are gone.
		assert.equal(s.oauthDeps.userIdIndex.has(victim.userId), false);
		assert.equal(await s.auth.getSessionUserId(victim.sessionId), null);
		assert.equal(await s.auth.findEmailByUserId(victim.userId), null);

		// S3 object deletes received exactly the seeded raw + body keys.
		assert.equal(s.rawEmailDeleteArgs.length, 1);
		assert.deepEqual(sorted(s.rawEmailDeleteArgs[0]), sorted(victim.rawKeys));
		assert.equal(s.bodyEmailDeleteArgs.length, 1);
		assert.deepEqual(sorted(s.bodyEmailDeleteArgs[0]), sorted(victim.bodyKeys));

		// Password-reset tokens purged by the email captured before deletion.
		assert.deepEqual(s.passwordResetCalls, [victim.email]);

		// Billing side effects fired for the active subscription.
		assert.deepEqual(s.cancelStripeCalls, [{ subscriptionId: "sub_u1" }]);
		assert.deepEqual(s.deleteCustomerCalls, [{ customerId: "cus_u1" }]);
		assert.deepEqual(s.deleteSubscriptionCalls, [victim.userId]);
		assert.deepEqual(s.deleteExportsCalls, [victim.userId]);
		assert.deepEqual(s.revokeIdpCalls, [victim.userId]);

		// Bystander: everything intact.
		assert.equal((await s.articleStore.findArticlesByUser({ userId: bystander.userId })).total, 1);
		assert.equal((await s.digest.listDigestItemsByUser(bystander.userId)).length, 1);
		assert.equal(await readerReadySlotPresent(s, bystander.userId), true);
		assert.deepEqual(await s.onboarding.getIosAppSignals({ userId: bystander.userId }), {
			installed: true,
			savedArticle: true,
		});
		const bystanderSub = await s.subs.findByUserId(bystander.userId);
		assert(bystanderSub, "expected the bystander subscription to survive");
		assert.equal(bystanderSub.status, "active");
		assert.equal((await s.inboxEmail.listEmailsByUserId(bystander.userId)).length, 2);
		assert.equal(
			(
				await s.inboxLink.listLinksByEmail({
					userId: bystander.userId,
					receivedAtMessageId: bystander.ramA,
				})
			).links.length,
			1,
		);
		const bystanderAddress = await s.inboxAddress.findByAddress(
			InboxAddressSchema.parse(bystander.address),
		);
		assert(bystanderAddress, "expected the bystander address to survive");
		assert.equal(bystanderAddress.userId, bystander.userId);
		assert.equal((await s.inboxAddress.listAddressesByUserId(bystander.userId)).length, 1);
		assert.equal(s.oauthDeps.userIdIndex.has(bystander.userId), true);
		assert(await s.auth.getSessionUserId(bystander.sessionId));
		assert.equal(await s.auth.findEmailByUserId(bystander.userId), bystander.email);
	});

	it("active subscription branch — cancels Stripe, deletes the customer, and drops the local row", async () => {
		const s = buildSubject();
		const account = await seedAccount(s, {
			label: "active",
			email: "active@example.com",
			subscription: "active",
		});

		const result = await run(s, [{ messageId: "msg", body: bodyFor(account.userId) }]);

		assert.deepEqual(result.batchItemFailures, []);
		assert.deepEqual(s.cancelStripeCalls, [{ subscriptionId: "sub_active" }]);
		assert.deepEqual(s.deleteCustomerCalls, [{ customerId: "cus_active" }]);
		assert.deepEqual(s.deleteSubscriptionCalls, [account.userId]);
		assert.equal(await s.subs.findByUserId(account.userId), undefined);
	});

	it("trialing branch — no Stripe calls, but the row is dropped and all three schedules deleted", async () => {
		const s = buildSubject();
		const account = await seedAccount(s, {
			label: "trial",
			email: "trial@example.com",
			subscription: "trialing",
		});

		const result = await run(s, [{ messageId: "msg", body: bodyFor(account.userId) }]);

		assert.deepEqual(result.batchItemFailures, []);
		assert.deepEqual(s.cancelStripeCalls, []);
		assert.deepEqual(s.deleteCustomerCalls, []);
		assert.deepEqual(s.deleteSubscriptionCalls, [account.userId]);
		assert.deepEqual(s.trialEndCalls, [account.userId]);
		assert.deepEqual(s.deferredCancelCalls, [account.userId]);
		assert.deepEqual(s.trialFeedbackCalls, [account.userId]);
	});

	it("founding-member branch — no subscription row, so no billing calls, but the schedules are still deleted", async () => {
		const s = buildSubject();
		const account = await seedAccount(s, {
			label: "founder",
			email: "founder@example.com",
			subscription: "none",
		});

		const result = await run(s, [{ messageId: "msg", body: bodyFor(account.userId) }]);

		assert.deepEqual(result.batchItemFailures, []);
		assert.deepEqual(s.cancelStripeCalls, []);
		assert.deepEqual(s.deleteCustomerCalls, []);
		assert.deepEqual(s.deleteSubscriptionCalls, []);
		assert.deepEqual(s.trialEndCalls, [account.userId]);
		assert.deepEqual(s.deferredCancelCalls, [account.userId]);
		assert.deepEqual(s.trialFeedbackCalls, [account.userId]);
	});

	it("is idempotent — a second run against the now-empty account does not throw and reports no failures", async () => {
		const s = buildSubject();
		const account = await seedAccount(s, {
			label: "again",
			email: "again@example.com",
			subscription: "active",
		});

		const first = await run(s, [{ messageId: "msg-1", body: bodyFor(account.userId) }]);
		assert.deepEqual(first.batchItemFailures, []);

		// The identity row is gone, so the second run finds no email (email === null
		// branch) and no subscription — every teardown step is a stable no-op.
		const second = await run(s, [{ messageId: "msg-2", body: bodyFor(account.userId) }]);
		assert.deepEqual(second.batchItemFailures, []);

		// Billing and password-reset only fired on the first, data-bearing run.
		assert.deepEqual(s.cancelStripeCalls, [{ subscriptionId: "sub_again" }]);
		assert.deepEqual(s.passwordResetCalls, [account.email]);
	});

	it("reports the failing record in batchItemFailures while a second valid record in the same batch still succeeds", async () => {
		const s = buildSubject();
		const poisoned = await seedAccount(s, {
			label: "boom",
			email: "boom@example.com",
			subscription: "active",
		});
		const healthy = await seedAccount(s, {
			label: "ok",
			email: "ok@example.com",
			subscription: "active",
		});
		s.failArticleDeleteFor(poisoned.userId);

		const result = await run(s, [
			{ messageId: "msg-boom", body: bodyFor(poisoned.userId) },
			{ messageId: "msg-ok", body: bodyFor(healthy.userId) },
		]);

		assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "msg-boom" }]);
		// The healthy record processed to completion despite its sibling failing.
		assert.equal(await s.subs.findByUserId(healthy.userId), undefined);
		assert.equal((await s.articleStore.findArticlesByUser({ userId: healthy.userId })).total, 0);
		assert.equal(await s.auth.findEmailByUserId(healthy.userId), null);
	});

	it("invokes revokeExternalIdpTokens exactly once per deletion", async () => {
		const s = buildSubject();
		const account = await seedAccount(s, {
			label: "idp",
			email: "idp@example.com",
			subscription: "none",
		});

		await run(s, [{ messageId: "msg", body: bodyFor(account.userId) }]);

		assert.deepEqual(s.revokeIdpCalls, [account.userId]);
	});
});
