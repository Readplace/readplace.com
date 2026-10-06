export type HtmxHistoryEventName =
	| "htmx:beforeRequest"
	| "htmx:beforeHistoryUpdate"
	| "htmx:historyCacheHit"
	| "htmx:historyCacheMiss"
	| "htmx:pushedIntoHistory"
	| "htmx:replacedInHistory"
	| "htmx:historyRestore";

export interface ReaderOpenDeps {
	document: Document;
	history: Pick<History, "pushState" | "replaceState" | "back">;
	currentHref: () => string;
	currentPath: () => string;
	navigate: (href: string) => void;
	reload: () => void;
	scrollTo: (top: number) => void;
	scrollY: () => number;
	setTimeoutFn: (callback: () => void, ms: number) => number;
	clearTimeoutFn: (id: number) => void;
	parseHtml: (html: string) => Document;
	paintDelayMs: number;
	addHtmxListener: (name: HtmxHistoryEventName, listener: (event: Event) => void) => void;
}

interface AbortableRequest extends EventTarget {
	abort(): void;
}

const OWNED_ATTR = "data-reader-open-owned";
const OPENER_ATTR = "data-opens-reader";
const CARD_SELECTOR = ".readlist-article, .readlist-article";
const TEMPLATE_SELECTOR = "template[data-reader-skeleton]";
const SHELL_BANNER_SELECTOR = "#extension-suggestion-banner";
const FIELD_ATTR = "data-reader-field";
const TEXT_TARGET_ATTR = "data-reader-field-text";
const HREF_TARGET_ATTR = "data-reader-field-href";
const EMPTY_CLASS_ATTR = "data-reader-field-empty-class";
const HISTORY_STATE = { htmx: true };
const XHR_DONE = 4;

interface ListOnScreen {
	holder: Element;
	mainClass: string;
	bodyClass: string;
	scrollY: number;
}

