import {
	DEFAULT_READLIST_SLUG,
	ReadlistLimitReachedError,
	ReadlistSlugSchema,
	READLIST_MAX_PER_USER,
} from "@packages/domain/readlist";
import type {
	CreateReadlistDefinition,
	ReadlistDefinitionData,
} from "@packages/provider-contracts/article-store";
import { UserIdSchema } from "@packages/domain/user";
import { initUpsertReadlist } from "./upsert-readlist";

const USER = UserIdSchema.parse("user-a");
const MINTED = ReadlistSlugSchema.parse("minted");
const NOW = new Date("2026-09-01T00:00:00.000Z");

function definition({ slug, label }: { slug: string; label: string }): ReadlistDefinitionData {
	return { slug: ReadlistSlugSchema.parse(slug), label, createdAt: new Date(0) };
}

function build(overrides: {
	definitions?: ReadlistDefinitionData[];
	create?: CreateReadlistDefinition;
}) {
	const created: Record<string, unknown>[] = [];
	const upsert = initUpsertReadlist({
		listReadlistDefinitions: async () => overrides.definitions ?? [],
		createReadlistDefinition:
			overrides.create ??
			(async (params) => {
				created.push({ slug: params.slug, label: params.label });
				return { created: true, ownedCount: 1 };
			}),
		generateReadlistSlug: () => MINTED,
		now: () => NOW,
	});
	return { upsert, created };
}

describe("initUpsertReadlist", () => {
	it("creates a new readlist under the minted slug when the name is free", async () => {
		const { upsert, created } = build({ definitions: [] });
		const outcome = await upsert({ userId: USER, name: "Work" });
		expect(outcome).toEqual({ status: "ok", readlist: { slug: MINTED, label: "Work" }, created: true });
		expect(created).toEqual([{ slug: MINTED, label: "Work" }]);
	});

	it("reuses an existing readlist matched case-insensitively, without creating", async () => {
		const { upsert, created } = build({ definitions: [definition({ slug: "work", label: "Work" })] });
		const outcome = await upsert({ userId: USER, name: "wOrK" });
		expect(outcome).toEqual({
			status: "ok",
			readlist: { slug: ReadlistSlugSchema.parse("work"), label: "Work" },
			created: false,
		});
		expect(created).toEqual([]);
	});

	it("returns the store's creation outcome when the insert wrote nothing", async () => {
		const { upsert } = build({
			create: async () => ({ created: false, ownedCount: 1 }),
		});

		expect(await upsert({ userId: USER, name: "Work" })).toEqual({
			status: "ok",
			readlist: { slug: MINTED, label: "Work" },
			created: false,
		});
	});

	it("rejects an empty name as invalid", async () => {
		const { upsert } = build({ definitions: [] });
		expect(await upsert({ userId: USER, name: "   " })).toEqual({ status: "invalid-name" });
	});

	it("rejects the built-in readlist's name as reserved", async () => {
		const { upsert } = build({ definitions: [] });
		expect(await upsert({ userId: USER, name: "All" })).toEqual({
			status: "reserved-name",
			readlist: { slug: DEFAULT_READLIST_SLUG, label: "All" },
		});
	});

	it("reports the cap when creating would exceed the per-user limit", async () => {
		const { upsert } = build({
			definitions: [],
			create: async () => {
				throw new ReadlistLimitReachedError(READLIST_MAX_PER_USER);
			},
		});
		expect(await upsert({ userId: USER, name: "Work" })).toEqual({
			status: "limit-reached",
			limit: READLIST_MAX_PER_USER,
		});
	});

	it("rethrows a non-limit failure from the store", async () => {
		const { upsert } = build({
			definitions: [],
			create: async () => {
				throw new Error("boom");
			},
		});
		await expect(upsert({ userId: USER, name: "Work" })).rejects.toThrow("boom");
	});
});
