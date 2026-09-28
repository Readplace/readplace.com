import assert from "node:assert/strict";

export function assertErrorAlert(document: Document): Element {
	const alert = document.querySelector('[data-test-alert="global-error"]');
	assert(alert, "the global error alert must render");
	assert.equal(alert.getAttribute("data-test-alert-variant"), "error");
	assert.equal(alert.getAttribute("role"), "alert");
	assert(alert.classList.contains("alert--visible"), "the global error alert must be visible");
	return alert;
}
