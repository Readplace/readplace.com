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
	clearTimeoutFn: (id: CopyTimerId) => void;
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
	const wired = new WeakSet<HTMLButtonElement>();

	function wire(button: HTMLButtonElement, clipboard: CopyClipboard): void {
		const text = button.getAttribute(deps.textAttr);
		if (text === null) return;
		if (wired.has(button)) return;
		wired.add(button);
		const idleLabel = button.textContent;
		let pendingReset: CopyTimerId | undefined;

		function flash(message: string): void {
			if (pendingReset !== undefined) deps.clearTimeoutFn(pendingReset);
			button.textContent = message;
			pendingReset = deps.setTimeoutFn(() => {
				button.textContent = idleLabel;
				pendingReset = undefined;
			}, RESET_MS);
		}

		// Revealed only here: the no-JS baseline is the selectable source text,
		// so the button stays hidden until the clipboard API is present.
		button.hidden = false;
		button.addEventListener("click", () => {
			clipboard.writeText(text).then(
				() => flash(COPIED_LABEL),
				() => flash(FAILED_LABEL),
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
