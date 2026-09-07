import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { articleFrontMatterXhtml } from "./article-front-matter";

describe("articleFrontMatterXhtml", () => {
	it("opens with the title and the site name and closes with a rule when nothing else is known", () => {
		expect(
			articleFrontMatterXhtml({
				title: "Hello World",
				siteName: "example.com",
				excerpt: "",
				summary: undefined,
			}),
		).toBe("<h1>Hello World</h1><p>example.com</p><hr />");
	});

	const notReady: { label: string; summary: GeneratedSummary | undefined }[] = [
		{ label: "missing", summary: undefined },
		{ label: "pending", summary: { status: "pending" } },
		{ label: "failed", summary: { status: "failed", reason: "exhausted-retries" } },
		{ label: "skipped", summary: { status: "skipped" } },
	];

	it.each(notReady)(
		"keeps the parsed excerpt and leaves out the summary section while the summary is $label",
		({ summary }) => {
			expect(
				articleFrontMatterXhtml({
					title: "Hello World",
					siteName: "example.com",
					excerpt: "Parsed blurb.",
					summary,
				}),
			).toBe("<h1>Hello World</h1><p>example.com</p><p>Parsed blurb.</p><hr />");
		},
	);

	it("prefers the generated excerpt and gives each blank-line-separated point its own paragraph", () => {
		expect(
			articleFrontMatterXhtml({
				title: "Hello World",
				siteName: "example.com",
				excerpt: "Parsed blurb.",
				summary: {
					status: "ready",
					summary: "First point.\n\nSecond point.",
					excerpt: "Generated blurb.",
				},
			}),
		).toBe(
			"<h1>Hello World</h1><p>example.com</p><p>Generated blurb.</p><h2>Summary (TL;DR)</h2><p>First point.</p><p>Second point.</p><hr />",
		);
	});

	const readyWithoutExcerpt: { label: string; summary: GeneratedSummary }[] = [
		{ label: "absent", summary: { status: "ready", summary: "Gist." } },
		{ label: "empty", summary: { status: "ready", summary: "Gist.", excerpt: "" } },
	];

	it.each(readyWithoutExcerpt)(
		"falls back to the parsed excerpt when the ready summary's excerpt is $label",
		({ summary }) => {
			expect(
				articleFrontMatterXhtml({
					title: "Hello World",
					siteName: "example.com",
					excerpt: "Parsed blurb.",
					summary,
				}),
			).toBe(
				"<h1>Hello World</h1><p>example.com</p><p>Parsed blurb.</p><h2>Summary (TL;DR)</h2><p>Gist.</p><hr />",
			);
		},
	);

	it("keeps the summary section but drops the excerpt paragraph when no excerpt exists at all", () => {
		expect(
			articleFrontMatterXhtml({
				title: "Hello World",
				siteName: "example.com",
				excerpt: "",
				summary: { status: "ready", summary: "Gist." },
			}),
		).toBe("<h1>Hello World</h1><p>example.com</p><h2>Summary (TL;DR)</h2><p>Gist.</p><hr />");
	});

	it("escapes XML in every text slot", () => {
		expect(
			articleFrontMatterXhtml({
				title: "Tom & Jerry <3",
				siteName: "a<b",
				excerpt: "ignored",
				summary: { status: "ready", summary: "p > q", excerpt: "x & y" },
			}),
		).toBe(
			"<h1>Tom &amp; Jerry &lt;3</h1><p>a&lt;b</p><p>x &amp; y</p><h2>Summary (TL;DR)</h2><p>p &gt; q</p><hr />",
		);
	});
});
