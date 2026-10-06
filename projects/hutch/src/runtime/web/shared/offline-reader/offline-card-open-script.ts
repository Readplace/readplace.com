import type { CspNonce } from "@packages/web-shell";

export const offlineCardOpenScript = (cspNonce: CspNonce) => `<script nonce="${cspNonce}">
(function () {
	document.addEventListener("click", function (event) {
		if (window.htmx || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		var opener = event.target.closest("[data-opens-reader]");
		if (opener === null) return;
		event.preventDefault();
		fetch(opener.href, { headers: { "HX-Boosted": "true" } }).then(
			function () { location.assign(opener.href); },
			function () { opener.dispatchEvent(new CustomEvent("htmx:sendError", { bubbles: true })); }
		);
	});
})();
</script>`;
