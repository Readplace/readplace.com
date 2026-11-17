import { getEnv } from "@packages/require-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { Builder } from "selenium-webdriver";
import { Driver } from "selenium-webdriver/firefox";
import {
	waitForServer,
	SUITE_FAILSAFE_MS,
	runCaptureScenarios,
	assertGeckodriverSupportsSystemAccess,
	createFirefoxBrowser,
} from "browser-extension-core/e2e-actions";
import { READY_NONCE_ENV, readyProbePath } from "@packages/e2e-harness/ready-probe";
import { getFreePort } from "@packages/test-phase-runner";

const ADDON_ID = "hutch-extension@hutch-app.com";
const ADDON_UUID = "d3b07384-d113-4ec6-a7b8-5f7e3b4c9a12";
const EXTENSION_DIR = path.resolve(__dirname, "../../../dist-extension-compiled");
const POPUP_URL = `moz-extension://${ADDON_UUID}/popup/popup.template.html`;

const TEST_EMAIL = "tab-switch-e2e-test@example.com";
const TEST_PASSWORD = "testpassword123";
assert(process.env.E2E_PORT, "E2E_PORT is required");
const TEST_PORT = Number(process.env.E2E_PORT);
const READY_NONCE = randomUUID();
const ORIGIN = `http://127.0.0.1:${TEST_PORT}`;
const RUN_ID = randomUUID().replace(/-/g, "");

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
	const child = spawn("pnpm", ["nx", "run", "hutch:e2e-server"], {
		env: {
			...process.env,
			E2E_PORT: String(TEST_PORT),
			[READY_NONCE_ENV]: READY_NONCE,
			NODE_ENV: "test",
			NX_DAEMON: "false",
		},
		stdio: ["ignore", 2, 2],
		detached: true,
	});
	child.on("error", () => {});

	await waitForServer(`http://127.0.0.1:${TEST_PORT}${readyProbePath(READY_NONCE)}`);

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

test("saves the invoking tab, image and PDF tabs, then signs out when the refresh token is forgotten", async () => {
	const server = await startTestServer();
	armSuiteFailsafe(server);
	try {
		const { options, service } = createFirefoxBrowser({ ci: getEnv("CI") === "true" });
		service.setPort(await getFreePort());
		if (process.env.HEADLESS !== "false") {
			options.addArguments("--headless");
		}
		options.setPreference(
			"extensions.webextensions.uuids",
			JSON.stringify({ [ADDON_ID]: ADDON_UUID }),
		);

		assertGeckodriverSupportsSystemAccess();
		const driver = await new Builder()
			.forBrowser("firefox")
			.setFirefoxOptions(options)
			.setFirefoxService(service)
			.build();

		try {
			assert(driver instanceof Driver, "firefox builder must produce a firefox Driver");
			await driver.installAddon(EXTENSION_DIR, true);

			await runCaptureScenarios({
				driver,
				namespace: "browser",
				popupUrl: POPUP_URL,
				serverOrigin: ORIGIN,
				testEmail: TEST_EMAIL,
				testPassword: TEST_PASSWORD,
				runId: RUN_ID,
			});
		} finally {
			await driver.quit();
		}
	} finally {
		await stopTestServer(server);
	}
});
