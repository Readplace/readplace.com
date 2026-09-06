import type { Server } from "node:http";
import type { Express } from "express";
import type { CreateUser } from "@packages/provider-contracts/auth";
import request from "supertest";

export interface RunningServer {
	server: Server;
	close: () => Promise<void>;
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
export function buildHarness<Result extends { app: Express }>(
	result: Result,
): Result & RunningServer {
	const server = result.app.listen(0);
	return {
		...result,
		server,
		close: () => new Promise<void>((resolve) => {
			server.closeAllConnections();
			server.close(() => resolve());
		}),
	};
}

/** Per-suite factory that registers an `afterEach` to close every harness it
 * creates. Call once at module scope (or describe scope) and use the returned
 * function inside `it()` to build a fresh test server — the cleanup is
 * transparent so tests don't have to thread `close()` through finally blocks
 * or hoist fixture creation into `beforeEach` just for lifecycle reasons. */
export function useTestServer<Fixture, Result extends { app: Express }>(
	createResult: (fixture: Fixture) => Result,
): (fixture: Fixture) => Result & RunningServer {
	const harnesses: RunningServer[] = [];
	afterEach(async () => {
		const toClose = harnesses.splice(0);
		await Promise.all(toClose.map((h) => h.close()));
	});
	return (fixture) => {
		const harness = buildHarness(createResult(fixture));
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
