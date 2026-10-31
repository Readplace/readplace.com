import { addToReadlistOfferForClient } from "./add-to-readlist-offer";

describe("addToReadlistOfferForClient", () => {
	it("withholds add-to-readlist from the Firefox extension, whose AMO-signed build renders every item action as a button and posts it without readlists", () => {
		expect(addToReadlistOfferForClient("hutch-firefox-extension")).toBe("withheld");
	});

	it.each(["hutch-chrome-extension", "ios-app", "android-app"])("advertises add-to-readlist to %s", (clientId) => {
		expect(addToReadlistOfferForClient(clientId)).toBe("advertised");
	});

	it("advertises add-to-readlist to a cookie session with no bearer", () => {
		expect(addToReadlistOfferForClient(undefined)).toBe("advertised");
	});

	it("advertises add-to-readlist to a dynamically registered client", () => {
		expect(addToReadlistOfferForClient("dyn-registered-mcp-client")).toBe("advertised");
	});
});
