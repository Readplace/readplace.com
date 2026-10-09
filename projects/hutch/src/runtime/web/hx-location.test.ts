import assert from "node:assert/strict";
import { hxLocationToMain } from "./hx-location";

describe("hxLocationToMain", () => {
	it("tells htmx to fetch the destination from the dialog and land its <main> at the top, like the page load a 303 gives", () => {
		const header = hxLocationToMain({ path: "/queue?queue=0123456789abcdef", source: "#readlist-create" });

		assert.deepEqual(JSON.parse(header), {
			path: "/queue?queue=0123456789abcdef",
			source: "#readlist-create",
			target: "main",
			select: "main",
			swap: "outerHTML show:none scroll:html:top",
		});
	});
});
