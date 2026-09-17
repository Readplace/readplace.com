/* c8 ignore start -- transport fixture, executes the deployed edge template */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import type { Express } from "express";
import serverless from "serverless-http";
import { EDGE_SECRET_HEADER, VIEWER_HOST_HEADER, VIEWER_IP_HEADER, VIEWER_PATH_HEADER } from "@packages/viewer-identity";
import { TEST_EDGE_SECRET } from "./test-app";

export function edgeRequest(uri: string, headers: Record<string, { value: string }> = {}) {
	const source = readFileSync(join(__dirname, "../../src/infra/hutch-ssr-cdn.ts"), "utf8");
	const template = source.match(/code: (`function handler\(event\) \{[\s\S]*?}`)/)?.[1];
	assert(template, "CDN function template must exist");
	const code = runInNewContext(template, { EDGE_SECRET_HEADER, VIEWER_HOST_HEADER, VIEWER_IP_HEADER, VIEWER_PATH_HEADER });
	const request = { uri, method: "POST", body: { data: "payload" }, querystring: { x: { value: "one", multiValue: [{ value: "one" }, { value: "" }] } }, headers: { host: { value: "localhost:3000" }, ...headers } as Record<string, { value: string }> };
	return runInNewContext(`${code}; handler(event)`, { event: { request, viewer: { ip: "203.0.113.9" } } }) as typeof request;
}

// Model the gateway's slash collapse independently of the edge preservation logic.
export function gatewayEvent(url: string, options: { method?: string; headers?: Record<string, string>; preservation?: boolean } = {}) {
	const queryAt = url.indexOf("?");
	const uri = queryAt === -1 ? url : url.slice(0, queryAt);
	const rawQueryString = queryAt === -1 ? "" : url.slice(queryAt + 1);
	const inputHeaders = Object.fromEntries(Object.entries(options.headers ?? {}).map(([name, value]) => [name.toLowerCase(), { value }]));
	const edge = edgeRequest(uri, inputHeaders);
	const headers = Object.fromEntries(Object.entries(edge.headers).map(([name, header]) => [name, header.value]));
	// Turning off transport reproduces the original defect, without changing routing.
	if (options.preservation === false) { edge.uri = uri; delete headers[VIEWER_PATH_HEADER]; }
	const rawPath = edge.uri.replace(/\/{2,}/g, "/");
	headers[EDGE_SECRET_HEADER] = TEST_EDGE_SECRET;
	headers["x-forwarded-proto"] = "http";
	return { version: "2.0", routeKey: "$default", rawPath, rawQueryString, headers,
		requestContext: { http: { method: options.method ?? "GET", path: rawPath, sourceIp: "203.0.113.9", protocol: "HTTP/1.1" } }, isBase64Encoded: false };
}

export async function throughEdge(app: Express, url: string, options: Parameters<typeof gatewayEvent>[1] = {}) {
	return await serverless(app, { binary: ["application/epub\\+zip"] })(gatewayEvent(url, options), {}) as {
		statusCode: number; headers: Record<string, string>; body: string; isBase64Encoded: boolean;
	};
}
/* c8 ignore stop */
