import { SERVER_TIME_ZONE } from "@packages/web-shell";
import type { CspNonce } from "@packages/web-shell";
import {
	OFFLINE_COPY_PATH_ATTRIBUTE,
	OFFLINE_COPY_SAVED_AT_ATTRIBUTE,
} from "../../offline-reader/offline-cache";

export const offlineCopyRowScript = (cspNonce: CspNonce) => `<script nonce="${cspNonce}">
(function () {
	var root = document.documentElement;
	var rowAttribute = "data-offline-copy-row";
	var drawerAttribute = "data-offline-copy-drawer";
	function create(input) {
		var element = document.createElement(input.tag);
		element.className = input.className;
		element.textContent = input.text;
		return element;
	}
	function savedAtLabel(iso) {
		var parts = {};
		new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "${SERVER_TIME_ZONE}" })
			.formatToParts(new Date(iso))
			.forEach(function (part) { parts[part.type] = part.value; });
		return parts.day + " " + parts.month + " '" + parts.year + ", " + parts.hour + ":" + parts.minute;
	}
	function drawerHolding(row) {
		var grip = create({ tag: "span", className: "crawl-bookmark__handle-grip", text: "" });
		grip.setAttribute("aria-hidden", "true");
		var handle = create({ tag: "summary", className: "crawl-bookmark__handle", text: "" });
		handle.setAttribute("aria-label", "Crawl details");
		handle.append(grip, create({ tag: "span", className: "sr-only", text: "Crawl details" }));
		var tabs = create({ tag: "ul", className: "crawl-bookmark__tabs", text: "" });
		tabs.append(row);
		var drawer = create({ tag: "details", className: "crawl-bookmark", text: "" });
		drawer.setAttribute("open", "");
		drawer.setAttribute(drawerAttribute, "");
		drawer.append(handle, tabs);
		return drawer;
	}
	function show(article, savedAt) {
		var time = create({ tag: "time", className: "crawl-bookmark__time", text: savedAtLabel(savedAt) });
		time.setAttribute("datetime", savedAt);
		time.setAttribute("data-local-time", "short-datetime");
		var badge = create({ tag: "span", className: "chip chip--badge chip--accent", text: "Offline" });
		badge.setAttribute("data-test-crawl-bookmark-badge", "offline");
		var row = create({ tag: "li", className: "crawl-bookmark__tab crawl-bookmark__tab--current", text: "" });
		row.setAttribute("aria-disabled", "false");
		row.setAttribute("data-test-crawl-bookmark-tab", "offline");
		row.setAttribute(rowAttribute, savedAt);
		row.append(time, badge);
		var tabs = article.querySelector(".crawl-bookmark__tabs");
		if (tabs) {
			tabs.prepend(row);
		} else {
			article.append(drawerHolding(row));
			article.dispatchEvent(new Event("readplace:crawl-bookmark", { bubbles: true }));
		}
		time.dispatchEvent(new Event("readplace:local-time", { bubbles: true }));
	}
	function sync() {
		var savedAt = root.getAttribute("${OFFLINE_COPY_SAVED_AT_ATTRIBUTE}");
		var article = document.querySelector("main:not([aria-busy]) [data-article-body]");
		var shown = document.querySelector("[" + rowAttribute + "]");
		if (savedAt === null || article === null || root.getAttribute("${OFFLINE_COPY_PATH_ATTRIBUTE}") !== location.pathname) {
			if (shown) (shown.closest("[" + drawerAttribute + "]") || shown).remove();
			return;
		}
		if (shown && shown.getAttribute(rowAttribute) === savedAt) return;
		if (shown) shown.remove();
		show(article, savedAt);
	}
	sync();
	document.body.addEventListener("htmx:afterSwap", sync);
	new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["${OFFLINE_COPY_PATH_ATTRIBUTE}", "${OFFLINE_COPY_SAVED_AT_ATTRIBUTE}"] });
})();
</script>`;
