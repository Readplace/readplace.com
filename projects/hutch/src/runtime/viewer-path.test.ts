import { throughEdge, gatewayEvent } from "./viewer-path.test-helper";
import { TEST_EDGE_SECRET } from "./test-app";
import express from "express";
import serverless from "serverless-http";
import {
	createViewerIdentityMiddleware,
	EDGE_SECRET_HEADER,
	VIEWER_PATH_HEADER,
} from "@packages/viewer-identity";

async function invoke(
	app: express.Express,
	input: ReturnType<typeof event>,
	context: object,
) {
	return (await serverless(app)(input, context)) as {
		statusCode: number;
		headers: Record<string, string>;
		body: string;
	};
}

// Model the receiving half of the V2 boundary independently of Express. Edge
// activation and its deployed-function fixtures belong to the second release.
function event(
	path: string,
	method: string,
	query: string,
	preserved?: string,
) {
	return {
		version: "2.0",
		routeKey: "$default",
		rawPath: path,
		rawQueryString: query,
		headers: {
			host: "origin.example",
			[EDGE_SECRET_HEADER]: "edge",
			...(preserved === undefined ? {} : { [VIEWER_PATH_HEADER]: preserved }),
		},
		requestContext: {
			http: { method, path, sourceIp: "203.0.113.1", protocol: "HTTP/1.1" },
		},
		isBase64Encoded: false,
	};
}

it.each([
	"GET",
	"HEAD",
	"POST",
])("restores the reader before routing and observers through the Lambda adapter (%s)", async (method) => {
	const observed: string[] = [];
	const app = express().use(
		createViewerIdentityMiddleware({ edgeSecret: "edge" }),
	);
	app.use((req, _res, next) => {
		observed.push(req.originalUrl);
		next();
	});
	app.all("/view/*article", (req, res) => {
		res
			.set("x-observed-url", req.url)
			.status(req.method === "POST" ? 405 : 200)
			.send("reader");
	});
	const path =
		"/view/https://example.com/embedded/https://original.example/a;b,c+%2F";
	const query = "format=epub&x=&x=a+b&flag";
	const response = await invoke(app, event("/view", method, query, path), {});
	expect(observed).toEqual([`${path}?${query}`]);
	expect(response.headers["x-observed-url"]).toBe(`${path}?${query}`);
	expect(response.statusCode).toBe(method === "POST" ? 405 : 200);
	expect(response.body).toBe(method === "HEAD" ? "" : "reader");
});

it("restores the URL before a host redirect constructs its Location", async () => {
	const app = express().use(
		createViewerIdentityMiddleware({ edgeSecret: "edge" }),
	);
	app.use((req, res) => {
		res.redirect(301, `https://readplace.com${req.originalUrl}`);
	});
	const response = await invoke(
		app,
		event("/view", "GET", "a=1&a=", "/view/example.com/a//b"),
		{},
	);
	expect(response.statusCode).toBe(301);
	expect(response.headers.location).toBe(
		"https://readplace.com/view/example.com/a//b?a=1&a=",
	);
});

it.each(["GET", "HEAD", "POST"])("executes the deployed edge through the real adapter before observers (%s)", async (method) => {
	const app = express().use(createViewerIdentityMiddleware({ edgeSecret: TEST_EDGE_SECRET }));
	const observations: string[] = [];
	app.use((req, res) => {
		observations.push(req.originalUrl);
		res.status(req.method === "POST" ? 405 : 200).set("x-public-url", req.url).send("article");
	});
	const url = "/VIEW/example.com/https://embedded.example/a;b,c+%E2%98%83?x=&x=two+words&flag&format=epub";
	const result = await throughEdge(app, url, { method });
	expect(observations).toEqual([url]);
	expect(result.headers["x-public-url"]).toBe(url);
	expect(result.statusCode).toBe(method === "POST" ? 405 : 200);
	expect(result.body).toBe(method === "HEAD" ? "" : "article");
});

it("retains existing non-reader normalization and supports conditional requests", async () => {
	const app = express().use(createViewerIdentityMiddleware({ edgeSecret: TEST_EDGE_SECRET }));
	app.use((req, res) => { res.set("x-public-url", req.url).send("unchanged body"); });
	const first = await throughEdge(app, "/other/a//b?x=&x=2");
	expect(first.headers["x-public-url"]).toBe("/other/a/b?x=&x=2");
	const cached = await throughEdge(app, "/view/example.com/a//b", { headers: { "if-none-match": first.headers.etag } });
	expect(cached.statusCode).toBe(304);
	expect(cached.headers["x-public-url"]).toBe("/view/example.com/a//b");
});

it.each([5000, 8000])("restores a %i-byte link with browser cookies through the adapter", async (size) => {
	const app = express().use(createViewerIdentityMiddleware({ edgeSecret: TEST_EDGE_SECRET }));
	app.use((req, res) => { res.json({ url: req.originalUrl, cookie: req.headers.cookie }); });
	const path = `/view/example.com/${"a".repeat(size)}`;
	const cookie = `hutch_sid=${"s".repeat(300)}; preferences=${"p".repeat(600)}`;
	const response = await throughEdge(app, path, { headers: { cookie } });
	expect(response.statusCode).toBe(200);
	expect(JSON.parse(response.body)).toEqual({ url: path, cookie });
});

it.each([undefined, "wrong-secret"])("does not trust preservation without the gateway proof: %s", async (proof) => {
	const app = express().use(createViewerIdentityMiddleware({ edgeSecret: TEST_EDGE_SECRET }));
	app.use((req, res) => { res.send(req.url); });
	const input = gatewayEvent("/view/example.com/a//b?x=1");
	if (proof === undefined) delete input.headers[EDGE_SECRET_HEADER];
	else input.headers[EDGE_SECRET_HEADER] = proof;
	const response = await serverless(app)(input, {}) as { body: string; statusCode: number };
	expect(response.statusCode).toBe(200);
	expect(response.body).toBe("/view?x=1");
});
