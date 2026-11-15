export interface ReadlistFilterDeps {
	document: Document;
}

const FILTER = "[data-readlist-filter]";
const INPUT = "[data-readlist-filter-input]";
const STATUS = "[data-readlist-filter-status]";
const SCOPE = "[data-readlist-filter-scope]";
const OPTION = ".readlist-filter__option";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function isElement(node: EventTarget | null): node is Element {
	return node !== null && typeof Reflect.get(node, "matches") === "function";
}

function reveal(root: ParentNode): void {
	for (const filter of root.querySelectorAll(`${FILTER}[hidden]`)) filter.removeAttribute("hidden");
}

function applyQuery(input: Element): void {
	const scope = input.closest(SCOPE);
	const status = input.closest(FILTER)?.querySelector<HTMLElement>(STATUS);
	assert(scope, "a readlist filter sits inside its filter scope");
	assert(status, "a readlist filter carries its status");
	const query = String(Reflect.get(input, "value")).trim().toLocaleLowerCase();
	let shown = 0;
	for (const option of scope.querySelectorAll<HTMLElement>(OPTION)) {
		const matches = String(option.textContent).toLocaleLowerCase().includes(query);
		option.hidden = !matches;
		if (matches) shown += 1;
	}
	status.textContent = shown === 0 ? String(status.getAttribute("data-empty-message")) : "";
}

export function initReadlistFilter(deps: ReadlistFilterDeps): void {
	reveal(deps.document);
	deps.document.addEventListener("htmx:afterSettle", () => reveal(deps.document));
	deps.document.addEventListener(
		"toggle",
		(event) => {
			if (isElement(event.target)) reveal(event.target);
		},
		true,
	);
	deps.document.addEventListener("input", (event) => {
		if (isElement(event.target) && event.target.matches(INPUT)) applyQuery(event.target);
	});
	deps.document.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && isElement(event.target) && event.target.matches(INPUT)) event.preventDefault();
	});
}
