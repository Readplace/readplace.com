import assert from "node:assert/strict";
import type { DeepseekCallFailedLogLine } from "@packages/ai-message";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { MinutesSchema, type SavedArticle, type SaveProvenance } from "@packages/domain/article";
import { EmailLinkOrdinalSchema } from "@packages/domain/inbox";
import {
	type ReadlistSlug,
	ReadlistSlugSchema,
	readlistFitOverrideId,
	readlistPurposeVersion,
} from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { SmartReadlistsMatchedEvent } from "@packages/infra-components";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { ReadlistDefinitionData, ReadlistFitOverride } from "@packages/provider-contracts/article-store";
import type { SubscriptionRecord } from "@packages/provider-contracts/subscription-providers";
import type { Logger } from "@packages/logger";
import type { DecideReadlistFit, ReadlistFitResult } from "@packages/readlist-fit";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initMatchSmartReadlistsHandler } from "./match-smart-readlists-handler";
import { MATCH_SMART_READLISTS_MAX_RECEIVE_COUNT } from "./timeouts";
import type { SmartReadlistMatchDecidedLine } from "./smart-readlist-match-log-lines.types";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const SAVED_AT = new Date("2026-09-23T09:00:00.000Z");
const URL = "https://blog.example.com/small-prs";
const STORED_KEY = ArticleResourceUniqueId.parse(URL).value;
const WORK = ReadlistSlugSchema.parse("work");
const COOKING = ReadlistSlugSchema.parse("cooking");
const WORK_PURPOSE = "Engineering practice: code review, testing, and shipping small changes.";
const COOKING_PURPOSE = "Weeknight recipes.";

function fitResult(decisions: ReadlistFitResult["decisions"]): ReadlistFitResult {
	return {
		decisions,
		engine: "deepseek-flash",
		model: "deepseek-chat",
		usage: { inputTokens: 900, outputTokens: 400, reasoningTokens: 300 },
	};
}

const keeps: DecideReadlistFit = async () => fitResult([{ id: "0000", verdict: "keep", reason: "On topic." }]);

function captureLines<T>() {
	const lines: T[] = [];
	const write = (line: T) => {
		lines.push(line);
	};
	const log: Logger.Typed<T> = { info: write, error: write, warn: write, debug: write };
	return { lines, log };
}

function override(index: number): ReadlistFitOverride {
	const createdAt = new Date(SAVED_AT.getTime() - index * 60_000);
	const ordinal = EmailLinkOrdinalSchema.parse(String(index).padStart(4, "0"));
	const receivedAtMessageId = `2026-09-20T09:00:00.000Z#<m-${index}@example.com>`;
	return {
		id: readlistFitOverrideId({ createdAt, receivedAtMessageId, ordinal }),
		url: `https://host${index}.test/${index}`,
		anchorText: `Choice ${index}`,
		host: `host${index}.test`,
		engineVerdict: "drop",
		engineReason: "The judge's earlier call.",
		readerVerdict: "keep",
		purposeVersion: readlistPurposeVersion(WORK_PURPOSE),
		receivedAtMessageId,
		ordinal,
		createdAt,
	};
}

