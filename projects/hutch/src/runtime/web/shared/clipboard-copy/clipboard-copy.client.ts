interface CopyClipboard {
	writeText(text: string): Promise<void>;
}

interface CopyNavigator {
	clipboard?: CopyClipboard;
}

type CopyTimerId = ReturnType<typeof setTimeout>;

interface ClipboardCopyDeps {
	document: Document;
	navigator: CopyNavigator;
	setTimeoutFn: (cb: () => void, ms: number) => CopyTimerId;
	copySelector: string;
	textAttr: string;
}

interface ClipboardCopyController {
	attach(): void;
}

export function initClipboardCopy(deps: ClipboardCopyDeps): ClipboardCopyController {
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

	function wire(button: HTMLButtonElement, clipboard: CopyClipboard): void {
		const text = button.getAttribute(deps.textAttr);
		if (text === null) return;
		// Revealed only here: the no-JS baseline is the selectable source text,
		// so the button stays hidden until the clipboard API is present.
		button.hidden = false;
		button.addEventListener("click", () => {
			clipboard.writeText(text).then(
				() => flash(button, COPIED_LABEL),
				() => flash(button, FAILED_LABEL),
			);
		});
	}

	function attach(): void {
		const clipboard = deps.navigator.clipboard;
		if (clipboard === undefined) return;
		for (const button of Array.from(
			deps.document.querySelectorAll<HTMLButtonElement>(deps.copySelector),
		)) {
			wire(button, clipboard);
		}
	}

	return { attach };
}
