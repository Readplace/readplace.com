import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";
import type { IconName } from "@packages/ui-icons";
import { render, withInternalTracking } from "@packages/web-shell";

import { readlistDeleteConfirmPopoverId } from "../readlist-delete-confirm.component";
import type { Readlist } from "../readlist.nav";
import { buildReadlistUrl, readlistDeletePath } from "../readlist.url";
import { designFeatureParams, readlistDesignReturnQuery } from "./readlist-design-feature";
import { readlistDesignRenamePopoverId } from "./readlist-design-rename.component";

const TEMPLATE = readFileSync(join(__dirname, "readlist-design-nav.template.html"), "utf-8");

const NAV_SOURCE = "queue-nav";

interface ReadlistDesignNavMenu {
	isDeletable: boolean;
	deleteAction?: string;
	deletePopoverId?: string;
	renamePopoverId?: string;
}

export interface ReadlistDesignNavItem extends ReadlistDesignNavMenu {
	href: string;
	title: string;
	name: string;
	iconName: IconName;
	itemClass: string;
	linkClass: string;
	isActive: boolean;
}

export interface ReadlistDesignNavDisplayModel {
	items: readonly ReadlistDesignNavItem[];
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
}): ReadlistDesignNavMenu {
	const isDeletable = input.canEdit && input.slug !== DEFAULT_READLIST_SLUG;
	if (!isDeletable) return { isDeletable: false };
	return {
		isDeletable: true,
		deleteAction: withInternalTracking(
			`${readlistDeletePath(input.slug)}${readlistDesignReturnQuery({ readlist: input.viewedSlug })}`,
			{ source: NAV_SOURCE, content: "delete-readlist" },
		),
		deletePopoverId: readlistDeleteConfirmPopoverId(input.slug),
		renamePopoverId: readlistDesignRenamePopoverId(input.slug),
	};
}

export function buildReadlistDesignNav(input: {
	readlists: readonly Readlist[];
	activeSlug: ReadlistSlug;
	newReadlistAction: string;
	canCreate: boolean;
}): ReadlistDesignNavDisplayModel {
	return {
		items: input.readlists.map((readlist) => {
			const isActive = readlist.slug === input.activeSlug;
			const kind = readlist.slug === DEFAULT_READLIST_SLUG ? "default" : "custom";
			return {
				href: withInternalTracking(
					buildReadlistUrl({ readlist: readlist.slug }, designFeatureParams(true)),
					{ source: NAV_SOURCE, content: `queue-${readlist.slug}` },
				),
				title: readlist.label,
				name: readlist.slug,
				iconName: ICON_BY_KIND[kind],
				itemClass: `readlist-design-nav__item${isActive ? " readlist-design-nav__item--active" : ""}`,
				linkClass: `readlist-design-nav__link${isActive ? " readlist-design-nav__link--active" : ""}`,
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

export function renderReadlistDesignNav(displayModel: ReadlistDesignNavDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
