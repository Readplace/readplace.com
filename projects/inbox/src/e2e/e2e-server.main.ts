import assert from "node:assert";
import cookieParser from "cookie-parser";
import express from "express";
import { z } from "zod";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import {
	EmailLinkOrdinalSchema,
	EmailLinkStatusSchema,
	InboxEmailStatusSchema,
	InboxReadlistOutcomeSchema,
	isExcludedLink,
	MessageIdSchema,
	AliasNameSchema,
} from "@packages/domain/inbox";
import type { InboxEmailLinkEntry } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { ReadlistSlugSchema, readlistFitOverrideHost } from "@packages/domain/readlist";
import { createDefaultTestAppFixture } from "@packages/test-fixtures";
import { requireEnv } from "@packages/require-env";
import { READY_NONCE_ENV, readyProbePath } from "@packages/e2e-harness/ready-probe";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import { createInboxTestApp } from "../runtime/test-app";

const PORT = Number(requireEnv("E2E_PORT"));
const origin = `http://127.0.0.1:${PORT}`;
const logger = HutchLogger.from(consoleLogger);

const fixture = createDefaultTestAppFixture(origin);
// Stands in for the deployed round trip — publish, save-link accepts, LinkQueued
// lands, the subscriber stamps the read model — so the Saved chip can appear.
const { app } = createInboxTestApp(fixture, {
	publishSubmitLink: async ({ userId, url }) => {
		await fixture.inboxEmail.inboxSavedLinkStore.markLinkSaved({
			userId: UserIdSchema.parse(userId),
			url,
		});
	},
});

const seedEmailSchema = z.object({
	messageId: z.string().min(1),
	receivedAt: z.string().min(1),
	senderEmail: z.string(),
	subject: z.string(),
	status: InboxEmailStatusSchema.default("received"),
	links: z
		.array(
			z.object({
				url: z.string().min(1),
				status: EmailLinkStatusSchema,
				title: z.string().optional(),
			}),
		)
		.default([]),
	extractionFinished: z.boolean().default(true),
	selectedReadlists: z
		.array(z.object({ readlist: ReadlistSlugSchema, label: z.string().min(1) }))
		.optional(),
	readlistOutcomes: z.array(InboxReadlistOutcomeSchema).default([]),
	eligibleArticleCount: z.number().int().nonnegative().optional(),
	savesHeld: z.boolean().optional(),
	fitOverrides: z
		.array(
			z.object({
				readlist: ReadlistSlugSchema,
				ordinal: EmailLinkOrdinalSchema,
				readerVerdict: z.enum(["keep", "drop"]),
				createdAt: z.iso.datetime(),
			}),
		)
		.default([]),
});

const seedAddressSchema = z.object({ name: z.string().min(1) });
const resolveLinkSchema = z.object({
	receivedAtMessageId: z.string().min(1),
	ordinal: z.string().min(1),
	title: z.string().min(1),
});

const server = express();
server.use(express.json());
server.use(cookieParser());

server.get(readyProbePath(requireEnv(READY_NONCE_ENV)), (_req, res) => {
	res.status(200).end();
});

/** Each test seeds the state it needs through these routes rather than sharing a
 * boot-time fixture, so one spec's data can never explain another's result. */
server.post("/e2e/session", async (req, res) => {
	const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
	const created = await fixture.auth.createUser({ email, password: "password123" });
	assert(created.ok, "seeding an e2e user must succeed");
	const sessionId = await fixture.auth.createSession({
		userId: created.userId,
		emailVerified: true,
	});
	res.cookie(SESSION_COOKIE_NAME, sessionId, { httpOnly: true, path: "/" });
	res.json({ userId: created.userId });
});

async function userIdFromSession(req: express.Request): Promise<string> {
	const sessionId = req.cookies?.[SESSION_COOKIE_NAME] ?? "";
	const session = await fixture.auth.getSessionUserId(sessionId);
	assert(session, "the e2e seed routes require a session minted by POST /e2e/session");
	return session.userId;
}

server.post("/e2e/seed-address", async (req, res) => {
	const { name } = seedAddressSchema.parse(req.body);
	const userId = UserIdSchema.parse(await userIdFromSession(req));
	const address = await fixture.inboxAddress.inboxAddressStore.createAddress({
		userId,
		domain: fixture.inboxAddress.inboxAddressDomain,
		name: AliasNameSchema.parse(name),
		purpose: "user-alias",
	});
	res.json({ address });
});

