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
	var cardAttribute = "data-offline-copy-card";
	var versionsSelector = "[data-article-history-versions]";
	function dateLabel(iso) {
		return new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "${SERVER_TIME_ZONE}" });
	}
	function timeLabel(iso) {
		var parts = {};
		new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "${SERVER_TIME_ZONE}" })
			.formatToParts(new Date(iso))
			.forEach(function (part) { parts[part.type] = part.value; });
		return parts.hour + ":" + parts.minute + " " + parts.dayPeriod;
	}
	function write(row, stamp) {
		var time = row.querySelector('time[data-local-time="' + stamp.mode + '"]');
		time.setAttribute("datetime", stamp.savedAt);
		time.textContent = stamp.label;
	}
	function show(template, savedAt) {
		var versions = template.closest("main").querySelector(versionsSelector);
		var card = template.content.firstElementChild.cloneNode(true);
		var row = card.querySelector(versionsSelector).firstElementChild;
		write(row, { mode: "date", savedAt: savedAt, label: dateLabel(savedAt) });
		write(row, { mode: "time", savedAt: savedAt, label: timeLabel(savedAt) });
		row.setAttribute(rowAttribute, savedAt);
		if (versions) {
			versions.prepend(row);
		} else {
			card.setAttribute(cardAttribute, "");
			template.before(card);
		}
		row.dispatchEvent(new Event("readplace:local-time", { bubbles: true }));
	}
	function sync() {
		var savedAt = root.getAttribute("${OFFLINE_COPY_SAVED_AT_ATTRIBUTE}");
		var template = document.querySelector("main:not([aria-busy]) template[data-offline-copy-template]");
		var shown = document.querySelector("[" + rowAttribute + "]");
		if (savedAt === null || template === null || root.getAttribute("${OFFLINE_COPY_PATH_ATTRIBUTE}") !== location.pathname) {
			if (shown) (shown.closest("[" + cardAttribute + "]") || shown).remove();
			return;
		}
		if (shown && shown.getAttribute(rowAttribute) === savedAt) return;
		if (shown) shown.remove();
		show(template, savedAt);
	}
	sync();
	document.body.addEventListener("htmx:afterSwap", sync);
	new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["${OFFLINE_COPY_PATH_ATTRIBUTE}", "${OFFLINE_COPY_SAVED_AT_ATTRIBUTE}"] });
})();
</script>`;
