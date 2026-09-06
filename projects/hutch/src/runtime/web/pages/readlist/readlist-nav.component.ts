import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";

import type { Readlist } from "./readlist.nav";
import { DEFAULT_READLIST_SLUG, READLIST_LABEL_MAX_LENGTH, type ReadlistSlug } from "@packages/domain/readlist";
import { readlistDeleteConfirmPopoverId } from "./readlist-delete-confirm.component";
import {
	buildReadlistUrl,
	readlistDeletePath,
	readlistRenamePath,
	readlistReturnQuery,
} from "./readlist.url";

const TEMPLATE = readFileSync(join(__dirname, "readlist-nav.template.html"), "utf-8");

const READLIST_RENAME_FIELD = "label";

const NAV_SOURCE = "queue-nav";

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
	itemClass: string;
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

function readlistNavItemClass(input: { isActive: boolean; isDeletable: boolean }): string {
	const modifiers = [
		input.isDeletable ? " readlist-nav__item--deletable" : "",
		input.isActive ? " readlist-nav__item--active" : "",
	];
	return `readlist-nav__item${modifiers.join("")}`;
}

function navRename(input: {
	slug: ReadlistSlug;
	isActive: boolean;
	canRename: boolean;
}): ReadlistNavRename {
	const isRenameable =
		input.canRename && input.isActive && input.slug !== DEFAULT_READLIST_SLUG;
	if (!isRenameable) return { isRenameable: false };
	return {
		isRenameable: true,
		renameAction: withInternalTracking(
			`${readlistRenamePath(input.slug)}${readlistReturnQuery({})}`,
			{ source: NAV_SOURCE, content: "rename-readlist" },
		),
		renameField: READLIST_RENAME_FIELD,
		maxLength: READLIST_LABEL_MAX_LENGTH,
	};
}

function navDelete(input: {
	slug: ReadlistSlug;
	viewedSlug: ReadlistSlug;
	canDelete: boolean;
}): ReadlistNavDelete {
	const isDeletable = input.canDelete && input.slug !== DEFAULT_READLIST_SLUG;
	if (!isDeletable) return { isDeletable: false };
	return {
		isDeletable: true,
		deleteAction: withInternalTracking(
			`${readlistDeletePath(input.slug)}${readlistReturnQuery({ readlist: input.viewedSlug })}`,
			{ source: NAV_SOURCE, content: "delete-readlist" },
		),
		deletePopoverId: readlistDeleteConfirmPopoverId(input.slug),
	};
}

export function buildReadlistNav(input: {
	readlists: readonly Readlist[];
	activeSlug: ReadlistSlug;
	newReadlistAction: string;
	canCreate: boolean;
}): ReadlistNavDisplayModel {
	return {
		items: input.readlists.map((readlist) => {
			const isActive = readlist.slug === input.activeSlug;
			const remove = navDelete({
				slug: readlist.slug,
				viewedSlug: input.activeSlug,
				canDelete: input.canCreate,
			});
			return {
				href: withInternalTracking(buildReadlistUrl({ readlist: readlist.slug }), {
					source: NAV_SOURCE,
					content: `queue-${readlist.slug}`,
				}),
				title: readlist.label,
				name: readlist.slug,
				itemClass: readlistNavItemClass({ isActive, isDeletable: remove.isDeletable }),
				linkClass: readlistNavLinkClass(isActive),
				isActive,
				...navRename({
					slug: readlist.slug,
					isActive,
					canRename: input.canCreate,
				}),
				...remove,
			};
		}),
		newReadlistAction: withInternalTracking(input.newReadlistAction, {
			source: NAV_SOURCE,
			content: "new-readlist",
		}),
		canCreate: input.canCreate,
	};
}

export function renderReadlistNav(displayModel: ReadlistNavDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
