import { OFFLINE_READER_SCOPE, OFFLINE_READER_WORKER_PATH, initOfflineReader } from "./offline-reader.client";

describe("initOfflineReader", () => {
	it("registers the offline worker once, over the readlist and every reader under it, checking its script past the HTTP cache", () => {
		const registrations: Array<{ scriptUrl: string; options: { scope: string; updateViaCache: string } }> = [];

		initOfflineReader({
			serviceWorker: {
				async register(scriptUrl, options) {
					registrations.push({ scriptUrl, options });
				},
			},
			scriptUrl: OFFLINE_READER_WORKER_PATH,
			scope: OFFLINE_READER_SCOPE,
		});

		expect(registrations).toEqual([
			{
				scriptUrl: "/client-dist/offline-reader-worker.client.js",
				options: { scope: "/queue", updateViaCache: "none" },
			},
		]);
	});
});
