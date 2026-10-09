import assert from "node:assert/strict";
import { hxLocationToMain } from "./hx-location";

describe("hxLocationToMain", () => {
	it("tells htmx to fetch the destination from the dialog and land its <main> at the top, like the page load a 303 gives", () => {
		const header = hxLocationToMain({
			path: "/queue?queue=0123456789abcdef",
			source: "#readlist-create",
			scroll: "top",
		});

		assert.deepEqual(JSON.parse(header), {
			path: "/queue?queue=0123456789abcdef",
			source: "#readlist-create",
			target: "main",
			select: "main",
			swap: "outerHTML show:none scroll:html:top",
		});
	});

	it("tells htmx to land the listing the reader acted from without moving the page", () => {
		const header = hxLocationToMain({
			path: "/queue?moved_article=0123456789abcdef0123456789abcdef&moved_from=default&moved_to=finance",
			source: "#readlist-create-move-0123456789abcdef0123456789abcdef",
			scroll: "stay-put",
		});

		assert.deepEqual(JSON.parse(header), {
			path: "/queue?moved_article=0123456789abcdef0123456789abcdef&moved_from=default&moved_to=finance",
			source: "#readlist-create-move-0123456789abcdef0123456789abcdef",
			target: "main",
			select: "main",
			swap: "outerHTML show:none",
		});
	});
});
