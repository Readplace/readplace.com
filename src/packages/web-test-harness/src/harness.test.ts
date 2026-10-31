import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";
import type { CreateUser } from "@packages/provider-contracts/auth";
import { UserIdSchema } from "@packages/domain/user";
import { buildHarness, loginAgent, useTestServer } from "./harness";

function createPingApp() {
	const app = express();
	app.get("/ping", (_req, res) => {
		res.status(200).send("pong");
	});
	return app;
}

function boundAddress(server: Server): AddressInfo {
	const address = server.address();
	assert(address && typeof address !== "string", "a listening TCP server reports an AddressInfo");
	return address;
}

describe("buildHarness", () => {
	it("listens on 127.0.0.1 only, on an ephemeral port, and preserves the result's own fields", async () => {
		const harness = await buildHarness({ app: createPingApp(), label: "extra" });

		assert.equal(harness.label, "extra");
		assert.equal(harness.server.listening, true);
		assert.equal(boundAddress(harness.server).address, "127.0.0.1");
		assert.equal(boundAddress(harness.server).family, "IPv4");
		assert.equal((await request(harness.server).get("/ping")).status, 200);

		await harness.close();
		assert.equal(harness.server.listening, false);
	});

	it("close destroys keep-alive sockets so an in-flight agent can't keep the server open", async () => {
		const harness = await buildHarness({ app: createPingApp() });
		const agent = await loginAgent(harness.server, {
			createUser: async () => ({ ok: true, userId: UserIdSchema.parse("user-1") }),
		});
		await agent.get("/ping");

		await harness.close();
		assert.equal(harness.server.listening, false);
	});
});

describe("useTestServer", () => {
	const useApp = useTestServer((fixture: { label: string }) => ({
		app: createPingApp(),
		label: fixture.label,
	}));
	let previous: ReturnType<typeof useApp> | undefined;

	it("hands out a server already bound to 127.0.0.1 when the test body runs, so a request in the same tick reaches it", async () => {
		const harness = useApp({ label: "first" });
		const address = boundAddress(harness.server);

		assert.equal(address.address, "127.0.0.1");
		assert.equal(address.family, "IPv4");
		const response = await request(harness.server).get("/ping");
		assert.equal(response.status, 200);
		assert.equal(harness.server.listening, true);
		assert.deepEqual(harness.server.address(), address);
		assert.equal(harness.label, "first");
		previous = harness;
	});

	it("closes every harness the previous test created via its afterEach", () => {
		assert(previous, "the previous test must have stored its harness");
		assert.equal(previous.server.listening, false);
	});

	it("builds 9 harnesses in one test, each on its own 127.0.0.1 port, and refuses the 10th", () => {
		const harnesses = Array.from({ length: 9 }, (_, i) => useApp({ label: `h${i}` }));

		const ports = harnesses.map((h) => {
			const address = boundAddress(h.server);
			assert.equal(address.address, "127.0.0.1");
			return address.port;
		});
		assert.equal(new Set(ports).size, 9);
		assert.throws(() => useApp({ label: "extra" }), { message: /binds 9 servers in its beforeEach/ });
	});
});

describe("loginAgent", () => {
	const useApp = useTestServer((handlers: {
		onLogin: (credentials: { email: string; password: string }) => void;
	}) => {
		const app = express();
		app.use(express.urlencoded({ extended: false }));
		app.post("/login", (req, res) => {
			handlers.onLogin({ email: req.body.email, password: req.body.password });
			res.cookie("session", "logged-in").status(204).end();
		});
		app.get("/me", (req, res) => {
			res.status(req.headers.cookie?.includes("session=logged-in") ? 200 : 401).end();
		});
		return { app };
	});

	it("creates the well-known user, posts the login form, and returns a cookie-holding agent", async () => {
		const created: { email: string; password: string }[] = [];
		const logins: { email: string; password: string }[] = [];
		const createUser: CreateUser = async (credentials) => {
			created.push(credentials);
			return { ok: true, userId: UserIdSchema.parse("user-1") };
		};
		const harness = useApp({ onLogin: (credentials) => logins.push(credentials) });

		const agent = await loginAgent(harness.server, { createUser });

		assert.deepEqual(created, [{ email: "test@example.com", password: "password123" }]);
		assert.deepEqual(logins, [{ email: "test@example.com", password: "password123" }]);
		const authenticated = await agent.get("/me");
		assert.equal(authenticated.status, 200);
	});
});
