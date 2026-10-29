import assert from "node:assert";
import type { RenderProxy } from "./render-page.types";

const PROXY_PROTOCOLS = new Set(["http:", "https:"]);

export function parseRenderProxy(proxyUrl: string): RenderProxy {
	const parsed = new URL(proxyUrl);
	assert(PROXY_PROTOCOLS.has(parsed.protocol), `Egress proxy URL must be http(s), got ${parsed.protocol}`);
	assert(parsed.username !== "" && parsed.password !== "", "Egress proxy URL must carry user:password credentials");
	return {
		server: `${parsed.protocol}//${parsed.host}`,
		username: decodeURIComponent(parsed.username),
		password: decodeURIComponent(parsed.password),
	};
}
