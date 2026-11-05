import { findIconSvg, type IconName, type IconVariant } from "@packages/ui-icons";
import { render } from "./render";
import {
	buildGuestNavGroups,
	buildNavGroups,
	type NavGroup,
	type NavItem,
	type NavItemKey,
	type SignedInUser,
	type UpgradeTarget,
} from "./banner-state";
import { type ClickSurface, withClickSurface } from "./internal-link-tracking";
import { NAV_TEMPLATE } from "./nav.template";
import { renderNeedsUpgrade } from "./shared/needs-upgrade/needs-upgrade.component";
import { initialsFor } from "./user-initials";

export interface NavProps {
	variant: "default" | "transparent";
	isAuthenticated: boolean;
	accessIsReadOnly: boolean;
	upgrade?: UpgradeTarget;
	currentPath?: string;
	clickSurface?: ClickSurface;
	signedInUser?: SignedInUser;
}

interface NavUserMenu {
	initials: string;
	name: string;
	ariaLabel: string;
}

type NavLinkDisplayModel = NavItem & {
	ariaCurrent: "page" | undefined;
	iconVariant: IconVariant;
};

interface NavLockDisplayModel {
	key: NavItemKey;
	html: string;
}

interface NavItemDisplayModel {
	links: NavLinkDisplayModel[];
	locks: NavLockDisplayModel[];
}

type NavGroupDisplayModel = Omit<NavGroup, "items"> & {
	items: NavItemDisplayModel[];
	userMenu?: NavUserMenu;
};

const ANONYMOUS_USER_MENU: NavUserMenu = { initials: "", name: "Account", ariaLabel: "Account menu" };

function userMenuFrom(user: SignedInUser | undefined): NavUserMenu {
	if (user === undefined) return ANONYMOUS_USER_MENU;
	return {
		initials: initialsFor(user),
		name: user.displayName ?? user.email,
		ariaLabel:
			user.displayName === undefined
				? `Account menu for ${user.email}`
				: `Account menu for ${user.displayName} (${user.email})`,
	};
}

function userMenuFor(
	group: NavGroupDisplayModel,
	signedIn: { isAuthenticated: boolean; signedInUser: SignedInUser | undefined },
): NavGroupDisplayModel {
	if (group.key !== "account" || !signedIn.isAuthenticated) return group;
	return { ...group, userMenu: userMenuFrom(signedIn.signedInUser) };
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
	const href = withClickSurface(item.href, context.surface);
	if (item.lock !== undefined) {
		return {
			links: [],
			locks: [
				{
					key: item.key,
					html: renderNeedsUpgrade({
						key: item.key,
						label: item.label,
						controlClass: item.linkClass,
						popoverId: item.lock.popoverId,
						fallbackHref: href,
					}),
				},
			],
		};
	}
	const isCurrent = item.key === context.currentKey;
	return {
		links: [
			{
				...item,
				href,
				trackTerm: context.surface,
				ariaCurrent: isCurrent ? "page" : undefined,
				iconVariant: isCurrent ? currentIconVariant(item.iconName) : "stroke",
			},
		],
		locks: [],
	};
}

export function GlobalNav(props: NavProps): string {
	const groups = props.isAuthenticated
		? buildNavGroups({ accessIsReadOnly: props.accessIsReadOnly, upgrade: props.upgrade })
		: buildGuestNavGroups();
	const context = { surface: props.clickSurface, currentKey: currentNavKey(props.currentPath) };
	return render(NAV_TEMPLATE, {
		transparent: props.variant === "transparent",
		clickSurface: props.clickSurface,
		navGroups: groups.map((group) =>
			userMenuFor(
				{ ...group, items: group.items.map((item) => displayItem(item, context)) },
				{ isAuthenticated: props.isAuthenticated, signedInUser: props.signedInUser },
			),
		),
		navVariant: props.isAuthenticated ? "authenticated" : "guest",
	});
}
