import type { HighlightSharedEvent } from "@packages/web-analytics";
import { PANEL_ATTRIBUTE } from "./highlight-popover.client";

export const HAS_WEB_SHARE_CLASS = "has-web-share";
export const SHARE_FAILED_CLASS = "highlight-popover--share-failed";

const SHARE_ATTRIBUTE = "data-highlight-share";
const TARGET_ATTRIBUTE = "data-highlight-share-target";
const BEACON_ATTRIBUTE = "data-highlight-share-beacon";

export interface WebShareData {
	text: string;
	title?: string;
	url?: string;
}

export interface HighlightShareDeps {
	document: Document;
	share: ((data: WebShareData) => Promise<void>) | undefined;
	sendBeacon: (url: string) => void;
	panels: { open(id: string): boolean };
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function isElement(target: unknown): target is Element {
	return typeof Reflect.get(Object(target), "closest") === "function";
}

function required(element: Element, name: string): string {
	const value = element.getAttribute(name);
	assert(value !== null, `the share item carries ${name}`);
	return value;
}

export function initHighlightShare(deps: HighlightShareDeps): void {
	const { document, share } = deps;
	if (share !== undefined) document.documentElement.classList.add(HAS_WEB_SHARE_CLASS);

	const beacon = (input: { panel: Element; button: Element; method: string }): void => {
		const id = required(input.panel, PANEL_ATTRIBUTE);
		const url = new URL(required(input.panel, BEACON_ATTRIBUTE), document.baseURI);
		url.searchParams.set("highlight", id);
		url.searchParams.set("method", input.method);
		url.searchParams.set("linked", required(input.button, "data-share-linked"));
		url.searchParams.set("fragment", required(input.button, "data-share-fragment"));
		deps.sendBeacon(`${url.pathname}${url.search}`);
	};

	document.addEventListener("click", (event) => {
		const elements = event.composedPath().filter(isElement);
		const panel = elements.find((element) => element.hasAttribute(PANEL_ATTRIBUTE));
		if (panel === undefined) return;
		const button = panel.querySelector(`[${SHARE_ATTRIBUTE}]`);
		if (button === null) return;
		const target = elements.find((element) => element.hasAttribute(TARGET_ATTRIBUTE));
		if (target !== undefined) {
			beacon({ panel, button, method: required(target, TARGET_ATTRIBUTE) });
			return;
		}
		if (share === undefined || !elements.includes(button)) return;
		const title = button.getAttribute("data-share-title");
		const url = button.getAttribute("data-share-url");
		const data: WebShareData = {
			text: required(button, "data-share-text"),
			...(title === null ? {} : { title }),
			...(url === null ? {} : { url }),
		};
		const nativeShare: HighlightSharedEvent["method"] = "native-share";
		share(data).then(
			() => beacon({ panel, button, method: nativeShare }),
			(error: unknown) => {
				if (Reflect.get(Object(error), "name") === "AbortError") return;
				panel.classList.add(SHARE_FAILED_CLASS);
				deps.panels.open(required(panel, PANEL_ATTRIBUTE));
			},
		);
	});
}
