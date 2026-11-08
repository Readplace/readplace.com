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

	it("tells htmx to land the listing a save went to on the row it just added", () => {
		const header = hxLocationToMain({ path: "/queue", source: "#add-link", scroll: "latest-saved" });

		assert.deepEqual(JSON.parse(header), {
			path: "/queue",
			source: "#add-link",
			target: "main",
			select: "main",
			swap: "outerHTML show:#latest-saved:top",
		});
	});

	it("leaves push out so htmx pushes the landing as it does by default", () => {
		const header = hxLocationToMain({ path: "/queue", source: "#add-link", scroll: "top" });

		assert.equal("push" in JSON.parse(header), false);
	});

	it("tells htmx not to push the landing as the string htmx reads, since it reads a boolean false as a push", () => {
		const header = hxLocationToMain({ path: "/queue", source: "#add-link", scroll: "top", push: false });

		assert.equal(JSON.parse(header).push, "false");
	});
});
