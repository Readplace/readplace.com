import { obtainAccessToken, runPdfSaveScenario } from "./pdf-save-scenario";

type Route = { status: number; body?: string; headers?: Record<string, string> };
type RouteHandler = Route | ((init?: RequestInit) => Route);

function createRoutingFetch(routes: Record<string, RouteHandler>): {
	fetchFn: typeof fetch;
	calls: string[];
	bodies: string[];
} {
	const calls: string[] = [];
	const bodies: string[] = [];
	const fetchFn: typeof fetch = async (input, init) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const method = init?.method ?? "GET";
		const key = `${method} ${url}`;
		calls.push(key);
		if (typeof init?.body === "string") bodies.push(init.body);
		const handler = routes[key];
		if (!handler) throw new Error(`Unexpected fetch: ${key}`);
		const route = typeof handler === "function" ? handler(init) : handler;
		const headers = new Headers(route.headers);
		return new Response(route.body ?? null, {
			status: route.status,
			headers,
		});
	};
	return { fetchFn, calls, bodies };
}

const SERVER = "http://server.test";

function authRoutes(overrides?: Partial<Record<string, RouteHandler>>): Record<string, RouteHandler> {
	return {
		[`POST ${SERVER}/login`]: {
			status: 303,
			headers: {
				location: "/queue",
				"set-cookie": "rp_session=abc123; Path=/; HttpOnly, other=value",
			},
		},
		[`POST ${SERVER}/oauth/authorize`]: {
			status: 303,
			headers: { location: "http://127.0.0.1:3000/oauth/callback?code=AUTH_CODE&state=xyz" },
		},
		[`POST ${SERVER}/oauth/token`]: {
			status: 200,
			body: JSON.stringify({ access_token: "OAUTH_BEARER" }),
		},
		...overrides,
	};
}

describe("obtainAccessToken", () => {
	it("returns the token from the oauth/token response after login + authorize", async () => {
		const { fetchFn, calls, bodies } = createRoutingFetch(authRoutes());
		const token = await obtainAccessToken({
			serverUrl: SERVER,
			email: "e@x.com",
			password: "pw",
			fetchFn,
		});
		expect(token).toBe("OAUTH_BEARER");
		expect(calls[0]).toBe(`POST ${SERVER}/login`);
		expect(bodies[0]).toContain("email=e%40x.com");
		expect(bodies[0]).toContain("password=pw");
		expect(calls[1]).toBe(`POST ${SERVER}/oauth/authorize`);
		expect(bodies[1]).toContain("client_id=hutch-chrome-extension");
		expect(bodies[1]).toContain("action=approve");
		expect(calls[2]).toBe(`POST ${SERVER}/oauth/token`);
		expect(bodies[2]).toContain("code=AUTH_CODE");
		expect(bodies[2]).toContain("grant_type=authorization_code");
	});

	it("re-sends the session cookie on the oauth/authorize call", async () => {
		let authorizeCookie: string | null = null;
		const routes = authRoutes({
			[`POST ${SERVER}/oauth/authorize`]: (init) => {
				authorizeCookie = new Headers(init?.headers).get("cookie");
				return {
					status: 303,
					headers: { location: "http://127.0.0.1:3000/oauth/callback?code=C&state=s" },
				};
			},
		});
		const { fetchFn } = createRoutingFetch(routes);
		await obtainAccessToken({ serverUrl: SERVER, email: "e", password: "p", fetchFn });
		expect(authorizeCookie).toContain("rp_session=abc123");
		expect(authorizeCookie).toContain("other=value");
	});

	it("uses globalThis.fetch when no fetchFn is provided", async () => {
		const original = globalThis.fetch;
		const { fetchFn } = createRoutingFetch(authRoutes());
		globalThis.fetch = fetchFn;
		try {
			const token = await obtainAccessToken({ serverUrl: SERVER, email: "e", password: "p" });
			expect(token).toBe("OAUTH_BEARER");
		} finally {
			globalThis.fetch = original;
		}
	});

	it("rejects when the login response status is outside 2xx/3xx", async () => {
		const { fetchFn } = createRoutingFetch({
			[`POST ${SERVER}/login`]: { status: 422, body: "invalid" },
		});
		await expect(
			obtainAccessToken({ serverUrl: SERVER, email: "e", password: "p", fetchFn }),
		).rejects.toThrow(/POST \/login returned 422/);
	});

	it("rejects when /login does not return a session cookie", async () => {
		const { fetchFn } = createRoutingFetch({
			[`POST ${SERVER}/login`]: { status: 303, headers: { location: "/queue" } },
		});
		await expect(
			obtainAccessToken({ serverUrl: SERVER, email: "e", password: "p", fetchFn }),
		).rejects.toThrow(/did not return a session cookie/);
	});

	it("rejects when /login set-cookie has no parseable name=value pairs", async () => {
		const { fetchFn } = createRoutingFetch({
			[`POST ${SERVER}/login`]: {
				status: 303,
				headers: { location: "/queue", "set-cookie": " " },
			},
		});
		await expect(
			obtainAccessToken({ serverUrl: SERVER, email: "e", password: "p", fetchFn }),
		).rejects.toThrow();
	});

	it("rejects when /oauth/authorize does not redirect", async () => {
		const { fetchFn } = createRoutingFetch(
			authRoutes({
				[`POST ${SERVER}/oauth/authorize`]: { status: 400, body: "bad" },
			}),
		);
		await expect(
			obtainAccessToken({ serverUrl: SERVER, email: "e", password: "p", fetchFn }),
		).rejects.toThrow(/POST \/oauth\/authorize must redirect/);
	});

	it("rejects when the authorize redirect lacks a code parameter", async () => {
		const { fetchFn } = createRoutingFetch(
			authRoutes({
				[`POST ${SERVER}/oauth/authorize`]: {
					status: 303,
					headers: { location: "http://127.0.0.1:3000/oauth/callback?state=s" },
				},
			}),
		);
		await expect(
			obtainAccessToken({ serverUrl: SERVER, email: "e", password: "p", fetchFn }),
		).rejects.toThrow(/authorize redirect missing code/);
	});

	it("rejects when /oauth/token returns non-200", async () => {
		const { fetchFn } = createRoutingFetch(
			authRoutes({
				[`POST ${SERVER}/oauth/token`]: { status: 401, body: "denied" },
			}),
		);
		await expect(
			obtainAccessToken({ serverUrl: SERVER, email: "e", password: "p", fetchFn }),
		).rejects.toThrow(/POST \/oauth\/token returned 401/);
	});

	it("rejects when /oauth/token response is missing access_token", async () => {
		const { fetchFn } = createRoutingFetch(
			authRoutes({
				[`POST ${SERVER}/oauth/token`]: { status: 200, body: JSON.stringify({}) },
			}),
		);
		await expect(
			obtainAccessToken({ serverUrl: SERVER, email: "e", password: "p", fetchFn }),
		).rejects.toThrow(/token response missing access_token/);
	});
});

