import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

interface NavState {
	displayUrl: string;
	canGoBack: boolean;
	canGoForward: boolean;
	isReader: boolean;
	loading: boolean;
}

contextBridge.exposeInMainWorld("internetReader", {
	navigate: (input: string): Promise<{ ok: boolean; reason?: string }> =>
		ipcRenderer.invoke("ir:navigate", input),
	back: (): void => ipcRenderer.send("ir:back"),
	forward: (): void => ipcRenderer.send("ir:forward"),
	reload: (): void => ipcRenderer.send("ir:reload"),
	toggleReader: (): void => ipcRenderer.send("ir:toggle-reader"),
	onNavState: (callback: (state: NavState) => void): void => {
		ipcRenderer.on(
			"ir:nav-state",
			(_event: IpcRendererEvent, state: NavState) => callback(state),
		);
	},
	onFocusAddress: (callback: () => void): void => {
		ipcRenderer.on("ir:focus-address", () => callback());
	},
});
