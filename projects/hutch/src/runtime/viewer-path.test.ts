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
