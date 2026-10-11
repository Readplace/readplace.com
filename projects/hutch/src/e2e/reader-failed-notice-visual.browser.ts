export function dismissExtensionSuggestion(): void {
	window.localStorage.setItem("readplace.extension-suggestion-dismissed", "1");
}

export function stubNativeReaderBridge(): void {
	Object.assign(window, { ReadplaceReader: { postMessage: () => undefined } });
}
