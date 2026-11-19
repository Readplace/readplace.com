import assert from "node:assert/strict";
import { initFindSavedArticleForLink } from "@packages/article-store";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { formatEmailLinkOrdinal } from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema, readlistPurposeVersion } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import {
	ArticleFiledIntoReadlistEvent,
	FileArticleIntoReadlistCommand,
	type FileArticleIntoReadlistDetail,
} from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { Logger, noopLogger } from "@packages/logger";
import { initFileRequestedArticleIntoReadlist, initResolveCanonicalIdentity } from "@packages/save-article";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initFileArticleIntoReadlistCommandHandler } from "./file-article-into-readlist-command-handler";

const USER = UserIdSchema.parse("user-a");
const WORK = ReadlistSlugSchema.parse("work");
const SCIENCE = ReadlistSlugSchema.parse("science");
const NOW = new Date("2026-10-25T00:00:00.000Z");
const EMAIL_SOURCE = { kind: "email" as const, receivedAtMessageId: "2026-10-25#<m@x>", ordinal: "0003" };

function command(overrides: Partial<FileArticleIntoReadlistDetail> = {}): FileArticleIntoReadlistDetail {
	return {
		userId: USER,
		url: "https://example.com/post",
		readlist: WORK,
		provenance: { kind: "email", senderEmail: "news@example.com" },
		fit: { verdict: "keep", reason: "Code review practice.", purposeVersion: "0123456789ab", source: EMAIL_SOURCE },
		...overrides,
	};
}

type FilingPorts = Parameters<typeof initFileRequestedArticleIntoReadlist>[0];