const SIREN = "application/vnd.siren+json";
const PDF_URL = "https://pdf.test/sample.pdf";
const SAVED_ID = "saved-pdf-id";
const STUB_TITLE = "Article from pdf.test";
const READY_TITLE = "READPLACE_E2E_PDF_FIXTURE";

function articleEntity(title: string) {
	return {
		class: ["article"],
		rel: ["item"],
		properties: { id: SAVED_ID, url: PDF_URL, title, savedAt: "2026-05-19T00:00:00.000Z" },
		links: [{ rel: ["read"], href: `/queue/${SAVED_ID}/read` }],
		actions: [{ name: "delete", href: `/queue/${SAVED_ID}/delete`, method: "POST" }],
	};
}

function collectionResponse(items: unknown[]) {
	return JSON.stringify({
		class: ["collection", "articles"],
		entities: items,
		links: [{ rel: ["self"], href: "/queue" }],
		actions: [
			{
				name: "save-article",
				href: "/queue",
				method: "POST",
				type: "application/json",
				fields: [{ name: "url", type: "url" }],
			},
			{
				name: "search",
				href: "/queue",
				method: "GET",
				fields: [{ name: "url", type: "url" }],
			},
		],
	});
}

function sirenWalkerRoutes(opts: {
	collectionResponses: string[];
}): Record<string, RouteHandler> {
	let walkerCallIndex = 0;
	const handler: RouteHandler = () => {
		const body = opts.collectionResponses[walkerCallIndex] ?? opts.collectionResponses[opts.collectionResponses.length - 1];
		walkerCallIndex += 1;
		return { status: 200, body, headers: { "content-type": SIREN } };
	};
	return {
		[`GET ${SERVER}/`]: handler,
		[`GET ${SERVER}/queue`]: handler,
	};
}

