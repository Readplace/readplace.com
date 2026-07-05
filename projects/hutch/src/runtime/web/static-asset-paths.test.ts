import { CLIENT_DIST_MOUNT_PATH, isStaticAssetRequestPath } from "./static-asset-paths";

describe("isStaticAssetRequestPath", () => {
	it("exposes the /client-dist mount path as a single source of truth for server.ts", () => {
		expect(CLIENT_DIST_MOUNT_PATH).toBe("/client-dist");
	});

	it.each([
		"/client-dist",
		"/client-dist/toast.client.js",
		"/client-dist/view-paywall.client.js.map",
		"/toast.client.js",
		"/extension-suggestion-banner.client.js",
		"/progress-bar.client.js.map",
		"/apple-touch-icon.png",
		"/apple-touch-icon-120x120-precomposed.png",
	])("classifies %s as a static asset", (path) => {
		expect(isStaticAssetRequestPath(path)).toBe(true);
	});

	it.each([
		"/",
		"/queue",
		"/view/fagnerbrack.com/learn-sql-9aceb0bdee03",
		"/view/example.com/image.png",
		"/fagnerbrack.com/photo.png",
		"/example.com",
		"/https:/fagnerbrack.com/post",
	])("does not classify reader-shaped path %s as a static asset", (path) => {
		expect(isStaticAssetRequestPath(path)).toBe(false);
	});
});
