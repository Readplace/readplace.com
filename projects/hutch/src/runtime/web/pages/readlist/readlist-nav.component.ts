import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";

import type { Readlist } from "./readlist.nav";
import { DEFAULT_READLIST_SLUG, READLIST_LABEL_MAX_LENGTH, type ReadlistSlug } from "@packages/domain/readlist";
import { readlistDeleteConfirmPopoverId } from "./readlist-delete-confirm.component";
import {
	type LinkParams,
	buildReadlistUrl,
	readlistDeletePath,
	readlistRenamePath,
	readlistReturnQuery,
} from "./readlist.url";

const TEMPLATE = readFileSync(join(__dirname, "readlist-nav.template.html"), "utf-8");

const READLIST_RENAME_FIELD = "label";

interface ReadlistNavRename {
	isRenameable: boolean;
	renameAction?: string;
	renameField?: string;
	maxLength?: number;
}

interface ReadlistNavDelete {
	isDeletable: boolean;
	deleteAction?: string;
	deletePopoverId?: string;
}

export interface ReadlistNavItem extends ReadlistNavRename, ReadlistNavDelete {
	href: string;
	title: string;
	name: string;
	linkClass: string;
	isActive: boolean;
}

export interface ReadlistNavDisplayModel {
	items: readonly ReadlistNavItem[];
	newReadlistAction: string;
	canCreate: boolean;
}

export function readlistNavLinkClass(isActive: boolean): string {
	return `readlist-nav__link${isActive ? " readlist-nav__link--active" : ""}`;
}

function navRename(input: {
	slug: ReadlistSlug;
	isActive: boolean;
	canRename: boolean;
	linkParams: LinkParams;
}): ReadlistNavRename {
	const isRenameable =
		input.canRename && input.isActive && input.slug !== DEFAULT_READLIST_SLUG;
	if (!isRenameable) return { isRenameable: false };
	return {
		isRenameable: true,
		renameAction: `${readlistRenamePath(input.slug)}${readlistReturnQuery({}, input.linkParams)}`,
		renameField: READLIST_RENAME_FIELD,
		maxLength: READLIST_LABEL_MAX_LENGTH,
	};
}

function navDelete(input: {
	slug: ReadlistSlug;
	isActive: boolean;
	canDelete: boolean;
	linkParams: LinkParams;
}): ReadlistNavDelete {
	const isDeletable =
		input.canDelete && input.isActive && input.slug !== DEFAULT_READLIST_SLUG;
	if (!isDeletable) return { isDeletable: false };
	return {
		isDeletable: true,
		deleteAction: `${readlistDeletePath(input.slug)}${readlistReturnQuery({}, input.linkParams)}`,
		deletePopoverId: readlistDeleteConfirmPopoverId(input.slug),
	};
}

export function buildReadlistNav(input: {
	readlists: readonly Readlist[];
	activeSlug: ReadlistSlug;
	linkParams: LinkParams;
	newReadlistAction: string;
	canCreate: boolean;
}): ReadlistNavDisplayModel {
	return {
		items: input.readlists.map((readlist) => {
			const isActive = readlist.slug === input.activeSlug;
			return {
				href: withInternalTracking(buildReadlistUrl({ readlist: readlist.slug }, input.linkParams), {
					source: "queue-nav",
					content: `queue-${readlist.slug}`,
				}),
				title: readlist.label,
				name: readlist.slug,
				linkClass: readlistNavLinkClass(isActive),
				isActive,
				...navRename({
					slug: readlist.slug,
					isActive,
					canRename: input.canCreate,
					linkParams: input.linkParams,
				}),
				...navDelete({
					slug: readlist.slug,
					isActive,
					canDelete: input.canCreate,
					linkParams: input.linkParams,
				}),
			};
		}),
		newReadlistAction: input.newReadlistAction,
		canCreate: input.canCreate,
	};
}

export function renderReadlistNav(displayModel: ReadlistNavDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
