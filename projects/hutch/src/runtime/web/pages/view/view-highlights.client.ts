import { collectTextChunks, normaliseText } from "@packages/domain/article/highlight";
import {
	initLocalHighlights,
	type LocalHighlight,
	type LocalHighlightState,
	type LocalHighlightStorage,
} from "../../shared/article-body/highlights/local-highlights";
import { wrapHighlightMarks } from "../../shared/article-body/highlights/wrap-highlight-marks";

export type ViewHighlightBeacon = "kept" | "limit-reached";

export interface ViewHighlightsDeps {
	document: Document;
	storage: LocalHighlightStorage;
	now: () => Date;
	newId: () => string;
	supportsPopover: () => boolean;
	showPopover: (panel: Element) => void;
	hidePopover: (panel: Element) => void;
	scrollIntoView: (element: Element) => void;
	sendBeacon: (url: string) => void;
	submitForm: (input: { form: HTMLFormElement; submitter: HTMLElement }) => void;
}

const CONTENT_SELECTOR = ".article-body__content";
const CARD_SELECTOR = "[data-view-highlights]";
const TOOLBAR_SELECTOR = "[data-highlight-toolbar]";
const LOCAL_FORM_SELECTOR = "form[data-highlight-local]";
const NOTE_FORM_SELECTOR = "form[data-view-highlight-note-form]";
const ROW_SELECTOR = "[data-view-highlight-row]";
const DELETE_SELECTOR = "[data-view-highlight-delete]";
const KEEP_FIELD_SELECTOR = "[data-view-highlights-field]";
const MARK_SELECTOR = "mark[data-highlight-id]";
const GET_FORM_SELECTOR = 'form[method="GET" i][action]';
const RETURN_FIELD_SELECTOR = "[data-view-highlights-return]";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function attributeOf(input: { element: Element; name: string }): string {
	const value = input.element.getAttribute(input.name);
	assert(value, `the element carries ${input.name}`);
	return value;
}

function partOf<E extends Element>(input: { root: ParentNode; selector: string }): E {
	const element = input.root.querySelector<E>(input.selector);
	assert(element, `the view highlights markup carries ${input.selector}`);
	return element;
}

function isElement(target: EventTarget | null): target is Element {
	return typeof Reflect.get(Object(target), "closest") === "function";
}

function fieldValue(input: { form: Element; name: string }): string {
	const field = input.form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${input.name}"]`);
	return field === null ? "" : field.value;
}

function unmark(content: Element): void {
	for (const mark of Array.from(content.querySelectorAll(MARK_SELECTOR))) {
		const parent = mark.parentNode;
		assert(parent, "a mark always sits inside the article");
		while (mark.firstChild !== null) parent.insertBefore(mark.firstChild, mark);
		parent.removeChild(mark);
	}
	content.normalize();
}

function byPosition(a: LocalHighlightState, b: LocalHighlightState): number {
	const orphaned = Number(a.anchor.anchorState === "orphaned") - Number(b.anchor.anchorState === "orphaned");
	return orphaned !== 0 ? orphaned : a.anchor.start - b.anchor.start;
}

