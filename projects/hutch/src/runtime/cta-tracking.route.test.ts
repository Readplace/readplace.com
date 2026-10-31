import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { ReaderArticleHashId } from "@packages/domain/article";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { AliasNameSchema } from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import { GMAIL_MODIFY_SCOPE, GMAIL_READONLY_SCOPE, GMAIL_SCOPES } from "@packages/provider-contracts/gmail-oauth";
import { PaymentMethodIdSchema } from "@packages/provider-contracts/payment-methods";
import { InvoiceIdSchema } from "@packages/provider-contracts/subscription-billing";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { describeUntrackedCtas, findUntrackedCtas } from "@packages/web-test-harness";
import { BROWSER_REQUEST_HEADERS, loginAgent, useTestServer } from "./test-app";
import { initQueueDigestMarkReadToken } from "./domain/email/queue-digest-mark-read-token";
import { initQueueDigestUnsubscribeToken } from "./domain/email/queue-digest-unsubscribe-token";
import { QUEUE_DIGEST_MARK_READ_PATH, QUEUE_DIGEST_UNSUBSCRIBE_PATH } from "./web/queue-digest-email";

const useApp = useTestServer();
const useArmB = useTestServer({ drawRandomByte: () => 128 });

const ARTICLE_CONTENT_REGIONS = ["[data-test-reader-content]"];

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
	"/install?client=android&feature=android",
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
	"/pdf-reflow",
	"/save-newsletter-links",
	"/article-to-epub",
	"/readwise-reader-alternative",
	"/queue",
	"/save",
	"/view/not-a-url",
	"/no-such-page",
];

const MEMBER_PATHS = [
	"/queue",
	"/queue?tab=done",
	"/queue?q=article",
	"/queue?q=no-such-words-anywhere",
	"/queue?time=5-10&saved=month",
	"/account",
	"/account?section=subscription",
	"/account?error=delete_confirmation",
	"/account?password=changed",
	"/account/password",
	"/account/plans",
	"/export",
	"/install",
	"/install?client=chrome",
	"/install?client=iphone",
	"/install?client=chatgpt",
	"/install?client=gemini",
	"/install?client=claude",
	"/install?client=android&feature=android",
	"/import",
	"/import?mode=upload",
	"/newsletters",
	"/queue?feature=pref",
	"/mcp",
	"/save",
	"/view/not-a-url",
	"/no-such-page",
];

