import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { z } from "zod";
import {
	type GmailFilterRewriteFailedLine,
	GmailFilterRewrittenEvent,
	GmailForwardingConfirmedEvent,
	type HutchEvent,
	RewriteGmailFilterCommand,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { AliasNameSchema } from "@packages/domain/inbox";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { GMAIL_SCOPES } from "@packages/provider-contracts/gmail-oauth";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryGmailFilters } from "@packages/test-fixtures/providers/gmail-filters";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initGmailForwardingConfirmedHandler } from "../../../domain/gmail/gmail-forwarding-confirmed-handler";
import { initRewriteGmailFilter } from "../../../domain/gmail/rewrite-gmail-filter";
import { initRewriteGmailFilterHandler } from "../../../domain/gmail/rewrite-gmail-filter-handler";
import { initHandleByDetailType } from "../../../handle-by-detail-type";
import { loginAgent, useTestServer } from "../../../test-app";

// The confirmation leg had never completed once in prod or staging (commit
// 3bcecf5a): the web routes, the rewrite Lambda, and the shared events are each
// tested in isolation. This drives connect + callback through HTTP, feeds the
// same GmailForwardingConfirmedEvent shape the inbox half emits into the Lambda
// wired the way the composition root wires it, maps a sender through the page,
// and asserts the filter the fake Gmail holds and the mapping the page reads back.

const useApp = useTestServer();
const NOW = new Date("2026-08-27T00:00:00.000Z");
const CONNECT = "/integrations/gmail/connect";
const CALLBACK = "/integrations/gmail/callback";
const GMAIL_PAGE = "/integrations/gmail";

type Published = { event: HutchEvent<z.ZodTypeAny>; detail: unknown };

