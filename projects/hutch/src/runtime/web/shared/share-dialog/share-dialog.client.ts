interface ShareDialogNavigator {
	clipboard?: { writeText(text: string): Promise<void> };
}

type ShareTimerId = ReturnType<typeof setTimeout>;

export interface ShareDialogDeps {
	document: Document;
	navigator: ShareDialogNavigator;
	setTimeoutFn: (cb: () => void, ms: number) => ShareTimerId;
	clearTimeoutFn: (id: ShareTimerId) => void;
}

const COPY = "[data-share-copy]";
const RESET_MS = 2000;
const COPIED_MESSAGE = "Link copied to clipboard";
const FAILED_MESSAGE = "Press Ctrl+C";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function partOf<T extends Element>(root: Element, selector: string): T {
	const part = root.querySelector<T>(selector);
	assert(part, `a share panel always carries ${selector}`);
	return part;
}

function panelOf(button: HTMLElement): Element {
	const panel = button.closest("[data-share-panel]");
	assert(panel, "a copy button always sits in its share panel");
	return panel;
}

function show(button: HTMLElement, state: { copied: boolean; message: string }): void {
	partOf<HTMLElement>(button, "[data-share-copy-idle]").hidden = state.copied;
	partOf<HTMLElement>(button, "[data-share-copy-done]").hidden = !state.copied;
	partOf(panelOf(button), "[data-share-status]").textContent = state.message;
}

export function initShareDialog(deps: ShareDialogDeps): { attach(): void; reveal(): void } {
	const pendingResets = new WeakMap<HTMLElement, ShareTimerId>();

	function copyButtons(): HTMLElement[] {
		return Array.from(deps.document.querySelectorAll<HTMLElement>(COPY));
	}

	function reveal(): void {
		if (deps.navigator.clipboard === undefined) return;
		for (const button of copyButtons()) button.hidden = false;
	}

	function flash(button: HTMLElement, state: { copied: boolean; message: string }): void {
		const pending = pendingResets.get(button);
		if (pending !== undefined) deps.clearTimeoutFn(pending);
		show(button, state);
		pendingResets.set(
			button,
			deps.setTimeoutFn(() => {
				pendingResets.delete(button);
				show(button, { copied: false, message: "" });
			}, RESET_MS),
		);
	}

	function attach(): void {
		const clipboard = deps.navigator.clipboard;
		if (clipboard === undefined) return;
		reveal();
		deps.document.addEventListener("click", (event) => {
			const path = event.composedPath();
			const button = copyButtons().find((candidate) => path.includes(candidate));
			if (button === undefined) return;
			const url = button.getAttribute("data-share-url");
			assert(url, "a copy button always carries the link it copies");
			clipboard.writeText(url).then(
				() => flash(button, { copied: true, message: COPIED_MESSAGE }),
				() => {
					partOf<HTMLInputElement>(panelOf(button), "[data-share-field]").select();
					flash(button, { copied: false, message: FAILED_MESSAGE });
				},
			);
		});
	}

	return { attach, reveal };
}