async function harness(
	opts: {
		fileRequestedArticleIntoReadlist?: Parameters<
			typeof initFileArticleIntoReadlistCommandHandler
		>[0]["fileRequestedArticleIntoReadlist"];
		racing?: (store: ReturnType<typeof initInMemoryArticleStore>) => Partial<FilingPorts>;
		publishEvent?: PublishEvent;
	} = {},
) {
	const store = initInMemoryArticleStore();
	for (const slug of [WORK, SCIENCE]) {
		await store.createReadlistDefinition({ userId: USER, slug, label: slug, createdAt: NOW });
	}
	const resolveCanonicalIdentity = initResolveCanonicalIdentity({ findIdentityRow: store.findIdentityRow });
	const published: { detailType: string; detail: unknown }[] = [];
	const infos: unknown[][] = [];
	const errors: unknown[][] = [];
	const publishEvent: PublishEvent = async (event, detail) => {
		if (opts.publishEvent) await opts.publishEvent(event, detail);
		published.push({ detailType: event.detailType, detail });
	};
	const handler = initFileArticleIntoReadlistCommandHandler({
		findSavedArticleForLink: initFindSavedArticleForLink({
			resolveCanonicalIdentity,
			findArticleById: store.findArticleById,
		}),
		listReadlistDefinitions: store.listReadlistDefinitions,
		fileRequestedArticleIntoReadlist:
			opts.fileRequestedArticleIntoReadlist ??
			initFileRequestedArticleIntoReadlist({ ...store, resolveCanonicalIdentity, ...opts.racing?.(store) }),
		publishEvent,
		logger: Logger.from({
			...noopLogger,
			info: (...args) => infos.push(args),
			error: (...args) => errors.push(args),
		}),
	});
	const run = async (detail: unknown, at: { requestedAt?: Date } = {}) => {
		const time = (at.requestedAt ?? new Date()).toISOString();
		const event = buildSqsEvent([{ messageId: "m-1", body: JSON.stringify({ detail, time }) }]);
		const response = await handler(event, buildLambdaContext(), () => {});
		assert(response);
		return response;
	};
	const saveToAll = (url: string) =>
		store.saveArticle({
			userId: USER,
			url,
			metadata: { title: "T", siteName: "S", excerpt: "E", wordCount: 1 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: NOW,
			saveTrigger: "manual",
		});
	const readlistsHolding = async (url: string) =>
		(await store.listUserSavesForUrl({ userId: USER, url })).map((save) => save.readlist ?? DEFAULT_READLIST_SLUG).sort();
	const workRow = (url: string) =>
		store.findReadlistArticleById({ id: ReaderArticleHashId.from(url), userId: USER, readlist: WORK });
	const skipped = () => infos.filter(([message]) => message === "[file-article-into-readlist] filing skipped");
	return { store, published, infos, errors, run, saveToAll, readlistsHolding, workRow, skipped };
}

describe("initFileArticleIntoReadlistCommandHandler", () => {
	it("files a saved article into the readlist and publishes the fact with the resolved URL and source", async () => {
		const h = await harness();
		await h.saveToAll("https://example.com/post");

		expect(await h.run(command())).toEqual({ batchItemFailures: [] });

		expect(await h.readlistsHolding("https://example.com/post")).toEqual([DEFAULT_READLIST_SLUG, WORK].sort());
		expect(h.published).toEqual([
			{
				detailType: ArticleFiledIntoReadlistEvent.detailType,
				detail: { userId: USER, readlist: WORK, url: "https://example.com/post", source: EMAIL_SOURCE },
			},
		]);
	});

	it("files the canonical's row for a substack redirect whose alias was claimed", async () => {
		const h = await harness();
		const wrapper = "https://substack.com/redirect/abc-123";
		const canonical = "https://writer.example.com/p/essay";
		await h.saveToAll(canonical);
		await h.store.claimAlias({ aliasUrl: wrapper, targetOriginalUrl: canonical, now: NOW });

		expect(await h.run(command({ url: wrapper }))).toEqual({ batchItemFailures: [] });

		expect(await h.readlistsHolding(canonical)).toEqual([DEFAULT_READLIST_SLUG, WORK].sort());
		expect(h.published[0]?.detail).toEqual(expect.objectContaining({ url: canonical }));
	});

	it("files an adopted terminal's target row", async () => {
		const h = await harness();
		const earlier = "https://example.com/original";
		const terminal = "https://example.com/final";
		await h.saveToAll(earlier);
		await h.store.claimAlias({ aliasUrl: terminal, targetOriginalUrl: earlier, now: NOW });

		await h.run(command({ url: terminal }));

		expect(await h.readlistsHolding(earlier)).toEqual([DEFAULT_READLIST_SLUG, WORK].sort());
	});

	it("still publishes the fact when the article is already in the readlist", async () => {
		const h = await harness();
		await h.saveToAll("https://example.com/post");
		await h.run(command());

		expect(await h.run(command())).toEqual({ batchItemFailures: [] });

		expect(h.published).toHaveLength(2);
	});

	it("resurfaces a read article, turning the other readlists that hold it unread", async () => {
		const h = await harness();
		const url = "https://example.com/post";
		await h.saveToAll(url);
		await h.run(command());
		await h.run(command({ readlist: SCIENCE }));
		const id = ReaderArticleHashId.from(url);
		await h.store.updateArticleStatusAcrossReadlists({ id, userId: USER, addressed: WORK, status: "read" });
		const requestedAt = new Date(Date.now() + 2_000);

		await h.run(command(), { requestedAt });

		expect((await h.store.findReadlistArticleById({ id, userId: USER, readlist: WORK }))?.status).toBe("unread");
		expect((await h.store.findReadlistArticleById({ id, userId: USER, readlist: SCIENCE }))?.status).toBe("unread");
		expect((await h.store.findArticleById(id, USER))?.status).toBe("unread");
	});

	it("waits for a link whose article is not in All yet, naming no URL", async () => {
		const h = await harness();

		expect(await h.run(command())).toEqual({ batchItemFailures: [{ itemIdentifier: "m-1" }] });

		expect(h.errors).toEqual([]);
		expect(h.infos).toHaveLength(1);
		const [message, fields] = h.infos[0];
		expect(message).toContain("waiting for the article");
		expect(fields).toEqual({
			userId: USER,
			readlist: WORK,
			messageId: "m-1",
			receiveCount: 1,
			receivedAtMessageId: EMAIL_SOURCE.receivedAtMessageId,
			ordinal: EMAIL_SOURCE.ordinal,
		});
		expect(JSON.stringify(h.infos)).not.toContain("example.com");
	});

	it("waits on a reader-sourced filing without email ids", async () => {
		const h = await harness();

		await h.run(command({ fit: { verdict: "keep", source: { kind: "reader" } } }));

		expect(h.infos[0]?.[1]).toEqual({ userId: USER, readlist: WORK, messageId: "m-1", receiveCount: 1 });
	});

	it("fails a filing into All", async () => {
		const h = await harness();
		await h.saveToAll("https://example.com/post");

		expect(await h.run(command({ readlist: DEFAULT_READLIST_SLUG }))).toEqual({
			batchItemFailures: [{ itemIdentifier: "m-1" }],
		});
		expect(h.published).toEqual([]);
	});

	it("logs one error naming no URL when the filing fails", async () => {
		const h = await harness({
			fileRequestedArticleIntoReadlist: async () => {
				throw new Error("DynamoDB unavailable");
			},
		});
		await h.saveToAll("https://example.com/post");

		expect(await h.run(command())).toEqual({ batchItemFailures: [{ itemIdentifier: "m-1" }] });

		expect(h.errors).toEqual([
			["[file-article-into-readlist] record failed on receive 1 (messageId m-1)", { error: new Error("DynamoDB unavailable") }],
		]);
	});

	it("logs the thrown string as the error", async () => {
		const h = await harness({
			fileRequestedArticleIntoReadlist: async () => {
				throw "boom";
			},
		});
		await h.saveToAll("https://example.com/post");

		await h.run(command());

		expect(h.errors).toEqual([
			["[file-article-into-readlist] record failed on receive 1 (messageId m-1)", { error: "boom" }],
		]);
	});
});

describe("initFileArticleIntoReadlistCommandHandler on a redrive", () => {
	const URL = "https://example.com/post";
	const anHourBack = () => new Date(Date.now() - 3_600_000);
	const expectSkipped = async (
		h: Awaited<ReturnType<typeof harness>>,
		response: unknown,
		reason: string,
		url: string = URL,
	) => {
		expect(response).toEqual({ batchItemFailures: [] });
		expect(h.published).toEqual([]);
		expect(h.skipped().map(([, fields]) => fields)).toEqual([expect.objectContaining({ reason })]);
		expect(await h.workRow(url)).toBeNull();
	};
	const ID = ReaderArticleHashId.from(URL);
	const dropOverride = (overrides: { url?: string; receivedAtMessageId?: string; ordinal?: ReturnType<typeof formatEmailLinkOrdinal>; createdAt: Date }) => ({
		url: overrides.url ?? URL,
		anchorText: "Post",
		host: "example.com",
		readerVerdict: "drop" as const,
		receivedAtMessageId: overrides.receivedAtMessageId ?? "2026-10-24#<other@x>",
		ordinal: overrides.ordinal ?? formatEmailLinkOrdinal(1),
		createdAt: overrides.createdAt,
	});
	const seedWork = (h: Awaited<ReturnType<typeof harness>>, url: string, savedAt: Date) =>
		h.store.saveReadlistArticle({
			userId: USER,
			readlist: WORK,
			url,
			metadata: { title: "T", siteName: "S", excerpt: "E", wordCount: 1 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt,
		});

	it("running the same filing twice leaves one row with the first savedAt and publishes the fact both times", async () => {
		const h = await harness();
		await h.saveToAll(URL);
		const requestedAt = new Date();

		await h.run(command(), { requestedAt });
		const first = (await h.workRow(URL))?.savedAt;
		await h.run(command(), { requestedAt });

		expect((await h.workRow(URL))?.savedAt).toEqual(first);
		expect(h.published).toHaveLength(2);
	});

	it("a filing dead-lettered after its write and redriven publishes the missing fact without moving the row", async () => {
		let failPublish = true;
		const h = await harness({
			publishEvent: async () => {
				if (failPublish) throw new Error("EventBridge unavailable");
			},
		});
		await h.saveToAll(URL);
		const requestedAt = new Date();

		expect(await h.run(command(), { requestedAt })).toEqual({ batchItemFailures: [{ itemIdentifier: "m-1" }] });
		const first = (await h.workRow(URL))?.savedAt;
		failPublish = false;
		expect(await h.run(command(), { requestedAt })).toEqual({ batchItemFailures: [] });

		expect((await h.workRow(URL))?.savedAt).toEqual(first);
		expect(h.published).toHaveLength(1);
	});

	it("a redrive after the readlist was deleted creates no row and logs readlist-gone, naming no URL", async () => {
		const h = await harness();
		await h.saveToAll(URL);
		await h.store.deleteReadlistDefinition({ userId: USER, slug: WORK });

		await expectSkipped(h, await h.run(command(), { requestedAt: anHourBack() }), "readlist-gone");
		expect(h.skipped()[0]?.[1]).toEqual({ userId: USER, readlist: WORK, messageId: "m-1", reason: "readlist-gone" });
		expect(JSON.stringify(h.infos)).not.toContain("example.com");
	});

	it("a redrive after the account was deleted ends with readlist-gone instead of waiting", async () => {
		const h = await harness();
		await h.store.deleteAllUserArticles(USER);

		await expectSkipped(h, await h.run(command(), { requestedAt: anHourBack() }), "readlist-gone");
	});

	it("a redrive after a newer drop creates no row and logs reader-dropped", async () => {
		const h = await harness();
		const requestedAt = anHourBack();
		await h.saveToAll(URL);
		await h.store.recordReadlistFitOverride({
			userId: USER,
			readlist: WORK,
			override: {
				url: URL,
				anchorText: "Post",
				host: "example.com",
				readerVerdict: "drop",
				receivedAtMessageId: "2026-10-24#<other@x>",
				ordinal: formatEmailLinkOrdinal(1),
				createdAt: new Date(),
			},
		});

		await expectSkipped(h, await h.run(command(), { requestedAt }), "reader-dropped");
	});

	it("a redrive after a direct removal creates no row and logs removed-after-request", async () => {
		const h = await harness();
		const requestedAt = anHourBack();
		await h.saveToAll(URL);
		await h.run(command(), { requestedAt });
		await h.store.deleteReadlistArticle({ id: ReaderArticleHashId.from(URL), userId: USER, readlist: WORK });
		h.published.length = 0;

		await expectSkipped(h, await h.run(command(), { requestedAt }), "removed-after-request");
	});

	it("a removal older than the request does not stop the filing", async () => {
		const h = await harness();
		await h.saveToAll(URL);
		await h.run(command());
		await h.store.deleteReadlistArticle({ id: ReaderArticleHashId.from(URL), userId: USER, readlist: WORK });

		await h.run(command(), { requestedAt: new Date(Date.now() + 2_000) });

		expect(await h.workRow(URL)).not.toBeNull();
	});

	it("a redrive after the reader read the article in All, with no readlist row yet, files it read", async () => {
		const h = await harness();
		const requestedAt = anHourBack();
		await h.saveToAll(URL);
		const read = await h.store.updateArticleStatusAcrossReadlists({
			id: ReaderArticleHashId.from(URL),
			userId: USER,
			addressed: DEFAULT_READLIST_SLUG,
			status: "read",
		});

		await h.run(command(), { requestedAt });

		const row = await h.workRow(URL);
		expect(row?.status).toBe("read");
		expect(row?.readAt).toEqual(read?.readAt);
		expect(h.published).toHaveLength(1);
	});

	it("a readlist deleted between the read and the transaction logs readlist-gone", async () => {
		const h = await harness({
			racing: (store) => ({
				findReadlistFiling: async (params) => {
					await store.deleteReadlistDefinition({ userId: USER, slug: WORK });
					return store.findReadlistFiling(params);
				},
			}),
		});
		await h.saveToAll(URL);

		await expectSkipped(h, await h.run(command()), "readlist-gone");
	});

	it("a link removed from All between the read and the transaction waits", async () => {
		const h = await harness({
			racing: (store) => ({
				findReadlistFiling: async (params) => {
					await store.deleteArticle(ReaderArticleHashId.from(URL), USER);
					return store.findReadlistFiling(params);
				},
			}),
		});
		await h.saveToAll(URL);

		expect(await h.run(command())).toEqual({ batchItemFailures: [{ itemIdentifier: "m-1" }] });
		expect(h.infos[0]?.[0]).toContain("waiting for the article");
		expect(h.published).toEqual([]);
	});
	it("a redrive after the reader added a read link to the readlist from another one leaves it read everywhere", async () => {
		const h = await harness();
		await h.saveToAll(URL);
		await h.run(command({ readlist: SCIENCE }));
		await h.store.updateArticleStatusAcrossReadlists({ id: ID, userId: USER, addressed: SCIENCE, status: "read" });
		await h.store.assignSavedArticleToReadlist({ userId: USER, readlist: WORK, from: SCIENCE, url: URL, savedAt: new Date() });
		const before = {
			work: await h.workRow(URL),
			science: await h.store.findReadlistArticleById({ id: ID, userId: USER, readlist: SCIENCE }),
			all: await h.store.findArticleById(ID, USER),
		};

		expect(await h.run(command(), { requestedAt: anHourBack() })).toEqual({ batchItemFailures: [] });

		const after = {
			work: await h.workRow(URL),
			science: await h.store.findReadlistArticleById({ id: ID, userId: USER, readlist: SCIENCE }),
			all: await h.store.findArticleById(ID, USER),
		};
		const stateOf = (rows: typeof before) =>
			[rows.work, rows.science, rows.all].map((row) => ({ status: row?.status, readAt: row?.readAt }));
		expect(stateOf(after)).toEqual(stateOf(before));
		expect(stateOf(after).map(({ status }) => status)).toEqual(["read", "read", "read"]);
	});

	it("a redrive with nothing against it files the link", async () => {
		const h = await harness();
		await h.saveToAll(URL);

		expect(await h.run(command(), { requestedAt: anHourBack() })).toEqual({ batchItemFailures: [] });

		expect((await h.workRow(URL))?.status).toBe("unread");
		expect(h.published).toHaveLength(1);
	});

	it("a drop recorded before the save, under the prepared URL, still refuses the filing", async () => {
		const h = await harness();
		const requestedAt = anHourBack();
		await h.store.recordReadlistFitOverride({
			userId: USER,
			readlist: WORK,
			override: dropOverride({ url: "https://x.com/jack/status/20", createdAt: new Date() }),
		});
		await h.saveToAll("https://x.com/jack/status/20");

		const response = await h.run(command({ url: "https://twitter.com/jack/status/20" }), { requestedAt });

		await expectSkipped(h, response, "reader-dropped", "https://x.com/jack/status/20");
	});

	it("a drop recorded before the save, under a URL the save later aliased, still refuses a reader-sourced filing", async () => {
		const h = await harness();
		const requestedAt = anHourBack();
		const canonical = "https://writer.example.com/p/thread";
		await h.store.recordReadlistFitOverride({
			userId: USER,
			readlist: WORK,
			override: dropOverride({ url: "https://x.com/jack/status/20", createdAt: new Date() }),
		});
		await h.saveToAll(canonical);
		await h.store.claimAlias({ aliasUrl: "https://x.com/jack/status/20", targetOriginalUrl: canonical, now: NOW });

		const response = await h.run(
			command({ url: "https://twitter.com/jack/status/20", fit: { verdict: "keep", source: { kind: "reader" } } }),
			{ requestedAt },
		);

		await expectSkipped(h, response, "reader-dropped", canonical);
	});

	it("a drop matching only by email id and ordinal still refuses the filing", async () => {
		const h = await harness();
		const requestedAt = anHourBack();
		await h.saveToAll(URL);
		await h.store.recordReadlistFitOverride({
			userId: USER,
			readlist: WORK,
			override: dropOverride({
				url: "https://elsewhere.example.org/unrelated",
				receivedAtMessageId: EMAIL_SOURCE.receivedAtMessageId,
				ordinal: formatEmailLinkOrdinal(3),
				createdAt: new Date(),
			}),
		});

		await expectSkipped(h, await h.run(command(), { requestedAt }), "reader-dropped");
	});

	it("an undo whose override still exists files, because the drop is older than the command", async () => {
		const h = await harness();
		await h.saveToAll(URL);
		await h.store.recordReadlistFitOverride({
			userId: USER,
			readlist: WORK,
			override: dropOverride({ createdAt: anHourBack() }),
		});

		await h.run(command({ fit: { verdict: "keep", source: { kind: "reader" } } }));

		expect(await h.workRow(URL)).not.toBeNull();
	});

	it("a later email carrying a dropped link files, because the drop is older than the command", async () => {
		const h = await harness();
		await h.saveToAll(URL);
		await h.store.recordReadlistFitOverride({
			userId: USER,
			readlist: WORK,
			override: dropOverride({ createdAt: anHourBack() }),
		});

		await h.run(command());

		expect(await h.workRow(URL)).not.toBeNull();
	});

	it("a redrive after a drop that found no readlist row creates no row and logs removed-after-request", async () => {
		const h = await harness();
		const requestedAt = anHourBack();
		await h.saveToAll(URL);
		await h.store.deleteReadlistArticleByUrl({ userId: USER, readlist: WORK, url: URL });

		await expectSkipped(h, await h.run(command(), { requestedAt }), "removed-after-request");
	});

	it("a redrive after the reader read the row leaves it read and in place", async () => {
		const h = await harness();
		await h.saveToAll(URL);
		const requestedAt = new Date();
		await h.run(command(), { requestedAt });
		await h.store.setReadlistArticleStatus({ id: ID, userId: USER, readlist: WORK, status: "read" });
		const before = await h.workRow(URL);
		const allBefore = await h.store.findArticleById(ID, USER);

		await h.run(command(), { requestedAt });

		const after = await h.workRow(URL);
		expect(after?.status).toBe("read");
		expect(after?.savedAt).toEqual(before?.savedAt);
		expect(after?.readAt).toEqual(before?.readAt);
		expect((await h.store.findArticleById(ID, USER))?.status).toBe(allBefore?.status);
	});

	it("a filing of an article read before the request lands unread, as a live filing does", async () => {
		const h = await harness();
		await h.saveToAll(URL);
		await h.store.updateArticleStatusAcrossReadlists({ id: ID, userId: USER, addressed: DEFAULT_READLIST_SLUG, status: "read" });
		const requestedAt = new Date(Date.now() + 2_000);

		await h.run(command(), { requestedAt });

		expect((await h.workRow(URL))?.status).toBe("unread");
		expect((await h.store.findArticleById(ID, USER))?.status).toBe("read");
		expect(h.published).toHaveLength(1);
	});

	it("a redrive after a newer filing does not move the row", async () => {
		const h = await harness();
		await h.saveToAll(URL);
		const requestedAt = anHourBack();
		await h.run(command());
		const first = (await h.workRow(URL))?.savedAt;

		await h.run(command(), { requestedAt });

		expect((await h.workRow(URL))?.savedAt).toEqual(first);
	});

	it("a row older than the request and not read since moves up, as a live filing does", async () => {
		const h = await harness();
		await h.saveToAll(URL);
		await seedWork(h, URL, NOW);

		await h.run(command(), { requestedAt: new Date(Date.now() + 2_000) });

		const savedAt = (await h.workRow(URL))?.savedAt;
		assert(savedAt);
		expect(savedAt.getTime()).toBeGreaterThan(NOW.getTime());
	});

	it("a filing carries the All row's suggestion attribution onto the readlist row", async () => {
		const h = await harness();
		const suggestionAttribution = { campaignId: "hn-front", snapshotAt: "2026-10-24T00:00:00Z", hnItemId: 42, rank: 3 };
		await h.store.saveArticle({
			userId: USER,
			url: URL,
			metadata: { title: "T", siteName: "S", excerpt: "E", wordCount: 1 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			suggestionAttribution,
			savedAt: NOW,
			saveTrigger: "manual",
		});

		await h.run(command());

		const { articles } = await h.store.findReadlistArticles({ userId: USER, readlist: WORK });
		expect(articles.map((article) => article.suggestionAttribution)).toEqual([suggestionAttribution]);
	});

	it("a link removed from the readlist between the read and the transaction logs removed-after-request", async () => {
		const h = await harness({
			racing: (store) => ({
				findReadlistFiling: async (params) => {
					const filing = await store.findReadlistFiling(params);
					await store.deleteReadlistArticle({ id: ID, userId: USER, readlist: WORK });
					return filing;
				},
			}),
		});
		await h.saveToAll(URL);
		await seedWork(h, URL, NOW);

		await expectSkipped(h, await h.run(command(), { requestedAt: anHourBack() }), "removed-after-request");
	});

	it("a filing that loses its row to a newer write publishes the fact and does not resurface", async () => {
		const racerSavedAt = new Date(Date.now() + 60_000);
		const h = await harness({
			racing: (store) => ({
				allocateSavedAt: async (params) => {
					const allocated = await store.allocateSavedAt(params);
					await store.saveReadlistArticle({
						userId: USER,
						readlist: WORK,
						url: URL,
						metadata: { title: "T", siteName: "S", excerpt: "E", wordCount: 1 },
						estimatedReadTime: MinutesSchema.parse(1),
						provenance: { kind: "web" },
						savedAt: racerSavedAt,
					});
					return allocated;
				},
			}),
		});
		await h.saveToAll(URL);
		await seedWork(h, URL, NOW);
		await h.run(command({ readlist: SCIENCE }));
		await h.store.setReadlistArticleStatus({ id: ID, userId: USER, readlist: WORK, status: "read" });
		const scienceBefore = await h.store.findReadlistArticleById({ id: ID, userId: USER, readlist: SCIENCE });
		h.published.length = 0;

		expect(await h.run(command(), { requestedAt: new Date(Date.now() + 2_000) })).toEqual({ batchItemFailures: [] });

		expect((await h.workRow(URL))?.savedAt).toEqual(racerSavedAt);
		expect(h.published.map((event) => event.detailType)).toEqual([ArticleFiledIntoReadlistEvent.detailType]);
		const scienceAfter = await h.store.findReadlistArticleById({ id: ID, userId: USER, readlist: SCIENCE });
		expect({ status: scienceAfter?.status, savedAt: scienceAfter?.savedAt }).toEqual({
			status: scienceBefore?.status,
			savedAt: scienceBefore?.savedAt,
		});
	});

});

describe("FileArticleIntoReadlistCommand", () => {
	it.each([
		["an email keep", command().fit],
		["a reader keep", { verdict: "keep", source: { kind: "reader" } }],
		["a reader keep with a purpose version", { verdict: "keep", purposeVersion: "0123456789ab", source: { kind: "reader" } }],
		["a no-purpose filing from email", { kind: "no-purpose", source: EMAIL_SOURCE }],
		["a no-purpose filing by the reader", { kind: "no-purpose", source: { kind: "reader" } }],
	])("parses %s", (_name, fit) => {
		expect(FileArticleIntoReadlistCommand.detailSchema.safeParse({ ...command(), fit }).success).toBe(true);
	});

	it("parses the purpose version the domain computes for a readlist purpose", () => {
		const fit = { ...command().fit, purposeVersion: readlistPurposeVersion("Keep: code review\nSkip: hiring") };

		expect(FileArticleIntoReadlistCommand.detailSchema.safeParse({ ...command(), fit }).success).toBe(true);
	});

	it("rejects a reader-sourced keep that carries a reason", () => {
		const fit = { verdict: "keep", reason: "The reader kept it.", source: { kind: "reader" } };

		expect(FileArticleIntoReadlistCommand.detailSchema.safeParse({ ...command(), fit }).success).toBe(false);
	});

	it("rejects an email keep without its purpose version", () => {
		const fit = { verdict: "keep", reason: "Code review.", source: EMAIL_SOURCE };

		expect(FileArticleIntoReadlistCommand.detailSchema.safeParse({ ...command(), fit }).success).toBe(false);
	});

	it.each([
		["an email keep", { verdict: "keep", reason: "Code review.", purposeVersion: "v1", source: EMAIL_SOURCE }],
		["a reader keep", { verdict: "keep", purposeVersion: "0123456789AB", source: { kind: "reader" } }],
	])("rejects %s whose purpose version is not 12 hex characters", (_name, fit) => {
		expect(FileArticleIntoReadlistCommand.detailSchema.safeParse({ ...command(), fit }).success).toBe(false);
	});
});
