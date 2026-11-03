import assert from "node:assert/strict";
import { browserLaunchArgs } from "./browser-launch-args";

const inheritedArgs = ["--no-sandbox", "--single-process"];
const proxy = { server: "http://brd.superproxy.io:33335", username: "brd-customer-c1-zone-z1", password: "secret-pass" };

describe("browserLaunchArgs", () => {
	it("adds no proxy flags for a direct render", () => {
		assert.deepEqual(browserLaunchArgs({ inheritedArgs, egress: { kind: "direct" } }), [
			"--no-sandbox",
			"--single-process",
			"--block-new-web-contents",
		]);
	});

	it("routes a residential render through the proxy server with normal TLS and no credentials", () => {
		assert.deepEqual(browserLaunchArgs({ inheritedArgs, egress: { kind: "residential", proxy } }), [
			"--no-sandbox",
			"--single-process",
			"--block-new-web-contents",
			"--proxy-server=http://brd.superproxy.io:33335",
		]);
	});

	it("routes a web unlocker render through the proxy server and accepts its certificate, with no credentials", () => {
		assert.deepEqual(browserLaunchArgs({ inheritedArgs, egress: { kind: "web-unlocker", proxy } }), [
			"--no-sandbox",
			"--single-process",
			"--block-new-web-contents",
			"--proxy-server=http://brd.superproxy.io:33335",
			"--ignore-certificate-errors",
		]);
	});
});
