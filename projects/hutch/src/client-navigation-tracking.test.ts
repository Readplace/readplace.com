import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const PROJECT_ROOT = join(__dirname, "..");
const SAME_ORIGIN_PATH_LITERAL = /["'`]\/[A-Za-z]/;

function clientSources(): string[] {
	const clientModules = readdirSync(join(PROJECT_ROOT, "src"), { recursive: true, encoding: "utf-8" })
		.filter((path) => path.endsWith(".client.ts") && !path.endsWith(".test.ts"))
		.map((path) => join(PROJECT_ROOT, "src", path));
	return [...clientModules, join(PROJECT_ROOT, "scripts", "build-client-bundles.js")];
}

function hardCodedPathsIn(file: string): string[] {
	return readFileSync(file, "utf-8")
		.split("\n")
		.flatMap((line, index) =>
			SAME_ORIGIN_PATH_LITERAL.test(line) ? [`${relative(PROJECT_ROOT, file)}:${index + 1}  ${line.trim()}`] : [],
		);
}

describe("client scripts take every same-origin destination from the server-rendered page", () => {
	it("finds the client scripts it scans", () => {
		expect(clientSources().map((file) => relative(PROJECT_ROOT, file))).toEqual(
			expect.arrayContaining([
				"scripts/build-client-bundles.js",
				"src/runtime/web/pages/account/account-cards.client.ts",
			]),
		);
	});

	it("hard-codes no same-origin path, because a URL built in the browser skips the CTA guard that checks rendered HTML for its utm markers", () => {
		expect(clientSources().flatMap(hardCodedPathsIn)).toEqual([]);
	});

	it("recognises the hard-coded form action that once shipped the Save card submit untagged", () => {
		expect(SAME_ORIGIN_PATH_LITERAL.test("    form.action = '/account/cards/confirm';")).toBe(true);
	});
});
