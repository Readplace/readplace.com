import { type IconName, iconSvg } from "@packages/ui-icons";
import type {
	ActionDescriptor,
	LinkDescriptor,
} from "../domain/reading-list-item.types";

/** A client-side design token, never a server string. The popup maps an action
 * `name` to one of these and looks up its own CSS class; an unknown name falls
 * back to `default`. The server never sends a class — presentation is 100%
 * client-side, so a server-side rename of an action's wire `name` only loses the
 * bespoke styling (degrading to `default`), it never injects a class. */
export type ActionVariant = "danger" | "default";

/** The one place the wire vocabulary meets the client's design tokens. Add a row
 * to give a known action bespoke styling; everything absent is `default`. Keep
 * this a map of `name` -> token, never a passthrough of the server string. */
const VARIANT_BY_NAME: Record<string, ActionVariant> = {
	delete: "danger",
};

export function actionVariant(name: string): ActionVariant {
	return VARIANT_BY_NAME[name] ?? "default";
}

/** The client's own icon for a known action `name`, or undefined when the action
 * has no bespoke icon (the control falls back to its text label). This is the
 * same one-mapping-with-a-default shape as `actionVariant`: presentation (here
 * the icon) is derived from the wire `name` client-side, never from a per-name
 * `if` in the popup. The map holds a *name* from the shared set, so a
 * server-side rename only loses the icon (degrading to the label) and can never
 * reach the returned markup. */
const ICON_BY_NAME: Record<string, IconName> = {
	delete: "x",
};

export function actionIcon(name: string): string | undefined {
	const icon = ICON_BY_NAME[name];
	return icon === undefined ? undefined : iconSvg(icon);
}

/** Turns a wire `name` (`mark-read`, `archive_now`) into a human label when the
 * server advertised no `title`: split on `-`/`_`, then Title-Case each word so an
 * unlabelled affordance still renders a readable control instead of a raw slug. */
export function humanize(name: string): string {
	return name
		.split(/[-_]+/)
		.filter((word) => word.length > 0)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/** The control's text and aria-label: the server's `title` when present, else a
 * humanized `name`. One function so the label and the accessible name never
 * drift apart. */
export function actionLabel(action: ActionDescriptor): string {
	return action.title ?? humanize(action.name);
}

/** Where a semantic link renders in the popup. `read` is the row's primary open
 * anchor (the whole row); every other semantic rel renders as a generic
 * standalone control. This is the link counterpart of `actionVariant` — one
 * client-side rel->presentation map with a default — so a future semantic rel
 * (e.g. `summary`) renders as a generic control with zero further client change,
 * and `read` stays the row anchor without a per-rel `if` in the render loop.
 * `list-view` is the popup's own list surface: the reader stays in the popup
 * rather than being handed to a tab, and that navigation is what fetches the
 * collection — nothing else does. */
export type LinkPresentation = "row-anchor" | "list-view" | "control";

const PRESENTATION_BY_REL: Record<string, LinkPresentation> = {
	read: "row-anchor",
	collection: "list-view",
};

export function linkPresentation(rel: string): LinkPresentation {
	return PRESENTATION_BY_REL[rel] ?? "control";
}

/** The link control's text and aria-label: the server's `title` when present,
 * else a humanized `rel`. The link counterpart of `actionLabel`. */
export function linkLabel(link: LinkDescriptor): string {
	return link.title ?? humanize(link.rel);
}
