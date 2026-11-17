import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	DEFAULT_READLIST_SLUG,
	READLIST_LABEL_MAX_LENGTH,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import type { IconName } from "@packages/ui-icons";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import {
	render,
	renderNeedsUpgrade,
	withInternalTracking,
} from "@packages/web-shell";

import { READLIST_KIND_ICON } from "../../shared/readlist-kind-icon";
import {
	type UpgradeOffer,
	lockFor,
} from "../../shared/upgrade-offer/upgrade-offer";
import { readlistDeleteConfirmPopoverId } from "./readlist-delete-confirm.component";
import type { Readlist } from "./readlist.nav";
import { composeReadlistNav } from "./readlist-nav-layout";
import {
	buildReadlistUrl,
	readlistDeletePath,
	readlistPinPath,
	readlistReturnQuery,
	readlistUnpinPath,
} from "./readlist.url";
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
import {
	READLIST_CREATE_POPOVER_ID,
	readlistCreateAction,
} from "./readlist-create.component";

const TEMPLATE = readFileSync(
	join(__dirname, "readlist-nav.template.html"),
	"utf-8",
);
const PINNED_TEMPLATE = readFileSync(
	join(__dirname, "readlist-nav-pinned.template.html"),
	"utf-8",
);
const MENU_TEMPLATE = readFileSync(
	join(__dirname, "readlist-nav-menu.template.html"),
	"utf-8",
);

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

type ReadlistNavPlacement = "rail" | "more" | "sheet";

type ReadlistPinState = "unpinnable" | "pinned" | "unpinned";

const PLACEMENT_CLASSES: Record<
	ReadlistNavPlacement,
	{ item: string; selected: string; link: string; inputSuffix: string }
> = {
	rail: {
		item: "readlist-row readlist-nav__item",
		selected: " readlist-row--selected",
		link: "readlist-row__main readlist-nav__link",
		inputSuffix: "",
	},
	more: {
		item: "readlist-more__entry",
		selected: " readlist-more__entry--current",
		link: "readlist-more__link",
		inputSuffix: "-more",
	},
	sheet: {
		item: "readlist-more__entry",
		selected: " readlist-more__entry--current",
		link: "readlist-more__link",
		inputSuffix: "-sheet",
	},
};

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

interface ReadlistPinForm {
	key: "readlist-pin" | "readlist-unpin";
	action: string;
	iconName: IconName;
	label: string;
}

interface ReadlistNavMenu {
	isDeletable: boolean;
	pinForms?: readonly ReadlistPinForm[];
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

export interface ReadlistNavItem {
	menuHtml: string;
	autofocus: boolean;
	href: string;
	title: string;
	name: string;
	iconName: IconName;
	itemClass: string;
	linkClass: string;
	isActive: boolean;
}

interface ReadlistNavPopover {
	id: string;
	placement: ReadlistNavPlacement;
	popoverClass: string;
	title: string;
	entries: readonly ReadlistNavItem[];
}

export interface ReadlistNavDisplayModel {
	mode: "today" | "pinned-rail";
	items: readonly ReadlistNavItem[];
	popovers: readonly ReadlistNavPopover[];
	moreCount: number;
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
	].flatMap((control) =>
		renderedNavLock({
			...control,
			offer: input.offer,
			gated,
			controlClass: "menu__item",
		}),
	);
	return menuLocks.length === 0
		? []
		: [{ name: input.slug, title: input.title, menuLocks }];
}

function pinFormsOf(input: {
	slug: ReadlistSlug;
	viewedSlug: ReadlistSlug;
	pinState: ReadlistPinState;
}): ReadlistPinForm[] {
	if (input.pinState === "unpinnable") return [];
	const returnQuery = readlistReturnQuery({ readlist: input.viewedSlug });
	const form =
		input.pinState === "pinned"
			? {
					key: "readlist-unpin" as const,
					path: readlistUnpinPath(input.slug),
					content: "unpin-readlist",
					iconName: "arrow-down" as const,
					label: t("readlistNav.pin.unpin"),
				}
			: {
					key: "readlist-pin" as const,
					path: readlistPinPath(input.slug),
					content: "pin-readlist",
					iconName: "arrow-up" as const,
					label: t("readlistNav.pin.pin"),
				};
	return [
		{
			key: form.key,
			action: withInternalTracking(`${form.path}${returnQuery}`, {
				source: NAV_SOURCE,
				content: form.content,
			}),
			iconName: form.iconName,
			label: form.label,
		},
	];
}

function navMenu(input: {
	slug: ReadlistSlug;
	viewedSlug: ReadlistSlug;
	canEdit: boolean;
	pinState: ReadlistPinState;
	inputSuffix: string;
}): ReadlistNavMenu {
	const isDeletable = input.canEdit && input.slug !== DEFAULT_READLIST_SLUG;
	if (!isDeletable) return { isDeletable: false };
	return {
		isDeletable: true,
		pinForms: pinFormsOf(input),
		deleteAction: withInternalTracking(
			`${readlistDeletePath(input.slug)}${readlistReturnQuery({ readlist: input.viewedSlug })}`,
			{ source: NAV_SOURCE, content: "delete-readlist" },
		),
		deletePopoverId: readlistDeleteConfirmPopoverId(input.slug),
		renamePopoverId: readlistRenamePopoverId(input.slug),
		renameAction: readlistRenameAction(input.slug),
		renameInputId: `${readlistRenameFallbackInputId(input.slug)}${input.inputSuffix}`,
		renameField: READLIST_NAME_FIELD,
		renameLabel: READLIST_NAME_LABEL,
		renameMaxLength: READLIST_LABEL_MAX_LENGTH,
	};
}

