interface InboxClipboard {
	writeText(text: string): Promise<void>;
}

interface InboxNavigator {
	clipboard?: InboxClipboard;
}

type InboxTimerId = ReturnType<typeof setTimeout>;

interface InboxCopyDeps {
	document: Document;
	navigator: InboxNavigator;
	setTimeoutFn: (cb: () => void, ms: number) => InboxTimerId;
}

interface InboxCopyController {
	attach(): void;
}

export function initInboxCopy(deps: InboxCopyDeps): InboxCopyController {
	const RESET_MS = 2000;
	const COPIED_LABEL = "Copied";
	const FAILED_LABEL = "Press Ctrl+C";

	function flash(button: HTMLButtonElement, message: string): void {
		const original = button.textContent;
		button.textContent = message;
		deps.setTimeoutFn(() => {
			button.textContent = original;
		}, RESET_MS);
	}

	function wire(button: HTMLButtonElement, clipboard: InboxClipboard): void {
		const address = button.getAttribute("data-inbox-address");
		if (address === null) return;
		// Revealed only here: the no-JS baseline is the selectable read-only
		// field, so the button stays hidden until the clipboard API is present.
		button.hidden = false;
		button.addEventListener("click", () => {
			clipboard.writeText(address).then(
				() => flash(button, COPIED_LABEL),
				() => flash(button, FAILED_LABEL),
			);
		});
	}

	function attach(): void {
		const clipboard = deps.navigator.clipboard;
		if (clipboard === undefined) return;
		for (const button of Array.from(
			deps.document.querySelectorAll<HTMLButtonElement>("[data-inbox-copy]"),
		)) {
			wire(button, clipboard);
		}
	}

	return { attach };
}
