import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READER_IMAGE_SIZE_ATTRIBUTE as STORED_SIZE_ATTRIBUTE } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import {
	initReaderImageBoxes,
	READER_IMAGE_BOXES_ATTRIBUTE,
	READER_IMAGE_SIZE_ATTRIBUTE,
} from "./reader-image-boxes.client";

const MEASURED =
	'<img id="measured" src="https://cdn.example.com/a.png" data-reader-image-size="1456x1005" style="--reader-image-width:1456px;--reader-image-ratio:1456 / 1005">';
const UNMARKED = '<img id="unmarked" src="https://cdn.example.com/b.png" style="float:left">';

function createHarness(params: { body: string; completeIds: string[] }) {
	const dom = new JSDOM(`<!doctype html><html><body><main>${params.body}</main></body></html>`);
	const { document } = dom.window;
	for (const id of params.completeIds) {
		const image = document.getElementById(id);
		assert(image, `the harness page holds #${id}`);
		Object.defineProperty(image, "complete", { value: true });
	}
	for (const image of document.querySelectorAll("img")) {
		if (!params.completeIds.includes(image.id)) Object.defineProperty(image, "complete", { value: false });
	}
	initReaderImageBoxes({
		document,
		isImage: (target): target is HTMLImageElement => target instanceof dom.window.HTMLImageElement,
	});

	function image(id: string): Element {
		const found = document.getElementById(id);
		assert(found, `the harness page holds #${id}`);
		return found;
	}

	return {
		document,
		image,
		fire: (params: { target: EventTarget; type: "load" | "error" }) =>
			params.target.dispatchEvent(new dom.window.Event(params.type)),
	};
}

describe("initReaderImageBoxes", () => {
	it.each(["load", "error"] as const)("releases a measured image's box on its %s event", (type) => {
		const harness = createHarness({ body: MEASURED, completeIds: [] });
		const measured = harness.image("measured");

		harness.fire({ target: measured, type });

		expect(measured.hasAttribute("data-reader-image-size")).toBe(false);
		expect(measured.hasAttribute("style")).toBe(false);
	});

	it("leaves an unmarked image's own style alone when it loads", () => {
		const harness = createHarness({ body: UNMARKED, completeIds: [] });

		harness.fire({ target: harness.image("unmarked"), type: "load" });

		expect(harness.image("unmarked").getAttribute("style")).toBe("float:left");
	});

	it("leaves the page alone on a load event from something that is not an image", () => {
		const harness = createHarness({ body: `${MEASURED}<p id="other" data-reader-image-size="1x1" style="color:red">p</p>`, completeIds: [] });

		harness.fire({ target: harness.image("other"), type: "load" });

		expect(harness.image("other").getAttribute("style")).toBe("color:red");
		expect(harness.image("measured").hasAttribute("style")).toBe(true);
	});

	it("releases an image that was already complete before the script ran", () => {
		const harness = createHarness({ body: MEASURED, completeIds: ["measured"] });

		expect(harness.image("measured").hasAttribute("data-reader-image-size")).toBe(false);
		expect(harness.image("measured").hasAttribute("style")).toBe(false);
	});

	it("keeps the box of an image whose bytes are still pending", () => {
		const harness = createHarness({ body: MEASURED, completeIds: [] });

		expect(harness.image("measured").getAttribute("data-reader-image-size")).toBe("1456x1005");
		expect(harness.image("measured").hasAttribute("style")).toBe(true);
	});

	it("marks the root once it is listening", () => {
		const harness = createHarness({ body: MEASURED, completeIds: [] });

		expect(harness.document.documentElement.hasAttribute("data-reader-image-boxes")).toBe(true);
	});

	it("releases an image a later swap inserted, on its load", () => {
		const harness = createHarness({ body: "", completeIds: [] });
		const main = harness.document.querySelector("main");
		assert(main, "the harness page holds a <main>");
		main.innerHTML = MEASURED;

		harness.fire({ target: harness.image("measured"), type: "load" });

		expect(harness.image("measured").hasAttribute("data-reader-image-size")).toBe(false);
		expect(harness.image("measured").hasAttribute("style")).toBe(false);
	});

	it("names the attributes the sanitizer writes and the reader stylesheet reads", () => {
		const css = readFileSync(join(__dirname, "..", "article-body.styles.css"), "utf-8");

		expect(READER_IMAGE_SIZE_ATTRIBUTE).toBe(STORED_SIZE_ATTRIBUTE);
		expect(css).toContain(`:root[${READER_IMAGE_BOXES_ATTRIBUTE}]`);
		expect(css).toContain(`img[${READER_IMAGE_SIZE_ATTRIBUTE}]`);
	});
});
