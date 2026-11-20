import { SUPPORTED_CLIENTS } from "@packages/supported-clients";
import type { SaveTrigger } from "../article/article.schema";
import type { SaveProvenance } from "../article/save-provenance";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "./readlist-name.schema";

export const DEFAULT_READLIST_LABEL = "All";

export interface ReadlistRef {
	starterCampaignId?: string;
	ownSavesSince?: Date;
	slug: ReadlistSlug;
	label: string;
}

export const DEFAULT_READLIST: ReadlistRef = {
	slug: DEFAULT_READLIST_SLUG,
	label: DEFAULT_READLIST_LABEL,
};

export function readerReadlists(
	definitions: readonly ReadlistRef[],
): readonly ReadlistRef[] {
	return [
		DEFAULT_READLIST,
		...definitions.map(({ slug, label, starterCampaignId, ownSavesSince }) => ({
			slug,
			label,
			...(starterCampaignId === undefined ? {} : { starterCampaignId }),
			...(ownSavesSince === undefined ? {} : { ownSavesSince }),
		})),
	];
}

export function readlistsHoldingArticle(input: {
	saves: readonly { readlist?: ReadlistSlug }[];
	readlists: readonly ReadlistRef[];
}): readonly ReadlistRef[] {
	const held = new Set(
		input.saves.map((save) => save.readlist ?? DEFAULT_READLIST_SLUG),
	);
	return input.readlists.filter((readlist) => held.has(readlist.slug));
}

export function routableReadlists<T extends { slug: ReadlistSlug; ownSavesSince?: Date }>(
	readlists: readonly T[],
): readonly T[] {
	return readlists.filter((readlist) => readlist.ownSavesSince === undefined);
}

export function ownSavesReadlist<T extends { slug: ReadlistSlug; ownSavesSince?: Date }>(
	readlists: readonly T[],
): T | undefined {
	return readlists.find((readlist) => readlist.ownSavesSince !== undefined);
}

const APP_CLIENT_NAMES: ReadonlySet<string> = new Set(
	SUPPORTED_CLIENTS.filter((client) => client.group === "nativeApp").map((client) => client.name),
);

export function ownSavesFiling<T extends { slug: ReadlistSlug; ownSavesSince?: Date }>(input: {
	readlists: readonly T[];
	provenance: SaveProvenance;
	trigger: SaveTrigger;
}): T | undefined {
	if (input.trigger === "automatic") return undefined;
	if (input.provenance.kind === "client" && APP_CLIENT_NAMES.has(input.provenance.clientName)) return undefined;
	return ownSavesReadlist(input.readlists);
}

export function withOwnSaves<T extends { slug: ReadlistSlug }>(input: {
	destinations: readonly T[];
	ownSaves: T | undefined;
}): readonly T[] {
	const { ownSaves } = input;
	if (ownSaves === undefined) return input.destinations;
	return input.destinations.some((destination) => destination.slug === ownSaves.slug)
		? input.destinations
		: [...input.destinations, ownSaves];
}