export function initViewHighlights(deps: ViewHighlightsDeps): void {
	const { document } = deps;
	const card = document.querySelector<HTMLElement>(CARD_SELECTOR);
	if (card === null) return;
	const store = initLocalHighlights(deps);
	if (!store.isAvailable()) {
		document.querySelector(TOOLBAR_SELECTOR)?.remove();
		return;
	}
	const url = attributeOf({ element: card, name: "data-view-highlights-url" });
	const eventUrl = attributeOf({ element: card, name: "data-view-highlights-event-url" });
	const idPrefix = attributeOf({ element: card, name: "data-highlight-id-prefix" });
	const savePath = attributeOf({ element: card, name: "data-view-highlights-save-path" });
	const authIntents = new Map<string, "signup" | "login">([
		[savePath, "signup"],
		[attributeOf({ element: card, name: "data-view-highlights-signup-path" }), "signup"],
		[attributeOf({ element: card, name: "data-view-highlights-login-path" }), "login"],
	]);
	const popover = partOf({ root: document, selector: `#${attributeOf({ element: card, name: "data-view-highlights-popover" })}` });
	const inlineForm = partOf<HTMLFormElement>({ root: document, selector: `#${attributeOf({ element: card, name: "data-view-highlights-inline-form" })}` });
	const list = partOf({ root: card, selector: "[data-view-highlights-list]" });
	const rowTemplate = partOf<HTMLTemplateElement>({ root: card, selector: "template[data-view-highlights-row]" });
	const elsewhere = partOf<HTMLElement>({ root: card, selector: "[data-view-highlights-elsewhere]" });
	const elsewhereList = partOf({ root: elsewhere, selector: "[data-view-highlights-elsewhere-list]" });
	const elsewhereRowTemplate = partOf<HTMLTemplateElement>({
		root: card,
		selector: "template[data-view-highlights-elsewhere-row]",
	});

	const beacon = (action: ViewHighlightBeacon): void => {
		deps.sendBeacon(`${eventUrl}?${new URLSearchParams({ action })}`);
	};

	const fillKeepFields = (): void => {
		const kept = JSON.stringify(
			store.all().map(({ url, exact, prefix, suffix, note }) => ({ url, exact, prefix, suffix, note })),
		);
		for (const field of Array.from(document.querySelectorAll<HTMLInputElement>(KEEP_FIELD_SELECTOR))) {
			field.value = kept;
		}
	};

	const rowOf = (state: LocalHighlightState): Element => {
		const { highlight, anchor } = state;
		const row = partOf({ root: rowTemplate.content, selector: ROW_SELECTOR }).cloneNode(true);
		assert(isElement(row), "a highlight row clones to an element");
		row.setAttribute("data-view-highlight-row", highlight.id);
		partOf({ root: row, selector: "[data-view-highlight-exact]" }).textContent = highlight.exact;
		const note = partOf<HTMLElement>({ root: row, selector: "[data-view-highlight-note]" });
		note.textContent = highlight.note ?? "";
		note.hidden = highlight.note === undefined;
		partOf<HTMLElement>({ root: row, selector: "[data-view-highlight-orphan]" }).hidden =
			anchor.anchorState !== "orphaned";
		const jump = partOf<HTMLAnchorElement>({ root: row, selector: "[data-view-highlight-jump]" });
		jump.href = `#${idPrefix}${highlight.id}`;
		jump.hidden = anchor.anchorState === "orphaned";
		partOf<HTMLElement>({ root: row, selector: '[data-view-highlight-note-label="add"]' }).hidden =
			highlight.note !== undefined;
		partOf<HTMLElement>({ root: row, selector: '[data-view-highlight-note-label="edit"]' }).hidden =
			highlight.note === undefined;
		const inputId = `view-highlight-note-${highlight.id}`;
		const input = partOf<HTMLTextAreaElement>({ root: row, selector: "[data-view-highlight-note-input]" });
		input.id = inputId;
		input.value = highlight.note ?? "";
		partOf<HTMLLabelElement>({ root: row, selector: "[data-view-highlight-note-input-label]" }).htmlFor = inputId;
		return row;
	};

	const elsewhereRowOf = (highlight: LocalHighlight): Element => {
		const row = partOf({ root: elsewhereRowTemplate.content, selector: ROW_SELECTOR }).cloneNode(true);
		assert(isElement(row), "a highlight row clones to an element");
		row.setAttribute("data-view-highlight-row", highlight.id);
		partOf({ root: row, selector: "[data-view-highlight-exact]" }).textContent = highlight.exact;
		partOf({ root: row, selector: "[data-view-highlight-source]" }).textContent = new URL(highlight.url).hostname;
		return row;
	};

	const render = (): void => {
		const content = document.querySelector(CONTENT_SELECTOR);
		assert(content, "a page offering local highlights renders the article");
		unmark(content);
		const chunks = collectTextChunks<ChildNode>(content);
		const { text, spans } = normaliseText(chunks);
		const states = store.anchorsOn({ url, text });
		wrapHighlightMarks({
			document,
			root: content,
			chunks,
			spans,
			highlights: states.map(({ highlight, anchor }) => ({ highlightId: highlight.id, note: highlight.note, anchor })),
			idPrefix,
		});
		list.replaceChildren(...[...states].sort(byPosition).map(rowOf));
		const keptElsewhere = store.all().filter((highlight) => highlight.url !== url);
		elsewhereList.replaceChildren(...keptElsewhere.map(elsewhereRowOf));
		elsewhere.hidden = keptElsewhere.length === 0;
		card.hidden = states.length === 0 && keptElsewhere.length === 0;
		fillKeepFields();
	};

	const openKeep = (): void => {
		fillKeepFields();
		card.hidden = false;
		if (deps.supportsPopover()) deps.showPopover(popover);
		else deps.scrollIntoView(inlineForm);
	};

	const closeDialogOf = (form: Element): void => {
		const dialog = form.closest("[popover]");
		if (dialog !== null && deps.supportsPopover()) deps.hidePopover(dialog);
	};

	const keepSelection = (form: Element): void => {
		const content = document.querySelector(CONTENT_SELECTOR);
		assert(content, "a page offering local highlights renders the article");
		const { text } = normaliseText(collectTextChunks<Node>(content));
		const start = Number(fieldValue({ form, name: "start" }));
		const end = Number(fieldValue({ form, name: "end" }));
		closeDialogOf(form);
		if (text.slice(start, end) !== fieldValue({ form, name: "exact" })) return;
		const outcome = store.add({ url, text, start, end, note: fieldValue({ form, name: "note" }) });
		switch (outcome.status) {
			case "kept":
				render();
				beacon("kept");
				return;
			case "limit-reached":
				beacon("limit-reached");
				openKeep();
				return;
			case "too-long":
				openKeep();
				return;
			case "unavailable":
				document.querySelector(TOOLBAR_SELECTOR)?.remove();
				return;
			case "passage-changed":
				return;
		}
	};

	const saveNote = (form: Element): void => {
		const row = form.closest(ROW_SELECTOR);
		assert(row, "a note form sits in its highlight's row");
		const outcome = store.setNote({
			id: attributeOf({ element: row, name: "data-view-highlight-row" }),
			note: fieldValue({ form, name: "note" }),
		});
		if (outcome.status === "too-long") {
			openKeep();
			return;
		}
		render();
	};

	const handOver = (target: URL): boolean => {
		const intent = authIntents.get(target.pathname);
		if (target.origin !== document.location.origin || intent === undefined || store.all().length === 0) return false;
		fillKeepFields();
		partOf<HTMLInputElement>({ root: inlineForm, selector: RETURN_FIELD_SELECTOR }).value =
			target.pathname === savePath ? `${target.pathname}${target.search}` : (target.searchParams.get("return") ?? "");
		deps.submitForm({
			form: inlineForm,
			submitter: partOf<HTMLElement>({ root: inlineForm, selector: `button[name="intent"][value="${intent}"]` }),
		});
		return true;
	};

	document.addEventListener(
		"submit",
		(event) => {
			const form = event.target;
			if (!isElement(form)) return;
			if (form.matches(GET_FORM_SELECTOR)) {
				const target = new URL(attributeOf({ element: form, name: "action" }), document.location.href);
				for (const field of Array.from(form.querySelectorAll<HTMLInputElement>("input[name]"))) {
					target.searchParams.append(field.name, field.value);
				}
				if (handOver(target)) event.preventDefault();
				return;
			}
			if (form.matches(LOCAL_FORM_SELECTOR)) {
				event.preventDefault();
				keepSelection(form);
				return;
			}
			if (form.matches(NOTE_FORM_SELECTOR)) {
				event.preventDefault();
				saveNote(form);
			}
		},
		{ capture: true },
	);

	document.addEventListener(
		"click",
		(event) => {
			const target = event.target;
			if (!isElement(target)) return;
			const link = target.closest<HTMLAnchorElement>("a[href]");
			if (link !== null && handOver(new URL(link.href, document.location.href))) event.preventDefault();
		},
		{ capture: true },
	);

	document.addEventListener("click", (event) => {
		const target = event.target;
		if (!isElement(target)) return;
		const remove = target.closest(DELETE_SELECTOR);
		const row = remove?.closest(ROW_SELECTOR);
		if (row === null || row === undefined) return;
		store.remove(attributeOf({ element: row, name: "data-view-highlight-row" }));
		render();
	});

	document.addEventListener("htmx:afterSettle", render);

	render();
}
