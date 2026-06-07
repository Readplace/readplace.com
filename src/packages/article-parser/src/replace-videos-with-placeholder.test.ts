import { parseHTML } from "linkedom";
import { replaceVideosWithPlaceholder } from "./replace-videos-with-placeholder";

function parse(html: string): Document {
	return parseHTML(html).document;
}

function fakeRenderer(): {
	render: Parameters<typeof replaceVideosWithPlaceholder>[0]["renderPlaceholder"];
	calls: { originalUrl: string; hostname: string }[];
} {
	const calls: { originalUrl: string; hostname: string }[] = [];
	const render: Parameters<typeof replaceVideosWithPlaceholder>[0]["renderPlaceholder"] = (ctx) => {
		calls.push({ originalUrl: ctx.originalUrl, hostname: ctx.hostname });
		const ph = ctx.document.createElement("p");
		ph.setAttribute("data-ph", String(calls.length));
		return ph;
	};
	return { render, calls };
}

describe("replaceVideosWithPlaceholder", () => {
	it("replaces a single <video> with the rendered placeholder", () => {
		const document = parse(
			'<html><body><article><p>Before</p><video src="x.mp4"></video><p>After</p></article></body></html>',
		);
		const { render } = fakeRenderer();

		replaceVideosWithPlaceholder({
			document,
			originalUrl: "https://example.com/article",
			renderPlaceholder: render,
		});

		expect(document.querySelectorAll("video")).toHaveLength(0);
		expect(document.querySelectorAll("p[data-ph]")).toHaveLength(1);
		const article = document.querySelector("article");
		expect(article?.innerHTML).toContain("Before");
		expect(article?.innerHTML).toContain("After");
	});

	it("replaces every <video> in document order and keeps siblings stable", () => {
		const document = parse(
			"<html><body><article>" +
				"<p>p1</p><video src='a.mp4'></video>" +
				"<p>p2</p><video src='b.mp4'></video>" +
				"<p>p3</p><video src='c.mp4'></video>" +
				"<p>p4</p><video src='d.mp4'></video>" +
				"<p>p5</p><video src='e.mp4'></video>" +
				"<p>p6</p>" +
				"</article></body></html>",
		);
		const { render } = fakeRenderer();

		replaceVideosWithPlaceholder({
			document,
			originalUrl: "https://example.com/article",
			renderPlaceholder: render,
		});

		expect(document.querySelectorAll("video")).toHaveLength(0);
		const placeholders = Array.from(document.querySelectorAll("p[data-ph]"));
		expect(placeholders).toHaveLength(5);
		expect(placeholders.map((el) => el.getAttribute("data-ph"))).toEqual([
			"1",
			"2",
			"3",
			"4",
			"5",
		]);
		const article = document.querySelector("article");
		const texts = Array.from(article?.querySelectorAll("p") ?? [])
			.filter((el) => !el.hasAttribute("data-ph"))
			.map((el) => el.textContent);
		expect(texts).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
	});

	it("removes <source> and <track> children with the <video>", () => {
		const document = parse(
			"<html><body><article>" +
				'<video poster="cover.jpg">' +
				'<source src="a.mp4" type="video/mp4">' +
				'<track kind="captions" src="cap.vtt">' +
				"</video>" +
				"</article></body></html>",
		);
		const { render } = fakeRenderer();

		replaceVideosWithPlaceholder({
			document,
			originalUrl: "https://example.com/article",
			renderPlaceholder: render,
		});

		expect(document.querySelectorAll("video")).toHaveLength(0);
		expect(document.querySelectorAll("source")).toHaveLength(0);
		expect(document.querySelectorAll("track")).toHaveLength(0);
		expect(document.querySelectorAll("p[data-ph]")).toHaveLength(1);
	});

	it("replaces a <video> even when it already has a real src attribute", () => {
		const document = parse(
			'<html><body><article><video src="https://cdn.example.com/clip.mp4"></video></article></body></html>',
		);
		const { render } = fakeRenderer();

		replaceVideosWithPlaceholder({
			document,
			originalUrl: "https://example.com/article",
			renderPlaceholder: render,
		});

		expect(document.querySelectorAll("video")).toHaveLength(0);
		expect(document.querySelectorAll("p[data-ph]")).toHaveLength(1);
	});

	it("is a no-op when the document has no <video>", () => {
		const document = parse(
			"<html><body><article><p>Just text.</p></article></body></html>",
		);
		const { render, calls } = fakeRenderer();

		replaceVideosWithPlaceholder({
			document,
			originalUrl: "https://example.com/article",
			renderPlaceholder: render,
		});

		expect(calls).toEqual([]);
		expect(document.querySelector("article")?.innerHTML).toContain("Just text.");
	});

	it("is idempotent — a second pass finds no <video> to replace", () => {
		const document = parse(
			"<html><body><article>" +
				"<video src='a.mp4'></video>" +
				"<video src='b.mp4'></video>" +
				"</article></body></html>",
		);
		const { render, calls } = fakeRenderer();

		replaceVideosWithPlaceholder({
			document,
			originalUrl: "https://example.com/article",
			renderPlaceholder: render,
		});
		const callsAfterFirst = calls.length;

		replaceVideosWithPlaceholder({
			document,
			originalUrl: "https://example.com/article",
			renderPlaceholder: render,
		});

		expect(callsAfterFirst).toBe(2);
		expect(calls.length).toBe(callsAfterFirst);
		expect(document.querySelectorAll("video")).toHaveLength(0);
		expect(document.querySelectorAll("p[data-ph]")).toHaveLength(2);
	});

	it("passes the article URL and hostname to the placeholder renderer", () => {
		const document = parse(
			"<html><body><article><video src='a.mp4'></video></article></body></html>",
		);
		const { render, calls } = fakeRenderer();

		replaceVideosWithPlaceholder({
			document,
			originalUrl: "https://performance.dev/posts/how-is-linear-so-fast",
			renderPlaceholder: render,
		});

		expect(calls).toEqual([
			{
				originalUrl: "https://performance.dev/posts/how-is-linear-so-fast",
				hostname: "performance.dev",
			},
		]);
	});
});
