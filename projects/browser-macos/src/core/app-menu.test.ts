import assert from "node:assert/strict";
import type { MenuItemConstructorOptions } from "electron";
import { buildMenuTemplate } from "./app-menu";

function makeActions() {
	return {
		reload: () => undefined,
		back: () => undefined,
		forward: () => undefined,
		toggleReader: () => undefined,
		focusAddressBar: () => undefined,
		newWindow: () => undefined,
	};
}

function submenuOf(
	template: MenuItemConstructorOptions[],
	label: string,
): MenuItemConstructorOptions[] {
	const submenu = template.find((item) => item.label === label)?.submenu;
	return Array.isArray(submenu) ? submenu : [];
}

describe("buildMenuTemplate", () => {
	it("includes the application menu and a Close item on macOS", () => {
		const actions = makeActions();
		const template = buildMenuTemplate({
			appName: "Internet Reader",
			isMac: true,
			actions,
		});

		assert.equal(template[0].label, "Internet Reader");

		const file = submenuOf(template, "File");
		assert.equal(
			file.find((item) => item.label === "New Window")?.click,
			actions.newWindow,
		);
		assert.ok(file.some((item) => item.role === "close"));

		const view = submenuOf(template, "View");
		assert.equal(
			view.find((item) => item.label === "Reload Page")?.click,
			actions.reload,
		);
		assert.equal(
			view.find((item) => item.label === "Back")?.click,
			actions.back,
		);
		assert.equal(
			view.find((item) => item.label === "Forward")?.click,
			actions.forward,
		);
		assert.equal(
			view.find((item) => item.label === "Toggle Reader / Live")?.click,
			actions.toggleReader,
		);
		assert.equal(
			view.find((item) => item.label === "Open Location…")?.click,
			actions.focusAddressBar,
		);
	});

	it("omits the application menu and uses Quit off macOS", () => {
		const template = buildMenuTemplate({
			appName: "Internet Reader",
			isMac: false,
			actions: makeActions(),
		});
		assert.equal(template[0].label, "File");
		assert.ok(submenuOf(template, "File").some((item) => item.role === "quit"));
	});
});
