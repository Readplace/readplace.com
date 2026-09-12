import assert from "node:assert";
import {
	DEFAULT_READLIST,
	type ReadlistRef,
	type ReadlistSlug,
	ReadlistLimitReachedError,
	decideReadlistCreate,
	readerReadlists,
} from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type {
	CreateReadlistDefinition,
	ListReadlistDefinitions,
} from "@packages/provider-contracts/article-store";

export type UpsertReadlistOutcome =
	| { status: "ok"; readlist: ReadlistRef; created: boolean }
	| { status: "invalid-name" }
	| { status: "reserved-name"; readlist: ReadlistRef }
	| { status: "limit-reached"; limit: number };

export interface UpsertReadlistDependencies {
	listReadlistDefinitions: ListReadlistDefinitions;
	createReadlistDefinition: CreateReadlistDefinition;
	generateReadlistSlug: () => ReadlistSlug;
	now: () => Date;
}

export type UpsertReadlist = (params: {
	userId: UserId;
	name: string;
}) => Promise<UpsertReadlistOutcome>;

export function initUpsertReadlist(deps: UpsertReadlistDependencies): UpsertReadlist {
	return async ({ userId, name }) => {
		const definitions = await deps.listReadlistDefinitions(userId);
		const readlists = readerReadlists(definitions);
		const decision = decideReadlistCreate({
			label: name,
			slug: deps.generateReadlistSlug(),
			readlists,
		});
		if (!decision.ok) {
			if (decision.reason === "invalid-name") return { status: "invalid-name" };
			return { status: "reserved-name", readlist: DEFAULT_READLIST };
		}
		if (!decision.create) {
			const existing = readlists.find((readlist) => readlist.slug === decision.slug);
			assert(existing, "decideReadlistCreate reused a slug that is not in the reader's readlists");
			return { status: "ok", readlist: existing, created: false };
		}
		const label = decision.create.label;
		try {
			const { created } = await deps.createReadlistDefinition({
				userId,
				slug: decision.slug,
				label,
				createdAt: deps.now(),
			});
			return { status: "ok", readlist: { slug: decision.slug, label }, created };
		} catch (error) {
			if (error instanceof ReadlistLimitReachedError) {
				return { status: "limit-reached", limit: error.limit };
			}
			throw error;
		}
	};
}
