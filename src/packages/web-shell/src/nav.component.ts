import { findIconSvg, type IconName, type IconVariant } from "@packages/ui-icons";
import { render } from "./render";
import {
	buildGuestNavGroups,
	buildNavGroups,
	type NavGroup,
	type NavItem,
	type NavItemKey,
} from "./banner-state";
import { type ClickSurface, withClickSurface } from "./internal-link-tracking";
import { NAV_TEMPLATE } from "./nav.template";
import { initialsFromEmail } from "./user-initials";

export interface NavProps {
	variant: "default" | "transparent";
	isAuthenticated: boolean;
	accessIsReadOnly: boolean;
	gmailFeatureEnabled: boolean;
	currentPath?: string;
	clickSurface?: ClickSurface;
	userEmail?: string;
}

interface NavUserMenu {
	initials: string;
	name: string;
	ariaLabel: string;
}

type NavItemDisplayModel = NavItem & {
	ariaCurrent: "page" | undefined;
	iconVariant: IconVariant;
};

type NavGroupDisplayModel = Omit<NavGroup, "items"> & {
	items: NavItemDisplayModel[];
	userMenu?: NavUserMenu;
};

const ANONYMOUS_USER_MENU: NavUserMenu = { initials: "", name: "Account", ariaLabel: "Account menu" };

function userMenuFrom(userEmail: string | undefined): NavUserMenu {
	if (userEmail === undefined) return ANONYMOUS_USER_MENU;
	return { initials: initialsFromEmail(userEmail), name: userEmail, ariaLabel: `Account menu for ${userEmail}` };
}

function userMenuFor(
	group: NavGroupDisplayModel,
	signedIn: { isAuthenticated: boolean; userEmail: string | undefined },
): NavGroupDisplayModel {
	if (group.key !== "account" || !signedIn.isAuthenticated) return group;
	return { ...group, userMenu: userMenuFrom(signedIn.userEmail) };
}

const CURRENT_NAV_KEY_BY_SECTION: ReadonlyMap<string, NavItemKey> = new Map<string, NavItemKey>([
	["queue", "queue"],
	["queues", "queue"],
	["view", "queue"],
	["import", "import"],
	["inbox", "inbox"],
	["newsletters", "integrations"],
	["install", "install"],
]);

function currentNavKey(path: string | undefined): NavItemKey | undefined {
	if (path === undefined) return undefined;
	const section = path.replace(/[?#].*/s, "").split("/")[1];
	return CURRENT_NAV_KEY_BY_SECTION.get(section);
}

function currentIconVariant(iconName: IconName): IconVariant {
	return findIconSvg(iconName, "solid") === undefined ? "stroke" : "solid";
}

/** Renders no site nav, for a shell that intentionally has none (a bare embed or
 * other minimal surface) — the Base-shell analog of the chromeless page's absent
 * nav. Injected explicitly so "no nav" is a deliberate choice, not a missing dep. */
export function GlobalEmptyNav(_props: NavProps): string {
	return "";
}

function displayItem(
	item: NavItem,
	context: { surface: ClickSurface | undefined; currentKey: NavItemKey | undefined },
): NavItemDisplayModel {
	const isCurrent = item.key === context.currentKey;
	return {
		...item,
		href: withClickSurface(item.href, context.surface),
		trackTerm: context.surface,
		ariaCurrent: isCurrent ? "page" : undefined,
		iconVariant: isCurrent ? currentIconVariant(item.iconName) : "stroke",
	};
}

export function GlobalNav(props: NavProps): string {
	const groups = props.isAuthenticated
		? buildNavGroups({
				accessIsReadOnly: props.accessIsReadOnly,
				gmailFeatureEnabled: props.gmailFeatureEnabled,
			})
		: buildGuestNavGroups();
	const context = { surface: props.clickSurface, currentKey: currentNavKey(props.currentPath) };
	return render(NAV_TEMPLATE, {
		transparent: props.variant === "transparent",
		clickSurface: props.clickSurface,
		navGroups: groups.map((group) =>
			userMenuFor(
				{ ...group, items: group.items.map((item) => displayItem(item, context)) },
				{ isAuthenticated: props.isAuthenticated, userEmail: props.userEmail },
			),
		),
		navVariant: props.isAuthenticated ? "authenticated" : "guest",
	});
}
