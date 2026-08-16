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

export const SAVE_TIP_PANEL_ID = "save-tip";
export const SAVE_TIP_SCRIPT = `<script src="/client-dist/save-tip.client.js" defer></script>`;

/** What the visitor is about to hand Readplace: one article's URL, or a page
 * whose outbound links are all about to be fetched the same way. */
export type SaveTipKind = "article" | "import";

/** The content-capture client this visitor already has, which decides whether
 * the panel pitches an install or tells them to use what they have. */
type SaveTipClient = "extension" | "ios" | "none";

interface SaveTipCopy {
	title: string;
	body: string;
	proceedLabel: string;
}

const COPY = {
	article: {
		title: "Save the whole article, not just the link",
		body: "From a pasted link Readplace has to fetch the page from its own servers, and plenty of sites block that — the save can arrive as a bare link with none of the article in it.",
		proceedLabel: "Save the link anyway",
	},
	import: {
		title: "Some of these may arrive as links only",
		body: "Readplace fetches this page from its own servers, then saves everything it links to the same way. Sites that block automated fetching arrive as a bare link with none of the article in it.",
		proceedLabel: "Fetch the links anyway",
	},
} satisfies Record<SaveTipKind, SaveTipCopy>;

/** Second sentence of the panel, resolved per surface and per client. Import
 * gets its own row rather than reusing the article one because the extension
 * and the app cannot read a newsletter index for you — there they are the
 * answer for the *next* single article, not for this fetch. */
const ADVICE = {
	article: {
		extension: "Open the page and save it again with the Readplace extension, which sends what your browser already loaded.",
		ios: "Open the page in your browser and send it to Readplace from the share sheet, which sends what your phone already loaded.",
		none: `Saving from the page itself — with ${FULL_PAGE_CAPTURE_PHRASE} — sends what your device already loaded, which no fetch can be blocked out of.`,
	},
	import: {
		extension: "Nothing can capture a whole index for you, but the extension still takes any single article you open in full.",
		ios: "Nothing can capture a whole index for you, but the Readplace share sheet still takes any single article you open in full.",
		none: `Nothing can capture a whole index for you, but ${FULL_PAGE_CAPTURE_PHRASE} take any single article you open in full.`,
	},
} satisfies Record<SaveTipKind, Record<SaveTipClient, string>>;

const SAVE_TIP_ACTIONS_TEMPLATE = `<div class="confirm-popover__actions" data-test-save-tip-variant="{{client}}">
	<button class="btn btn--primary" type="button" data-save-tip-proceed data-test-action="save-tip-proceed">{{proceedLabel}}</button>
	{{#if installUrl}}<a class="btn btn--secondary" href="{{installUrl}}" data-test-action="save-tip-install">See the ways to save</a>{{/if}}
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
			source: "save-tip",
			content: "install",
		}),
} satisfies Record<SaveTipClient, (req: Request) => string | undefined>;

export interface SaveTip {
	/** Rendered on the control the panel gates, so the client script can tell a
	 * visitor still owed the warning from one who has had it this session. */
	state: SaveTipState;
	html: string;
}

export function buildSaveTip(req: Request, kind: SaveTipKind): SaveTip {
	return { state: saveTipState(req), html: renderSaveTip(req, kind) };
}

function renderSaveTip(req: Request, kind: SaveTipKind): string {
	const client = resolveSaveTipClient(req);
	const copy = COPY[kind];
	return renderConfirmPopover({
		id: SAVE_TIP_PANEL_ID,
		key: "save-tip",
		subject: kind,
		title: copy.title,
		body: `${copy.body} ${ADVICE[kind][client]}`,
		actionsHtml: render(SAVE_TIP_ACTIONS_TEMPLATE, {
			client,
			proceedLabel: copy.proceedLabel,
			installUrl: INSTALL_URL_BY_CLIENT[client](req),
		}),
	});
}
