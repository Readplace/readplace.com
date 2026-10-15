export interface ChangePasswordDeps {
	document: Document;
}

const FORM_SELECTOR = "form[data-change-password-form]";
const FAILURE_ATTR = "data-change-password-failure";
const FAILURE_LINE_SELECTOR = "[data-change-password-failure-line]";
const REFUSED_STATUS = 422;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function isElement(node: EventTarget | null): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

function formOf(event: Event): Element | null {
	const target = event.target;
	return isElement(target) && target.matches(FORM_SELECTOR) ? target : null;
}

function statusOf(event: Event): unknown {
	return Reflect.get(Object(Reflect.get(Object(Reflect.get(event, "detail")), "xhr")), "status");
}

function showFailure(form: Element): void {
	const line = form.querySelector(FAILURE_LINE_SELECTOR);
	assert(line, "the change-password form always carries its failure line");
	const failure = form.getAttribute(FAILURE_ATTR);
	assert(failure, "the change-password form always carries its failure message");
	line.textContent = failure;
}

function clearFailure(form: Element): void {
	const line = form.querySelector(FAILURE_LINE_SELECTOR);
	assert(line, "the change-password form always carries its failure line");
	line.textContent = "";
}

export function initChangePassword(deps: ChangePasswordDeps): void {
	deps.document.addEventListener("htmx:beforeSwap", (event) => {
		const form = formOf(event);
		if (form === null || statusOf(event) === REFUSED_STATUS) return;
		Reflect.set(Object(Reflect.get(event, "detail")), "shouldSwap", false);
		showFailure(form);
	});

	deps.document.addEventListener("htmx:beforeRequest", (event) => {
		const form = formOf(event);
		if (form !== null) clearFailure(form);
	});

	deps.document.addEventListener("htmx:sendError", (event) => {
		const form = formOf(event);
		if (form !== null) showFailure(form);
	});
}
