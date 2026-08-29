import { SUPPORTED_CLIENTS } from "@packages/supported-clients";
import {
	EXTENSION_READLIST_PAGE_SIZE,
	READLIST_PAGE_SIZE,
	readlistPageSizeForClient,
} from "./readlist-page-size";

describe("readlistPageSizeForClient", () => {
	it("pages every browser extension at the size its popup displays", () => {
		const extensionClientIds = SUPPORTED_CLIENTS.filter(
			(client) => client.group === "browserExtension",
		).map((client) => (client.auth.kind === "builtIn" ? client.auth.oauthClientId : client.name));

		const sizes = extensionClientIds.map((clientId) => readlistPageSizeForClient(clientId));

		expect(sizes).toEqual(extensionClientIds.map(() => EXTENSION_READLIST_PAGE_SIZE));
	});

	it("keeps the iPhone app on the default size", () => {
		expect(readlistPageSizeForClient("ios-app")).toBe(READLIST_PAGE_SIZE);
	});

	it("keeps a cookie session with no bearer on the default size", () => {
		expect(readlistPageSizeForClient(undefined)).toBe(READLIST_PAGE_SIZE);
	});

	it("keeps a dynamically registered client on the default size", () => {
		expect(readlistPageSizeForClient("dyn-registered-mcp-client")).toBe(READLIST_PAGE_SIZE);
	});
});