function makeHarness(opts: {
	subscription?: SubscriptionRecord;
	decide?: DecideReadlistFit;
	crawl?: ArticleCrawl;
	overrides?: ReadlistFitOverride[];
	extraDefinitions?: ReadlistDefinitionData[];
	mapArticle?: (article: SavedArticle) => SavedArticle;
	onDecide?: () => Promise<void>;
}) {
	const store = initInMemoryArticleStore();
	const logLines: unknown[][] = [];
	const capture = (...args: unknown[]) => {
		logLines.push(args);
	};
	const logger: Logger = { info: capture, error: capture, warn: capture, debug: capture };
	const published: { detailType: string; detail: unknown }[] = [];
	const decisions: Parameters<DecideReadlistFit>[0][] = [];
	const recorded: { readlist: ReadlistSlug; revision: number }[] = [];
	const decided = captureLines<SmartReadlistMatchDecidedLine>();
	const callFailed = captureLines<DeepseekCallFailedLogLine>();
	const handler = initMatchSmartReadlistsHandler({
		findSubscriptionByUserId: async () => opts.subscription,
		findSmartMatchRevisions: store.findSmartMatchRevisions,
		recordSmartMatchRevision: async (params) => {
			recorded.push({ readlist: params.readlist, revision: params.revision });
			return store.recordSmartMatchRevision(params);
		},
		listReadlistDefinitions: async (userId) => [
			...(await store.listReadlistDefinitions(userId)),
			...(opts.extraDefinitions ?? []),
		],
		listReadlistFitOverrides: async () => opts.overrides ?? [],
		findArticleById: async (id, userId) => {
			const article = await store.findArticleById(id, userId);
			assert(article);
			return opts.mapArticle ? opts.mapArticle(article) : article;
		},
		findArticleCrawlStatus: async () => opts.crawl,
		fileIntoLiveReadlist: store.fileIntoLiveReadlist,
		decideReadlistFit: async (input) => {
			decisions.push(input);
			await opts.onDecide?.();
			return (opts.decide ?? keeps)(input);
		},
		publishEvent: async (event, detail) => {
			published.push({ detailType: event.detailType, detail });
		},
		logger,
		decisionLog: decided.log,
		deepseekCallFailedLog: callFailed.log,
		now: () => SAVED_AT,
	});
	const save = (params: { url?: string; provenance?: SaveProvenance } = {}) =>
		store.saveArticle({
			userId: USER,
			url: params.url ?? URL,
			metadata: { title: "Ship small PRs", siteName: "Blog", excerpt: "Why small changes win.", wordCount: 900 },
			estimatedReadTime: MinutesSchema.parse(4),
			provenance: params.provenance ?? { kind: "web" },
			savedAt: SAVED_AT,
			saveTrigger: "manual",
		});
	const smartList = async (params: { slug: ReadlistSlug; purpose: string; effectiveAt?: Date }) => {
		await store.createReadlistDefinition({ userId: USER, slug: params.slug, label: params.slug, createdAt: SAVED_AT });
		const rule = await store.setSmartReadlistRule({
			userId: USER,
			slug: params.slug,
			purpose: params.purpose,
			effectiveAt: params.effectiveAt ?? new Date(SAVED_AT.getTime() - 60_000),
		});
		assert(rule.kind === "set");
		return rule.revision;
	};
	const run = async (storedKey: string = STORED_KEY, receiveCount = 1) => {
		const event = buildSqsEvent([
			{
				messageId: "rec-1",
				body: JSON.stringify({ detail: { userId: USER, storedKey, savedAt: SAVED_AT.toISOString() }, time: SAVED_AT.toISOString() }),
			},
		]);
		event.Records[0].attributes.ApproximateReceiveCount = String(receiveCount);
		const result = await handler(event, buildLambdaContext(), () => {});
		assert(result);
		return result.batchItemFailures;
	};
	const filed = (readlist: ReadlistSlug) => store.findReadlistFiling({ userId: USER, readlist, url: URL });
	const facts = () => published.map(({ detail }) => SmartReadlistsMatchedEvent.detailSchema.parse(detail));
	return {
		store,
		save,
		smartList,
		run,
		filed,
		facts,
		published,
		decisions,
		recorded,
		logLines,
		decidedLines: decided.lines,
		callFailedLines: callFailed.lines,
	};
}

