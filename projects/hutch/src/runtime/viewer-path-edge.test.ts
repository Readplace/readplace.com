import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import {
	EDGE_SECRET_HEADER,
	VIEWER_HOST_HEADER,
	VIEWER_IP_HEADER,
	VIEWER_PATH_HEADER,
} from "@packages/viewer-identity";

it.each([
	"/",
	"/view",
	"/view/https://example.com/a//b",
	"/api/articles",
])("strips caller preservation without activating the rewrite in Release 1: %s", (uri) => {
	// Execute the exact function template deployed by the CDN component.
	const source = readFileSync(
		join(__dirname, "../../src/infra/hutch-ssr-cdn.ts"),
		"utf8",
	);
	const template = source.match(
		/code: (`function handler\(event\) \{[\s\S]*?}`)/,
	)?.[1];
	assert(template, "CDN viewer function template must exist");
	const code = runInNewContext(template, {
		EDGE_SECRET_HEADER,
		VIEWER_HOST_HEADER,
		VIEWER_IP_HEADER,
		VIEWER_PATH_HEADER,
	});
	const request = {
		uri,
		method: "POST",
		body: { data: "unchanged" },
		querystring: {
			x: { value: "one", multiValue: [{ value: "one" }, { value: "" }] },
		},
		headers: {
			host: { value: "readplace.com" },
			[EDGE_SECRET_HEADER]: { value: "spoof" },
			[VIEWER_PATH_HEADER]: { value: "/view/spoof" },
		},
	};
	const result = runInNewContext(`${code}; handler(event)`, {
		event: { request, viewer: { ip: "203.0.113.1" } },
	});
	expect(result).toBe(request);
	expect(result.uri).toBe(uri);
	expect(result.method).toBe("POST");
	expect(result.body).toEqual({ data: "unchanged" });
	expect(result.querystring).toEqual({
		x: { value: "one", multiValue: [{ value: "one" }, { value: "" }] },
	});
	expect(result.headers[VIEWER_PATH_HEADER]).toBeUndefined();
	expect(result.headers[EDGE_SECRET_HEADER]).toBeUndefined();
	expect(result.headers[VIEWER_HOST_HEADER].value).toBe("readplace.com");
	expect(result.headers[VIEWER_IP_HEADER].value).toBe("203.0.113.1");
});
