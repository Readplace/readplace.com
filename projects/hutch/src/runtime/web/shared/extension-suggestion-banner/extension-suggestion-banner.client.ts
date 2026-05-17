interface ExtensionSuggestionBannerStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

interface ExtensionSuggestionBannerDeps {
	document: Document;
	storage: ExtensionSuggestionBannerStorage;
}

interface ExtensionSuggestionBannerController {
	attach(): void;
}

const STORAGE_KEY = "readplace.extension-suggestion-dismissed";
const BANNER_SELECTOR = ".extension-suggestion-banner";
const CLOSE_SELECTOR = "[data-extension-suggestion-close]";
const VISIBLE_CLASS = "extension-suggestion-banner--visible";

export function initExtensionSuggestionBanner(
	deps: ExtensionSuggestionBannerDeps,
): ExtensionSuggestionBannerController {
	function ensure<T>(value: T | null | undefined, description: string): T {
		if (value === null || value === undefined) {
			throw new Error(`extension-suggestion-banner: ${description}`);
		}
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

	function attach(): void {
		if (banner.dataset.showExtensionSuggestion !== "true") return;
		if (readDismissed()) return;

		banner.classList.add(VISIBLE_CLASS);

		const closeBtn = ensure(
			banner.querySelector<HTMLElement>(CLOSE_SELECTOR),
			`missing element ${CLOSE_SELECTOR}`,
		);
		closeBtn.addEventListener("click", () => {
			banner.classList.remove(VISIBLE_CLASS);
			writeDismissed();
		});
	}

	return { attach };
}