describe("runPdfSaveScenario", () => {
	it("polls until the saved article's title contains the expected substring", async () => {
		const collections = [
			collectionResponse([]),
			collectionResponse([articleEntity(STUB_TITLE)]),
			collectionResponse([articleEntity(STUB_TITLE)]),
			collectionResponse([articleEntity(READY_TITLE)]),
		];
		const routes = {
			...authRoutes(),
			...sirenWalkerRoutes({ collectionResponses: collections }),
			[`POST ${SERVER}/queue`]: {
				status: 201,
				body: JSON.stringify(articleEntity(STUB_TITLE)),
				headers: { "content-type": SIREN },
			},
		};
		const { fetchFn } = createRoutingFetch(routes);
		await runPdfSaveScenario({
			serverUrl: SERVER,
			email: "e",
			password: "p",
			pdfUrl: PDF_URL,
			expectedTitleSubstring: "READPLACE_E2E_PDF",
			fetchFn,
			pollIntervalMs: 1,
			pollTimeoutMs: 5_000,
		});
	});

	it("times out when the title never converges to the expected substring", async () => {
		const collections = [
			collectionResponse([]),
			collectionResponse([articleEntity(STUB_TITLE)]),
		];
		const routes = {
			...authRoutes(),
			...sirenWalkerRoutes({ collectionResponses: collections }),
			[`POST ${SERVER}/queue`]: {
				status: 201,
				body: JSON.stringify(articleEntity(STUB_TITLE)),
				headers: { "content-type": SIREN },
			},
		};
		const { fetchFn } = createRoutingFetch(routes);
		await expect(
			runPdfSaveScenario({
				serverUrl: SERVER,
				email: "e",
				password: "p",
				pdfUrl: PDF_URL,
				expectedTitleSubstring: "WILL_NEVER_APPEAR",
				fetchFn,
				pollIntervalMs: 1,
				pollTimeoutMs: 20,
			}),
		).rejects.toThrow(/Timed out after 20ms.*Last observed title: "Article from pdf\.test"/);
	});

	it("uses default poll interval/timeout when not provided", async () => {
		const collections = [
			collectionResponse([]),
			collectionResponse([articleEntity(READY_TITLE)]),
		];
		const routes = {
			...authRoutes(),
			...sirenWalkerRoutes({ collectionResponses: collections }),
			[`POST ${SERVER}/queue`]: {
				status: 201,
				body: JSON.stringify(articleEntity(READY_TITLE)),
				headers: { "content-type": SIREN },
			},
		};
		const { fetchFn } = createRoutingFetch(routes);
		await runPdfSaveScenario({
			serverUrl: SERVER,
			email: "e",
			password: "p",
			pdfUrl: PDF_URL,
			expectedTitleSubstring: "READPLACE_E2E_PDF",
			fetchFn,
		});
	});

	it("uses globalThis.fetch when no fetchFn is provided", async () => {
		const collections = [
			collectionResponse([]),
			collectionResponse([articleEntity(READY_TITLE)]),
		];
		const routes = {
			...authRoutes(),
			...sirenWalkerRoutes({ collectionResponses: collections }),
			[`POST ${SERVER}/queue`]: {
				status: 201,
				body: JSON.stringify(articleEntity(READY_TITLE)),
				headers: { "content-type": SIREN },
			},
		};
		const original = globalThis.fetch;
		const { fetchFn } = createRoutingFetch(routes);
		globalThis.fetch = fetchFn;
		try {
			await runPdfSaveScenario({
				serverUrl: SERVER,
				email: "e",
				password: "p",
				pdfUrl: PDF_URL,
				expectedTitleSubstring: "READPLACE_E2E_PDF",
				pollIntervalMs: 1,
				pollTimeoutMs: 5_000,
			});
		} finally {
			globalThis.fetch = original;
		}
	});

	it("rejects when saveUrl returns ok:false", async () => {
		const collections = [collectionResponse([])];
		const collectionWithBlockedSave = JSON.stringify({
			class: ["collection", "articles"],
			properties: { warning: { code: "blocked", message: "no" } },
			entities: [],
			links: [{ rel: ["self"], href: "/queue" }],
			actions: [],
		});
		const routes = {
			...authRoutes(),
			...sirenWalkerRoutes({ collectionResponses: collections }),
			[`POST ${SERVER}/queue`]: {
				status: 422,
				body: collectionWithBlockedSave,
				headers: { "content-type": SIREN },
			},
		};
		const { fetchFn } = createRoutingFetch(routes);
		await expect(
			runPdfSaveScenario({
				serverUrl: SERVER,
				email: "e",
				password: "p",
				pdfUrl: PDF_URL,
				expectedTitleSubstring: "X",
				fetchFn,
				pollIntervalMs: 1,
				pollTimeoutMs: 1_000,
			}),
		).rejects.toThrow(/saveUrl failed/);
	});

	it("rejects when the saved article disappears from the queue mid-poll", async () => {
		const collections = [
			collectionResponse([]),
			collectionResponse([articleEntity(STUB_TITLE)]),
			collectionResponse([]),
		];
		const routes = {
			...authRoutes(),
			...sirenWalkerRoutes({ collectionResponses: collections }),
			[`POST ${SERVER}/queue`]: {
				status: 201,
				body: JSON.stringify(articleEntity(STUB_TITLE)),
				headers: { "content-type": SIREN },
			},
		};
		const { fetchFn } = createRoutingFetch(routes);
		await expect(
			runPdfSaveScenario({
				serverUrl: SERVER,
				email: "e",
				password: "p",
				pdfUrl: PDF_URL,
				expectedTitleSubstring: "X",
				fetchFn,
				pollIntervalMs: 1,
				pollTimeoutMs: 5_000,
			}),
		).rejects.toThrow(/disappeared from the queue/);
	});

	it("propagates a 401 from a Siren call as Unauthorized", async () => {
		const collections = [collectionResponse([])];
		const routes = {
			...authRoutes(),
			...sirenWalkerRoutes({ collectionResponses: collections }),
			[`POST ${SERVER}/queue`]: {
				status: 401,
				body: "",
				headers: { "content-type": SIREN },
			},
		};
		const { fetchFn } = createRoutingFetch(routes);
		await expect(
			runPdfSaveScenario({
				serverUrl: SERVER,
				email: "e",
				password: "p",
				pdfUrl: PDF_URL,
				expectedTitleSubstring: "X",
				fetchFn,
				pollIntervalMs: 1,
				pollTimeoutMs: 1_000,
			}),
		).rejects.toThrow(/Unauthorized while running pdf-save scenario/);
	});
});
