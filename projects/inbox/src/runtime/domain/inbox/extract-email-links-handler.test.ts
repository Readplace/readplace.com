import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import {
	type EmailLinkOrdinal,
	type InboxEmailEntry,
	type InboxEmailLinkCounts,
	InboxAddressSchema,
	MessageIdSchema,
	type ParseEmailResult,
} from "@packages/domain/inbox";
import { type UserId, UserIdSchema } from "@packages/domain/user";
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
}) {
	const linkStore = initInMemoryInboxEmailLink();
	const published: { ordinal: EmailLinkOrdinal; url: string }[] = [];
	const submitted: { userId: UserId; url: string }[] = [];
	const alerts: { found: number }[] = [];
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
			published.push({ ordinal, url });
		},
		publishSubmitLink: async (input) => {
			submitted.push(input);
		},
		alertTruncated: async ({ found }) => {
			alerts.push({ found });
		},
		triageEmailLinks: opts?.triageEmailLinks ?? everythingIsAnArticle,
		logger: HutchLogger.from(noopLogger),
		maxLinks: opts?.maxLinks ?? 200,
	});

	const run = (body: string) =>
		handler(buildSqsEvent([{ messageId: "rec-1", body }]), buildLambdaContext(), () => {});

	return { linkStore, published, submitted, alerts, triageCalls, deriveInputs, countsWrites, writeOrder, run };
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
			{ userId: USER, url: "https://a.test/x", provenance: DIGEST_PROVENANCE },
			{ userId: USER, url: "https://b.test/y", provenance: DIGEST_PROVENANCE },
		]);
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
		expect(harness.submitted).toEqual([{ userId: USER, url: "https://a.test/x", provenance: DIGEST_PROVENANCE }]);
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
			{ userId: USER, url: "https://link.mail.test/ss/c/token?utm_source=nl", provenance: DIGEST_PROVENANCE },
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
			{ userId: USER, url: "https://a.test/x", provenance: DIGEST_PROVENANCE },
			{ userId: USER, url: "https://b.test/y", provenance: DIGEST_PROVENANCE },
			{ userId: USER, url: "https://a.test/x", provenance: DIGEST_PROVENANCE },
			{ userId: USER, url: "https://b.test/y", provenance: DIGEST_PROVENANCE },
		]);
	});
});