describe("initMatchSmartReadlistsHandler", () => {
	it("acknowledges a free account without reading its readlists or calling the model", async () => {
		const harness = makeHarness({
			subscription: {
				userId: USER,
				provider: "stripe",
				status: "cancelled",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-09-01T00:00:00.000Z",
			},
		});
		await harness.save();
		await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });

		assert.deepEqual(await harness.run(), []);

		assert.deepEqual(harness.decisions, []);
		assert.deepEqual(harness.facts(), [{ userId: USER, storedKey: STORED_KEY, outcome: "paid-plan-required", readlists: [] }]);
	});

	it("acknowledges a save no longer in the \"All\" readlist", async () => {
		const harness = makeHarness({});
		await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });

		assert.deepEqual(await harness.run(), []);

		assert.deepEqual(harness.decisions, []);
		assert.equal(harness.facts()[0]?.outcome, "not-in-all");
	});

	it("matches nothing when the only smart readlists are turned off, made after the save, or not smart", async () => {
		const harness = makeHarness({
			extraDefinitions: [{ slug: ReadlistSlugSchema.parse("plain"), label: "plain", createdAt: SAVED_AT }],
		});
		await harness.save();
		await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });
		await harness.store.turnOffSmartReadlistMatching({ userId: USER, slug: WORK });
		await harness.smartList({ slug: COOKING, purpose: COOKING_PURPOSE, effectiveAt: new Date(SAVED_AT.getTime() + 1) });
		await harness.store.createReadlistDefinition({
			userId: USER,
			slug: ReadlistSlugSchema.parse("manual"),
			label: "manual",
			createdAt: SAVED_AT,
		});

		assert.deepEqual(await harness.run(), []);

		assert.deepEqual(harness.decisions, []);
		assert.equal(harness.facts()[0]?.outcome, "nothing-to-match");
	});

	it("a duplicate delivery finds the revision recorded and does not call the model again", async () => {
		const harness = makeHarness({ decide: async () => fitResult([{ id: "0000", verdict: "drop", reason: "Off topic." }]) });
		await harness.save();
		await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });

		await harness.run();
		assert.deepEqual(await harness.run(), []);

		assert.equal(harness.decisions.length, 1);
		assert.deepEqual(
			harness.facts().map(({ outcome }) => outcome),
			["matched", "nothing-to-match"],
		);
	});

	it("skips a webmail page without calling the model", async () => {
		const webmail = "https://mail.google.com/mail/u/0/";
		const harness = makeHarness({});
		await harness.save({ url: webmail });
		await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });

		assert.deepEqual(await harness.run(ArticleResourceUniqueId.parse(webmail).value), []);

		assert.deepEqual(harness.decisions, []);
		assert.deepEqual(harness.recorded, []);
		assert.equal(harness.facts()[0]?.outcome, "not-an-article");
	});

	it("retries while the crawl is pending, recording nothing and logging no error", async () => {
		const harness = makeHarness({ crawl: { status: "pending", startedAt: SAVED_AT.toISOString() } });
		await harness.save();
		await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });

		assert.deepEqual(await harness.run(), [{ itemIdentifier: "rec-1" }]);

		assert.deepEqual(harness.decisions, []);
		assert.deepEqual(harness.recorded, []);
		assert.deepEqual(harness.published, []);
		assert.deepEqual(harness.callFailedLines, []);
		assert.equal(harness.logLines.some(([message]) => message === "[match-smart-readlists] waiting for the crawl"), true);
		assert.equal(harness.logLines.some(([message]) => message === "[match-smart-readlists] record failed"), false);
		assert.equal(harness.logLines.some(([message]) => message === "[match-smart-readlists] dead-lettered while the crawl is still pending"), false);
	});

	it("logs an error naming the pending crawl on the final receive, before the record dead-letters", async () => {
		const harness = makeHarness({ crawl: { status: "pending", startedAt: SAVED_AT.toISOString() } });
		await harness.save();
		await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });

		assert.deepEqual(await harness.run(STORED_KEY, MATCH_SMART_READLISTS_MAX_RECEIVE_COUNT), [{ itemIdentifier: "rec-1" }]);

		assert.deepEqual(harness.recorded, []);
		assert.deepEqual(harness.callFailedLines, []);
		assert.equal(harness.logLines.some(([message]) => message === "[match-smart-readlists] dead-lettered while the crawl is still pending"), true);
		assert.equal(harness.logLines.some(([message]) => message === "[match-smart-readlists] waiting for the crawl"), false);
	});

	it("files one save into both smart readlists it fits once the crawl is ready", async () => {
		const harness = makeHarness({ crawl: { status: "ready" } });
		await harness.save();
		const workRevision = await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });
		const cookingRevision = await harness.smartList({ slug: COOKING, purpose: COOKING_PURPOSE });

		assert.deepEqual(await harness.run(), []);

		assert.equal((await harness.filed(WORK))?.status, "unread");
		assert.equal((await harness.filed(COOKING))?.status, "unread");
		assert.deepEqual(harness.facts()[0]?.readlists, [
			{ readlist: COOKING, revision: cookingRevision, verdict: "keep", filing: "filed" },
			{ readlist: WORK, revision: workRevision, verdict: "keep", filing: "filed" },
		]);
		assert.deepEqual(
			harness.decidedLines.map(({ readlist, filing }) => ({ readlist, filing })).sort((a, b) => a.readlist.localeCompare(b.readlist)),
			[
				{ readlist: COOKING, filing: "filed" },
				{ readlist: WORK, filing: "filed" },
			],
		);
		assert.deepEqual(harness.decisions[0]?.candidates, [
			{ id: "0000", url: URL, text: "Ship small PRs\nWhy small changes win." },
		]);
		assert.equal("context" in (harness.decisions[0] ?? {}), false);
	});

	it("a drop or unsure verdict leaves the save in the \"All\" readlist only and records the revision", async () => {
		const harness = makeHarness({
			decide: async (input) =>
				fitResult([
					{ id: "0000", verdict: input.purpose.keep === WORK_PURPOSE ? "drop" : "unsure", reason: "No." },
				]),
		});
		await harness.save();
		const workRevision = await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });
		const cookingRevision = await harness.smartList({ slug: COOKING, purpose: COOKING_PURPOSE });

		assert.deepEqual(await harness.run(), []);

		assert.equal(await harness.filed(WORK), undefined);
		assert.equal(await harness.filed(COOKING), undefined);
		assert.deepEqual(
			[...harness.recorded].sort((a, b) => a.readlist.localeCompare(b.readlist)),
			[
				{ readlist: COOKING, revision: cookingRevision },
				{ readlist: WORK, revision: workRevision },
			],
		);
		assert.deepEqual(
			harness.facts()[0]?.readlists.map(({ readlist, verdict, filing }) => ({ readlist, verdict, filing })),
			[
				{ readlist: COOKING, verdict: "unsure", filing: undefined },
				{ readlist: WORK, verdict: "drop", filing: undefined },
			],
		);
	});

	it("treats a missing decision as unsure", async () => {
		const harness = makeHarness({ decide: async () => fitResult([]) });
		await harness.save();
		await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });

		await harness.run();

		assert.equal(await harness.filed(WORK), undefined);
		assert.equal(harness.decidedLines[0]?.verdict, "unsure");
		assert.equal(harness.decidedLines[0]?.reason, "The model returned no decision.");
	});

	it("does not file when the rule was edited after the command was sent", async () => {
		const harness = makeHarness({
			onDecide: async () => {
				await harness.store.setSmartReadlistRule({ userId: USER, slug: WORK, purpose: "Edited.", effectiveAt: SAVED_AT });
			},
		});
		await harness.save();
		await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });

		assert.deepEqual(await harness.run(), []);

		assert.equal(await harness.filed(WORK), undefined);
		assert.equal(harness.facts()[0]?.readlists[0]?.filing, "smart-rule-changed");
	});

	it("does not refile a save the reader removed from that readlist", async () => {
		const harness = makeHarness({});
		await harness.save();
		await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });
		await harness.store.deleteReadlistArticleByUrl({ userId: USER, readlist: WORK, url: URL });

		assert.deepEqual(await harness.run(), []);

		assert.equal(await harness.filed(WORK), undefined);
		assert.equal(harness.facts()[0]?.readlists[0]?.filing, "removed-after-request");
	});

	it("passes the sender of an emailed save as context, with up to 20 of the reader's choices", async () => {
		const harness = makeHarness({ overrides: Array.from({ length: 25 }, (_, index) => override(index + 1)) });
		await harness.save({ provenance: { kind: "email", senderEmail: "news@example.com" } });
		await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });

		await harness.run();

		assert.deepEqual(harness.decisions[0]?.context, { subject: "Ship small PRs", senderEmail: "news@example.com" });
		assert.equal(harness.decisions[0]?.examples.length, 20);
		assert.deepEqual(harness.decisions[0]?.examples[0], { text: "Choice 1", host: "host1.test", verdict: "keep" });
	});

	it("files a save the reader read after saving it as read", async () => {
		const readAt = new Date(SAVED_AT.getTime() + 60_000);
		const harness = makeHarness({ mapArticle: (article) => ({ ...article, readAt }) });
		await harness.save();
		await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });

		await harness.run();

		assert.deepEqual(await harness.filed(WORK), { savedAt: SAVED_AT, status: "read", readAt });
	});

	it("files a save read before this save as unread, with web provenance for a row that has none", async () => {
		const harness = makeHarness({
			mapArticle: ({ provenance: _provenance, ...article }) => ({ ...article, readAt: new Date(SAVED_AT.getTime() - 1) }),
		});
		await harness.save();
		await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });

		await harness.run();

		assert.equal((await harness.filed(WORK))?.status, "unread");
		assert.equal("context" in (harness.decisions[0] ?? {}), false);
	});

	it("a model error records nothing, fails the record and logs the DeepSeek line", async () => {
		const harness = makeHarness({
			decide: async () => {
				throw Object.assign(new Error("Service Unavailable"), { status: 503 });
			},
		});
		await harness.save();
		await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });

		assert.deepEqual(await harness.run(), [{ itemIdentifier: "rec-1" }]);

		assert.deepEqual(harness.recorded, []);
		assert.deepEqual(harness.published, []);
		assert.equal(harness.callFailedLines.length, 1);
		assert.equal(harness.callFailedLines[0]?.feature, "match-smart-readlists");
		assert.equal(harness.callFailedLines[0]?.status, 503);
	});

	it("an error that is not the provider's fails the record without a DeepSeek line", async () => {
		const harness = makeHarness({
			decide: async () => {
				throw new Error("boom");
			},
		});
		await harness.save();
		await harness.smartList({ slug: WORK, purpose: WORK_PURPOSE });

		assert.deepEqual(await harness.run(), [{ itemIdentifier: "rec-1" }]);

		assert.deepEqual(harness.callFailedLines, []);
		assert.equal(harness.logLines.some(([message]) => message === "[match-smart-readlists] record failed"), true);
	});
});
