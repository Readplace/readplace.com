export interface ReadlistDeps {
	document: Document;
}

const MENU_SELECTOR = ".readlist-nav__menu, .readlist-article__menu, .readlist-preferences__menu";
const NAME_FORM_SELECTOR = "form[data-readlist-name-form]";
const NAME_ERROR_ATTR = "data-readlist-name-error";
const NAME_FAILURE_ATTR = "data-readlist-name-failure";
const LIVE_REGION_SELECTOR = "#toast-live-region";
const REFUSED_NAME_STATUS = 422;

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

function nameFormOf(event: Event): Element | null {
	const target = event.target;
	return isElement(target) && target.matches(NAME_FORM_SELECTOR) ? target : null;
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

function showFailure(form: Element): void {
	const error = form.querySelector(`[${NAME_ERROR_ATTR}]`);
	assert(error, "a name form always carries its error line");
	const field = form.querySelector('input[name]:not([type="hidden"]), textarea[name]');
	assert(field, "a name form always carries its named field");
	const failure = form.getAttribute(NAME_FAILURE_ATTR);
	assert(failure, "a name form always carries its failure message");
	error.textContent = failure;
	field.setAttribute("aria-invalid", "true");
}

function announce(document: Document, message: string): void {
	const regions = document.querySelectorAll(LIVE_REGION_SELECTOR);
	for (let i = 0; i < regions.length; i++) regions[i].textContent = message;
}

export function initReadlist(deps: ReadlistDeps): void {
	deps.document.addEventListener("click", (event) => {
		const target = event.target;
		const within = isElement(target) ? target.closest(MENU_SELECTOR) : null;
		closeOpenMenus(deps.document, within);
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
			const menus = deps.document.querySelectorAll(MENU_SELECTOR);
			for (let i = 0; i < menus.length; i++) {
				if (menus[i].querySelector(`[popovertarget="${dialog.id}"]`) === null) continue;
				const summary = menus[i].querySelector<HTMLElement>("summary");
				assert(summary, "every menu opens from its summary");
				summary.focus({ preventScroll: true });
				return;
			}
			const invoker = deps.document.querySelector<HTMLElement>(`[popovertarget="${dialog.id}"]`);
			if (invoker !== null) invoker.focus({ preventScroll: true });
		},
		true,
	);

	deps.document.addEventListener("htmx:beforeSwap", (event) => {
		const form = nameFormOf(event);
		if (form === null || answerOf(event).status === REFUSED_NAME_STATUS) return;
		Reflect.set(Object(Reflect.get(event, "detail")), "shouldSwap", false);
		showFailure(form);
	});

	deps.document.addEventListener("htmx:sendError", (event) => {
		const form = nameFormOf(event);
		if (form !== null) showFailure(form);
	});

	deps.document.addEventListener("htmx:afterRequest", (event) => {
		if (nameFormOf(event) === null) return;
		const { body, location } = answerOf(event);
		if (typeof location !== "string" || typeof body !== "string" || body === "") return;
		announce(deps.document, body);
	});
}
