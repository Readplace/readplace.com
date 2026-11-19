import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { READLIST_PATH, buildReadlistUrl, type ReadlistUrlState } from "./readlist.url";

const TEMPLATE = readFileSync(join(__dirname, "readlist-save-skeleton.template.html"), "utf-8");

type SaveSkeletonState = "armed" | "inert";

const STATE_CLASSES: Record<SaveSkeletonState, string> = {
	armed: "readlist-save-skeleton--armed",
	inert: "readlist-save-skeleton--inert",
};

export interface ReadlistSaveSkeletonDisplayModel {
	stateClass: string;
}

export function toReadlistSaveSkeletonDisplayModel(input: {
	filters: ReadlistUrlState;
}): ReadlistSaveSkeletonDisplayModel {
	const listingIsWhereTheSaveLands = buildReadlistUrl(input.filters) === READLIST_PATH;
	const state: SaveSkeletonState = listingIsWhereTheSaveLands ? "armed" : "inert";
	return { stateClass: STATE_CLASSES[state] };
}

export function renderReadlistSaveSkeleton(
	displayModel: ReadlistSaveSkeletonDisplayModel,
): string {
	return render(TEMPLATE, displayModel);
}
