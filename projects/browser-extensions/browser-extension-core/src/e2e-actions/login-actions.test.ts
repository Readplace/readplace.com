import assert from "node:assert/strict";
import { error, Session, WebDriver, WebElement } from "selenium-webdriver";
import { type Command, Name } from "selenium-webdriver/lib/command";
import { createLoginActions } from "./login-actions";

describe("login action availability during navigation", () => {
	it.each(["click-login", "submit-login-form", "approve-oauth"])(
		"keeps polling when %s loses its control between lookup and visibility check",
		async (name) => {
			let detached = true;
			const driver = new WebDriver(new Session("availability", {}), {
				async execute(command: Command) {
					if (command.getName() === Name.FIND_ELEMENT) return WebElement.buildId("control");
					if (command.getName() === Name.IS_ELEMENT_DISPLAYED) {
						if (detached) throw new error.StaleElementReferenceError("The page replaced the control");
						return true;
					}
					throw new Error(`Unexpected command: ${command.getName()}`);
				},
			});
			const action = createLoginActions({
				testEmail: "reader@example.com",
				testPassword: "password",
				popupWindowHandle: "popup",
			}).get(name);
			assert(action);
			await expect(action.isAvailable(driver)).resolves.toBe(false);
			detached = false;
			await expect(action.isAvailable(driver)).resolves.toBe(true);
		},
	);
});