function limitFormsOf(input: {
	canEdit: boolean;
	canCreate: boolean;
	limitAlertHref: string;
}): ReadlistLimitForm[] {
	if (!input.canEdit || input.canCreate) return [];
	const tracked = new URL(
		withInternalTracking(input.limitAlertHref, {
			source: NAV_SOURCE,
			content: "readlist-limit",
		}),
		PARSE_ORIGIN,
	);
	return [
		{
			action: tracked.pathname,
			fields: Array.from(tracked.searchParams, ([name, value]) => ({
				name,
				value,
			})),
		},
	];
}

interface ReadlistNavInput {
	readlists: readonly Readlist[];
	pinnedReadlists: readonly ReadlistSlug[];
	activeSlug: ReadlistSlug;
	newReadlistAction: string;
	limitAlertHref: string;
	canEdit: boolean;
	canCreate: boolean;
	offer: UpgradeOffer | undefined;
}

function navItem(input: {
	nav: ReadlistNavInput;
	readlist: Readlist;
	placement: ReadlistNavPlacement;
	pinState: ReadlistPinState;
	autofocus: boolean;
}): ReadlistNavItem {
	const { nav, readlist } = input;
	const classes = PLACEMENT_CLASSES[input.placement];
	const isActive = readlist.slug === nav.activeSlug;
	const kind = readlist.slug === DEFAULT_READLIST_SLUG ? "default" : "custom";
	const menu = navMenu({
		slug: readlist.slug,
		viewedSlug: nav.activeSlug,
		canEdit: nav.canEdit,
		pinState: input.pinState,
		inputSuffix: classes.inputSuffix,
	});
	const lockedMenus = lockedMenusOf({
		slug: readlist.slug,
		title: readlist.label,
		gated: !nav.canEdit,
		offer: nav.offer,
	});
	return {
		href: withInternalTracking(buildReadlistUrl({ readlist: readlist.slug }), {
			source: NAV_SOURCE,
			content: `queue-${readlist.slug}`,
		}),
		title: readlist.label,
		name: readlist.slug,
		iconName: READLIST_KIND_ICON[kind],
		itemClass: `${classes.item}${isActive ? classes.selected : ""}`,
		linkClass: classes.link,
		isActive,
		autofocus: input.autofocus,
		menuHtml: render(MENU_TEMPLATE, {
			...menu,
			lockedMenus,
			name: readlist.slug,
			title: readlist.label,
		}),
	};
}

export function buildReadlistNav(
	input: ReadlistNavInput,
): ReadlistNavDisplayModel {
	const layout = composeReadlistNav({
		readlists: input.readlists,
		pinned: input.pinnedReadlists,
		currentSlug: input.activeSlug,
	});
	const pinStateOf = (readlist: Readlist): ReadlistPinState => {
		if (layout.mode === "today") return "unpinnable";
		return input.pinnedReadlists.includes(readlist.slug)
			? "pinned"
			: "unpinned";
	};
	const items = layout.railEntries.map((readlist) =>
		navItem({
			nav: input,
			readlist,
			placement: "rail",
			pinState: pinStateOf(readlist),
			autofocus: false,
		}),
	);
	const current = items.find((item) => item.isActive);
	assert(
		current,
		"the viewed readlist must be one of the readlists the rail lists",
	);
	const popovers: ReadlistNavPopover[] =
		layout.mode === "today"
			? []
			: [
					{
						id: "readlist-more",
						placement: "more",
						popoverClass: "readlist-more",
						title: t("readlistNav.more.label"),
						entries: layout.moreEntries.map((readlist, index) =>
							navItem({
								nav: input,
								readlist,
								placement: "more",
								pinState: pinStateOf(readlist),
								autofocus: index === 0,
							}),
						),
					},
					{
						id: "readlist-sheet",
						placement: "sheet",
						popoverClass: "readlist-more readlist-more--sheet",
						title: t("readlistNav.title"),
						entries: input.readlists.map((readlist) =>
							navItem({
								nav: input,
								readlist,
								placement: "sheet",
								pinState: pinStateOf(readlist),
								autofocus: readlist.slug === input.activeSlug,
							}),
						),
					},
				];
	return {
		mode: layout.mode,
		items,
		popovers,
		moreCount: layout.moreCount,
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

export function renderReadlistNav(
	displayModel: ReadlistNavDisplayModel,
): string {
	return render(
		displayModel.mode === "today" ? TEMPLATE : PINNED_TEMPLATE,
		displayModel,
	);
}
