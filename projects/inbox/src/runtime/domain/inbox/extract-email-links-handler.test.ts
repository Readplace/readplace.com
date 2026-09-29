import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import {
	AliasNameSchema,
	type EmailLinkOrdinal,
	EmailLinkOrdinalSchema,
	type InboxAddressEntry,
	type InboxAddressStore,
	type InboxEmailEntry,
	type InboxEmailLinkCounts,
	InboxAddressSchema,
	InboxTokenSchema,
	MessageIdSchema,
	type ParseEmailResult,
} from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug, ReadlistSlugSchema } from "@packages/domain/readlist";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import type { SubscriptionRecord } from "@packages/provider-contracts/subscription-providers";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryInboxEmailLink } from "@packages/test-fixtures/providers/inbox-email";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initExtractEmailLinksHandler } from "./extract-email-links-handler";
import type { EmailLinkTriageCategory, TriageEmailLinks } from "./triage-email-links";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const RECEIVED_AT = "2026-06-24T09:00:00.000Z";
const RAM = `${RECEIVED_AT}#<m@x>`;
const DIGEST_PROVENANCE = { kind: "email", senderEmail: "news@example.com" };
const RAW_KEY = "inbound/ses-msg-1";
const NOW = "2026-06-24T10:00:00.000Z";
const WORK = ReadlistSlugSchema.parse("a1b2c3d4");
const READ_ONLY_SUBSCRIPTION = {
	userId: USER,
	provider: "stripe" as const,
	status: "cancelled" as const,
	createdAt: RECEIVED_AT,
	updatedAt: RECEIVED_AT,
};

function makeInboxAddress(overrides: Partial<InboxAddressEntry> = {}): InboxAddressEntry {
	return {
		address: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		userId: USER,
		name: AliasNameSchema.parse("in"),
		token: InboxTokenSchema.parse("3f9a2c"),
		createdAt: RECEIVED_AT,
		disabledAt: undefined,
		purpose: "user-alias",
		readlist: undefined,
		...overrides,
	};
}

function makeEmail(overrides: Partial<InboxEmailEntry> = {}): InboxEmailEntry {
	return {
		userId: USER,
		receivedAtMessageId: RAM,
		messageId: MessageIdSchema.parse("<m@x>"),
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "Digest",
		status: "received",
		receivedAt: RECEIVED_AT,
		rawEmailS3Key: RAW_KEY,
		bodyS3Key: "content/m/content.html",
		linkCounts: undefined,
		...overrides,
	};
}

function parsedOk(html: string, listUnsubscribeUrls: string[] = []): ParseEmailResult {
	return {
		ok: true,
		email: {
			from: "news@example.com",
			subject: "Digest",
			text: "",
			html,
			messageId: MessageIdSchema.parse("<m@x>"),
			receivedAt: RECEIVED_AT,
			inlineImages: [],
			listUnsubscribeUrls,
			googleAddressConfirmation: undefined,
		},
	};
}

function eventBody(
	over: Partial<{ userId: string; receivedAtMessageId: string; origin: "receive" | "backfill" }> = {},
): string {
	return JSON.stringify({
		detail: {
			userId: over.userId ?? USER,
			receivedAtMessageId: over.receivedAtMessageId ?? RAM,
			recipientAddress: "in-3f9a2c@read.place",
			origin: over.origin ?? "receive",
		},
	});
}

