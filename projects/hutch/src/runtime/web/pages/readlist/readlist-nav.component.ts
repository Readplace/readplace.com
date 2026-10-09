import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	DEFAULT_READLIST_SLUG,
	READLIST_LABEL_MAX_LENGTH,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import type { IconName } from "@packages/ui-icons";
import { render, withInternalTracking } from "@packages/web-shell";

import { READLIST_KIND_ICON } from "../../shared/readlist-kind-icon";
import { readlistDeleteConfirmPopoverId } from "./readlist-delete-confirm.component";
import type { Readlist } from "./readlist.nav";
import { buildReadlistUrl, readlistDeletePath, readlistReturnQuery } from "./readlist.url";
import {
	readlistRenameAction,
	readlistRenameFallbackInputId,
	readlistRenamePopoverId,
} from "./readlist-rename.component";
import {
	READLIST_NAME_FIELD,
	READLIST_NAME_LABEL,
	READLIST_NAME_PLACEHOLDER,
} from "./readlist-name-form.component";
import { READLIST_CREATE_POPOVER_ID, readlistCreateAction } from "./readlist-create.component";

const TEMPLATE = readFileSync(join(__dirname, "readlist-nav.template.html"), "utf-8");

const NAV_SOURCE = "queue-nav";

interface ReadlistNavMenu {
	isDeletable: boolean;
	deleteAction?: string;
	deletePopoverId?: string;
	renamePopoverId?: string;
	renameAction?: string;
	renameInputId?: string;
	renameField?: string;
	renameLabel?: string;
	renameMaxLength?: number;
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
	current: { title: string; iconName: IconName };
	createAction: string;
	createPopoverId: string;
	nameLabel: string;
	nameField: string;
	namePlaceholder: string;
	nameMaxLength: number;
	canCreate: boolean;
}

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
		renameAction: readlistRenameAction(input.slug),
		renameInputId: readlistRenameFallbackInputId(input.slug),
		renameField: READLIST_NAME_FIELD,
		renameLabel: READLIST_NAME_LABEL,
		renameMaxLength: READLIST_LABEL_MAX_LENGTH,
	};
}

export function buildReadlistNav(input: {
	readlists: readonly Readlist[];
	activeSlug: ReadlistSlug;
	newReadlistAction: string;
	canCreate: boolean;
}): ReadlistNavDisplayModel {
	const items: ReadlistNavItem[] = input.readlists.map((readlist) => {
		const isActive = readlist.slug === input.activeSlug;
		const kind = readlist.slug === DEFAULT_READLIST_SLUG ? "default" : "custom";
		return {
			href: withInternalTracking(
				buildReadlistUrl({ readlist: readlist.slug }),
				{ source: NAV_SOURCE, content: `queue-${readlist.slug}` },
			),
			title: readlist.label,
			name: readlist.slug,
			iconName: READLIST_KIND_ICON[kind],
			itemClass: `readlist-row readlist-nav__item${isActive ? " readlist-row--selected" : ""}`,
			linkClass: "readlist-row__main readlist-nav__link",
			isActive,
			...navMenu({ slug: readlist.slug, viewedSlug: input.activeSlug, canEdit: input.canCreate }),
		};
	});
	const current = items.find((item) => item.isActive);
	assert(current, "the viewed readlist must be one of the readlists the rail lists");
	return {
		items,
		current: { title: current.title, iconName: current.iconName },
		createAction: readlistCreateAction(input.newReadlistAction),
		createPopoverId: READLIST_CREATE_POPOVER_ID,
		nameLabel: READLIST_NAME_LABEL,
		nameField: READLIST_NAME_FIELD,
		namePlaceholder: READLIST_NAME_PLACEHOLDER,
		nameMaxLength: READLIST_LABEL_MAX_LENGTH,
		canCreate: input.canCreate,
	};
}

export function renderReadlistNav(displayModel: ReadlistNavDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
