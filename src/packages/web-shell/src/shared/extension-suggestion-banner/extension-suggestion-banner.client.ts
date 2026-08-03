/** Inline assertion — this module is bundled for the browser, where
 * `node:assert` is not resolvable. */
function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface ExtensionSuggestionBannerStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

interface ExtensionSuggestionBannerDeps {
	document: Document;
	storage: ExtensionSuggestionBannerStorage;
	addSwapListener: (cb: () => void) => void;
}

interface ExtensionSuggestionBannerController {
	attach(): void;
}

const STORAGE_KEY = "readplace.extension-suggestion-dismissed";
const BANNER_SELECTOR = ".extension-suggestion-banner";
const CLOSE_SELECTOR = "[data-extension-suggestion-close]";
const VISIBLE_CLASS = "extension-suggestion-banner--visible";
const MAIN_MARKER_SELECTOR = "main[data-extension-suggestion]";

export function initExtensionSuggestionBanner(
	deps: ExtensionSuggestionBannerDeps,
): ExtensionSuggestionBannerController {
	function ensure<T>(value: T | null | undefined, description: string): T {
		assert(
			value !== null && value !== undefined,
			`extension-suggestion-banner: ${description}`,
		);
		return value;
	}

	function readDismissed(): boolean {
		try {
			return deps.storage.getItem(STORAGE_KEY) === "1";
		} catch {
			return false;
		}
	}

	function writeDismissed(): void {
		try {
			deps.storage.setItem(STORAGE_KEY, "1");
		} catch {
			/* storage may throw in private mode — swallow */
		}
	}

	const banner = ensure(
		deps.document.querySelector<HTMLElement>(BANNER_SELECTOR),
		`missing element ${BANNER_SELECTOR}`,
	);

	/** The banner lives outside <main>, so a boosted swap leaves it showing the
	 * origin page's answer. The destination's rides inside <main> — adopt it. */
	function adoptSwappedState(): void {
		const main = deps.document.querySelector<HTMLElement>(MAIN_MARKER_SELECTOR);
		if (main?.dataset.extensionSuggestion) {
			banner.dataset.showExtensionSuggestion = main.dataset.extensionSuggestion;
		}
	}

	function sync(): void {
		adoptSwappedState();
		const show = banner.dataset.showExtensionSuggestion === "true" && !readDismissed();
		banner.classList.toggle(VISIBLE_CLASS, show);
	}

	function attach(): void {
		const closeBtn = ensure(
			banner.querySelector<HTMLElement>(CLOSE_SELECTOR),
			`missing element ${CLOSE_SELECTOR}`,
		);
		closeBtn.addEventListener("click", () => {
			banner.classList.remove(VISIBLE_CLASS);
			writeDismissed();
		});

		sync();
		deps.addSwapListener(sync);
	}

	return { attach };
}
