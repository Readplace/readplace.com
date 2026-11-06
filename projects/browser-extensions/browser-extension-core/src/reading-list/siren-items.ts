import type {
	ReadingListItem,
	LinkDescriptor,
	ActionDescriptor,
} from "../domain/reading-list-item.types";
import { assert } from "../invariant";
import { type SirenSubEntity, SirenPropertiesSchema, resolveHref } from "./siren-wire";

/** Rels the client follows for its OWN navigation (pagination/identity), never
 * rendered as user controls. Everything else is a semantic link the client may
 * render through the generic link loop. */
const STRUCTURAL_LINK_RELS = new Set(["self", "root", "prev", "next", "item"]);

export function toReadingListItem(
	entity: SirenSubEntity,
	serverUrl: string,
): ReadingListItem {
	assert(entity.properties, "Server response entity missing properties");
	const props = SirenPropertiesSchema.parse(entity.properties);
	/** Semantic (non-structural) links serialized symmetrically with actions: one
	 * descriptor per link whose href resolves, carrying the resolved target so the
	 * popup renders each through the same generic loop. A structural rel is the
	 * client's own navigation and is excluded. */
	const links: LinkDescriptor[] = [];
	for (const link of entity.links) {
		if (link.rel.some((rel) => STRUCTURAL_LINK_RELS.has(rel))) continue;
		const href = resolveHref({ base: serverUrl, href: link.href });
		if (href === undefined) continue;
		for (const rel of link.rel) {
			const descriptor: LinkDescriptor = { rel, href };
			if (link.title !== undefined) descriptor.title = link.title;
			links.push(descriptor);
		}
	}
	const actions: ActionDescriptor[] = entity.actions.map((action) => {
		const descriptor: ActionDescriptor = { name: action.name };
		if (action.title !== undefined) descriptor.title = action.title;
		return descriptor;
	});
	return {
		id: props.id,
		url: props.url,
		title: props.title,
		savedAt: props.savedAt ? new Date(props.savedAt) : new Date(0),
		actions,
		links,
		needsBrowserCapture: props.needsBrowserCapture,
	};
}
