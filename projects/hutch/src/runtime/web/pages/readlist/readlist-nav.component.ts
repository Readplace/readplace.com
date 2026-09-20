import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";
import type { IconName } from "@packages/ui-icons";
import { render, withInternalTracking } from "@packages/web-shell";

import { readlistDeleteConfirmPopoverId } from "./readlist-delete-confirm.component";
import type { Readlist } from "./readlist.nav";
import { buildReadlistUrl, readlistDeletePath, readlistReturnQuery } from "./readlist.url";
import { readlistRenamePopoverId } from "./readlist-rename.component";

const TEMPLATE = readFileSync(join(__dirname, "readlist-nav.template.html"), "utf-8");

const NAV_SOURCE = "queue-nav";

interface ReadlistNavMenu {
	isDeletable: boolean;
	deleteAction?: string;
	deletePopoverId?: string;
	renamePopoverId?: string;
}

export interface ReadlistNavItem extends ReadlistNavMenu {
	href: string;
	title: string;
	name: string;
	iconName: IconName;
	itemClass: string;
	linkClass: string;
	isActive: boolean;
}

export interface ReadlistNavDisplayModel {
	items: readonly ReadlistNavItem[];
	newReadlistAction: string;
	canCreate: boolean;
}

const ICON_BY_KIND: Record<"default" | "custom", IconName> = {
	default: "book",
	custom: "folder",
};

function navMenu(input: {
	slug: ReadlistSlug;
	viewedSlug: ReadlistSlug;
	canEdit: boolean;
}): ReadlistNavMenu {
	const isDeletable = input.canEdit && input.slug !== DEFAULT_READLIST_SLUG;
	if (!isDeletable) return { isDeletable: false };
	return {
		isDeletable: true,
		deleteAction: withInternalTracking(
			`${readlistDeletePath(input.slug)}${readlistReturnQuery({ readlist: input.viewedSlug })}`,
			{ source: NAV_SOURCE, content: "delete-readlist" },
		),
		deletePopoverId: readlistDeleteConfirmPopoverId(input.slug),
		renamePopoverId: readlistRenamePopoverId(input.slug),
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
			const kind = readlist.slug === DEFAULT_READLIST_SLUG ? "default" : "custom";
			return {
				href: withInternalTracking(
					buildReadlistUrl({ readlist: readlist.slug }),
					{ source: NAV_SOURCE, content: `queue-${readlist.slug}` },
				),
				title: readlist.label,
				name: readlist.slug,
				iconName: ICON_BY_KIND[kind],
				itemClass: `readlist-nav__item${isActive ? " readlist-nav__item--active" : ""}`,
				linkClass: `readlist-nav__link${isActive ? " readlist-nav__link--active" : ""}`,
				isActive,
				...navMenu({ slug: readlist.slug, viewedSlug: input.activeSlug, canEdit: input.canCreate }),
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
