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

describe("returning from OAuth", () => {
	it.each(["saved-view", "list-view"])(
		"waits for a visible %s before returning control to the flow",
		async (terminalView) => {
			const states = ["popup-shell", "login-view", "saving-view", "list-skeleton-view", "hidden-terminal", terminalView];
			const observed: string[] = [];
			let current = "";
			const driver = new WebDriver(new Session("oauth-return", {}), {
				async execute(command: Command) {
					if (command.getName() === Name.SWITCH_TO_WINDOW) {
						expect(command.getParameters().handle).toBe("popup");
						return;
					}
					if (command.getName() === Name.FIND_ELEMENTS) {
						expect(command.getParameters().value).toBe("#saved-view:not([hidden]), #list-view:not([hidden])");
						current = states[observed.length];
						observed.push(current);
						return current === terminalView || current === "hidden-terminal"
							? [WebElement.buildId(terminalView)]
							: [];
					}
					if (command.getName() === Name.IS_ELEMENT_DISPLAYED) return current === terminalView;
					throw new Error(`Unexpected command: ${command.getName()}`);
				},
			});
			const action = createLoginActions({
				testEmail: "reader@example.com",
				testPassword: "password",
				popupWindowHandle: "popup",
			}).get("switch-to-popup");
			assert(action);

			await action.execute(driver);

			expect(observed).toEqual(states);
		},
	);
});