describe("gmail forwarding chain (hutch half)", () => {
	it("connects, confirms, and writes the forwarding filter for the first mapped sender", async () => {
		const gmail = initInMemoryGmailIntegration({
			grant: {
				ok: true,
				grant: { refreshToken: "refresh", accessToken: "access", grantedScope: GMAIL_SCOPES },
			},
			accountEmail: { ok: true, value: GmailAccountEmailSchema.parse("reader@gmail.com") },
			now: () => NOW,
		});
		const gmailFilters = initInMemoryGmailFilters();
		const logger = HutchLogger.from(noopLogger);

		const published: Published[] = [];
		const publishEvent = (async (event, detail) => {
			published.push({ event, detail: event.detailSchema.parse(detail) });
		}) as PublishEvent;
		let drained = 0;
		const newlyPublished = () => {
			const fresh = published.slice(drained);
			drained = published.length;
			return fresh;
		};

		// The rewrite Lambda, wired the way rewrite-gmail-filter.main.ts wires it,
		// minus only the disconnect route.
		const rewriteGmailFilter = initRewriteGmailFilter({
			filters: gmailFilters.api,
			connections: gmail.bundle.gmailConnectionStore,
			senders: gmail.bundle.gmailSenderStore,
			addresses: gmail.addresses,
			now: () => NOW,
			logger,
		});
		const lambda = initHandleByDetailType({
			routes: {
				[RewriteGmailFilterCommand.detailType]: [
					initRewriteGmailFilterHandler({
						rewriteGmailFilter,
						publishEvent,
						metricLog: HutchLogger.fromJSON<GmailFilterRewriteFailedLine>(),
						logger,
					}),
				],
				[GmailForwardingConfirmedEvent.detailType]: [
					initGmailForwardingConfirmedHandler({
						connections: gmail.bundle.gmailConnectionStore,
						publishEvent,
						logger,
					}),
				],
			},
			logger,
		});
		const runLambda = (detailType: string, detail: unknown, messageId: string) =>
			lambda(
				buildSqsEvent([{ messageId, body: JSON.stringify({ "detail-type": detailType, detail }) }]),
				buildLambdaContext(),
				() => {},
			);

		const harness = useApp({ ...createDefaultTestAppFixture(TEST_APP_ORIGIN), gmailIntegration: gmail.bundle });
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");

		// (1) connect + callback → a connection with a minted, unconfirmed gateway.
		const started = await agent.post(CONNECT).send();
		const state = new URL(started.headers.location).searchParams.get("state") ?? "";
		const callback = await agent.get(CALLBACK).query({ code: "auth-code", state });
		assert.equal(callback.status, 303);
		assert.equal(callback.headers.location, "/integrations/gmail?notice=connected");
		const connection = await gmail.bundle.gmailConnectionStore.findConnectionByUserId(userId);
		assert(connection?.gatewayAddress, "the callback must mint a gateway on first connect");
		const gateway = connection.gatewayAddress;
		const gatewayEntry = await gmail.addresses.findByAddress(gateway);
		assert.equal(gatewayEntry?.purpose, "gmail-forwarding");
		assert.equal(connection.forwardingConfirmedAt, undefined);

		// (2) the confirmed event (the shape the inbox half publishes) stamps the
		// connection and asks for a rewrite.
		const confirmedDetail = GmailForwardingConfirmedEvent.detailSchema.parse({
			userId,
			forwardingAddress: gateway,
		});
		const confirmedRun = await runLambda(GmailForwardingConfirmedEvent.detailType, confirmedDetail, "evt-1");
		assert(confirmedRun);
		assert.deepEqual(confirmedRun.batchItemFailures, []);
		assert.equal(
			(await gmail.bundle.gmailConnectionStore.findConnectionByUserId(userId))?.forwardingConfirmedAt,
			NOW.toISOString(),
		);
		const afterConfirm = newlyPublished();
		assert.equal(afterConfirm.length, 1);
		assert.equal(afterConfirm[0].event, RewriteGmailFilterCommand);
		assert.deepEqual(afterConfirm[0].detail, { userId, reason: "forwarding-confirmed" });

		// (3) draining that command with no senders yet reconciles to zero filters.
		const zeroRun = await runLambda(RewriteGmailFilterCommand.detailType, afterConfirm[0].detail, "cmd-1");
		assert(zeroRun);
		assert.deepEqual(zeroRun.batchItemFailures, []);
		assert.deepEqual(gmailFilters.created, []);
		const afterZero = newlyPublished();
		assert.equal(afterZero.length, 1);
		assert.equal(afterZero[0].event, GmailFilterRewrittenEvent);
		assert.deepEqual(afterZero[0].detail, { userId, senderCount: 0 });

		// (4) seed discovery (the page tests seed it, not run it), then map a sender.
		const senderEmail = ForwardableSenderSchema.parse("dan@tldr.tech");
		const discovery = gmail.bundle.gmailDiscoveryStore;
		await discovery.startDiscovery({
			userId,
			accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
			gatewayAddress: gateway,
			generation: "initial",
			mode: "full",
			historyId: "100",
		});
		await discovery.claimPage({ userId, generation: "initial", page: 0 });
		const previous = await discovery.findDiscoveryByUserId(userId);
		assert(previous);
		await discovery.savePage({
			previous,
			senders: [{ email: senderEmail, name: "TLDR" }],
			mode: "full",
			pageToken: undefined,
			historyId: "100",
			state: "complete",
			scannedMessages: 1,
			estimatedTotalMessages: 1,
			oldestScannedAt: undefined,
		});

		const added = await agent
			.post("/integrations/gmail/senders/add")
			.type("form")
			.send({ sender: senderEmail, destination: "new", inbox_name: "tldr" });
		assert.equal(added.status, 303);
		assert.equal(added.headers.location, "/integrations/gmail?notice=inbox_created&discovery=started");
		assert.deepEqual(gmail.rewriteRequests, [{ userId, reason: "sender-added" }]);
		const senderRow = await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail });
		assert(senderRow?.mappedAddress, "the sender must be mapped to a live inbox");
		const mapped = senderRow.mappedAddress;
		const mappedEntry = await gmail.addresses.findByAddress(mapped);
		assert.equal(mappedEntry?.purpose, "gmail-mapped");
		assert.equal(mappedEntry?.name, AliasNameSchema.parse("tldr"));

		// (5) draining the sender-added rewrite forwards the unconfirmed inbox via
		// the gateway and records the filter on the connection.
		const [rewriteRequest] = gmail.rewriteRequests;
		const senderRun = await runLambda(
			RewriteGmailFilterCommand.detailType,
			{ userId: rewriteRequest.userId, reason: rewriteRequest.reason },
			"cmd-2",
		);
		assert(senderRun);
		assert.deepEqual(senderRun.batchItemFailures, []);
		assert.deepEqual(gmailFilters.created, [{ query: "from:(dan@tldr.tech)", forwardTo: gateway }]);
		const filteredConnection = await gmail.bundle.gmailConnectionStore.findConnectionByUserId(userId);
		assert.equal(filteredConnection?.filterCount, 1);
		assert.equal(filteredConnection?.filterSenderCount, 1);
		const afterSender = newlyPublished();
		assert.equal(afterSender.length, 1);
		assert.equal(afterSender[0].event, GmailFilterRewrittenEvent);
		assert.deepEqual(afterSender[0].detail, { userId, senderCount: 1 });

		// (6) the page reads back the mapping the workers wrote.
		const page = await agent.get(GMAIL_PAGE);
		assert.equal(page.status, 200);
		const { document } = new JSDOM(page.text).window;
		const mapping = document.querySelector(`[data-test-gmail-mapping="${mapped}"]`);
		assert(mapping, "the mapped inbox must appear in the mapping list");
		assert(
			mapping.querySelector(`[data-test-gmail-mapped-sender="${senderEmail}"]`),
			"the mapped sender must appear under its inbox",
		);
	});
});