function makeHarness(opts?: {
	getEmail?: (input: { userId: UserId; receivedAtMessageId: string }) => Promise<InboxEmailEntry | undefined>;
	readRawEmail?: (s3Key: string) => Promise<Buffer | undefined>;
	parseEmail?: () => Promise<ParseEmailResult>;
	triageEmailLinks?: TriageEmailLinks;
	derivedHtml?: string;
	maxLinks?: number;
	subscription?: SubscriptionRecord;
	inboxAddress?: InboxAddressEntry;
	findInboxAddress?: InboxAddressStore["findByAddress"];
}) {
	const linkStore = initInMemoryInboxEmailLink();
	const subscriptionReads: UserId[] = [];
	const published: { ordinal: EmailLinkOrdinal; url: string }[] = [];
	const submitted: { userId: UserId; url: string; readlist: ReadlistSlug }[] = [];
	const triaged: Parameters<Parameters<typeof initExtractEmailLinksHandler>[0]["publishEmailLinksTriaged"]>[0][] = [];
	const addressReads: string[] = [];
	const alerts: { found: number }[] = [];
	const heldNotices: {
		userId: UserId;
		receivedAtMessageId: string;
		inboxAddress: string;
	}[] = [];
	const firstInboxNotices: {
		userId: UserId;
		receivedAtMessageId: string;
		inboxAddress: string;
	}[] = [];
	const publishOrder: ("notice" | "first-notice" | "preview" | "submit" | "triaged")[] = [];
	const triageCalls: Parameters<TriageEmailLinks>[0][] = [];
	const deriveInputs: { rehostedRemoteImages: Record<string, string> }[] = [];
	const countsWrites: InboxEmailLinkCounts[] = [];
	const writeOrder: ("counts" | "meta")[] = [];

	const everythingIsAnArticle: TriageEmailLinks = async (input) => {
		triageCalls.push(input);
		return {
			status: "triaged",
			categories: new Map(input.links.map((link) => [link.ordinal, "article" as const])),
		};
	};

	const handler = initExtractEmailLinksHandler({
		getEmail: opts?.getEmail ?? (async () => makeEmail()),
		readRawEmail: opts?.readRawEmail ?? (async () => Buffer.from("raw eml")),
		parseEmail: opts?.parseEmail ?? (async () => parsedOk("<p>body</p>")),
		deriveSanitizedBody: (input) => {
			deriveInputs.push({ rehostedRemoteImages: input.rehostedRemoteImages });
			return opts?.derivedHtml ?? "";
		},
		putLink: linkStore.putLink,
		getLink: linkStore.getLink,
		putLinksMeta: async (input) => {
			writeOrder.push("meta");
			await linkStore.putLinksMeta(input);
		},
		setEmailLinkCounts: async ({ linkCounts }) => {
			writeOrder.push("counts");
			countsWrites.push(linkCounts);
		},
		publishCrawlPreview: async ({ ordinal, url }) => {
			publishOrder.push("preview");
			published.push({ ordinal, url });
		},
		publishSubmitLink: async (input) => {
			publishOrder.push("submit");
			submitted.push(input);
		},
		publishEmailLinksTriaged: async (input) => {
			publishOrder.push("triaged");
			triaged.push(input);
		},
		alertTruncated: async ({ found }) => {
			alerts.push({ found });
		},
		publishSaveHeldNotice: async (input) => {
			publishOrder.push("notice");
			heldNotices.push(input);
		},
		publishFirstInboxEmailNotice: async (input) => {
			publishOrder.push("first-notice");
			firstInboxNotices.push(input);
		},
		findSubscriptionByUserId: async (userId) => {
			subscriptionReads.push(UserIdSchema.parse(userId));
			return opts?.subscription;
		},
		findInboxAddress:
			opts?.findInboxAddress ??
			(async (address) => {
				addressReads.push(address);
				return opts?.inboxAddress ?? makeInboxAddress();
			}),
		now: () => new Date(NOW),
		triageEmailLinks: opts?.triageEmailLinks ?? everythingIsAnArticle,
		logger: HutchLogger.from(noopLogger),
		maxLinks: opts?.maxLinks ?? 200,
	});

	const run = (body: string) =>
		handler(buildSqsEvent([{ messageId: "rec-1", body }]), buildLambdaContext(), () => {});

	return { linkStore, published, submitted, triaged, addressReads, alerts, heldNotices, firstInboxNotices, triageCalls, deriveInputs, countsWrites, writeOrder, subscriptionReads, publishOrder, run };
}

