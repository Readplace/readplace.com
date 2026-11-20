import assert from "node:assert/strict";
import {
	MinutesSchema,
	ReaderArticleHashIdSchema,
	SaveableUrlSchema,
	type SavedArticle,
	articleDestinationUrl,
	articleDisplayMetadata,
	validateSaveableUrl,
	viewerFor,
	withNewSavePreparation,
} from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import type { PublishSubmitLink } from "@packages/provider-contracts/events";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import { initClaimDailySaves } from "../pages/readlist/daily-save-allowance";
import { initMcpSaveLink } from "./mcp-save-link";

const userId = authenticatedUserIdFrom("00000000000000000000000000000001");
const exampleUrl = SaveableUrlSchema.parse("https://example.com/post");
const destination = articleDestinationUrl({ url: exampleUrl, displayUrl: undefined });
const work = { id: ReadlistSlugSchema.parse("work"), name: "Work" };
const all = { id: DEFAULT_READLIST_SLUG, name: "All" };
const provenance = { kind: "mcp" as const, registeredName: "Example client" };
const mine = { slug: ReadlistSlugSchema.parse("mine"), label: "Mine", createdAt: new Date("2026-11-01T00:00:00.000Z"), ownSavesSince: new Date("2026-11-20T00:00:00.000Z") };

const saved: SavedArticle = {
	id: ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef"),
	userId,
	url: exampleUrl,
	destinationUrl: destination,
	metadata: articleDisplayMetadata({ url: exampleUrl, destinationUrl: destination, title: "Post", siteName: "Example", excerpt: "", wordCount: 0, imageUrl: undefined, publishedOn: undefined, viewer: viewerFor(userId), ownerUserId: userId }),
	servedBody: { kind: "legacy" },
	estimatedReadTime: MinutesSchema.parse(0),
	status: "unread",
	savedAt: new Date("2026-08-04T00:00:00.000Z"),
};

type SaveLinkDeps = Parameters<typeof initMcpSaveLink>[0];

function fakeDeps(overrides: Partial<SaveLinkDeps> = {}): SaveLinkDeps {
	return {
		resolveSaveAccess: async () => ({ allowed: true }),
		claimDailySaves: async ({ urls }) => ({ granted: [...urls], refused: [], retryAfterSeconds: undefined }),
		validateNewSaveUrl: withNewSavePreparation(validateSaveableUrl),
		refreshArticleIfStale: async () => ({ action: "skip", identity: { status: "resolved", url: exampleUrl, originalUrl: exampleUrl } }),
		resolveMcpSaveProvenance: async () => provenance,
		publishSubmitLink: async () => {},
		saveArticleAtReadlistTop: async () => ({ saved, canonicalUrl: exampleUrl, createdUserArticle: true, wroteUserArticle: true, resurfacedFromRead: false, meteredLegs: "run", crawlPending: { kind: "not-attempted" } }),
		fileArticleIntoReadlist: async () => ({ createdUserArticle: true, wroteUserArticle: true, resurfacedFromRead: false }),
		resolveReadlistMembership: async () => new Map([[exampleUrl, [all, work]]]),
		logError: () => {},
		baseUrl: "https://readplace.test",
		listReadlistDefinitions: async () => [],
		...overrides,
	};
}

const request = { userId, url: "https://example.com/post", readlists: [], oauthClientId: "client" };

