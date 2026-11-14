import assert from "node:assert/strict";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { MinutesSchema, validateSaveableUrl, withNewSavePreparation } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initResolveSaveIdentity, type ResolveWrapperTarget } from "@packages/save-article";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initFindLinkQueueRowKeys } from "./find-link-queue-row-keys";

const userId = UserIdSchema.parse("user-1");
const NOW = new Date("2026-11-03T10:00:00.000Z");
const ORIGINAL = "https://publisher.example/article";
const ALIAS_TARGET = "https://publisher.example/canonical";
const TRACKER = "https://javascriptweekly.com/link/100000/rss";
const OVERSIZED_TRACKER = `https://link.mail.beehiiv.com/ss/c/u001.${"a".repeat(2800)}`;
const ARCHIVE = "https://archive.ph/Ab1cD";
const LINKEDIN_EMAIL_LINK = "https://www.linkedin.com/comm/feed/update/urn:li:activity:7000000000000000001";

type IdentityStore = ReturnType<typeof initInMemoryArticleStore>;

const articleRow = (url: string) => ({
	url,
	metadata: { title: "T", siteName: "publisher.example", excerpt: "", wordCount: 0 },
	estimatedReadTime: MinutesSchema.parse(0),
	savedAt: NOW,
});

type Branch = {
	name: string;
	raw: string;
	targets?: Record<string, Awaited<ReturnType<ResolveWrapperTarget>>>;
	rows?: (store: IdentityStore) => Promise<void>;
};

const branches: Branch[] = [
	{ name: "a plain original with no identity row", raw: ORIGINAL },
	{ name: "a plain original with its own article row", raw: ORIGINAL, rows: async (store) => {
		await store.saveArticleGlobally(articleRow(ORIGINAL));
	} },
	{ name: "a plain original whose article row adopted another destination", raw: ORIGINAL, rows: async (store) => {
		await store.saveArticleGlobally(articleRow(ORIGINAL));
		await store.setDisplayUrl({ url: ORIGINAL, displayUrl: ALIAS_TARGET });
	} },
	{ name: "a plain original that is an alias", raw: ORIGINAL, rows: async (store) => {
		await store.claimAlias({ aliasUrl: ORIGINAL, targetOriginalUrl: ALIAS_TARGET, now: NOW });
	} },
	{ name: "a plain original that is an alias of an adopted article row", raw: ORIGINAL, rows: async (store) => {
		await store.saveArticleGlobally(articleRow(ALIAS_TARGET));
		await store.setDisplayUrl({ url: ALIAS_TARGET, displayUrl: "https://publisher.example/adopted" });
		await store.claimAlias({ aliasUrl: ORIGINAL, targetOriginalUrl: ALIAS_TARGET, now: NOW });
	} },
	{ name: "a syntactic wrapper", raw: `https://archive.ph/o/Ab1cD/${ORIGINAL}` },
	{ name: "a syntactic wrapper with its own article row", raw: `https://archive.ph/o/Ab1cD/${ORIGINAL}`, rows: async (store) => {
		await store.saveArticleGlobally(articleRow(`https://archive.ph/o/Ab1cD/${ORIGINAL}`));
	} },
	{ name: "a syntactic wrapper whose original is an alias", raw: `https://archive.ph/o/Ab1cD/${ORIGINAL}`, rows: async (store) => {
		await store.claimAlias({ aliasUrl: ORIGINAL, targetOriginalUrl: ALIAS_TARGET, now: NOW });
	} },
	{ name: "an archive capture whose embedded host is normalised", raw: "https://web.archive.org/web/2026/https://twitter.com/person/status/1" },
	{ name: "a tracker followed over the network", raw: TRACKER, targets: { [TRACKER]: { url: ORIGINAL, contentSourceUrl: TRACKER } } },
	{ name: "an oversized tracker followed over the network", raw: OVERSIZED_TRACKER, targets: { [OVERSIZED_TRACKER]: { url: ORIGINAL, contentSourceUrl: OVERSIZED_TRACKER } } },
	{ name: "a tracker followed through an archive", raw: TRACKER, targets: {
		[TRACKER]: { url: ARCHIVE, contentSourceUrl: TRACKER },
		[ARCHIVE]: { url: ORIGINAL, contentSourceUrl: ARCHIVE },
	} },
	{ name: "a tracker with a stored binding", raw: TRACKER, rows: async (store) => {
		await store.claimAlias({
			aliasUrl: TRACKER,
			targetOriginalUrl: ORIGINAL,
			sourceBinding: { contentSourceUrl: TRACKER, sourceOriginalUrl: ORIGINAL },
			now: NOW,
		});
	} },
	{ name: "a tracker whose stored binding leads to an alias", raw: TRACKER, rows: async (store) => {
		await store.claimAlias({
			aliasUrl: TRACKER,
			targetOriginalUrl: ORIGINAL,
			sourceBinding: { contentSourceUrl: TRACKER, sourceOriginalUrl: ORIGINAL },
			now: NOW,
		});
		await store.claimAlias({ aliasUrl: ORIGINAL, targetOriginalUrl: ALIAS_TARGET, now: NOW });
	} },
	{ name: "an archive short link saved as its own original", raw: ARCHIVE, targets: { [ARCHIVE]: { ownOriginal: true } } },
	{ name: "a LinkedIn email link", raw: LINKEDIN_EMAIL_LINK },
	{ name: "a wrapper around a LinkedIn email link with its own article row", raw: `https://archive.ph/o/Ab1cD/${LINKEDIN_EMAIL_LINK}`, rows: async (store) => {
		await store.saveArticleGlobally(articleRow(`https://archive.ph/o/Ab1cD/${LINKEDIN_EMAIL_LINK}`));
	} },
	{ name: "a link carrying subscriber parameters", raw: `${ORIGINAL}?r=reader&utm_source=email` },
];

