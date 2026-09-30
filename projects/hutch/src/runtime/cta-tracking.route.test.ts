import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { AliasNameSchema } from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import { GMAIL_READONLY_SCOPE, GMAIL_SCOPES } from "@packages/provider-contracts/gmail-oauth";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { describeUntrackedCtas, findUntrackedCtas } from "@packages/web-test-harness";
import { BROWSER_REQUEST_HEADERS, loginAgent, useTestServer } from "./test-app";
import { initQueueDigestUnsubscribeToken } from "./domain/email/queue-digest-unsubscribe-token";
import { QUEUE_DIGEST_UNSUBSCRIBE_PATH } from "./web/queue-digest-email";

const useApp = useTestServer();

const ARTICLE_CONTENT_REGIONS = [
	"[data-test-reader-content]",
	// The past-reads compute triggers fire automatically on load rather than on a
	// reader click, so tagging them would count a click on every reader open.
	".past-reads__request",
];

const GUEST_PATHS = [
	"/",
	"/login",
	"/signup",
	"/forgot-password",
	"/install",
	"/install?client=chrome",
	"/install?client=iphone",
	"/install?client=chatgpt",
	"/install?client=gemini",
	"/install?client=claude",
	"/import",
	"/privacy",
	"/terms",
	"/support",
	"/help/add-links",
	"/mcp",
	"/pocket-alternative",
	"/pdf-ocr",
	"/ai-reading-list",
	"/read-it-later-that-wont-die",
	"/queue",
	"/save",
	"/view/not-a-url",
	"/no-such-page",
];

const MEMBER_PATHS = [
	"/queue",
	"/queue?tab=done",
	"/queue?q=article",
	"/account",
	"/account?section=subscription",
	"/account/plans",
	"/export",
	"/install",
	"/install?client=chrome",
	"/install?client=iphone",
	"/install?client=chatgpt",
	"/install?client=gemini",
	"/install?client=claude",
	"/import",
	"/import?mode=upload",
	"/integrations",
	"/mcp",
	"/save",
	"/view/not-a-url",
	"/no-such-page",
];

function untrackedOn(path: string, html: string): string[] {
	return describeUntrackedCtas(
		findUntrackedCtas(html, { skipSelectors: ARTICLE_CONTENT_REGIONS }),
	).map((line) => `${path}  ${line}`);
}