server.post("/e2e/seed-email", async (req, res) => {
	const input = seedEmailSchema.parse(req.body);
	const userId = UserIdSchema.parse(await userIdFromSession(req));
	const messageId = MessageIdSchema.parse(input.messageId);
	const receivedAtMessageId = `${input.receivedAt}#${messageId}`;
	const rows: InboxEmailLinkEntry[] = input.links.map((link, index) => ({
		userId,
		receivedAtMessageId,
		ordinal: EmailLinkOrdinalSchema.parse(String(index).padStart(4, "0")),
		url: link.url,
		resolvedUrl: undefined,
		status: link.status,
		title: link.title,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: link.status === "skipped" ? "list-unsubscribe" : undefined,
		anchorText: undefined,
	}));
	const skipped = rows.filter(isExcludedLink).length;
	const kept = rows.length - skipped;
	// Addresses carry a minted token, so the recipient has to be one the store
	// actually created rather than a hand-written string.
	const [firstAddress] = await fixture.inboxAddress.inboxAddressStore.listAddressesByUserId(userId);
	assert(firstAddress, "seed an address before seeding mail for it");

	await fixture.inboxEmail.inboxEmailStore.putEmail({
		userId,
		recipientAddress: firstAddress.address,
		senderEmail: input.senderEmail,
		subject: input.subject,
		status: input.status,
		rawEmailS3Key: `inbound/${messageId}`,
		bodyS3Key: input.status === "received" ? `content/${messageId}/content.html` : undefined,
		linkCounts: input.extractionFinished ? { kept, skipped, truncated: false } : undefined,
		messageId,
		receivedAt: input.receivedAt,
		receivedAtMessageId,
	});

	for (const row of rows) {
		await fixture.inboxEmail.inboxEmailLinkStore.putLink(row);
		if (input.selectedReadlists !== undefined && !isExcludedLink(row)) {
			await fixture.inboxEmail.inboxSavedLinkStore.markLinkSaved({ userId, url: row.url });
		}
	}

	if (input.extractionFinished) {
		await fixture.inboxEmail.inboxEmailLinkStore.putLinksMeta({
			userId,
			receivedAtMessageId,
			meta: {
				truncated: false,
				extractionFailed: false,
				selectedReadlists: input.selectedReadlists,
				eligibleArticleCount: input.eligibleArticleCount,
				savesHeld: input.savesHeld,
			},
		});
		for (const outcome of input.readlistOutcomes) {
			await fixture.inboxEmail.inboxEmailLinkStore.putReadlistOutcome({
				userId,
				receivedAtMessageId,
				outcome,
			});
		}
	}

	for (const choice of input.fitOverrides) {
		const link = rows.find((row) => row.ordinal === choice.ordinal);
		assert(link, "a seeded readlist choice must name one of the seeded links");
		const outcome = input.readlistOutcomes.find((entry) => entry.readlist === choice.readlist);
		const engine = outcome?.fit.find((entry) => entry.ordinal === choice.ordinal);
		await fixture.articleStore.recordReadlistFitOverride({
			userId,
			readlist: choice.readlist,
			override: {
				url: link.url,
				anchorText: "",
				host: readlistFitOverrideHost(link.url),
				engineVerdict: engine?.verdict,
				engineReason: engine?.reason,
				readerVerdict: choice.readerVerdict,
				purposeVersion: outcome?.purposeVersion,
				receivedAtMessageId,
				ordinal: choice.ordinal,
				createdAt: new Date(choice.createdAt),
			},
		});
	}

	res.json({ emailId: receivedAtMessageId });
});

/** Flips a pending link terminal mid-test, which is what the card's 3s poll is
 * waiting for — the only way to exercise the real swap without a crawler. */
server.post("/e2e/resolve-link", async (req, res) => {
	const input = resolveLinkSchema.parse(req.body);
	const userId = UserIdSchema.parse(await userIdFromSession(req));
	await fixture.inboxEmail.inboxEmailLinkStore.setLinkOutcome({
		userId,
		receivedAtMessageId: input.receivedAtMessageId,
		ordinal: EmailLinkOrdinalSchema.parse(input.ordinal),
		outcome: {
			status: "crawled",
			title: input.title,
			excerpt: "Resolved by the e2e harness.",
			siteName: "Example",
			imageUrl: undefined,
			resolvedUrl: undefined,
		},
	});
	res.json({ ok: true });
});

server.use(app);

const listening = server.listen(PORT, "127.0.0.1");
listening.on("listening", () => {
	logger.info(`inbox e2e server running on ${origin}/inbox`);
});

// Exit rather than let the process drain: V8 flushes its coverage profile on a
// clean exit, and playwright SIGTERMs the web server between runs.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
	process.on(signal, () => {
		listening.close(() => process.exit(0));
	});
}
