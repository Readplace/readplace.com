import assert from "node:assert";
import { readFileSync } from "node:fs";
import cookieParser from "cookie-parser";
import express from "express";
import { z } from "zod";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import {
	EmailLinkOrdinalSchema,
	EmailLinkStatusSchema,
	InboxEmailStatusSchema,
	MessageIdSchema,
	AliasNameSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
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
	});
	res.json({ address });
});

server.post("/e2e/seed-email", async (req, res) => {
	const input = seedEmailSchema.parse(req.body);
	const userId = UserIdSchema.parse(await userIdFromSession(req));
	const messageId = MessageIdSchema.parse(input.messageId);
	const receivedAtMessageId = `${input.receivedAt}#${messageId}`;
	const kept = input.links.filter((link) => link.status !== "skipped").length;
	const skipped = input.links.length - kept;
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

	for (const [index, link] of input.links.entries()) {
		await fixture.inboxEmail.inboxEmailLinkStore.putLink({
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
		});
	}

	if (input.extractionFinished) {
		await fixture.inboxEmail.inboxEmailLinkStore.putLinksMeta({
			userId,
			receivedAtMessageId,
			meta: { truncated: false, extractionFailed: false },
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

// The shared shell loads htmx same-origin from /client-dist/htmx.client.js;
// production serves it from hutch's origin (this deployable sits behind hutch),
// but standalone e2e has no hutch, so serve the pinned build here — the article
// card's poll under test only begins once htmx runs. Send the read buffer rather
// than sendFile: Express 5 rejects the pnpm-symlinked node_modules path.
const htmxBundle = readFileSync(require.resolve("htmx.org/dist/htmx.min.js"));
server.get("/client-dist/htmx.client.js", (_req, res) => {
	res.type("text/javascript").send(htmxBundle);
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
