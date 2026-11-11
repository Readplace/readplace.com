import type { CspNonce } from "@packages/web-shell";
import { OFFLINE_COPY_PATH_ATTRIBUTE } from "./offline-cache";

export const offlineContentBannerScript = (cspNonce: CspNonce) => `<script nonce="${cspNonce}">
(function () {
	var root = document.documentElement;
	var holding = {
		list: function (state) { return "main .readlist-article[data-content-state='" + state + "']"; },
		reader: function (state) { return "main.reader[data-content-state='" + state + "']"; }
	};
	function sync() {
		var stored = root.getAttribute("${OFFLINE_COPY_PATH_ATTRIBUTE}") === location.pathname;
		document.querySelectorAll("[data-offline-content-banner]").forEach(function (banner) {
			var selector = holding[banner.getAttribute("data-offline-content-banner")](banner.getAttribute("data-offline-content-state"));
			banner.hidden = !(stored && document.querySelector(selector) !== null);
		});
	}
	sync();
	document.body.addEventListener("htmx:afterSwap", sync);
	new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["${OFFLINE_COPY_PATH_ATTRIBUTE}"] });
})();
</script>`;
