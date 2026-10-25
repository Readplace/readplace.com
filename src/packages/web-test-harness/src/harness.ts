import assert from "node:assert";
import { createServer, type Server } from "node:http";
import type { Express } from "express";
import type { CreateUser } from "@packages/provider-contracts/auth";
import request from "supertest";

export interface RunningServer {
	server: Server;
	close: () => Promise<void>;
}

const SERVERS_BOUND_PER_TEST = 9;

function listenOnLoopback(): Promise<Server> {
	const server = createServer();
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve(server));
	});
}

/** server.close only invokes the callback with an error when the socket was
 * never bound — which can't happen below because we always reach here after
 * listen(0). Treat the callback as completion regardless of the err arg so
 * coverage doesn't carry a phantom reject branch.
 *
 * closeAllConnections() is called first to immediately destroy keep-alive
 * sockets. Without it, server.close() waits for sockets to drain naturally,
 * which can outlast jest's worker shutdown timeout and cause force-exits that
 * truncate V8 coverage shards below the 99% threshold. */
function closeServer(server: Server): Promise<void> {
	return new Promise<void>((resolve) => {
		server.closeAllConnections();
		server.close(() => resolve());
	});
}

function serveOn<Result extends { app: Express }>(server: Server, result: Result): Result & RunningServer {
	server.on("request", result.app);
	return { ...result, server, close: () => closeServer(server) };
}

export async function buildHarness<Result extends { app: Express }>(
	result: Result,
): Promise<Result & RunningServer> {
	return serveOn(await listenOnLoopback(), result);
}

/** Per-suite factory that registers an `afterEach` to close every harness it
 * creates. Call once at module scope (or describe scope) and use the returned
 * function inside `it()` to build a fresh test server — the cleanup is
 * transparent so tests don't have to thread `close()` through finally blocks
 * or hoist fixture creation into `beforeEach` just for lifecycle reasons. */
export function useTestServer<Fixture, Result extends { app: Express }>(
	createResult: (fixture: Fixture) => Result,
): (fixture: Fixture) => Result & RunningServer {
	const bound: Server[] = [];
	const harnesses: RunningServer[] = [];
	beforeEach(async () => {
		bound.push(...(await Promise.all(Array.from({ length: SERVERS_BOUND_PER_TEST }, listenOnLoopback))));
	});
	afterEach(async () => {
		await Promise.all([...harnesses.splice(0).map((h) => h.close()), ...bound.splice(0).map(closeServer)]);
	});
	return (fixture) => {
		const server = bound.shift();
		assert(
			server,
			`useTestServer binds ${SERVERS_BOUND_PER_TEST} servers in its beforeEach; this test asked for more, or called the builder outside that hook's scope`,
		);
		const harness = serveOn(server, createResult(fixture));
		harnesses.push(harness);
		return harness;
	};
}

export const BROWSER_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

export async function loginAgent(
	server: Server,
	auth: { createUser: CreateUser },
) {
	await auth.createUser({ email: "test@example.com", password: "password123" });
	const agent = request.agent(server).set("User-Agent", BROWSER_USER_AGENT);
	await agent
		.post("/login")
		.type("form")
		.send({ email: "test@example.com", password: "password123" });
	return agent;
}
