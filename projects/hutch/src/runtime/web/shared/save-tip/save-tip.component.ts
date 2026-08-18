import type { Request } from "express";
import { render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";
import {
	buildExtensionInstallUrl,
	installablePlatform,
	isExtensionInstalled,
} from "../../onboarding/extension-install";
import { isIosSurface } from "../../onboarding/ios-client";
import { FULL_PAGE_CAPTURE_PHRASE } from "../client-surface-phrases";
import { type SaveTipState, saveTipState } from "./save-tip";
import {
	SAVE_TIP_ELEMENTS,
	SAVE_TIP_EVENT_PATH,
	SAVE_TIP_UTM_SOURCE,
	type SaveTipElement,
} from "./save-tip-tracking";

export const SAVE_TIP_PANEL_ID = "save-tip";
export const SAVE_TIP_SCRIPT = `<script src="/client-dist/save-tip.client.js" defer></script>`;

/** What the visitor is about to hand Readplace: one article's URL, or a page
 * whose outbound links are all about to be fetched the same way. */
export type SaveTipKind = "article" | "import";

/** How the panel meets the decision it describes: `advisory` opens beside a URL
 * box the reader has just focused and holds nothing back, while `gating` stands
 * in front of a link whose navigation waits on the proceed control. */
export type SaveTipMode = "advisory" | "gating";

/** Only a link can be gated, and the only gated link is the reader view's save
 * call to action — an import has no navigation to hold back. */
export type SaveTipSpec =
	| { kind: SaveTipKind; mode: "advisory" }
	| { kind: "article"; mode: "gating" };

/** The content-capture client this visitor already has, which decides whether
 * the panel pitches an install or tells them to use what they have. */
type SaveTipClient = "extension" | "ios" | "none";

interface SaveTipCopy {
	title: string;
	body: (client: SaveTipClient) => string;
}

const IMPORT_ADVICE = {
	extension: "Nothing can capture a whole index for you, but the extension still takes any single article you open in full.",
	ios: "Nothing can capture a whole index for you, but the Readplace share sheet still takes any single article you open in full.",
	none: `Nothing can capture a whole index for you, but ${FULL_PAGE_CAPTURE_PHRASE} take any single article you open in full.`,
} satisfies Record<SaveTipClient, string>;

const COPY = {
	article: {
		title: "There are better ways to save!",
		body: () =>
			"Readplace strongly recommends to use our dedicated clients to save content so you can always get a clean reader view.",
	},
	import: {
		title: "Some of these may arrive as links only",
		body: (client) =>
			`Readplace fetches this page from its own servers, then saves everything it links to the same way. Sites that block automated fetching arrive as a bare link with none of the article in it. ${IMPORT_ADVICE[client]}`,
	},
} satisfies Record<SaveTipKind, SaveTipCopy>;

function beaconUrl(element: SaveTipElement): string {
	return withInternalTracking(SAVE_TIP_EVENT_PATH, {
		source: SAVE_TIP_UTM_SOURCE,
		content: element,
	});
}

const OPEN_BEACON_URL = beaconUrl(SAVE_TIP_ELEMENTS.opened);
const DISMISS_BEACON_URL = beaconUrl(SAVE_TIP_ELEMENTS.dismissed);
const ACKNOWLEDGE_BEACON_URL = beaconUrl(SAVE_TIP_ELEMENTS.acknowledged);

/** The advisory control needs no script of its own: a popover target hides the
 * panel and hands focus back to the box the reader was already typing into. */
const PRIMARY_CONTROL = {
	advisory: `<button class="btn btn--primary" type="button" popovertarget="${SAVE_TIP_PANEL_ID}" popovertargetaction="hide" data-beacon-url="{{acknowledgeBeaconUrl}}" data-test-action="save-tip-acknowledge">Got it</button>`,
	gating: `<button class="btn btn--primary" type="button" data-save-tip-proceed data-test-action="save-tip-proceed">Save the link anyway</button>`,
} satisfies Record<SaveTipMode, string>;

const SAVE_TIP_ACTIONS_TEMPLATE = `<div class="confirm-popover__actions" data-test-save-tip-variant="{{client}}" data-test-save-tip-mode="{{mode}}">
	{{{primaryHtml}}}
	{{#if installUrl}}<a class="btn btn--secondary" href="{{installUrl}}" data-test-action="save-tip-install">See better ways to save</a>{{/if}}
</div>`;

function resolveSaveTipClient(req: Request): SaveTipClient {
	if (isIosSurface(req)) return "ios";
	if (isExtensionInstalled(req)) return "extension";
	return "none";
}

const INSTALL_URL_BY_CLIENT = {
	extension: () => undefined,
	ios: () => undefined,
	none: (req: Request) =>
		withInternalTracking(buildExtensionInstallUrl(installablePlatform(req)), {
			source: SAVE_TIP_UTM_SOURCE,
			content: SAVE_TIP_ELEMENTS.install,
		}),
} satisfies Record<SaveTipClient, (req: Request) => string | undefined>;

export interface SaveTip {
	/** Rendered on the control the panel answers for, so the client script can
	 * tell a visitor still owed the warning from one who has had it this session. */
	state: SaveTipState;
	html: string;
}

export function buildSaveTip(req: Request, spec: SaveTipSpec): SaveTip {
	return { state: saveTipState(req), html: renderSaveTip(req, spec) };
}

function renderSaveTip(req: Request, spec: SaveTipSpec): string {
	const client = resolveSaveTipClient(req);
	const copy = COPY[spec.kind];
	return renderConfirmPopover({
		id: SAVE_TIP_PANEL_ID,
		key: "save-tip",
		subject: spec.kind,
		title: copy.title,
		body: copy.body(client),
		openBeaconUrl: OPEN_BEACON_URL,
		dismissBeaconUrl: DISMISS_BEACON_URL,
		actionsHtml: render(SAVE_TIP_ACTIONS_TEMPLATE, {
			client,
			mode: spec.mode,
			primaryHtml: render(PRIMARY_CONTROL[spec.mode], {
				acknowledgeBeaconUrl: ACKNOWLEDGE_BEACON_URL,
			}),
			installUrl: INSTALL_URL_BY_CLIENT[client](req),
		}),
	});
}
