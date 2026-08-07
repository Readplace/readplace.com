import { safeReturnPath } from "./safe-return-path";

describe("safeReturnPath", () => {
	it("returns / when there is no return path", () => {
		expect(safeReturnPath(undefined)).toBe("/");
	});

	it("returns / when the return path is not a string (e.g. a duplicated form field)", () => {
		expect(safeReturnPath(["/queue", "/account"])).toBe("/");
	});

	it("returns the path and query for a root-relative return path", () => {
		expect(safeReturnPath("/queue?filter=unread")).toBe("/queue?filter=unread");
	});

	it("returns / for an absolute, cross-origin URL", () => {
		expect(safeReturnPath("https://evil.example/queue")).toBe("/");
	});

	it("returns / for a protocol-relative authority a browser would resolve off-site", () => {
		expect(safeReturnPath("//evil.example/queue")).toBe("/");
	});

	it("returns / for a path that normalises to a // authority", () => {
		expect(safeReturnPath("/..//evil.example")).toBe("/");
	});

	it("returns / for an unparseable return path", () => {
		expect(safeReturnPath("http://[")).toBe("/");
	});
});
