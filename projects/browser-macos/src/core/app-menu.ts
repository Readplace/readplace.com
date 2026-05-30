import type { MenuItemConstructorOptions } from "electron";

interface MenuActions {
	reload: () => void;
	back: () => void;
	forward: () => void;
	toggleReader: () => void;
	focusAddressBar: () => void;
	newWindow: () => void;
}

interface MenuTemplateInput {
	appName: string;
	isMac: boolean;
	actions: MenuActions;
}

/**
 * The native macOS menu bar. Navigation items drive the embedded webview
 * through injected `actions` (assigned by reference so there is no wrapper
 * closure to leave untested); the rest are standard Electron roles, which is
 * what gives the window its native Cut/Copy/Paste, zoom, and window controls.
 */
export function buildMenuTemplate(
	input: MenuTemplateInput,
): MenuItemConstructorOptions[] {
	const { appName, isMac, actions } = input;

	const appMenu: MenuItemConstructorOptions[] = isMac
		? [
				{
					label: appName,
					submenu: [
						{ role: "about" },
						{ type: "separator" },
						{ role: "hide" },
						{ role: "hideOthers" },
						{ role: "unhide" },
						{ type: "separator" },
						{ role: "quit" },
					],
				},
			]
		: [];

	return [
		...appMenu,
		{
			label: "File",
			submenu: [
				{
					label: "New Window",
					accelerator: "CmdOrCtrl+N",
					click: actions.newWindow,
				},
				{ type: "separator" },
				isMac ? { role: "close" } : { role: "quit" },
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				{
					label: "Reload Page",
					accelerator: "CmdOrCtrl+R",
					click: actions.reload,
				},
				{
					label: "Toggle Reader / Live",
					accelerator: "CmdOrCtrl+Shift+R",
					click: actions.toggleReader,
				},
				{ type: "separator" },
				{ label: "Back", accelerator: "CmdOrCtrl+[", click: actions.back },
				{
					label: "Forward",
					accelerator: "CmdOrCtrl+]",
					click: actions.forward,
				},
				{ type: "separator" },
				{
					label: "Open Location…",
					accelerator: "CmdOrCtrl+L",
					click: actions.focusAddressBar,
				},
				{ type: "separator" },
				{ role: "togglefullscreen" },
				{ role: "toggleDevTools" },
			],
		},
		{
			label: "Window",
			submenu: [{ role: "minimize" }, { role: "zoom" }],
		},
	];
}
