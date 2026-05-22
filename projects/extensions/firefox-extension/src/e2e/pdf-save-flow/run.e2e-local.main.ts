import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { runPdfSaveScenario } from "browser-extension-core/e2e";

const TEST_EMAIL = "pdf-e2e-test@example.com";
const TEST_PASSWORD = "testpassword123";
assert(process.env.E2E_PORT, "E2E_PORT is required");
const TEST_PORT = Number(process.env.E2E_PORT);
const ORIGIN = `http://127.0.0.1:${TEST_PORT}`;

async function waitForServer(port: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
			return;
		} catch {
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	throw new Error(`e2e server did not start on port ${port} within ${timeoutMs}ms`);
}

async function startTestServer(): Promise<ChildProcess> {
	// Same pnpm-nx invocation as the login-flow harness: see
	// projects/extensions/firefox-extension/src/e2e/login-flow/run.e2e-local.main.ts
	// for the rationale on NX_DAEMON=false and detached:true (process-group
	// cleanup so the e2e-server is killed when the harness exits).
	const child = spawn("pnpm", ["nx", "run", "hutch:e2e-server"], {
		env: {
			...process.env,
			E2E_PORT: String(TEST_PORT),
			NODE_ENV: "test",
			NX_DAEMON: "false",
		},
		stdio: "inherit",
		detached: true,
	});
	child.on("error", () => {}); // waitForServer will throw on its own timeout
	await waitForServer(TEST_PORT, 30_000);
	const userRes = await fetch(`${ORIGIN}/e2e/users`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
	});
	assert.equal(
		userRes.status,
		201,
		`POST /e2e/users returned ${userRes.status} (expected 201)`,
	);
	return child;
}

async function stopTestServer(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.pid === undefined) return;
	const pid = child.pid;
	const killGroup = (signal: NodeJS.Signals) => {
		try {
			process.kill(-pid, signal);
		} catch {
			child.kill(signal);
		}
	};
	await new Promise<void>((resolve) => {
		const cleanExit = () => resolve();
		child.once("exit", cleanExit);
		killGroup("SIGTERM");
		setTimeout(() => {
			killGroup("SIGKILL");
			child.off("exit", cleanExit);
			resolve();
		}, 5_000).unref();
	});
}

test("extension should save a PDF URL end-to-end via the Siren walker", async () => {
	const server = await startTestServer();
	try {
		await runPdfSaveScenario({
			serverUrl: ORIGIN,
			email: TEST_EMAIL,
			password: TEST_PASSWORD,
			pdfUrl: `${ORIGIN}/e2e/fixtures/sample.pdf`,
			expectedTitleSubstring: "READPLACE_E2E_PDF_FIXTURE",
			pollTimeoutMs: 30_000,
		});
	} finally {
		await stopTestServer(server);
	}
});
