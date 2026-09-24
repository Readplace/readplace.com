import assert from "node:assert/strict";
import { createFirefoxBrowser } from "./firefox-browser";

describe("Firefox browser selection", () => {
	it("uses both pinned CI executables without host browser or driver discovery", () => {
		const browser = createFirefoxBrowser({ ci: true });
		expect(browser.options.get("moz:firefoxOptions")).toHaveProperty(
			"binary",
			"/opt/firefox/firefox",
		);
		const service = browser.service.build();
		assert("getExecutable" in service);
		assert(typeof service.getExecutable === "function");
		expect(service.getExecutable()).toBe("/opt/geckodriver/geckodriver");
	});

	it("preserves locally installed browser and driver discovery outside CI", () => {
		const browser = createFirefoxBrowser({ ci: false });
		expect(browser.options.get("moz:firefoxOptions")).not.toHaveProperty(
			"binary",
		);
		const service = browser.service.build();
		assert("getExecutable" in service);
		assert(typeof service.getExecutable === "function");
		expect(service.getExecutable()).toBeUndefined();
	});
});
