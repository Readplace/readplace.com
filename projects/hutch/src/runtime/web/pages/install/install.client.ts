interface InstallClipboard {
	writeText(text: string): Promise<void>;
}

interface InstallNavigator {
	clipboard?: InstallClipboard;
}

type InstallTimerId = ReturnType<typeof setTimeout>;

interface InstallCopyDeps {
	document: Document;
	navigator: InstallNavigator;
	setTimeoutFn: (cb: () => void, ms: number) => InstallTimerId;
}

interface InstallCopyController {
	attach(): void;
}

export function initInstallCopy(deps: InstallCopyDeps): InstallCopyController {
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

	function wire(button: HTMLButtonElement, clipboard: InstallClipboard): void {
		const text = button.getAttribute("data-install-text");
		if (text === null) return;
		// Revealed only here: the no-JS baseline is the selectable URL / prompt
		// text, so the button stays hidden until the clipboard API is present.
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
			deps.document.querySelectorAll<HTMLButtonElement>("[data-install-copy]"),
		)) {
			wire(button, clipboard);
		}
	}

	return { attach };
}
