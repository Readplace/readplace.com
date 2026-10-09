export interface ReadlistResponse {
	status: number;
	json: () => Promise<unknown>;
}

export interface ReadlistDeps {
	document: Document;
	window: Pick<Window, "addEventListener">;
	hidePopover: (popover: Element) => void;
	fetchFn: (url: string, init: RequestInit) => Promise<ReadlistResponse>;
	reload: () => void;
	navigate: (href: string) => void;
	setTimeoutFn: (callback: () => void, ms: number) => void;
}

const MENU_SELECTOR = ".readlist-nav__menu, .readlist-article__menu";
const NAME_FORM_ATTR = "data-readlist-name-form";
const NAME_ERROR_ATTR = "data-readlist-name-error";
const NAME_FAILURE_ATTR = "data-readlist-name-failure";
const LIVE_REGION_SELECTOR = "#toast-live-region";
const LIVE_REGION_SETTLE_MS = 150;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function isElement(node: EventTarget | null): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

function stringField(body: unknown, field: string): string | undefined {
	const value = Reflect.get(Object(body), field);
	return typeof value === "string" ? value : undefined;
}

function closeOpenMenus(document: Document, except: Element | null): void {
	const menus = document.querySelectorAll<HTMLDetailsElement>(MENU_SELECTOR);
	for (let i = 0; i < menus.length; i++) {
		if (menus[i] !== except) menus[i].open = false;
	}
}

function showError(form: HTMLFormElement, message: string | undefined): void {
	const error = form.querySelector(`[${NAME_ERROR_ATTR}]`);
	assert(error, "a name form always carries its error line");
	const input = form.querySelector("input[name]");
	assert(input, "a name form always carries its named input");
	const failure = form.getAttribute(NAME_FAILURE_ATTR);
	assert(failure, "a name form always carries its failure message");
	form.removeAttribute("aria-busy");
	error.textContent = message ?? failure;
	input.setAttribute("aria-invalid", "true");
}

function announce(document: Document, message: string): void {
	const regions = document.querySelectorAll(LIVE_REGION_SELECTOR);
	for (let i = 0; i < regions.length; i++) regions[i].textContent = message;
}

function nameRequest(form: HTMLFormElement): RequestInit {
	const body = new URLSearchParams();
	const fields = form.querySelectorAll<HTMLInputElement>("input[name]");
	for (let i = 0; i < fields.length; i++) body.append(fields[i].name, fields[i].value);
	return {
		method: "POST",
		credentials: "same-origin",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: body.toString(),
	};
}

function releaseBusyForms(deps: ReadlistDeps): void {
	const forms = deps.document.querySelectorAll(`form[${NAME_FORM_ATTR}][aria-busy="true"]`);
	for (let i = 0; i < forms.length; i++) {
		forms[i].removeAttribute("aria-busy");
		const popover = forms[i].closest("[popover]");
		assert(popover, "a name form always sits in its dialog");
		deps.hidePopover(popover);
	}
}

export function initReadlist(deps: ReadlistDeps): void {
	deps.window.addEventListener("pageshow", (event) => {
		if (event.persisted) releaseBusyForms(deps);
	});

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

	deps.document.addEventListener("submit", (event) => {
		const target = event.target;
		if (!isElement(target)) return;
		const form = target.closest("form");
		if (form === null || !form.hasAttribute(NAME_FORM_ATTR)) return;
		event.preventDefault();
		if (form.getAttribute("aria-busy") === "true") return;
		const action = form.getAttribute("action");
		assert(action, "the name form always posts somewhere");
		form.setAttribute("aria-busy", "true");
		deps.fetchFn(action, nameRequest(form)).then(
			(response) =>
				response.json().then(
					(body) => {
						const location = stringField(body, "location");
						if (location) {
							deps.navigate(location);
							return;
						}
						const label = stringField(body, "label");
						if (response.status === 200 && label) {
							announce(deps.document, `Readlist renamed to ${label}.`);
							deps.setTimeoutFn(deps.reload, LIVE_REGION_SETTLE_MS);
							return;
						}
						showError(form, stringField(body, "message"));
					},
					() => showError(form, undefined),
				),
			() => showError(form, undefined),
		);
	});
}
