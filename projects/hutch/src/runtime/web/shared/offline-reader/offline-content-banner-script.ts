import type { CspNonce } from "@packages/web-shell";
import { OFFLINE_COPY_PATH_ATTRIBUTE } from "./offline-cache";

export const offlineContentBannerScript = (cspNonce: CspNonce) => `<script nonce="${cspNonce}">
(function () {
	var root = document.documentElement;
	var lacking = {
		list: "main .readlist-article[data-content-state]:not([data-content-state='available'])",
		reader: "main.reader[data-content-state]:not([data-content-state='available'])"
	};
	function sync() {
		var stored = root.getAttribute("${OFFLINE_COPY_PATH_ATTRIBUTE}") === location.pathname;
		document.querySelectorAll("[data-offline-content-banner]").forEach(function (banner) {
			banner.hidden = !(stored && document.querySelector(lacking[banner.getAttribute("data-offline-content-banner")]) !== null);
		});
	}
	sync();
	document.body.addEventListener("htmx:afterSwap", sync);
	new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["${OFFLINE_COPY_PATH_ATTRIBUTE}"] });
})();
</script>`;
