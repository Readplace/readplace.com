import { isAppUrl } from "./is-app-url";

describe("isAppUrl", () => {
	it("returns true when the tab hostname is one of the app domains", () => {
		expect(
			isAppUrl({ tabUrl: "https://readplace.com/queue", appDomains: ["readplace.com"] }),
		).toBe(true);
	});

	it("returns true for 127.0.0.1 on any port", () => {
		expect(isAppUrl({ tabUrl: "http://127.0.0.1:3000/queue", appDomains: ["readplace.com"] })).toBe(true);
		expect(isAppUrl({ tabUrl: "http://127.0.0.1:4000/queue", appDomains: ["readplace.com"] })).toBe(true);
	});

	it("returns true for localhost on any port", () => {
		expect(isAppUrl({ tabUrl: "http://localhost:3000/queue", appDomains: ["readplace.com"] })).toBe(true);
		expect(isAppUrl({ tabUrl: "http://localhost:8080/queue", appDomains: ["readplace.com"] })).toBe(true);
	});

	it("returns false for a domain not in the list", () => {
		expect(
			isAppUrl({ tabUrl: "https://example.com/article", appDomains: ["readplace.com"] }),
		).toBe(false);
	});

	it("returns false for invalid tab URL", () => {
		expect(isAppUrl({ tabUrl: "not-a-url", appDomains: ["readplace.com"] })).toBe(false);
	});

	it("returns true for nested paths on an app domain", () => {
		expect(
			isAppUrl({ tabUrl: "https://readplace.com/read/abc123", appDomains: ["readplace.com"] }),
		).toBe(true);
	});

	it("returns false for subdomains not explicitly listed", () => {
		expect(
			isAppUrl({ tabUrl: "https://static.readplace.com/favicon.ico", appDomains: ["readplace.com"] }),
		).toBe(false);
	});

	it("returns false when appDomains is empty and URL is not localhost", () => {
		expect(isAppUrl({ tabUrl: "https://readplace.com/", appDomains: [] })).toBe(false);
	});
});