interface PendingOpen {
	xhr: AbortableRequest;
	href: string;
	opener: HTMLElement;
	card: Element;
	target: HTMLElement;
	timer: number;
	paintedOver: ListOnScreen | undefined;
	committed: boolean;
	abandoned: boolean;
	restored: boolean;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function read(target: unknown, key: string): unknown {
	return Reflect.get(Object(target), key);
}

function isHtmlElement(node: unknown): node is HTMLElement {
	return typeof read(node, "focus") === "function";
}

function isAbortableRequest(value: unknown): value is AbortableRequest {
	return typeof read(value, "addEventListener") === "function" && typeof read(value, "abort") === "function";
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function initReaderOpen(deps: ReaderOpenDeps): void {
	const root = deps.document.documentElement;
	if (root.hasAttribute(OWNED_ATTR)) return;
	root.setAttribute(OWNED_ATTR, "");

	let pending: PendingOpen | null = null;
	let lastPath = deps.currentPath();
	let steppingBack = false;

	function skeletonTemplate(): HTMLTemplateElement {
		const template = deps.document.querySelector<HTMLTemplateElement>(TEMPLATE_SELECTOR);
		assert(template, "the queue page must ship the reader skeleton template");
		return template;
	}

	function requiredAttribute(element: Element, name: string): string {
		const value = element.getAttribute(name);
		assert(value !== null, `the reader skeleton template must carry ${name}`);
		return value;
	}

	function fieldSource(input: { card: Element; target: Element; targetAttr: string }): Element | null {
		const name = input.target.getAttribute(input.targetAttr);
		assert(name !== null, "a field target selected by attribute must carry its value");
		return input.card.querySelector(`[${FIELD_ATTR}="${name}"]`);
	}

	function copyFields(input: { main: Element; card: Element }): void {
		for (const target of input.main.querySelectorAll(`[${TEXT_TARGET_ATTR}]`)) {
			const source = fieldSource({ card: input.card, target, targetAttr: TEXT_TARGET_ATTR });
			const text = source?.textContent ?? "";
			target.textContent = text;
			const emptyClass = target.getAttribute(EMPTY_CLASS_ATTR);
			if (emptyClass !== null) target.classList.toggle(emptyClass, text === "");
		}
		for (const target of input.main.querySelectorAll(`[${HREF_TARGET_ATTR}]`)) {
			const source = fieldSource({ card: input.card, target, targetAttr: HREF_TARGET_ATTR });
			target.setAttribute("href", source?.getAttribute("href") ?? "");
		}
	}

	function paint(open: PendingOpen): void {
		const template = skeletonTemplate();
		const main = open.target;
		const holder = deps.document.createElement("div");
		holder.hidden = true;
		const list: ListOnScreen = {
			holder,
			mainClass: main.className,
			bodyClass: deps.document.body.className,
			scrollY: deps.scrollY(),
		};
		holder.append(...main.childNodes);
		main.className = requiredAttribute(template, "data-main-class");
		main.setAttribute("aria-busy", "true");
		main.replaceChildren(deps.document.importNode(template.content, true), holder);
		copyFields({ main, card: open.card });
		deps.document.body.classList.remove(requiredAttribute(template, "data-body-class-from"));
		deps.document.body.classList.add(...requiredAttribute(template, "data-body-class").split(" "));
		deps.scrollTo(0);
		open.paintedOver = list;
	}

	function applyFinalBodyClass(response: Document): boolean {
		const body = response.body;
		assert(body, "a reader response must carry a body element");
		const finalClass = body.className;
		if (finalClass === "") return false;
		deps.document.body.className = finalClass;
		return true;
	}

	function fallbackBodyClass(): void {
		const template = skeletonTemplate();
		deps.document.body.classList.remove(requiredAttribute(template, "data-body-class-from"));
		deps.document.body.classList.add(...requiredAttribute(template, "data-body-class").split(" "));
	}

	function transplantShellBanner(response: Document): void {
		const incoming = response.querySelector(SHELL_BANNER_SELECTOR);
		const live = deps.document.querySelector(SHELL_BANNER_SELECTOR);
		if (incoming === null || live === null) return;
		live.replaceWith(deps.document.importNode(incoming, true));
	}

	function restoreList(open: PendingOpen): void {
		open.restored = true;
		const main = open.target;
		main.removeAttribute("hx-history");
		const list = open.paintedOver;
		if (list !== undefined) {
			main.className = list.mainClass;
			main.removeAttribute("aria-busy");
			main.replaceChildren(...list.holder.childNodes);
			deps.document.body.className = list.bodyClass;
			deps.scrollTo(list.scrollY);
			open.opener.focus({ preventScroll: true });
		}
		steppingBack = true;
		deps.history.back();
	}

	function onReadyStateChange(open: PendingOpen): void {
		if (open.abandoned || read(open.xhr, "readyState") !== XHR_DONE || read(open.xhr, "status") !== 0) return;
		restoreList(open);
	}

	function onLoadEnd(open: PendingOpen): void {
		deps.clearTimeoutFn(open.timer);
		if (pending === open) pending = null;
		if (open.committed || open.abandoned || open.restored) return;
		deps.navigate(open.href);
	}

	function abandon(): void {
		if (pending === null) return;
		const open = pending;
		pending = null;
		deps.clearTimeoutFn(open.timer);
		open.abandoned = true;
		open.xhr.abort();
	}

	deps.addHtmxListener("htmx:beforeRequest", (event) => {
		const detail = read(event, "detail");
		const opener = read(detail, "elt");
		if (!isHtmlElement(opener) || !opener.hasAttribute(OPENER_ATTR)) return;
		if (pending !== null) {
			event.preventDefault();
			return;
		}
		const href = stringValue(read(read(detail, "pathInfo"), "finalRequestPath"));
		const xhr = read(detail, "xhr");
		const target = read(detail, "target");
		const card = opener.closest(CARD_SELECTOR);
		if (href === undefined || !isAbortableRequest(xhr) || !isHtmlElement(target) || card === null) return;
		target.setAttribute("hx-history", "false");
		deps.history.replaceState(HISTORY_STATE, "", deps.currentHref());
		deps.history.pushState(HISTORY_STATE, "", href);
		const open: PendingOpen = {
			xhr,
			href,
			opener,
			card,
			target,
			timer: 0,
			paintedOver: undefined,
			committed: false,
			abandoned: false,
			restored: false,
		};
		open.timer = deps.setTimeoutFn(() => paint(open), deps.paintDelayMs);
		pending = open;
		xhr.addEventListener("readystatechange", () => onReadyStateChange(open));
		xhr.addEventListener("loadend", () => onLoadEnd(open));
	});

	deps.addHtmxListener("htmx:beforeHistoryUpdate", (event) => {
		const open = pending;
		const detail = read(event, "detail");
		if (open === null) {
			applyFinalBodyClass(deps.parseHtml(stringValue(read(read(detail, "xhr"), "response")) ?? ""));
			return;
		}
		if (read(detail, "xhr") !== open.xhr) return;
		deps.clearTimeoutFn(open.timer);
		Reflect.set(Object(read(detail, "history")), "type", "replace");
		const response = deps.parseHtml(stringValue(read(open.xhr, "response")) ?? "");
		const applied = applyFinalBodyClass(response);
		if (!applied && open.paintedOver === undefined) fallbackBodyClass();
		transplantShellBanner(response);
		if (open.paintedOver === undefined) deps.scrollTo(0);
		open.committed = true;
	});

	function cancelledStepBack(event: Event): boolean {
		if (!steppingBack) return false;
		steppingBack = false;
		event.preventDefault();
		return true;
	}

	deps.addHtmxListener("htmx:historyCacheHit", (event) => {
		if (cancelledStepBack(event)) return;
		if (deps.document.querySelector('[hx-history="false" i]') === null) return;
		event.preventDefault();
		abandon();
		deps.reload();
	});

	deps.addHtmxListener("htmx:historyCacheMiss", (event) => {
		if (cancelledStepBack(event)) return;
		event.preventDefault();
		if (pending !== null) {
			abandon();
			deps.reload();
			return;
		}
		const path = stringValue(read(read(event, "detail"), "path"));
		if (path !== undefined && path !== lastPath) deps.reload();
	});

	function trackPath(event: Event): void {
		const path = stringValue(read(read(event, "detail"), "path"));
		if (path !== undefined) lastPath = path;
	}
	deps.addHtmxListener("htmx:pushedIntoHistory", trackPath);
	deps.addHtmxListener("htmx:replacedInHistory", trackPath);
	deps.addHtmxListener("htmx:historyRestore", trackPath);
}
