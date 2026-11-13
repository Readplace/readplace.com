import assert from "node:assert/strict";
import { initFindSavedArticleForLink } from "@packages/article-store";
import { MinutesSchema } from "@packages/domain/article";
import { type EventInstant, toEventInstant } from "@packages/domain/event-envelope";
import { type EmailLinkOrdinal, EmailLinkOrdinalSchema } from "@packages/domain/inbox";
import {
	type ReadlistSlug,
	ReadlistSlugSchema,
	readlistFitOverrideId,
	readlistPurposeVersion,
} from "@packages/domain/readlist";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import type { Logger } from "@packages/logger";
import type { ReadlistFitOverride } from "@packages/provider-contracts/article-store";
import { initResolveCanonicalIdentity } from "@packages/save-article";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initFilingsLeftToFile } from "./filings-left-to-file";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const RAM = "2026-09-23T09:00:00.000Z#<m-1@example.com>";
const OTHER_RAM = "2026-09-20T09:00:00.000Z#<m-9@example.com>";
const WORK = ReadlistSlugSchema.parse("a1b2c3d4");
const NOW = new Date("2026-09-23T09:00:00.000Z");

const ordinal = (value: string): EmailLinkOrdinal => EmailLinkOrdinalSchema.parse(value);

const FILINGS = [
	{ ordinal: ordinal("0000"), url: "https://a.test/small-prs" },
	{ ordinal: ordinal("0005"), url: "https://c.test/testing" },
];

function override(params: {
	receivedAtMessageId: string;
	ordinal: EmailLinkOrdinal;
	readerVerdict: "keep" | "drop";
}): ReadlistFitOverride {
	return {
		id: readlistFitOverrideId({ createdAt: NOW, receivedAtMessageId: params.receivedAtMessageId, ordinal: params.ordinal }),
		url: "https://a.test/small-prs",
		anchorText: "Ship small PRs",
		host: "a.test",
		engineVerdict: params.readerVerdict === "keep" ? "drop" : "keep",
		engineReason: "The judge's call.",
		readerVerdict: params.readerVerdict,
		purposeVersion: readlistPurposeVersion("Engineering practice"),
		receivedAtMessageId: params.receivedAtMessageId,
		ordinal: params.ordinal,
		createdAt: NOW,
	};
}

function makeFence(opts: { overrides?: ReadlistFitOverride[] } = {}) {
	const store = initInMemoryArticleStore();
	const overrideReads: { userId: UserId; readlist: ReadlistSlug }[] = [];
	const markerReads: string[] = [];
	const infos: unknown[][] = [];
	const capture = (...args: unknown[]) => {
		infos.push(args);
	};
	const logger: Logger = { info: capture, error: capture, warn: capture, debug: capture };
	const filingsLeftToFile = initFilingsLeftToFile({
		listReadlistFitOverrides: async (params) => {
			overrideReads.push(params);
			return opts.overrides ?? [];
		},
		findSavedArticleForLink: initFindSavedArticleForLink({
			resolveCanonicalIdentity: initResolveCanonicalIdentity({ findIdentityRow: store.findIdentityRow }),
			findArticleById: store.findArticleById,
		}),
		findReadlistRemoval: async (params) => {
			markerReads.push(params.url);
			return store.findReadlistRemoval(params);
		},
		logger,
	});
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
	const remove = (url: string) => store.deleteReadlistArticleByUrl({ userId: USER, readlist: WORK, url });
	const leftToFile = <Filing extends { ordinal: EmailLinkOrdinal; url: string }>(
		filings: Filing[],
		triagedAt: EventInstant,
	) => filingsLeftToFile({ userId: USER, readlist: WORK, receivedAtMessageId: RAM, triagedAt, filings });
	return { leftToFile, saveToAll, remove, overrideReads, markerReads, infos };
}

describe("initFilingsLeftToFile", () => {
	it("returns no filings without reading the overrides", async () => {
		const fence = makeFence();

		assert.deepEqual(await fence.leftToFile([], toEventInstant(NOW)), []);
		assert.deepEqual(fence.overrideReads, []);
	});

	it.each(["keep", "drop"] as const)(
		"a same-email override holding %s removes that filing",
		async (readerVerdict) => {
			const fence = makeFence({
				overrides: [override({ receivedAtMessageId: RAM, ordinal: ordinal("0000"), readerVerdict })],
			});

			assert.deepEqual(await fence.leftToFile(FILINGS, toEventInstant(NOW)), [FILINGS[1]]);
			assert.deepEqual(fence.overrideReads, [{ userId: USER, readlist: WORK }]);
		},
	);

	it("does not re-file a link the reader kept", async () => {
		const fence = makeFence({
			overrides: [override({ receivedAtMessageId: RAM, ordinal: ordinal("0005"), readerVerdict: "keep" })],
		});

		assert.deepEqual(await fence.leftToFile(FILINGS, toEventInstant(NOW)), [FILINGS[0]]);
	});

	it("an override from another email does not fence this email's filing", async () => {
		const fence = makeFence({
			overrides: [override({ receivedAtMessageId: OTHER_RAM, ordinal: ordinal("0000"), readerVerdict: "drop" })],
		});

		assert.deepEqual(await fence.leftToFile(FILINGS, toEventInstant(NOW)), FILINGS);
	});

	it("a removal newer than the triage withholds that filing", async () => {
		const triagedAt = toEventInstant(new Date(Date.now() - 2_000));
		const withheld = { ordinal: ordinal("0003"), url: "https://example.com/post?utm_source=newsletter" };
		const fence = makeFence();
		for (const filing of [...FILINGS, withheld]) await fence.saveToAll(filing.url);
		await fence.remove(withheld.url);

		assert.deepEqual(await fence.leftToFile([...FILINGS, withheld], triagedAt), FILINGS);
		assert.deepEqual(fence.infos, [
			[
				"[filter-email-links] filing withheld",
				{ userId: USER, readlist: WORK, receivedAtMessageId: RAM, ordinal: "0003", reason: "removed-after-triage" },
			],
		]);
	});

	it.each<[string, boolean]>([
		["a removal older than the triage leaves the filing", true],
		["a link with no All row keeps the filing", false],
	])("%s", async (_name, saved) => {
		const triagedAt = toEventInstant(new Date(Date.now() + 2_000));
		const fence = makeFence();
		if (saved) {
			await fence.saveToAll(FILINGS[0].url);
			await fence.remove(FILINGS[0].url);
		}

		assert.deepEqual(await fence.leftToFile([FILINGS[0]], triagedAt), [FILINGS[0]]);
		assert.deepEqual(fence.markerReads, saved ? [FILINGS[0].url] : []);
	});
});