describe("every same-origin CTA carries its own utm_source", () => {
	it("holds across the logged-out funnel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await harness.auth.createUser({ email: "digest-reader@example.com", password: "password123" });
		const digestReader = await harness.auth.findUserByEmail("digest-reader@example.com");
		assert(digestReader, "the digest reader must exist");
		const unsubscribeQuery = new URLSearchParams({
			t: initQueueDigestUnsubscribeToken("test-analytics-salt").sign(digestReader.userId),
		});
		const untracked: string[] = [];
		for (const path of [
			...GUEST_PATHS,
			`${QUEUE_DIGEST_UNSUBSCRIBE_PATH}?${unsubscribeQuery.toString()}`,
		]) {
			const response = await request(harness.server).get(path).set(BROWSER_REQUEST_HEADERS);
			untracked.push(...untrackedOn(path, response.text));
		}

		expect(untracked).toEqual([]);
	});

	it("holds across the signed-in surfaces, including the reader", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const reader = await harness.auth.findUserByEmail("test@example.com");
		assert(reader, "the logged-in reader must exist");
		await harness.subscriptionProviders.upsertTrialing({
			userId: reader.userId,
			trialEndsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
		});
		await fixture.inboxAddress.inboxAddressStore.createAddress({
			userId: reader.userId,
			domain: fixture.inboxAddress.inboxAddressDomain,
			name: AliasNameSchema.parse("news"),
			purpose: "user-alias",
		});
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/article" });
		const queue = await agent.get("/queue").set(BROWSER_REQUEST_HEADERS);
		const readerHref = new JSDOM(queue.text).window.document
			.querySelector("[data-test-article-title]")
			?.getAttribute("href");
		const madeReadlist = new URL(
			(await agent.post("/queue/queues")).headers.location,
			TEST_APP_ORIGIN,
		).searchParams.get("queue");
		const readlistPaths = madeReadlist
			? [`/queue/queues/${madeReadlist}/preferences?feature=pref`]
			: [];

		const untracked: string[] = [];
		for (const path of [
			...MEMBER_PATHS,
			...readlistPaths,
			...(readerHref ? [readerHref] : []),
		]) {
			const response = await agent.get(path).set(BROWSER_REQUEST_HEADERS);
			untracked.push(...untrackedOn(path, response.text));
		}

		expect(readerHref).toContain("/view");
		expect(readlistPaths.length).toBe(1);
		expect(untracked).toEqual([]);
	});

	it("holds across the GMail Newsletters page with both pickers open, every mapping action and the import consent", async () => {
		const gmail = initInMemoryGmailIntegration({
			grant: { ok: true, grant: { refreshToken: "refresh", accessToken: "access", grantedScope: GMAIL_SCOPES } },
			addresses: initInMemoryInboxAddress({ now: () => new Date() }),
		});
		const harness = useApp({ ...createDefaultTestAppFixture(TEST_APP_ORIGIN), gmailIntegration: gmail.bundle });
		const agent = await loginAgent(harness.server, harness.auth);
		const reader = await harness.auth.findUserByEmail("test@example.com");
		assert(reader, "the logged-in reader must exist");
		const userId = reader.userId;
		const accountEmail = GmailAccountEmailSchema.parse("reader@gmail.com");
		const waiting = ForwardableSenderSchema.parse("dan@tldr.tech");
		const idle = ForwardableSenderSchema.parse("crew@morningbrew.com");
		const gatewayAddress = await gmail.bundle.mintGatewayAddress({ userId });
		await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress });
		await gmail.bundle.gmailConnectionStore.recordAccountEmail({ userId, accountEmail });
		await gmail.bundle.gmailConnectionStore.markForwardingConfirmed({ userId });
		await gmail.bundle.gmailCredentialsStore.saveCredentials({ userId, refreshToken: "refresh", grantedScope: GMAIL_SCOPES });
		await gmail.bundle.gmailDiscoveryStore.startDiscovery({ checkedMessageCount: 0, userId, accountEmail, gatewayAddress, generation: "initial", mode: "full", historyId: "100" });
		await gmail.bundle.gmailDiscoveryStore.claimPage({ userId, generation: "initial", page: 0 });
		const previous = await gmail.bundle.gmailDiscoveryStore.findDiscoveryByUserId(userId);
		assert(previous, "the seeded discovery must exist");
		await gmail.bundle.gmailDiscoveryStore.savePage({
			previous,
			senders: [{ email: waiting, name: "TLDR" }, { email: idle, name: "Morning Brew" }],
			mode: "full",
			pageToken: undefined,
			historyId: "100",
			state: "complete",
			scannedMessages: 2,
			estimatedTotalMessages: 2,
			oldestScannedAt: undefined,
		});
		const destination = await gmail.bundle.getOrCreateReadlistAddress({ userId, readlist: DEFAULT_READLIST_SLUG });
		for (const senderEmail of [waiting, idle]) {
			await gmail.bundle.gmailSenderStore.mapSenderToAddress({ userId, senderEmail, mappedAddress: destination.address });
			await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail });
		}
		await gmail.bundle.gmailHistoryImportStore.createJob({
			userId,
			jobId: gmail.bundle.newGmailHistoryImportJobId(),
			senderEmail: waiting,
			destinationAddress: destination.address,
			connection: { gatewayAddress, accountEmail },
			window: undefined,
			generation: "waiting",
			page: 0,
			pageToken: undefined,
			listingCompletedAt: undefined,
			state: "awaiting-permission",
			counts: { listed: 0, imported: 0, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: 0, cancelled: 0 },
			failureReason: undefined,
			cancelReason: undefined,
			createdAt: "2026-09-30T00:00:00.000Z",
			updatedAt: "2026-09-30T00:00:00.000Z",
			completedAt: undefined,
		});
		const pickerOpen = `/integrations/gmail?search=tldr&sender=${encodeURIComponent(waiting)}&readlist=default&edit=1&discovery=started`;
		const pages: [string, string][] = [];
		for (const path of [pickerOpen, "/integrations/gmail?advanced=1", "/integrations/gmail"]) {
			pages.push([path, (await agent.get(path).set(BROWSER_REQUEST_HEADERS)).text]);
		}
		await gmail.bundle.gmailCredentialsStore.saveCredentials({ userId, refreshToken: "refresh", grantedScope: `${GMAIL_SCOPES} ${GMAIL_READONLY_SCOPE}` });
		pages.push([pickerOpen, (await agent.get(pickerOpen).set(BROWSER_REQUEST_HEADERS)).text]);

		const rendered = pages.map(([, html]) => new JSDOM(html).window.document);
		const actionKeys = new Set(rendered.flatMap((doc) =>
			Array.from(doc.querySelectorAll("[data-test-gmail-mapping-action]"), (el) => el.getAttribute("data-test-gmail-mapping-action")),
		));
		expect([...actionKeys].sort()).toEqual(["cancel-import", "edit", "grant-import-permission", "remove", "retry-import", "start-import"]);
		expect(rendered[0]?.querySelector("[data-test-gmail-readlist-picker]")?.hasAttribute("open")).toBe(true);
		expect(pages.flatMap(([path, html]) => untrackedOn(path, html))).toEqual([]);
	});
});
