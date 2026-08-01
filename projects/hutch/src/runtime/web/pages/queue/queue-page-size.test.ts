import { SUPPORTED_CLIENTS } from "@packages/supported-clients";
import {
	EXTENSION_QUEUE_PAGE_SIZE,
	QUEUE_PAGE_SIZE,
	queuePageSizeForClient,
} from "./queue-page-size";

describe("queuePageSizeForClient", () => {
	it("pages every browser extension at the size its popup displays", () => {
		const extensionClientIds = SUPPORTED_CLIENTS.filter(
			(client) => client.group === "browserExtension",
		).map((client) => (client.auth.kind === "builtIn" ? client.auth.oauthClientId : client.name));

		const sizes = extensionClientIds.map((clientId) => queuePageSizeForClient(clientId));

		expect(sizes).toEqual(extensionClientIds.map(() => EXTENSION_QUEUE_PAGE_SIZE));
	});

	it("keeps the iPhone app on the default size", () => {
		expect(queuePageSizeForClient("ios-app")).toBe(QUEUE_PAGE_SIZE);
	});

	it("keeps a cookie session with no bearer on the default size", () => {
		expect(queuePageSizeForClient(undefined)).toBe(QUEUE_PAGE_SIZE);
	});

	it("keeps a dynamically registered client on the default size", () => {
		expect(queuePageSizeForClient("dyn-registered-mcp-client")).toBe(QUEUE_PAGE_SIZE);
	});
});
