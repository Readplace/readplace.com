import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	DEFAULT_READLIST_SLUG,
	READLIST_LABEL_MAX_LENGTH,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import type { IconName } from "@packages/ui-icons";
import { render, renderNeedsUpgrade, withInternalTracking } from "@packages/web-shell";

import { READLIST_KIND_ICON } from "../../shared/readlist-kind-icon";
import { type UpgradeOffer, lockFor } from "../../shared/upgrade-offer/upgrade-offer";
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

const PARSE_ORIGIN = "https://internal.invalid";

interface ReadlistCreateForm {
	action: string;
	popoverId: string;
	nameLabel: string;
	nameField: string;
	namePlaceholder: string;
	nameMaxLength: number;
}

interface ReadlistLimitForm {
	action: string;
	fields: readonly { name: string; value: string }[];
}

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

interface ReadlistLockedMenu {
	name: string;
	title: string;
	menuLocks: readonly string[];
}

export interface ReadlistNavItem extends ReadlistNavMenu {
	lockedMenus: readonly ReadlistLockedMenu[];
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
	createForms: readonly ReadlistCreateForm[];
	createLocks: readonly string[];
	limitForms: readonly ReadlistLimitForm[];
}

function renderedNavLock(input: {
	offer: UpgradeOffer | undefined;
	gated: boolean;
	key: string;
	label: string;
	controlClass: string;
}): string[] {
	const lock = lockFor({ ...input, source: NAV_SOURCE });
	return lock === undefined ? [] : [renderNeedsUpgrade(lock)];
}

function lockedMenusOf(input: {
	slug: ReadlistSlug;
	title: string;
	gated: boolean;
	offer: UpgradeOffer | undefined;
}): ReadlistLockedMenu[] {
	const gated = input.gated && input.slug !== DEFAULT_READLIST_SLUG;
	const menuLocks = [
		{ key: "rename-readlist", label: "Edit" },
		{ key: "delete-readlist", label: "Delete" },
	].flatMap((control) => renderedNavLock({ ...control, offer: input.offer, gated, controlClass: "menu__item" }));
	return menuLocks.length === 0 ? [] : [{ name: input.slug, title: input.title, menuLocks }];
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

function limitFormsOf(input: { canEdit: boolean; canCreate: boolean; limitAlertHref: string }): ReadlistLimitForm[] {
	if (!input.canEdit || input.canCreate) return [];
	const tracked = new URL(
		withInternalTracking(input.limitAlertHref, { source: NAV_SOURCE, content: "readlist-limit" }),
		PARSE_ORIGIN,
	);
	return [
		{
			action: tracked.pathname,
			fields: Array.from(tracked.searchParams, ([name, value]) => ({ name, value })),
		},
	];
}

export function buildReadlistNav(input: {
	readlists: readonly Readlist[];
	activeSlug: ReadlistSlug;
	newReadlistAction: string;
	limitAlertHref: string;
	canEdit: boolean;
	canCreate: boolean;
	offer: UpgradeOffer | undefined;
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
			...navMenu({ slug: readlist.slug, viewedSlug: input.activeSlug, canEdit: input.canEdit }),
			lockedMenus: lockedMenusOf({ slug: readlist.slug, title: readlist.label, gated: !input.canEdit, offer: input.offer }),
		};
	});
	const current = items.find((item) => item.isActive);
	assert(current, "the viewed readlist must be one of the readlists the rail lists");
	return {
		items,
		current: { title: current.title, iconName: current.iconName },
		createForms: input.canCreate
			? [
					{
						action: readlistCreateAction(input.newReadlistAction),
						popoverId: READLIST_CREATE_POPOVER_ID,
						nameLabel: READLIST_NAME_LABEL,
						nameField: READLIST_NAME_FIELD,
						namePlaceholder: READLIST_NAME_PLACEHOLDER,
						nameMaxLength: READLIST_LABEL_MAX_LENGTH,
					},
				]
			: [],
		createLocks: renderedNavLock({
			offer: input.offer,
			gated: !input.canEdit,
			key: "create-readlist",
			label: "Create a readlist",
			controlClass: "readlist-row__main readlist-nav__new",
		}),
		limitForms: limitFormsOf(input),
	};
}

export function renderReadlistNav(displayModel: ReadlistNavDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
