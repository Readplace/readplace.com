import { parseRenderProxy } from "./parse-render-proxy";

describe("parseRenderProxy", () => {
	it("splits an egress proxy URL into the browser's proxy server and its credentials", () => {
		expect(parseRenderProxy("http://zone-user:zone-secret@proxy.example.test:22225")).toEqual({
			server: "http://proxy.example.test:22225",
			username: "zone-user",
			password: "zone-secret",
		});
	});

	it("decodes percent-encoded credentials", () => {
		expect(parseRenderProxy("https://zone%3Auser:p%40ss@proxy.example.test")).toEqual({
			server: "https://proxy.example.test",
			username: "zone:user",
			password: "p@ss",
		});
	});

	it("refuses a proxy URL that is not http(s)", () => {
		expect(() => parseRenderProxy("socks5://zone-user:zone-secret@proxy.example.test:1080")).toThrow(
			"Egress proxy URL must be http(s), got socks5:",
		);
	});

	it("refuses a proxy URL without credentials", () => {
		expect(() => parseRenderProxy("http://proxy.example.test:22225")).toThrow(
			"Egress proxy URL must carry user:password credentials",
		);
	});
});
