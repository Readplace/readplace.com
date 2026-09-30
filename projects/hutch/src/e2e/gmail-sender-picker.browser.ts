export function markSenderSearchTriggers(): void {
	document.addEventListener("htmx:trigger", (event) => {
		if (event.target instanceof Element && event.target.id === "gmail-sender-search-form") {
			event.target.setAttribute("data-test-gmail-search-triggered", "");
		}
	});
}
