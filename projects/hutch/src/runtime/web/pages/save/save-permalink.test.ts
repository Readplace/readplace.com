import { buildSavePermalink, runSavePermalinkCli } from "./save-permalink";

describe("buildSavePermalink", () => {
	it("should build a save URL with utm params and the scheme-less canonical view path", () => {
		const result = buildSavePermalink({
			baseUrl: "https://readplace.com",
			url: "https://fagnerbrack.com/example",
			utmSource: "fagnerbrack.com",
			utmContent: "top",
		});

		expect(result).toBe(
			"https://readplace.com/view/fagnerbrack.com/example?utm_source=fagnerbrack.com&utm_content=top",
		);
	});

	it("should encode the article URL's query separator inside the path", () => {
		const result = buildSavePermalink({
			baseUrl: "https://readplace.com",
			url: "https://example.com/path?q=hello world&x=1",
			utmSource: "src",
			utmContent: "ctx",
		});

		expect(result).toBe(
			"https://readplace.com/view/example.com/path%3Fq=hello%20world&x=1?utm_source=src&utm_content=ctx",
		);
	});
});

function runCli(argv: string[]) {
	let out = "";
	let err = "";
	const code = runSavePermalinkCli({
		argv,
		stdout: {
			write: (chunk: string) => {
				out += chunk;
			},
		},
		stderr: {
			write: (chunk: string) => {
				err += chunk;
			},
		},
	});
	return { code, out, err };
}

describe("runSavePermalinkCli", () => {
	it("should print medium-top permalink and return 0", () => {
		const { code, out, err } = runCli(["medium-top", "https://fagnerbrack.com/example"]);
		expect(code).toBe(0);
		expect(out).toBe(
			"https://readplace.com/view/fagnerbrack.com/example?utm_source=fagnerbrack.com&utm_content=top\n",
		);
		expect(err).toBe("");
	});

	it("should print medium-bottom permalink and return 0", () => {
		const { code, out, err } = runCli(["medium-bottom", "https://fagnerbrack.com/example"]);
		expect(code).toBe(0);
		expect(out).toBe(
			"https://readplace.com/view/fagnerbrack.com/example?utm_source=fagnerbrack.com&utm_content=bottom\n",
		);
		expect(err).toBe("");
	});

	it("should print usage and return 1 when no args", () => {
		const { code, out, err } = runCli([]);
		expect(code).toBe(1);
		expect(out).toBe("");
		expect(err).toContain("Usage: permalink <preset> <url>");
		expect(err).toContain("medium-top");
		expect(err).toContain("medium-bottom");
	});

	it("should print usage and return 1 when url is missing", () => {
		const { code, out, err } = runCli(["medium-top"]);
		expect(code).toBe(1);
		expect(out).toBe("");
		expect(err).toContain("Usage: permalink <preset> <url>");
	});

	it("should print error and return 1 for unknown preset", () => {
		const { code, out, err } = runCli(["unknown", "https://example.com"]);
		expect(code).toBe(1);
		expect(out).toBe("");
		expect(err).toContain("Unknown preset: unknown");
		expect(err).toContain("medium-top");
	});

	it("should print error and return 1 for invalid url", () => {
		const { code, out, err } = runCli(["medium-top", "not-a-url"]);
		expect(code).toBe(1);
		expect(out).toBe("");
		expect(err).toContain("Invalid URL: not-a-url");
	});
});
