import assert from "node:assert/strict";
import express from "express";
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

describe("buildHarness", () => {
	it("listens on an ephemeral port and preserves the result's own fields", async () => {
		const harness = buildHarness({ app: createPingApp(), label: "extra" });

		assert.equal(harness.label, "extra");
		assert.equal(harness.server.listening, true);

		await harness.close();
		assert.equal(harness.server.listening, false);
	});

	it("close destroys keep-alive sockets so an in-flight agent can't keep the server open", async () => {
		const harness = buildHarness({ app: createPingApp() });
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

	it("builds a fresh harness from the fixture", () => {
		const harness = useApp({ label: "first" });

		assert.equal(harness.label, "first");
		assert.equal(harness.server.listening, true);
		previous = harness;
	});

	it("closes every harness the previous test created via its afterEach", () => {
		assert(previous, "the previous test must have stored its harness");
		assert.equal(previous.server.listening, false);
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