describe("initMcpSaveLink", () => {
	it("refuses the save with the access message when the account may not save", async () => {
		const saveLink = initMcpSaveLink(fakeDeps({ resolveSaveAccess: async () => ({ allowed: false, message: "Verify your email first." }) }));

		const result = await saveLink(request);

		assert.deepEqual(result, { ok: false, message: "Verify your email first." });
	});

	it("refuses a URL that cannot be saved with the validation message", async () => {
		const saveLink = initMcpSaveLink(fakeDeps());

		const result = await saveLink({ ...request, url: "not a url" });

		assert.equal(result.ok, false);
		assert.ok("message" in result && result.message.length > 0);
	});

	describe("on a metered account", () => {
		function meteredClaim(params: { limit: number; savedUrls: readonly string[] }) {
			const limiter = initInMemoryRateLimit({ now: () => new Date("2026-08-04T00:00:00.000Z") });
			return initClaimDailySaves({
				getEffectiveAccess: async () => ({ tier: "free", banner: "free", reason: "trial-expired" }),
				isDailyLimited: () => true,
				findSavedUrls: async ({ urls }) => urls.filter((url) => params.savedUrls.includes(url)),
				claimRateLimitUnits: limiter.claimRateLimitUnits,
				rule: { limit: params.limit, windowSeconds: 86_400 },
			});
		}

		it("refuses a new link once today's saves are spent and saves nothing", async () => {
			const saveArticleAtReadlistTop = jest.fn<ReturnType<SaveLinkDeps["saveArticleAtReadlistTop"]>, Parameters<SaveLinkDeps["saveArticleAtReadlistTop"]>>();
			const refreshArticleIfStale = jest.fn<ReturnType<SaveLinkDeps["refreshArticleIfStale"]>, Parameters<SaveLinkDeps["refreshArticleIfStale"]>>();
			const saveLink = initMcpSaveLink(fakeDeps({
				claimDailySaves: meteredClaim({ limit: 0, savedUrls: [] }),
				saveArticleAtReadlistTop,
				refreshArticleIfStale,
			}));

			const result = await saveLink(request);

			assert.deepEqual(result, {
				ok: false,
				refused: "daily-save-limit",
				message: "You've reached today's limit for new saves. Links you already saved are still in your readlist.",
			});
			expect(saveArticleAtReadlistTop).not.toHaveBeenCalled();
			expect(refreshArticleIfStale).not.toHaveBeenCalled();
		});

		it("saves a link the reader already holds without charging today's saves", async () => {
			const saveLink = initMcpSaveLink(fakeDeps({ claimDailySaves: meteredClaim({ limit: 0, savedUrls: [exampleUrl] }) }));

			const result = await saveLink(request);

			assert.deepEqual(result, { ok: true, id: saved.id.value, title: "Post", filedInto: [all, work] });
		});
	});

	it("publishes a submit-link command for All and each named readlist when the URL is unresolved, and reports the save as pending", async () => {
		const publishSubmitLink = jest.fn<ReturnType<PublishSubmitLink>, Parameters<PublishSubmitLink>>(async () => {});
		const saveLink = initMcpSaveLink(fakeDeps({
			refreshArticleIfStale: async () => ({ action: "unresolved", identity: { status: "unresolved" } }),
			publishSubmitLink,
		}));

		const result = await saveLink({ ...request, readlists: [work.id] });

		assert.deepEqual(result, { ok: true, pending: true });
		expect(
			publishSubmitLink.mock.calls.map(([params]) => [params.readlist, params.url, params.provenance, params.saveTrigger]),
		).toEqual([
			[DEFAULT_READLIST_SLUG, exampleUrl, provenance, "manual"],
			[work.id, exampleUrl, provenance, "manual"],
		]);
	});

	it("saves the article, files it into each named readlist other than All, and answers with its readlists", async () => {
		const fileArticleIntoReadlist = jest.fn<ReturnType<SaveLinkDeps["fileArticleIntoReadlist"]>, Parameters<SaveLinkDeps["fileArticleIntoReadlist"]>>(
			async () => ({ createdUserArticle: true, wroteUserArticle: true, resurfacedFromRead: false }),
		);
		const saveLink = initMcpSaveLink(fakeDeps({ fileArticleIntoReadlist }));

		const result = await saveLink({ ...request, readlists: [DEFAULT_READLIST_SLUG, work.id] });

		assert.deepEqual(result, { ok: true, id: saved.id.value, title: "Post", filedInto: [all, work] });
		expect(fileArticleIntoReadlist.mock.calls).toEqual([[{ userId, readlist: work.id, article: saved, provenance }]]);
	});

	it("also queues the save for the readlist that holds the reader's own saves when the URL is unresolved", async () => {
		const publishSubmitLink = jest.fn<ReturnType<PublishSubmitLink>, Parameters<PublishSubmitLink>>(async () => {});
		const saveLink = initMcpSaveLink(fakeDeps({
			refreshArticleIfStale: async () => ({ action: "unresolved", identity: { status: "unresolved" } }),
			publishSubmitLink,
			listReadlistDefinitions: async () => [mine],
		}));

		await saveLink({ ...request, readlists: [work.id] });

		const commands = publishSubmitLink.mock.calls.map(([params]) => params);
		expect(commands.map((params) => params.readlist)).toEqual([DEFAULT_READLIST_SLUG, work.id, mine.slug]);
		expect(new Set(commands.map((params) => params.saveAttemptId)).size).toBe(1);
	});

	it("files the save once into the readlist that holds the reader's own saves, even when the assistant names it", async () => {
		const fileArticleIntoReadlist = jest.fn<ReturnType<SaveLinkDeps["fileArticleIntoReadlist"]>, Parameters<SaveLinkDeps["fileArticleIntoReadlist"]>>(
			async () => ({ createdUserArticle: true, wroteUserArticle: true, resurfacedFromRead: false }),
		);
		const saveLink = initMcpSaveLink(fakeDeps({ fileArticleIntoReadlist, listReadlistDefinitions: async () => [mine] }));

		await saveLink({ ...request, readlists: [mine.slug, work.id] });

		expect(fileArticleIntoReadlist.mock.calls.map(([params]) => params.readlist)).toEqual([mine.slug, work.id]);
	});

	it("logs a failure on Readplace's side and points the reader at their readlist", async () => {
		const failure = new Error("store unavailable");
		const logError = jest.fn();
		const saveLink = initMcpSaveLink(fakeDeps({
			refreshArticleIfStale: async () => {
				throw failure;
			},
			logError,
		}));

		const result = await saveLink(request);

		assert.deepEqual(result, {
			ok: false,
			message: "Could not save the link — something went wrong on Readplace's side. Try again in a moment, or save it from your readlist at https://readplace.test/queue.",
		});
		expect(logError.mock.calls).toEqual([["MCP save_link failed", failure]]);
	});

	it("logs a thrown value that is not an Error without attaching it", async () => {
		const logError = jest.fn();
		const saveLink = initMcpSaveLink(fakeDeps({
			refreshArticleIfStale: async () => {
				throw "store unavailable";
			},
			logError,
		}));

		await saveLink(request);

		expect(logError.mock.calls).toEqual([["MCP save_link failed", undefined]]);
	});
});
