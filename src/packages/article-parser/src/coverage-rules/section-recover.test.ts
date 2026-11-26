import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { recoverSection } from "./section-recover";

function root(html: string): Element {
	const { document } = parseHTML(`<!DOCTYPE html><html><head></head><body><div id="p">${html}</div></body></html>`);
	const el = document.getElementById("p");
	assert(el !== null, "fixture root missing");
	return el;
}

describe("recoverSection", () => {
	it("returns the region without its unowned descendants and leaves the document as it was", () => {
		const region = root(
			'<div><h2>One</h2><p>Kept <span hidden>hidden</span></p><nav><a href="#x">menu</a></nav></div><script>x()</script><div style="display:none"><p>gone</p></div>',
		);
		expect(recoverSection({ root: region })).toEqual({ bodyHtml: "<div><h2>One</h2><p>Kept </p></div>" });
		expect(region.querySelectorAll("nav, script, span").length).toBe(3);
	});

	it("restores lazy image sources from the first lazy url and the lazy srcset", () => {
		const { bodyHtml } = recoverSection({
			root: root(
				'<img data-src="map.png" src="placeholder.gif" data-srcset="map.png 1x, map@2x.png 2x"><img data-srcset="b.png 1x, b@2x.png 2x" src="p.gif"><img data-original="c.png"><img src="plain.png" srcset="plain@2x.png 2x">',
			),
		});
		const images = [...parseHTML(`<div>${bodyHtml}</div>`).document.querySelectorAll("img")].map((img) => [
			img.getAttribute("src"),
			img.getAttribute("srcset"),
		]);
		expect(images).toEqual([
			["map.png", "map.png 1x, map@2x.png 2x"],
			["b.png", "b.png 1x, b@2x.png 2x"],
			["c.png", null],
			["plain.png", "plain@2x.png 2x"],
		]);
	});
});
