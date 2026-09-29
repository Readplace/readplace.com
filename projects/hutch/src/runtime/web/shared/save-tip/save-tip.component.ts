import type { Request } from "express";
import { type ClickSurface, render, renderConfirmPopover, renderIllustration, withClickSurface, withInternalTracking } from "@packages/web-shell";
import {
	buildExtensionInstallUrl,
	advertisedPlatformOf,
	detectPlatform,
	isExtensionInstalled,
	type PitchablePlatform,
} from "../../onboarding/extension-install";
import { isNativeSurface } from "../../onboarding/native-client";
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
	| { kind: "article"; mode: "gating"; clickSurface: ClickSurface };

/** The content-capture client this visitor already has, which decides whether
 * the panel pitches an install or tells them to use what they have. */
type SaveTipClient = "extension" | "app" | "none";

interface SaveTipCopy {
	title: string;
	body: (req: Request, client: SaveTipClient) => string;
}

interface SaveWay {
	lead: string;
	gesture: string;
}

const SAVE_WAY_BY_PLATFORM = {
	chrome: { lead: "the Readplace browser extension or other supported options", gesture: "one click" },
	firefox: { lead: "the Readplace browser extension or other supported options", gesture: "one click" },
	iphone: { lead: "the Readplace iPhone app or other supported options", gesture: "one tap" },
} satisfies Record<Exclude<PitchablePlatform, "other">, SaveWay>;

const SAVE_WAY_FALLBACK = {
	lead: "one of Readplace's supported options",
	gesture: "one click",
} satisfies SaveWay;

const SAVE_WAY_BY_CLIENT = {
	extension: (_req: Request) => SAVE_WAY_BY_PLATFORM.chrome,
	app: (_req: Request) => ({ lead: "the Readplace share sheet", gesture: "one tap" }),
	none: (req: Request) => {
		const platform = advertisedPlatformOf(req);
		return platform === undefined ? SAVE_WAY_FALLBACK : SAVE_WAY_BY_PLATFORM[platform];
	},
} satisfies Record<SaveTipClient, (req: Request) => SaveWay>;

const IMPORT_ADVICE = {
	extension: "For individual articles, the extension can save the full page.",
	app: "For individual articles, the Readplace share sheet can save the full page.",
	none: `For individual articles, ${FULL_PAGE_CAPTURE_PHRASE} can save the full page.`,
} satisfies Record<SaveTipClient, string>;

const COPY = {
	article: {
		title: "Save articles the better way",
		body: (req, client) => {
			const way = SAVE_WAY_BY_CLIENT[client](req);
			return `Use ${way.lead} to save articles in ${way.gesture} and get a cleaner reading experience.`;
		},
	},
	import: {
		title: "Some of these may arrive as links only",
		body: (_req, client) =>
			`Some sites block Readplace from fetching article text. ${IMPORT_ADVICE[client]}`,
	},
} satisfies Record<SaveTipKind, SaveTipCopy>;

function beaconUrl(element: SaveTipElement): string {
	return withInternalTracking(SAVE_TIP_EVENT_PATH, {
		source: SAVE_TIP_UTM_SOURCE,
		content: element,
	});
}

const OPEN_BEACON_URL = beaconUrl(SAVE_TIP_ELEMENTS.opened);
const CONTINUE_BEACON_URL = beaconUrl(SAVE_TIP_ELEMENTS.continued);

/** The advisory control needs no script of its own: a popover target hides the
 * panel and hands focus back to the box the reader was already typing into. */
const CONTINUE_CONTROL = {
	advisory: `<button class="btn {{tierClass}}" type="button" popovertarget="${SAVE_TIP_PANEL_ID}" popovertargetaction="hide" data-beacon-url="{{continueBeaconUrl}}" data-test-action="save-tip-continue">Continue with URL</button>`,
	gating: `<button class="btn {{tierClass}}" type="button" data-save-tip-proceed data-test-action="save-tip-proceed">Save the link anyway</button>`,
} satisfies Record<SaveTipMode, string>;

const INSTALL_CONTROL = `<a class="btn btn--primary" href="{{installUrl}}" data-test-action="save-tip-install">Explore saving options</a>`;

const SAVE_TIP_ACTIONS_TEMPLATE = `<div class="confirm-popover__actions confirm-popover__buttons" data-test-save-tip-variant="{{client}}" data-test-save-tip-mode="{{mode}}">
	{{#each controls}}{{{this}}}{{/each}}
</div>`;

function resolveSaveTipClient(req: Request): SaveTipClient {
	if (isNativeSurface(req)) return "app";
	if (isExtensionInstalled(req)) return "extension";
	return "none";
}

const INSTALL_URL_BY_CLIENT = {
	extension: () => undefined,
	app: () => undefined,
	none: (req: Request) =>
		withInternalTracking(buildExtensionInstallUrl(detectPlatform(req)), {
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
	const surface = spec.mode === "gating" ? spec.clickSurface : undefined;
	const installUrl = INSTALL_URL_BY_CLIENT[client](req);
	const controls = [
		render(CONTINUE_CONTROL[spec.mode], {
			tierClass: installUrl === undefined ? "btn--primary" : "btn--neutral",
			continueBeaconUrl: CONTINUE_BEACON_URL,
		}),
		...(installUrl === undefined ? [] : [render(INSTALL_CONTROL, { installUrl: withClickSurface(installUrl, surface) })]),
	];
	return renderConfirmPopover({
		id: SAVE_TIP_PANEL_ID,
		key: "save-tip",
		subject: spec.kind,
		title: copy.title,
		body: copy.body(req, client),
		illustrationHtml: renderIllustration("book-lightbulb"),
		openBeaconUrl: withClickSurface(OPEN_BEACON_URL, surface),
		actionsHtml: render(SAVE_TIP_ACTIONS_TEMPLATE, {
			client,
			mode: spec.mode,
			controls,
		}),
	});
}
