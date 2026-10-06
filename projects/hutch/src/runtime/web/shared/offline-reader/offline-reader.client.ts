export { OFFLINE_READER_WORKER_PATH } from "../../static-asset-paths";
export { OFFLINE_READER_SCOPE } from "./offline-cache";

export interface OfflineReaderDeps {
	serviceWorker: {
		register(scriptUrl: string, options: { scope: string; updateViaCache: "none" }): Promise<unknown>;
	};
	scriptUrl: string;
	scope: string;
}

export function initOfflineReader(deps: OfflineReaderDeps): void {
	deps.serviceWorker.register(deps.scriptUrl, { scope: deps.scope, updateViaCache: "none" });
}
