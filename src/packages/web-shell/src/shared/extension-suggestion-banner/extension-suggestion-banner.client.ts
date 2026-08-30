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
	addSwapListener: (listener: () => void) => void;
}

interface ExtensionSuggestionBannerController {
	attach(): void;
}

const STORAGE_KEY = "readplace.extension-suggestion-dismissed";
const BANNER_SELECTOR = ".extension-suggestion-banner";
const CLOSE_SELECTOR = "[data-extension-suggestion-close]";
const VISIBLE_CLASS = "extension-suggestion-banner--visible";

function isElement(node: EventTarget | null): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

export function initExtensionSuggestionBanner(
	deps: ExtensionSuggestionBannerDeps,
): ExtensionSuggestionBannerController {
	let dismissedInPage = false;

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

	function banner(): HTMLElement {
		const el = deps.document.querySelector<HTMLElement>(BANNER_SELECTOR);
		assert(el, `extension-suggestion-banner: missing element ${BANNER_SELECTOR}`);
		return el;
	}

	function sync(): void {
		const el = banner();
		el.classList.toggle(
			VISIBLE_CLASS,
			el.dataset.showExtensionSuggestion === "true" &&
				!(dismissedInPage || readDismissed()),
		);
	}

	deps.document.addEventListener("click", (event) => {
		const target = event.target;
		if (!isElement(target)) return;
		if (target.closest(CLOSE_SELECTOR) === null) return;
		dismissedInPage = true;
		writeDismissed();
		sync();
	});

	return {
		attach(): void {
			sync();
			deps.addSwapListener(sync);
		},
	};
}