function untrackedOn(path: string, html: string): string[] {
	return describeUntrackedCtas(
		findUntrackedCtas(html, { skipSelectors: ARTICLE_CONTENT_REGIONS, ownOrigin: TEST_APP_ORIGIN }),
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
		const markReadToken = initQueueDigestMarkReadToken("test-analytics-salt").sign({
			userId: digestReader.userId,
			articleIds: [ReaderArticleHashId.from("https://example.com/article")],
		});
		const untracked: string[] = [];
		for (const path of [
			...GUEST_PATHS,
			`${QUEUE_DIGEST_UNSUBSCRIBE_PATH}?${unsubscribeQuery.toString()}`,
			`${QUEUE_DIGEST_MARK_READ_PATH}?${new URLSearchParams({ t: markReadToken }).toString()}`,
			`${QUEUE_DIGEST_MARK_READ_PATH}?${new URLSearchParams({ t: markReadToken, done: "1" }).toString()}`,
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
		const articleId = new JSDOM(queue.text).window.document
			.querySelector("[data-test-article]")
			?.getAttribute("data-test-article");
		assert(articleId, "the saved article must be listed");
		const madeReadlist = new URL(
			(await agent.post("/queue/queues").type("form").send({ label: "New Readlist" })).headers.location,
			TEST_APP_ORIGIN,
		).searchParams.get("queue");
		const describedReadlist = new URL(
			(await agent.post("/queue/queues").type("form").send({ label: "Described Readlist" })).headers.location,
			TEST_APP_ORIGIN,
		).searchParams.get("queue");
		await agent
			.post(`/queue/queues/${describedReadlist}/preferences`)
			.type("form")
			.send({ purpose: "Essays on how teams actually ship." });
		assert(madeReadlist, "creating a readlist must land on it");
		await agent
			.post(`/queue/${articleId}/assign`)
			.type("form")
			.send({ queue: madeReadlist, returnTo: `/queue/${articleId}/view` });
		const readlistPaths =
			madeReadlist && describedReadlist
				? [
						`/queue?queue=${madeReadlist}&feature=pref`,
						`/queue/queues/${madeReadlist}/preferences?feature=pref`,
						`/queue/queues/${madeReadlist}/preferences/inboxes?feature=pref`,
						`/queue?moved_article=${articleId}&moved_from=default&moved_to=${madeReadlist}`,
						`/queue/queues/${describedReadlist}/preferences?feature=pref`,
						`/queue/${articleId}/view?filed_readlist=${madeReadlist}`,
					]
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
		expect(readlistPaths.length).toBe(6);
		expect(untracked).toEqual([]);
	});

	it("holds across the billing surfaces of a paying subscriber with saved cards and invoices", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const reader = await harness.auth.findUserByEmail("test@example.com");
		assert(reader, "the logged-in reader must exist");
		await harness.subscriptionProviders.upsertActive({
			userId: reader.userId,
			subscriptionId: "sub_billing_ctas",
			customerId: "cus_billing_ctas",
			plan: "monthly",
		});
		harness.paymentMethods.seedCards({
			customerId: "cus_billing_ctas",
			cards: [
				{ id: PaymentMethodIdSchema.parse("pm_billing_primary"), brand: "visa", last4: "4242", expMonth: 12, expYear: 2034, isPrimary: true },
				{ id: PaymentMethodIdSchema.parse("pm_billing_backup"), brand: "mastercard", last4: "5555", expMonth: 8, expYear: 2029, isPrimary: false },
			],
		});
		harness.subscriptionBilling.seedInvoices({
			customerId: "cus_billing_ctas",
			invoices: Array.from({ length: 13 }, (_, index) => {
				const n = String(index + 1).padStart(3, "0");
				return {
					id: InvoiceIdSchema.parse(`in_cta${n}`),
					number: `CTA-${n}`,
					issuedAt: new Date(Date.UTC(2026, 8 - index, 18)).toISOString(),
					amountPaidMinor: 1000,
					currency: "usd",
					hostedInvoiceUrl: `https://invoice.stripe.com/i/acct_test/in_cta${n}`,
				};
			}),
		});

		const pages: [string, string][] = [];
		for (const path of [
			"/account",
			"/account?manage=subscription",
			"/account?manage=payment",
			"/account/invoices",
			"/account/invoices?after=in_cta012",
		]) {
			pages.push([path, (await agent.get(path).set(BROWSER_REQUEST_HEADERS)).text]);
		}

		const rendered = pages.map(([, html]) => new JSDOM(html).window.document);
		const accountActions = new Set(rendered.flatMap((doc) =>
			Array.from(doc.querySelectorAll("[data-test-account-action]"), (el) => el.getAttribute("data-test-account-action")),
		));
		expect([...accountActions].sort()).toEqual([
			"cancel-form",
			"done",
			"manage-subscription",
			"update-payment",
			"view-invoices",
		]);
		expect(rendered.flatMap((doc) => Array.from(doc.querySelectorAll("a[data-test-invoices-newer], a[data-test-invoices-older]"), (el) => el.getAttribute("rel")))).toEqual([
			"next",
			"prev",
		]);
		expect(pages.flatMap(([path, html]) => untrackedOn(path, html))).toEqual([]);
	});

	it("holds across the GMail Newsletters page, its Add popup with both pickers open, its Edit popup, every mapping action and the import consent", async () => {
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
			await gmail.bundle.gmailMappingStore.mapSenderToAddress({ userId, accountEmail: accountEmail, senderEmail, mappedAddresses: [destination.address], deliveryMode: "links" });
			await gmail.bundle.gmailMappingStore.addSenderToFilter({ userId, accountEmail: accountEmail, senderEmail });
		}
		await gmail.bundle.gmailMappingStore.setMarkImported({ userId, accountEmail, senderEmail: waiting });
		await gmail.bundle.gmailHistoryImportStore.createJob({
			userId,
			jobId: gmail.bundle.newGmailHistoryImportJobId(),
			senderEmail: waiting,
			destinationAddresses: [destination.address],
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
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			completedAt: undefined,
		});
		const pickerOpen = "/newsletters/gmail?search=tldr&error=readlist_invalid&add=1&discovery=started";
		const editOpen = `/newsletters/gmail?search=tldr&sender=${encodeURIComponent(waiting)}&readlist=default&edit=1&discovery=started`;
		const pages: [string, string][] = [];
		for (const path of [pickerOpen, editOpen, "/newsletters/gmail?advanced=1", "/newsletters/gmail"]) {
			pages.push([path, (await agent.get(path).set(BROWSER_REQUEST_HEADERS)).text]);
		}
		await gmail.bundle.gmailCredentialsStore.saveCredentials({ userId, refreshToken: "refresh", grantedScope: `${GMAIL_SCOPES} ${GMAIL_READONLY_SCOPE} ${GMAIL_MODIFY_SCOPE}` });
		pages.push([pickerOpen, (await agent.get(pickerOpen).set(BROWSER_REQUEST_HEADERS)).text]);

		const rendered = pages.map(([, html]) => new JSDOM(html).window.document);
		const actionKeys = new Set(rendered.flatMap((doc) =>
			Array.from(doc.querySelectorAll("[data-test-gmail-mapping-action]"), (el) => el.getAttribute("data-test-gmail-mapping-action")),
		));
		expect([...actionKeys].sort()).toEqual(["cancel-import", "edit", "grant-import-permission", "grant-mark-permission", "mark-read-backfill", "mark-read-start", "mark-read-stop", "remove", "retry-import", "start-import"]);
		expect(["[data-test-gmail-readlist-picker]", "[data-test-gmail-sender-picker]"].map((picker) => rendered[0]?.querySelector(picker)?.hasAttribute("open"))).toEqual([true, true]);
		const dialogLinks = rendered.slice(0, 2).map((doc) => Array.from(doc.querySelectorAll("#gmail-dialog a[data-test-action]"), (link) => [link.getAttribute("data-test-action"), new URL(link.getAttribute("href") ?? "", TEST_APP_ORIGIN).searchParams.get("utm_content")]));
		expect(dialogLinks).toEqual([
			[["gmail-add-dismiss", "close-dialog"], ["gmail-add-cancel", "cancel-dialog"]],
			[["gmail-edit-dismiss", "close-dialog"], ["gmail-edit-cancel", "cancel-dialog"]],
		]);
		expect(rendered[3]?.querySelector("#gmail-add-newsletters-form input[name='utm_content']")?.getAttribute("value")).toBe("add-newsletters");
		expect(pages.flatMap(([path, html]) => untrackedOn(path, html))).toEqual([]);
	});

	it("holds across homepage arm B, including its comparison signup link", async () => {
		const harness = useArmB(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set(BROWSER_REQUEST_HEADERS);
		expect(response.status).toBe(200);
		const document = new JSDOM(response.text).window.document;
		const body = document.querySelector("body.page-home.variant-b");
		assert(body, "the CTA audit must render homepage arm B");
		const signup = body.querySelector('[data-test-cta="compare-signup"]');
		assert(signup, "the comparison must offer its signup link");
		const href = signup.getAttribute("href");
		assert(href, "the comparison signup must navigate");
		const destination = new URL(href, TEST_APP_ORIGIN);
		expect(destination.pathname).toBe("/signup");
		expect(destination.searchParams.get("utm_source")).toBe("home-compare");
		expect(destination.searchParams.get("utm_content")).toBe("compare-signup");
		expect(untrackedOn("homepage arm B", response.text)).toEqual([]);
	});
});