function preparedUrlOf(raw: string): string {
	const prepared = withNewSavePreparation(validateSaveableUrl)(raw);
	assert(prepared.status !== "ERROR", `${raw} must be saveable`);
	return prepared.url;
}

async function candidateKeysAfterSaving(branch: Branch, factUrl: (raw: string) => string) {
	const store = initInMemoryArticleStore();
	await branch.rows?.(store);
	const save = initResolveSaveIdentity({
		validateUrl: validateSaveableUrl,
		findIdentityRow: store.findIdentityRow,
		claimAlias: store.claimAlias,
		resolveWrapperTarget: async (url) => branch.targets?.[url],
		now: () => NOW,
	});
	const identity = await save(preparedUrlOf(branch.raw));
	assert(identity.status === "resolved", `the save of ${branch.name} must resolve`);
	const requested: string[] = [];
	const findLinkQueueRowKeys = initFindLinkQueueRowKeys({
		findIdentityRow: store.findIdentityRow,
		findQueueRowKeys: async ({ urls }) => {
			requested.push(...urls);
			return [];
		},
	});
	await findLinkQueueRowKeys({ userId, url: factUrl(branch.raw) });
	return {
		savedKey: ArticleResourceUniqueId.parse(identity.url).value,
		candidateKeys: requested.map((url) => ArticleResourceUniqueId.parse(url).value),
	};
}

describe("findLinkQueueRowKeys covers the key every save branch writes", () => {
	it.each(branches)("for the prepared URL LinkQueued carries: $name", async (branch) => {
		const { savedKey, candidateKeys } = await candidateKeysAfterSaving(branch, preparedUrlOf);

		expect(candidateKeys).toContain(savedKey);
	});

	it.each(branches)("for the raw URL LinkQueueFailed carries: $name", async (branch) => {
		const { savedKey, candidateKeys } = await candidateKeysAfterSaving(branch, (raw) => raw);

		expect(candidateKeys).toContain(savedKey);
	});
});

describe("findLinkQueueRowKeys", () => {
	it("misses only a tracker whose save followed the network and left no stored binding", async () => {
		const { savedKey, candidateKeys } = await candidateKeysAfterSaving(
			{
				name: "a tracker with its own article row whose network claim is declined",
				raw: TRACKER,
				targets: { [TRACKER]: { url: ORIGINAL, contentSourceUrl: TRACKER } },
				rows: async (store) => {
					await store.saveArticleGlobally(articleRow(TRACKER));
				},
			},
			(raw) => raw,
		);

		expect(candidateKeys).not.toContain(savedKey);
	});

	it("returns the queue row keys the store finds for the candidates", async () => {
		const store = initInMemoryArticleStore();
		await store.saveArticle({ ...articleRow(ORIGINAL), userId, provenance: { kind: "web" }, saveTrigger: "manual" });
		const findLinkQueueRowKeys = initFindLinkQueueRowKeys({
			findIdentityRow: store.findIdentityRow,
			findQueueRowKeys: store.findQueueRowKeys,
		});

		expect(await findLinkQueueRowKeys({ userId, url: `${ORIGINAL}#top` })).toEqual([
			{ userId, url: "publisher.example/article" },
		]);
	});

	it("finds the saved destination of an oversized tracking link so its inbox state can recover", async () => {
		const store = initInMemoryArticleStore();
		await store.saveArticle({ ...articleRow(ORIGINAL), userId, provenance: { kind: "email", senderEmail: "letter@example.com" }, saveTrigger: "automatic" });
		await store.claimAlias({
			aliasUrl: OVERSIZED_TRACKER,
			targetOriginalUrl: ORIGINAL,
			sourceBinding: { contentSourceUrl: OVERSIZED_TRACKER, sourceOriginalUrl: ORIGINAL },
			now: NOW,
		});
		const findLinkQueueRowKeys = initFindLinkQueueRowKeys({
			findIdentityRow: store.findIdentityRow,
			findQueueRowKeys: store.findQueueRowKeys,
		});

		expect(await findLinkQueueRowKeys({ userId, url: OVERSIZED_TRACKER })).toEqual([
			{ userId, url: "publisher.example/article" },
		]);
	});

	it("returns no queue row for an oversized link with no saved destination", async () => {
		const store = initInMemoryArticleStore();
		const findLinkQueueRowKeys = initFindLinkQueueRowKeys({
			findIdentityRow: store.findIdentityRow,
			findQueueRowKeys: store.findQueueRowKeys,
		});

		expect(await findLinkQueueRowKeys({ userId, url: OVERSIZED_TRACKER })).toEqual([]);
	});

	it("still reads a URL whose key is exactly 2,048 bytes", async () => {
		const url = `https://publisher.example/${"a".repeat(2048 - "publisher.example/".length)}`;
		const reads: string[] = [];
		const findLinkQueueRowKeys = initFindLinkQueueRowKeys({
			findIdentityRow: async () => ({ kind: "absent" }),
			findQueueRowKeys: async ({ urls }) => {
				reads.push(...urls);
				return [];
			},
		});

		await findLinkQueueRowKeys({ userId, url });

		expect(reads.length).toBeGreaterThan(0);
	});
});
