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
	// NX_DAEMON=false and detached:true keep the spawned server in its own process
	// group so it is killed when the harness exits.
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

test("extension should save a PDF's captured bytes end-to-end via save-content", async () => {
	const server = await startTestServer();
	armSuiteFailsafe(server);
	try {
		const pdfUrl = `${ORIGIN}/e2e/fixtures/sample.pdf`;
		const fixture = await fetch(pdfUrl);
		assert.equal(fixture.status, 200, `PDF fixture must be served from ${pdfUrl}`);
		const uploadBytes = await fixture.arrayBuffer();

		let multipartPosts = 0;
		let jsonPosts = 0;
		const spyFetch: typeof fetch = async (input, init) => {
			if ((init?.method ?? "GET") === "POST") {
				if (init?.body instanceof FormData) multipartPosts += 1;
				const contentType = new Headers(init?.headers).get("content-type");
				if (contentType?.includes("application/json")) jsonPosts += 1;
			}
			return fetch(input, init);
		};

		await runPdfSaveScenario({
			serverUrl: ORIGIN,
			email: TEST_EMAIL,
			password: TEST_PASSWORD,
			pdfUrl,
			uploadBytes,
			expectedTitleSubstring: "READPLACE_E2E_PDF_FIXTURE",
			fetchFn: spyFetch,
		});

		assert.equal(
			multipartPosts,
			1,
			"the byte-upload rung must POST one multipart body — the title poll alone cannot distinguish an upload from a URL-only fallback, because the server crawls the same fixture to the same title",
		);
		assert.equal(
			jsonPosts,
			0,
			"no JSON save may fire — one would mean the upload was refused and the walker degraded onto the URL-only fallback",
		);
	} finally {
		await stopTestServer(server);
	}
});

test("extension should save a large PDF end-to-end via the presigned upload slot", async () => {
	const server = await startTestServer();
	armSuiteFailsafe(server);
	try {
		const pdfUrl = `${ORIGIN}/e2e/fixtures/large.pdf`;
		const fixture = await fetch(pdfUrl);
		assert.equal(fixture.status, 200, `large PDF fixture must be served from ${pdfUrl}`);
		const uploadBytes = await fixture.arrayBuffer();
		assert.ok(uploadBytes.byteLength > 3 * 1024 * 1024, "fixture must exceed the direct-upload budget");

		let slotPosts = 0;
		let completionPosts = 0;
		let s3Puts = 0;
		let jsonPosts = 0;
		let putCarriedAuth = false;
		const spyFetch: typeof fetch = async (input, init) => {
			const method = init?.method ?? "GET";
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const headers = new Headers(init?.headers);
			if (method === "POST" && init?.body instanceof FormData) {
				if (init.body.has("uploaded")) completionPosts += 1;
				else if (init.body.has("size")) slotPosts += 1;
			}
			if (method === "POST" && headers.get("content-type")?.includes("application/json")) jsonPosts += 1;
			if (method === "PUT" && url.includes("/e2e/s3/")) {
				s3Puts += 1;
				if (headers.get("authorization")) putCarriedAuth = true;
			}
			return fetch(input, init);
		};

		await runPdfSaveScenario({
			serverUrl: ORIGIN,
			email: TEST_EMAIL,
			password: TEST_PASSWORD,
			pdfUrl,
			uploadBytes,
			expectedTitleSubstring: "READPLACE_E2E_PDF_FIXTURE",
			fetchFn: spyFetch,
		});

		assert.equal(slotPosts, 1, "exactly one upload-slot request must fire");
		assert.equal(s3Puts, 1, "the bytes must be PUT once to the presigned S3 URL");
		assert.equal(completionPosts, 1, "exactly one completion must fire");
		assert.equal(jsonPosts, 0, "no URL-only fallback may fire — that would mean the slot flow failed");
		assert.equal(putCarriedAuth, false, "the S3 PUT must not carry a bearer token");
	} finally {
		await stopTestServer(server);
	}
});
