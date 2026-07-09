import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { runPdfSaveScenario } from "browser-extension-core/e2e";
import { waitForServer, SUITE_FAILSAFE_MS } from "browser-extension-core/e2e-actions";

const TEST_EMAIL = "pdf-e2e-test@example.com";
const TEST_PASSWORD = "testpassword123";
assert(process.env.E2E_PORT, "E2E_PORT is required");
const TEST_PORT = Number(process.env.E2E_PORT);
const ORIGIN = `http://127.0.0.1:${TEST_PORT}`;

// The suite must always end: a test cancelled by --test-timeout skips its
// teardown, and the orphaned e2e-server child then holds this process open
// forever (observed hanging a 20x soak for 12+ minutes against a 90s test
// timeout). Reap the server group on any exit, and hard-exit past the
// failsafe deadline. unref() keeps the timer itself from holding the loop.
function armSuiteFailsafe(server: ChildProcess): void {
	const reapServerGroup = () => {
		if (server.pid === undefined || server.exitCode !== null) return;
		try {
			process.kill(-server.pid, "SIGKILL");
		} catch {
			server.kill("SIGKILL");
		}
	};
	process.on("exit", reapServerGroup);
	setTimeout(() => {
		console.error(`suite failsafe: still running after ${SUITE_FAILSAFE_MS}ms, force-exiting`);
		reapServerGroup();
		process.exit(1);
	}, SUITE_FAILSAFE_MS).unref();
}

async function startTestServer(): Promise<ChildProcess> {
	// detached:true gives the spawned process its own group so the
	// e2e-server is killed when the harness exits.
	const child = spawn("pnpm", ["nx", "run", "hutch:e2e-server"], {
		env: {
			...process.env,
			E2E_PORT: String(TEST_PORT),
			NODE_ENV: "test",
			NX_DAEMON: "false",
		},
		// Keep the server off fd 1: it carries node --test's serialized reporter
		// protocol, which a grandchild's raw writes corrupt. fd 2 is safe diagnostics.
		stdio: ["ignore", 2, 2],
		detached: true,
	});
	child.on("error", () => {}); // waitForServer will throw on its own timeout
	await waitForServer(`http://127.0.0.1:${TEST_PORT}/`);
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
	armSuiteFailsafe(server);
	try {
		await runPdfSaveScenario({
			serverUrl: ORIGIN,
			email: TEST_EMAIL,
			password: TEST_PASSWORD,
			pdfUrl: `${ORIGIN}/e2e/fixtures/sample.pdf`,
			expectedTitleSubstring: "READPLACE_E2E_PDF_FIXTURE",
		});
	} finally {
		await stopTestServer(server);
	}
});
