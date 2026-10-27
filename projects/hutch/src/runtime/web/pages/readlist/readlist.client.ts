export interface ReadlistDeps {
	document: Document;
}

const MENU_SELECTOR = ".readlist-nav__menu, .readlist-article__menu, .readlist-preferences__menu";
const NAME_FORM_SELECTOR = "form[data-readlist-name-form]";
const NAME_FORM = { errorAttr: "data-readlist-name-error", failureAttr: "data-readlist-name-failure" };
const SAVE_LINK_FORM_SELECTOR = "form[data-save-link-form]";
const SAVE_LINK_FORM = { errorAttr: "data-save-link-error", failureAttr: "data-save-link-failure" };
const LANDING_SWAP = "outerHTML show:none scroll:html:top";
const LIVE_REGION_SELECTOR = "#toast-live-region";
const REFUSED_STATUS = 422;
const OPENER_SELECTOR = '[popovertarget]:not([popovertargetaction="hide"])';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function isElement(node: EventTarget | null): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

function closeOpenMenus(document: Document, except: Element | null): void {
	const menus = document.querySelectorAll<HTMLDetailsElement>(MENU_SELECTOR);
	for (let i = 0; i < menus.length; i++) {
		if (menus[i] !== except) menus[i].open = false;
	}
}

function formOf(event: Event, selector: string): Element | null {
	const target = event.target;
	return isElement(target) && target.matches(selector) ? target : null;
}

function nameFormOf(event: Event): Element | null {
	return formOf(event, NAME_FORM_SELECTOR);
}

function answerOf(event: Event): { status: unknown; body: unknown; location: unknown } {
	const request: unknown = Reflect.get(Object(Reflect.get(event, "detail")), "xhr");
	const readHeader: unknown = Reflect.get(Object(request), "getResponseHeader");
	assert(typeof readHeader === "function", "htmx hands every request event its XMLHttpRequest");
	return {
		status: Reflect.get(Object(request), "status"),
		body: Reflect.get(Object(request), "responseText"),
		location: Reflect.apply(readHeader, request, ["HX-Location"]),
	};
}

function showFailure(form: Element, attributes: { errorAttr: string; failureAttr: string }): void {
	const error = form.querySelector(`[${attributes.errorAttr}]`);
	assert(error, "a dialog form always carries its error line");
	const field = form.querySelector('input[name]:not([type="hidden"]), textarea[name]');
	assert(field, "a dialog form always carries its named field");
	const failure = form.getAttribute(attributes.failureAttr);
	assert(failure, "a dialog form always carries its failure message");
	error.textContent = failure;
	field.setAttribute("aria-invalid", "true");
}

function hostDialogFieldOf(dialog: Element): HTMLElement | null {
	if (!dialog.matches("[popover]")) return null;
	const parent = dialog.parentElement;
	assert(parent, "a dialog always sits inside the page");
	const host = parent.closest("[popover]");
	return host === null ? null : host.querySelector<HTMLElement>("[autofocus]");
}

function announce(document: Document, message: string): void {
	const regions = document.querySelectorAll(LIVE_REGION_SELECTOR);
	for (let i = 0; i < regions.length; i++) regions[i].textContent = message;
}

export function initReadlist(deps: ReadlistDeps): void {
	const openers = new Map<string, HTMLElement>();

	deps.document.addEventListener("click", (event) => {
		const target = event.target;
		const within = isElement(target) ? target.closest(MENU_SELECTOR) : null;
		closeOpenMenus(deps.document, within);
		const opener = isElement(target) ? target.closest<HTMLElement>(OPENER_SELECTOR) : null;
		if (opener === null) return;
		const openedId = opener.getAttribute("popovertarget");
		assert(openedId !== null, "an opener names the popover it opens");
		openers.set(openedId, opener);
	});

	deps.document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") closeOpenMenus(deps.document, null);
	});

	deps.document.addEventListener(
		"toggle",
		(event) => {
			const dialog = event.target;
			if (event.newState !== "closed" || !isElement(dialog)) return;
			const focused = deps.document.activeElement;
			if (focused !== deps.document.body && !dialog.contains(focused)) return;
			const hostField = hostDialogFieldOf(dialog);
			if (hostField !== null) {
				hostField.focus({ preventScroll: true });
				return;
			}
			const menus = deps.document.querySelectorAll(MENU_SELECTOR);
			for (let i = 0; i < menus.length; i++) {
				if (menus[i].querySelector(`[popovertarget="${dialog.id}"]`) === null) continue;
				const summary = menus[i].querySelector<HTMLElement>("summary");
				assert(summary, "every menu opens from its summary");
				summary.focus({ preventScroll: true });
				return;
			}
			const opener = openers.get(dialog.id);
			const invoker = opener?.isConnected
				? opener
				: deps.document.querySelector<HTMLElement>(`[popovertarget="${dialog.id}"]`);
			if (invoker !== null) invoker.focus({ preventScroll: true });
		},
		true,
	);

	deps.document.addEventListener("htmx:beforeSwap", (event) => {
		const form = nameFormOf(event);
		if (form === null || answerOf(event).status === REFUSED_STATUS) return;
		Reflect.set(Object(Reflect.get(event, "detail")), "shouldSwap", false);
		showFailure(form, NAME_FORM);
	});

	deps.document.addEventListener("htmx:beforeSwap", (event) => {
		const form = formOf(event, SAVE_LINK_FORM_SELECTOR);
		if (form === null || answerOf(event).status === REFUSED_STATUS) return;
		const detail = Object(Reflect.get(event, "detail"));
		if (Reflect.get(detail, "shouldSwap") !== true) {
			showFailure(form, SAVE_LINK_FORM);
			return;
		}
		const main = deps.document.querySelector("main");
		assert(main, "every page that offers Add link renders a <main>");
		Reflect.set(detail, "target", main);
		Reflect.set(detail, "selectOverride", "main");
		Reflect.set(detail, "swapOverride", LANDING_SWAP);
	});

	deps.document.addEventListener("htmx:sendError", (event) => {
		const nameForm = nameFormOf(event);
		if (nameForm !== null) showFailure(nameForm, NAME_FORM);
		const saveLinkForm = formOf(event, SAVE_LINK_FORM_SELECTOR);
		if (saveLinkForm !== null) showFailure(saveLinkForm, SAVE_LINK_FORM);
	});

	deps.document.addEventListener("htmx:afterRequest", (event) => {
		if (nameFormOf(event) === null) return;
		const { body, location } = answerOf(event);
		if (typeof location !== "string" || typeof body !== "string" || body === "") return;
		announce(deps.document, body);
	});
}
