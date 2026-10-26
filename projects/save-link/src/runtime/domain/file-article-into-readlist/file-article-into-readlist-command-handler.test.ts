import assert from "node:assert/strict";
import { initFindSavedArticleForLink } from "@packages/article-store";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import {
	ArticleFiledIntoReadlistEvent,
	FileArticleIntoReadlistCommand,
	type FileArticleIntoReadlistDetail,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initFileArticleIntoReadlist, initResolveCanonicalIdentity } from "@packages/save-article";
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

function harness(opts: { fileArticleIntoReadlist?: Parameters<typeof initFileArticleIntoReadlistCommandHandler>[0]["fileArticleIntoReadlist"] } = {}) {
	const store = initInMemoryArticleStore();
	const published: { detailType: string; detail: unknown }[] = [];
	const infos: unknown[][] = [];
	const errors: unknown[][] = [];
	const publishEvent: PublishEvent = async (event, detail) => {
		published.push({ detailType: event.detailType, detail });
	};
	const handler = initFileArticleIntoReadlistCommandHandler({
		findSavedArticleForLink: initFindSavedArticleForLink({
			resolveCanonicalIdentity: initResolveCanonicalIdentity({ findIdentityRow: store.findIdentityRow }),
			findArticleById: store.findArticleById,
		}),
		fileArticleIntoReadlist: opts.fileArticleIntoReadlist ?? initFileArticleIntoReadlist(store),
		publishEvent,
		logger: HutchLogger.from({
			...noopLogger,
			info: (...args) => infos.push(args),
			error: (...args) => errors.push(args),
		}),
		now: () => NOW,
	});
	const run = async (detail: unknown) => {
		const event = buildSqsEvent([{ messageId: "m-1", body: JSON.stringify({ detail }) }]);
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
		});
	const readlistsHolding = async (url: string) =>
		(await store.listUserSavesForUrl({ userId: USER, url })).map((save) => save.readlist ?? DEFAULT_READLIST_SLUG).sort();
	return { store, published, infos, errors, run, saveToAll, readlistsHolding };
}

describe("initFileArticleIntoReadlistCommandHandler", () => {
	it("files a saved article into the readlist and publishes the fact with the resolved URL and source", async () => {
		const h = harness();
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
		const h = harness();
		const wrapper = "https://substack.com/redirect/abc-123";
		const canonical = "https://writer.example.com/p/essay";
		await h.saveToAll(canonical);
		await h.store.claimAlias({ aliasUrl: wrapper, targetOriginalUrl: canonical, now: NOW });

		expect(await h.run(command({ url: wrapper }))).toEqual({ batchItemFailures: [] });

		expect(await h.readlistsHolding(canonical)).toEqual([DEFAULT_READLIST_SLUG, WORK].sort());
		expect(h.published[0]?.detail).toEqual(expect.objectContaining({ url: canonical }));
	});

	it("files an adopted terminal's target row", async () => {
		const h = harness();
		const earlier = "https://example.com/original";
		const terminal = "https://example.com/final";
		await h.saveToAll(earlier);
		await h.store.claimAlias({ aliasUrl: terminal, targetOriginalUrl: earlier, now: NOW });

		await h.run(command({ url: terminal }));

		expect(await h.readlistsHolding(earlier)).toEqual([DEFAULT_READLIST_SLUG, WORK].sort());
	});

	it("still publishes the fact when the article is already in the readlist", async () => {
		const h = harness();
		await h.saveToAll("https://example.com/post");
		await h.run(command());

		expect(await h.run(command())).toEqual({ batchItemFailures: [] });

		expect(h.published).toHaveLength(2);
	});

	it("resurfaces a read article, turning the other readlists that hold it unread", async () => {
		const h = harness();
		const url = "https://example.com/post";
		await h.saveToAll(url);
		await h.run(command());
		await h.run(command({ readlist: SCIENCE }));
		const id = ReaderArticleHashId.from(url);
		await h.store.updateArticleStatusAcrossReadlists({ id, userId: USER, addressed: WORK, status: "read" });

		await h.run(command());

		expect((await h.store.findReadlistArticleById({ id, userId: USER, readlist: WORK }))?.status).toBe("unread");
		expect((await h.store.findReadlistArticleById({ id, userId: USER, readlist: SCIENCE }))?.status).toBe("unread");
		expect((await h.store.findArticleById(id, USER))?.status).toBe("unread");
	});

	it("waits for a link whose article is not in All yet, naming no URL", async () => {
		const h = harness();

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
		const h = harness();

		await h.run(command({ fit: { verdict: "keep", source: { kind: "reader" } } }));

		expect(h.infos[0]?.[1]).toEqual({ userId: USER, readlist: WORK, messageId: "m-1", receiveCount: 1 });
	});

	it("fails a filing into All", async () => {
		const h = harness();
		await h.saveToAll("https://example.com/post");

		expect(await h.run(command({ readlist: DEFAULT_READLIST_SLUG }))).toEqual({
			batchItemFailures: [{ itemIdentifier: "m-1" }],
		});
		expect(h.published).toEqual([]);
	});

	it("writes one ERROR JSON line with no URL when the filing fails", async () => {
		const h = harness({
			fileArticleIntoReadlist: async () => {
				throw new Error("DynamoDB unavailable");
			},
		});
		await h.saveToAll("https://example.com/post");

		expect(await h.run(command())).toEqual({ batchItemFailures: [{ itemIdentifier: "m-1" }] });

		expect(h.errors).toHaveLength(1);
		const line = JSON.parse(String(h.errors[0]?.[0]));
		expect(line).toEqual(
			expect.objectContaining({
				level: "ERROR",
				message: "[file-article-into-readlist] record failed on receive 1 (messageId m-1)",
			}),
		);
		expect(line).not.toHaveProperty("url");
		expect(String(h.errors[0]?.[0])).not.toContain("example.com");
	});

	it("writes the same ERROR line when a string is thrown", async () => {
		const h = harness({
			fileArticleIntoReadlist: async () => {
				throw "boom";
			},
		});
		await h.saveToAll("https://example.com/post");

		await h.run(command());

		const line = JSON.parse(String(h.errors[0]?.[0]));
		expect(line.stack).toContain("boom");
		expect(String(h.errors[0]?.[0])).not.toContain("example.com");
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