describe("initExtractEmailLinksHandler", () => {
	it("sends every kept link to the save pipeline so it lands in the reader's unread queue", async () => {
		const harness = makeHarness({
			derivedHtml: "https://a.test/x https://b.test/y",
		});

		const result = await harness.run(eventBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		expect(harness.submitted).toEqual([
			{ userId: USER, url: "https://a.test/x", provenance: DIGEST_PROVENANCE, readlist: DEFAULT_READLIST_SLUG },
			{ userId: USER, url: "https://b.test/y", provenance: DIGEST_PROVENANCE, readlist: DEFAULT_READLIST_SLUG },
		]);
	});

	it("announces the reader's first inbox save once, right after the first submit", async () => {
		const harness = makeHarness({
			derivedHtml: "https://a.test/x https://b.test/y",
		});

		await harness.run(eventBody());

		expect(harness.publishOrder).toEqual([
			"submit",
			"first-notice",
			"preview",
			"submit",
			"preview",
		]);
		expect(harness.firstInboxNotices).toEqual([
			{ userId: USER, receivedAtMessageId: RAM, inboxAddress: "in-3f9a2c@read.place" },
		]);
	});

	it("holds every save for a read-only reader while still extracting, storing and crawling the links", async () => {
		const harness = makeHarness({
			derivedHtml: "https://a.test/x https://b.test/y",
			subscription: {
				userId: USER,
				provider: "stripe",
				status: "trialing",
				trialEndsAt: "2026-06-24T09:30:00.000Z",
				createdAt: RECEIVED_AT,
				updatedAt: RECEIVED_AT,
			},
		});

		const result = await harness.run(eventBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		expect(harness.submitted).toEqual([]);
		expect(harness.published.map((p) => p.url)).toEqual(["https://a.test/x", "https://b.test/y"]);
		expect(harness.countsWrites).toEqual([{ kept: 2, skipped: 0, truncated: false }]);
		expect(harness.heldNotices).toEqual([
			{ userId: USER, receivedAtMessageId: RAM, inboxAddress: "in-3f9a2c@read.place" },
		]);
		expect(harness.firstInboxNotices).toEqual([]);
		const { links } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links.map((link) => link.status)).toEqual(["pending", "pending"]);
	});

	it("tells the reader once even when a single email holds many links", async () => {
		const harness = makeHarness({
			derivedHtml: "https://a.test/x https://b.test/y https://c.test/z",
			subscription: {
				userId: USER,
				provider: "stripe",
				status: "cancelled",
				createdAt: RECEIVED_AT,
				updatedAt: RECEIVED_AT,
			},
		});

		await harness.run(eventBody());

		expect(harness.heldNotices).toEqual([
			{ userId: USER, receivedAtMessageId: RAM, inboxAddress: "in-3f9a2c@read.place" },
		]);
	});

	it("raises the notice before the first held link is crawled, so a later crash cannot swallow it", async () => {
		const harness = makeHarness({
			derivedHtml: "https://a.test/x https://b.test/y",
			subscription: {
				userId: USER,
				provider: "stripe",
				status: "cancelled",
				createdAt: RECEIVED_AT,
				updatedAt: RECEIVED_AT,
			},
		});

		await harness.run(eventBody());

		expect(harness.publishOrder).toEqual(["notice", "preview", "preview"]);
	});

	it("stays silent for a reader who can save", async () => {
		const harness = makeHarness({ derivedHtml: "https://a.test/x" });

		await harness.run(eventBody());

		expect(harness.heldNotices).toEqual([]);
	});

	it("submits for a reader whose trial is still running", async () => {
		const harness = makeHarness({
			derivedHtml: "https://a.test/x",
			subscription: {
				userId: USER,
				provider: "stripe",
				status: "trialing",
				trialEndsAt: "2026-06-24T11:00:00.000Z",
				createdAt: RECEIVED_AT,
				updatedAt: RECEIVED_AT,
			},
		});

		await harness.run(eventBody());

		expect(harness.submitted).toEqual([
			{ userId: USER, url: "https://a.test/x", provenance: DIGEST_PROVENANCE, readlist: DEFAULT_READLIST_SLUG },
		]);
	});

	it("never reads the subscription for a backfill run, which submits nothing by design", async () => {
		const harness = makeHarness({ derivedHtml: "https://a.test/x" });

		await harness.run(eventBody({ origin: "backfill" }));

		expect(harness.subscriptionReads).toEqual([]);
		expect(harness.submitted).toEqual([]);
		expect(harness.firstInboxNotices).toEqual([]);
		expect(harness.published.map((p) => p.url)).toEqual(["https://a.test/x"]);
	});

	it("keeps a preview for an unsaveable link but never submits it — the save pipeline would reject it", async () => {
		const harness = makeHarness({
			derivedHtml: "https://a.test/x https://localhost/private",
		});

		await harness.run(eventBody());

		expect(harness.published.map((p) => p.url)).toEqual([
			"https://a.test/x",
			"https://localhost/private",
		]);
		expect(harness.submitted).toEqual([{ userId: USER, url: "https://a.test/x", provenance: DIGEST_PROVENANCE, readlist: DEFAULT_READLIST_SLUG }]);
	});

	it("stores and crawls the link byte-exact, utm tags included — the crawl input must not be rewritten", async () => {
		const harness = makeHarness({
			derivedHtml: "https://link.mail.test/ss/c/token?utm_source=nl",
		});

		await harness.run(eventBody());

		// Extraction cannot tell a plain link from an opaque wrapper that signs its
		// own query, so cleaning is deferred to the card, which acts only once the
		// crawl has resolved the real destination.
		expect(harness.published.map((p) => p.url)).toEqual([
			"https://link.mail.test/ss/c/token?utm_source=nl",
		]);
		expect(harness.submitted).toEqual([
			{ userId: USER, url: "https://link.mail.test/ss/c/token?utm_source=nl", provenance: DIGEST_PROVENANCE, readlist: DEFAULT_READLIST_SLUG },
		]);
	});

	it("never submits unrouted audit mail's links to anyone's queue", async () => {
		const harness = makeHarness({
			derivedHtml: "https://a.test/x",
			getEmail: async () =>
				makeEmail({ userId: UserIdSchema.parse("__unrouted__") }),
		});

		await harness.run(eventBody({ userId: "__unrouted__" }));

		expect(harness.published.map((p) => p.url)).toEqual(["https://a.test/x"]);
		expect(harness.submitted).toEqual([]);
		expect(harness.firstInboxNotices).toEqual([]);
	});

	it("re-extracts previews for a backfill replay without submitting anything to the queue", async () => {
		const harness = makeHarness({
			derivedHtml: "https://a.test/x https://b.test/y",
		});

		await harness.run(eventBody({ origin: "backfill" }));

		expect(harness.published.map((p) => p.url)).toEqual([
			"https://a.test/x",
			"https://b.test/y",
		]);
		expect(harness.submitted).toEqual([]);
	});

	it("submits nothing when every link is skipped by classification", async () => {
		const harness = makeHarness({
			derivedHtml: "https://news.test/unsubscribe?u=1",
			parseEmail: async () =>
				parsedOk("<p>bye</p>", ["https://news.test/unsubscribe?u=1"]),
		});

		await harness.run(eventBody());

		expect(harness.submitted).toEqual([]);
		expect(harness.firstInboxNotices).toEqual([]);
	});

	it("writes one pending row per link and fans out a crawl command for each", async () => {
		const harness = makeHarness({
			derivedHtml: "https://a.test/x https://b.test/y https://c.test/z",
		});

		const result = await harness.run(eventBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const { links, meta } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links.map((l) => [l.ordinal, l.url, l.status])).toEqual([
			["0000", "https://a.test/x", "pending"],
			["0001", "https://b.test/y", "pending"],
			["0002", "https://c.test/z", "pending"],
		]);
		// Meta is always written once extraction finishes (the "extraction ran"
			// barrier the detail view polls against); only `truncated` differs.
			expect(meta).toEqual({ truncated: false, extractionFailed: false });
		expect(harness.published).toEqual([
			{ ordinal: "0000", url: "https://a.test/x" },
			{ ordinal: "0001", url: "https://b.test/y" },
			{ ordinal: "0002", url: "https://c.test/z" },
		]);
		expect(harness.countsWrites).toEqual([{ kept: 3, skipped: 0, truncated: false }]);
		expect(harness.writeOrder).toEqual(["counts", "meta"]);
		expect(harness.alerts).toHaveLength(0);
		// Extraction must derive with NO remote-image rehost map: CDN image URLs
		// in its body would be extracted as phantom article links, and building
		// the map would re-download every image on every run.
		expect(harness.deriveInputs).toEqual([{ rehostedRemoteImages: {} }]);
	});

	it("writes a List-Unsubscribe match as a terminal skipped row and does not fan it out", async () => {
		const harness = makeHarness({
			parseEmail: async () => parsedOk("<p>body</p>", ["https://news.example.com/unsub"]),
			derivedHtml: "https://a.test/x https://news.example.com/unsub?token=send-1",
		});

		const result = await harness.run(eventBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const { links, meta } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links.map((l) => [l.ordinal, l.url, l.status, l.skipReason])).toEqual([
			["0000", "https://a.test/x", "pending", undefined],
			["0001", "https://news.example.com/unsub?token=send-1", "skipped", "list-unsubscribe"],
		]);
		expect(meta).toEqual({ truncated: false, extractionFailed: false });
		expect(harness.published).toEqual([{ ordinal: "0000", url: "https://a.test/x" }]);
		expect(harness.countsWrites).toEqual([{ kept: 1, skipped: 1, truncated: false }]);
	});

	it("caps the fan-out, writes a truncated meta item, and raises one alert", async () => {
		const harness = makeHarness({
			derivedHtml: "https://a.test/x https://b.test/y https://c.test/z",
			maxLinks: 2,
		});

		const result = await harness.run(eventBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const { links, meta } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links).toHaveLength(2);
		expect(meta).toEqual({ truncated: true, extractionFailed: false });
		expect(harness.published).toHaveLength(2);
		expect(harness.alerts).toEqual([{ found: 3 }]);
		expect(harness.countsWrites).toEqual([{ kept: 2, skipped: 0, truncated: true }]);
	});

	it("skips an email that is not in the received state", async () => {
		const harness = makeHarness({
			getEmail: async () => makeEmail({ status: "unparsed", bodyS3Key: undefined }),
			derivedHtml: "https://a.test/x",
		});

		await harness.run(eventBody());

		const { links } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links).toHaveLength(0);
		expect(harness.published).toHaveLength(0);
	});

	it("skips when the email row is not yet visible", async () => {
		const harness = makeHarness({ getEmail: async () => undefined, derivedHtml: "https://a.test/x" });

		const result = await harness.run(eventBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		expect(harness.published).toHaveLength(0);
	});

	it("retries when the raw .eml is not yet readable", async () => {
		const harness = makeHarness({ readRawEmail: async () => undefined });

		const result = await harness.run(eventBody());

		assert(result);
		expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
	});

	it("acks (no rows) when the raw no longer parses", async () => {
		const harness = makeHarness({ parseEmail: async () => ({ ok: false, reason: "unparseable" }) });

		const result = await harness.run(eventBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		expect(harness.published).toHaveLength(0);
	});

	it("fails the record for a malformed event envelope", async () => {
		const harness = makeHarness({ derivedHtml: "https://a.test/x" });

		const result = await harness.run(JSON.stringify({ detail: { wrong: "shape" } }));

		assert(result);
		expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
	});

	it("fails the record when a dependency throws, so SQS redelivers it", async () => {
		const harness = makeHarness({
			getEmail: async () => {
				throw new Error("dynamo down");
			},
		});

		const result = await harness.run(eventBody());

		assert(result);
		expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
		expect(harness.published).toHaveLength(0);
	});

	it("decodes entity-encoded hrefs before storing, classifying, and publishing", async () => {
		const harness = makeHarness({
			parseEmail: async () => parsedOk("<p>body</p>", ["https://news.example.com/unsub&go"]),
			derivedHtml:
				'<a href="https://a.test/x?a=1&amp;b=2">A</a> <a href="https://news.example.com/unsub&amp;go">Unsub</a>',
		});

		await harness.run(eventBody());

		const { links } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links.map((l) => [l.url, l.status])).toEqual([
			["https://a.test/x?a=1&b=2", "pending"],
			["https://news.example.com/unsub&go", "skipped"],
		]);
		expect(harness.published).toEqual([{ ordinal: "0000", url: "https://a.test/x?a=1&b=2" }]);
	});

	it("skips links the triage marks as noise, ad, menu, or subscription", async () => {
		const verdicts = new Map<string, EmailLinkTriageCategory>([
			["0000", "article"],
			["0001", "noise"],
			["0002", "ad"],
			["0003", "menu"],
			["0004", "subscription"],
		]);
		const harness = makeHarness({
			triageEmailLinks: async (input) => ({
				status: "triaged",
				categories: new Map(
					input.links.flatMap((link) => {
						const category = verdicts.get(link.ordinal);
						return category === undefined ? [] : [[link.ordinal, category] as const];
					}),
				),
			}),
			derivedHtml:
				"https://a.test/1 https://a.test/2 https://a.test/3 https://a.test/4 https://a.test/5 https://a.test/6",
		});

		await harness.run(eventBody());

		const { links } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links.map((l) => [l.ordinal, l.status, l.skipReason])).toEqual([
			["0000", "pending", undefined],
			["0001", "skipped", "llm-noise"],
			["0002", "skipped", "llm-ad"],
			["0003", "skipped", "llm-menu"],
			["0004", "skipped", "llm-subscription"],
			["0005", "pending", undefined],
		]);
		expect(harness.published).toEqual([
			{ ordinal: "0000", url: "https://a.test/1" },
			{ ordinal: "0005", url: "https://a.test/6" },
		]);
		expect(harness.countsWrites).toEqual([{ kept: 2, skipped: 4, truncated: false }]);
	});

	it("crawls every remaining link when the triage is unavailable", async () => {
		const harness = makeHarness({
			triageEmailLinks: async () => ({ status: "unavailable" }),
			derivedHtml: "https://a.test/x https://b.test/y",
		});

		await harness.run(eventBody());

		const { links, meta } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links.map((l) => l.status)).toEqual(["pending", "pending"]);
		expect(meta).toEqual({ truncated: false, extractionFailed: false });
		expect(harness.published).toHaveLength(2);
	});

	it("does not invoke the triage when every link is excluded by rules", async () => {
		const harness = makeHarness({
			parseEmail: async () => parsedOk("<p>body</p>", ["https://news.example.com/unsub"]),
			derivedHtml: "https://news.example.com/unsub?token=send-1",
		});

		await harness.run(eventBody());

		const { links } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links.map((l) => l.status)).toEqual(["skipped"]);
		expect(harness.triageCalls).toHaveLength(0);
	});

	it("sends each link's anchor text with the email context to the triage", async () => {
		const harness = makeHarness({
			derivedHtml: '<a href="https://a.test/essay?x=1&amp;y=2">Read the essay</a>',
		});

		await harness.run(eventBody());

		expect(harness.triageCalls).toEqual([
			{
				subject: "Digest",
				from: "news@example.com",
				links: [
					{ ordinal: "0000", url: "https://a.test/essay?x=1&y=2", anchorText: "Read the essay" },
				],
			},
		]);
	});

	it("does not re-publish a link whose row a previous delivery terminally skipped", async () => {
		let deliveries = 0;
		const harness = makeHarness({
			triageEmailLinks: async (input) => {
				deliveries += 1;
				const category = deliveries === 1 ? ("subscription" as const) : ("article" as const);
				return {
					status: "triaged",
					categories: new Map(input.links.map((link) => [link.ordinal, category])),
				};
			},
			derivedHtml: "https://a.test/x",
		});

		await harness.run(eventBody());
		await harness.run(eventBody());

		const { links } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links.map((l) => [l.status, l.skipReason])).toEqual([
			["skipped", "llm-subscription"],
		]);
		expect(harness.published).toEqual([]);
		expect(harness.submitted).toEqual([]);
		expect(harness.countsWrites).toEqual([
			{ kept: 0, skipped: 1, truncated: false },
			{ kept: 0, skipped: 1, truncated: false },
		]);
	});

	it("counts a still-pending row as kept when a later delivery would skip it", async () => {
		let deliveries = 0;
		const harness = makeHarness({
			triageEmailLinks: async (input) => {
				deliveries += 1;
				const category = deliveries === 1 ? ("article" as const) : ("subscription" as const);
				return {
					status: "triaged",
					categories: new Map(input.links.map((link) => [link.ordinal, category])),
				};
			},
			derivedHtml: "https://a.test/x",
		});

		await harness.run(eventBody());
		await harness.run(eventBody());

		const { links } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links.map((l) => l.status)).toEqual(["pending"]);
		expect(harness.countsWrites).toEqual([
			{ kept: 1, skipped: 0, truncated: false },
			{ kept: 1, skipped: 0, truncated: false },
		]);
		expect(harness.published).toEqual([{ ordinal: "0000", url: "https://a.test/x" }]);
	});

	it("writes zero counts and the meta barrier for an email with no links", async () => {
		const harness = makeHarness({ derivedHtml: "" });

		await harness.run(eventBody());

		const { links, meta } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links).toEqual([]);
		expect(meta).toEqual({ truncated: false, extractionFailed: false });
		expect(harness.countsWrites).toEqual([{ kept: 0, skipped: 0, truncated: false }]);
	});

	it("keeps a skipped link terminal and unpublished across re-delivery", async () => {
		const harness = makeHarness({
			parseEmail: async () => parsedOk("<p>body</p>", ["https://news.example.com/unsub"]),
			derivedHtml: "https://a.test/x https://news.example.com/unsub",
		});

		await harness.run(eventBody());
		await harness.run(eventBody());

		const { links } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links.map((l) => [l.status, l.skipReason])).toEqual([
			["pending", undefined],
			["skipped", "list-unsubscribe"],
		]);
		expect(harness.published).toEqual([
			{ ordinal: "0000", url: "https://a.test/x" },
			{ ordinal: "0000", url: "https://a.test/x" },
		]);
		expect(harness.countsWrites).toEqual([
			{ kept: 1, skipped: 1, truncated: false },
			{ kept: 1, skipped: 1, truncated: false },
		]);
	});

	it("is idempotent under re-delivery: no duplicate rows, re-publishes the fan-out", async () => {
		const harness = makeHarness({ derivedHtml: "https://a.test/x https://b.test/y" });

		await harness.run(eventBody());
		await harness.run(eventBody());

		const { links, meta } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links).toHaveLength(2);
		// Meta is an idempotent overwrite — re-delivery leaves a single barrier row.
		expect(meta).toEqual({ truncated: false, extractionFailed: false });
		expect(harness.published).toHaveLength(4);
		// Still-pending rows re-submit too; the subscriber converges duplicates.
		expect(harness.submitted).toEqual([
			{ userId: USER, url: "https://a.test/x", provenance: DIGEST_PROVENANCE, readlist: DEFAULT_READLIST_SLUG },
			{ userId: USER, url: "https://b.test/y", provenance: DIGEST_PROVENANCE, readlist: DEFAULT_READLIST_SLUG },
			{ userId: USER, url: "https://a.test/x", provenance: DIGEST_PROVENANCE, readlist: DEFAULT_READLIST_SLUG },
			{ userId: USER, url: "https://b.test/y", provenance: DIGEST_PROVENANCE, readlist: DEFAULT_READLIST_SLUG },
		]);
	});

	describe("an inbox routed to a readlist", () => {
		const routedInbox = makeInboxAddress({ readlist: WORK });

		it("hands the newsletter's article links to the readlist's filter instead of saving them", async () => {
			const harness = makeHarness({
				derivedHtml:
					'<a href="https://a.test/x">Ship small PRs</a> <a href="https://b.test/y">Our spring sale</a>',
				inboxAddress: routedInbox,
			});

			const result = await harness.run(eventBody());

			assert(result);
			expect(result.batchItemFailures).toHaveLength(0);
			expect(harness.submitted).toEqual([]);
			expect(harness.triaged).toEqual([
				{
					userId: USER,
					receivedAtMessageId: RAM,
					readlist: WORK,
					senderEmail: "news@example.com",
					subject: "Digest",
					links: [
						{ ordinal: "0000", url: "https://a.test/x", anchorText: "Ship small PRs" },
						{ ordinal: "0001", url: "https://b.test/y", anchorText: "Our spring sale" },
					],
				},
			]);
		});

		it("still crawls every preview, then announces the triage once and the first-save notice after it", async () => {
			const harness = makeHarness({
				derivedHtml: "https://a.test/x https://b.test/y",
				inboxAddress: routedInbox,
			});

			await harness.run(eventBody());

			expect(harness.publishOrder).toEqual(["preview", "preview", "triaged", "first-notice"]);
			expect(harness.firstInboxNotices).toEqual([
				{ userId: USER, receivedAtMessageId: RAM, inboxAddress: "in-3f9a2c@read.place" },
			]);
		});

		it("opens a deciding readlist decision on the barrier, written last", async () => {
			const harness = makeHarness({
				derivedHtml: "https://a.test/x",
				inboxAddress: routedInbox,
			});

			await harness.run(eventBody());

			const { meta } = await harness.linkStore.listLinksByEmail({
				userId: USER,
				receivedAtMessageId: RAM,
			});
			expect(meta).toEqual({
				truncated: false,
				extractionFailed: false,
				readlistDecision: { state: "deciding", readlist: WORK },
			});
			expect(harness.writeOrder).toEqual(["counts", "meta"]);
		});

		it("sends no anchor text when the newsletter gave the link none", async () => {
			const harness = makeHarness({
				derivedHtml: "https://a.test/x",
				inboxAddress: routedInbox,
			});

			await harness.run(eventBody());

			expect(harness.triaged[0]?.links).toEqual([
				{ ordinal: "0000", url: "https://a.test/x", anchorText: "" },
			]);
		});

		it("clips each link's anchor text so a link-heavy email fits one event", async () => {
			const harness = makeHarness({
				derivedHtml: `<a href="https://a.test/x">${"word ".repeat(40)}</a>`,
				inboxAddress: routedInbox,
			});

			await harness.run(eventBody());

			expect(harness.triaged[0]?.links[0]?.anchorText).toBe("word ".repeat(24));
		});

		it("leaves out links the triage skipped and links the save pipeline would reject", async () => {
			const harness = makeHarness({
				triageEmailLinks: async (input) => ({
					status: "triaged",
					categories: new Map(
						input.links.map((link) => [link.ordinal, link.ordinal === "0001" ? "ad" : "article"] as const),
					),
				}),
				derivedHtml: "https://a.test/x https://b.test/sale https://localhost/private",
				inboxAddress: routedInbox,
			});

			await harness.run(eventBody());

			expect(harness.triaged[0]?.links.map((link) => link.url)).toEqual(["https://a.test/x"]);
			expect(harness.published.map((p) => p.url)).toEqual([
				"https://a.test/x",
				"https://localhost/private",
			]);
		});

		it("falls back to today's path when no link is left to decide on", async () => {
			const harness = makeHarness({
				derivedHtml: "https://localhost/private",
				inboxAddress: routedInbox,
			});

			await harness.run(eventBody());

			expect(harness.triaged).toEqual([]);
			expect(harness.submitted).toEqual([]);
			expect(harness.firstInboxNotices).toEqual([]);
			const { meta } = await harness.linkStore.listLinksByEmail({
				userId: USER,
				receivedAtMessageId: RAM,
			});
			expect(meta?.readlistDecision).toBeUndefined();
		});

		it("re-sends the same links when a redelivery finds their previews already crawled", async () => {
			const harness = makeHarness({
				derivedHtml: "https://a.test/x https://b.test/y",
				inboxAddress: routedInbox,
			});
			await harness.run(eventBody());
			for (const ordinal of ["0000", "0001"]) {
				await harness.linkStore.setLinkOutcome({
					userId: USER,
					receivedAtMessageId: RAM,
					ordinal: EmailLinkOrdinalSchema.parse(ordinal),
					outcome: { status: "failed", failureReason: "timeout" },
				});
			}

			await harness.run(eventBody());

			expect(harness.triaged.map((event) => event.links.map((link) => link.ordinal))).toEqual([
				["0000", "0001"],
				["0000", "0001"],
			]);
			expect(harness.published).toHaveLength(2);
		});

		it("never re-sends a link a previous delivery's triage skipped", async () => {
			let delivery = 0;
			const harness = makeHarness({
				triageEmailLinks: async (input) => {
					delivery += 1;
					return {
						status: "triaged",
						categories: new Map(
							input.links.map(
								(link) => [link.ordinal, delivery === 1 && link.ordinal === "0001" ? "menu" : "article"] as const,
							),
						),
					};
				},
				derivedHtml: "https://a.test/x https://b.test/y",
				inboxAddress: routedInbox,
			});

			await harness.run(eventBody());
			await harness.run(eventBody());

			expect(harness.triaged.map((event) => event.links.map((link) => link.ordinal))).toEqual([
				["0000"],
				["0000"],
			]);
		});

		it("saves to All as today for a read-only reader, holding every save", async () => {
			const harness = makeHarness({
				derivedHtml: "https://a.test/x",
				inboxAddress: routedInbox,
				subscription: READ_ONLY_SUBSCRIPTION,
			});

			await harness.run(eventBody());

			expect(harness.addressReads).toEqual([]);
			expect(harness.triaged).toEqual([]);
			expect(harness.heldNotices).toHaveLength(1);
		});

		it("never reads the routing for a backfill replay", async () => {
			const harness = makeHarness({
				derivedHtml: "https://a.test/x",
				inboxAddress: routedInbox,
			});

			await harness.run(eventBody({ origin: "backfill" }));

			expect(harness.addressReads).toEqual([]);
			expect(harness.triaged).toEqual([]);
			expect(harness.submitted).toEqual([]);
		});

		it("saves to All when the address was handed to a deleted account after the mail arrived", async () => {
			const harness = makeHarness({
				derivedHtml: "https://a.test/x",
				inboxAddress: makeInboxAddress({
					userId: UserIdSchema.parse("deleted-account"),
					readlist: WORK,
				}),
			});

			await harness.run(eventBody());

			expect(harness.triaged).toEqual([]);
			expect(harness.submitted).toEqual([
				{ userId: USER, url: "https://a.test/x", provenance: DIGEST_PROVENANCE, readlist: DEFAULT_READLIST_SLUG },
			]);
		});

		it("saves to All when the address is routed to All itself", async () => {
			const harness = makeHarness({
				derivedHtml: "https://a.test/x",
				inboxAddress: makeInboxAddress({ readlist: DEFAULT_READLIST_SLUG }),
			});

			await harness.run(eventBody());

			expect(harness.addressReads).toEqual(["in-3f9a2c@read.place"]);
			expect(harness.triaged).toEqual([]);
			expect(harness.submitted).toEqual([
				{ userId: USER, url: "https://a.test/x", provenance: DIGEST_PROVENANCE, readlist: DEFAULT_READLIST_SLUG },
			]);
		});

		it("fails the record when the inbox address has vanished, so SQS redelivers it", async () => {
			const harness = makeHarness({
				derivedHtml: "https://a.test/x",
				findInboxAddress: async () => undefined,
			});

			const result = await harness.run(eventBody());

			assert(result);
			expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
			expect(harness.triaged).toEqual([]);
		});
	});
});
