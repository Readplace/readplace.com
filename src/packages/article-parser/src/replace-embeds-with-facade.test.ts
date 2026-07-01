import { parseHTML } from "linkedom";
import { replaceEmbedsWithFacade } from "./replace-embeds-with-facade";

function parse(html: string): Document {
	return parseHTML(html).document;
}

function fakeRenderer(): {
	render: Parameters<typeof replaceEmbedsWithFacade>[0]["renderFacade"];
	calls: string[];
} {
	const calls: string[] = [];
	const render: Parameters<typeof replaceEmbedsWithFacade>[0]["renderFacade"] = (ctx) => {
		calls.push(ctx.embed.kind === "video" ? ctx.embed.videoId : ctx.embed.watchUrl);
		const facade = ctx.document.createElement("p");
		facade.setAttribute("data-facade", String(calls.length));
		return facade;
	};
	return { render, calls };
}

const YT = "https://www.youtube.com/embed/hVl9B3dTFB4";

describe("replaceEmbedsWithFacade", () => {
	it("replaces a YouTube iframe with the rendered facade and drops the iframe", () => {
		const document = parse(
			`<html><body><article><p>Before</p><p><iframe src="${YT}"></iframe></p><p>After</p></article></body></html>`,
		);
		const { render, calls } = fakeRenderer();

		replaceEmbedsWithFacade({ document, renderFacade: render });

		expect(document.querySelectorAll("iframe")).toHaveLength(0);
		expect(document.querySelectorAll("p[data-facade]")).toHaveLength(1);
		expect(calls).toEqual(["hVl9B3dTFB4"]);
	});

	it("leaves a non-YouTube iframe untouched", () => {
		const document = parse(
			'<html><body><article><iframe src="https://player.vimeo.com/video/76979871"></iframe></article></body></html>',
		);
		const { render, calls } = fakeRenderer();

		replaceEmbedsWithFacade({ document, renderFacade: render });

		expect(document.querySelectorAll("iframe")).toHaveLength(1);
		expect(document.querySelectorAll("p[data-facade]")).toHaveLength(0);
		expect(calls).toEqual([]);
	});

	it("leaves an iframe without a src untouched", () => {
		const document = parse(
			"<html><body><article><iframe></iframe></article></body></html>",
		);
		const { render } = fakeRenderer();

		replaceEmbedsWithFacade({ document, renderFacade: render });

		expect(document.querySelectorAll("iframe")).toHaveLength(1);
		expect(document.querySelectorAll("p[data-facade]")).toHaveLength(0);
	});

	it("replaces every YouTube iframe in document order and keeps siblings stable", () => {
		const document = parse(
			"<html><body><article>" +
				`<p>p1</p><iframe src="https://www.youtube.com/embed/aaaaaaaaaaa"></iframe>` +
				`<p>p2</p><iframe src="https://youtu.be/bbbbbbbbbbb"></iframe>` +
				`<p>p3</p><iframe src="https://vimeo.com/keep-me"></iframe>` +
				"<p>p4</p>" +
				"</article></body></html>",
		);
		const { render, calls } = fakeRenderer();

		replaceEmbedsWithFacade({ document, renderFacade: render });

		expect(calls).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
		expect(document.querySelectorAll("p[data-facade]")).toHaveLength(2);
		const remaining = Array.from(document.querySelectorAll("iframe")).map((f) => f.getAttribute("src"));
		expect(remaining).toEqual(["https://vimeo.com/keep-me"]);
		const texts = Array.from(document.querySelectorAll("p"))
			.filter((el) => !el.hasAttribute("data-facade"))
			.map((el) => el.textContent);
		expect(texts).toEqual(["p1", "p2", "p3", "p4"]);
	});

	it("is a no-op when the document has no iframe", () => {
		const document = parse(
			"<html><body><article><p>Just text.</p></article></body></html>",
		);
		const { render, calls } = fakeRenderer();

		replaceEmbedsWithFacade({ document, renderFacade: render });

		expect(calls).toEqual([]);
		expect(document.querySelector("article")?.innerHTML).toContain("Just text.");
	});

	it("is idempotent — a second pass finds no YouTube iframe to replace", () => {
		const document = parse(
			`<html><body><article><p><iframe src="${YT}"></iframe></p></article></body></html>`,
		);
		const { render, calls } = fakeRenderer();

		replaceEmbedsWithFacade({ document, renderFacade: render });
		const callsAfterFirst = calls.length;
		replaceEmbedsWithFacade({ document, renderFacade: render });

		expect(callsAfterFirst).toBe(1);
		expect(calls.length).toBe(callsAfterFirst);
		expect(document.querySelectorAll("iframe")).toHaveLength(0);
	});
});
