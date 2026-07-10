import { pendingSaveHostFrom } from "./pending-save-host";

describe("pendingSaveHostFrom", () => {
	it("returns the article hostname, normalized exactly like analytics' article_host, for a /save return URL", () => {
		expect(pendingSaveHostFrom("/save?url=https%3A%2F%2FExample.com%2Fhow-to-read")).toBe("example.com");
	});

	it("keeps only the hostname when the article URL carries credentials, a port, and a query", () => {
		expect(pendingSaveHostFrom("/save?url=https%3A%2F%2Fuser%3Apass%40blog.example.com%3A8443%2Fpost%3Fa%3Db")).toBe("blog.example.com");
	});

	it("returns undefined when there is no return URL", () => {
		expect(pendingSaveHostFrom(undefined)).toBeUndefined();
	});

	it("returns undefined for a return URL that is not a save URL", () => {
		expect(pendingSaveHostFrom("/queue")).toBeUndefined();
	});

	it("returns undefined when the save URL carries no url param", () => {
		expect(pendingSaveHostFrom("/save")).toBeUndefined();
	});

	it("returns undefined when the article URL does not parse", () => {
		expect(pendingSaveHostFrom("/save?url=not-a-url")).toBeUndefined();
	});

	it("returns undefined instead of throwing when the return URL itself is unparseable (backslash forces an invalid authority)", () => {
		expect(pendingSaveHostFrom("/\\[")).toBeUndefined();
	});

	it("returns undefined for a hostless article URL such as mailto:", () => {
		expect(pendingSaveHostFrom("/save?url=mailto%3Aa%40b.com")).toBeUndefined();
	});
});
