export type { ReadingListItemId } from "./reading-list-item-id";
import type { ReadingListItemId } from "./reading-list-item-id";

/** The data shadow of a Siren action that survives the popup<->background
 * sendMessage boundary. The bound callable (with its href/method/fields) cannot
 * be cloned across that boundary, so the background walker keeps it; only the
 * fields a control needs to render and re-invoke travel as data: the action
 * `name` (the contract key the popup echoes back in an invoke-action message)
 * and the server's human `title`. No href/method here — invocation is resolved
 * back in the walker by (item id, action name). */
export interface ActionDescriptor {
	name: string;
	title?: string;
}

/** The data shadow of a semantic (non-structural) Siren link the popup renders
 * as a control — the symmetric counterpart of ActionDescriptor for links. The
 * `rel` is the contract key the client maps to its own presentation (e.g. `read`
 * is the row's open anchor); `title` is the server's human label (else the
 * client humanizes the rel); `href` is the already-resolved target the control
 * opens. Structural rels (self/root/prev/next/item) are the client's own
 * navigation and are never serialized here. */
export interface LinkDescriptor {
	rel: string;
	title?: string;
	href: string;
}

export interface ReadingListItem {
	id: ReadingListItemId;
	url: string;
	title: string;
	savedAt: Date;
	/** Every per-item affordance the server advertised, in advertised order. The
	 * popup loops these to render one control each — it never gates a control on a
	 * per-capability boolean, so a newly-advertised action renders with no popup
	 * change. */
	actions: ActionDescriptor[];
	/** The item's semantic (non-structural) links, serialized symmetrically with
	 * `actions` so the popup renders each through the same generic loop. `read`
	 * lives here; the popup's rel->presentation map keeps it as the row's open
	 * anchor, so a future semantic rel (e.g. `summary`) renders with no client
	 * change. */
	links: LinkDescriptor[];
	needsBrowserCapture: boolean;
}
