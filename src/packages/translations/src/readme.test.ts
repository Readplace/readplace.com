import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ALL_SURFACES } from "./all-surfaces";
import { NATIVE_CATALOGS } from "./native/native-catalogs";
import { WEB_SURFACE_NAMES } from "./web-catalog";

function readmeRows(): Map<string, string> {
	const readme = readFileSync(path.resolve(__dirname, "../README.md"), "utf8");
	const rows = readme
		.split("\n")
		.filter((line) => line.startsWith("| ") && !line.startsWith("| Surface |"))
		.map((line) => line.split("|").map((cell) => cell.trim()));
	return new Map(rows.map(([, surface, purpose]) => [surface, purpose]));
}

describe("README surface table", () => {
	it("lists every surface and native catalog with the purpose its module states", () => {
		const expected = new Map([
			...Object.entries(ALL_SURFACES).map(([name, surface]): [string, string] => [name, surface.purpose]),
			...Object.entries(NATIVE_CATALOGS).map(([name, catalog]): [string, string] => [name, catalog.purpose]),
		]);
		assert.deepEqual(readmeRows(), expected);
	});

	it("combines every surface except the API, stored and extension ones into the web catalog", () => {
		assert.deepEqual(
			[...WEB_SURFACE_NAMES].sort(),
			[
				"blog-site",
				"common",
				"hutch-account",
				"hutch-auth",
				"hutch-emails",
				"hutch-integrations",
				"hutch-reader",
				"hutch-readlist",
				"inbox",
				"shell",
				"web-embed",
			],
		);
	});
});
