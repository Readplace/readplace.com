import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { DisconnectGmail } from "./disconnect-gmail";
import { initLocalGmailCommands } from "./local-gmail-commands";
import type { RewriteGmailFilter } from "./rewrite-gmail-filter";

const USER = UserIdSchema.parse("user-1");

type LoggedCall = { level: "info" | "warn" | "error" | "debug"; args: unknown[] };

function capturingLogger() {
	const calls: LoggedCall[] = [];
	const at = (level: LoggedCall["level"]) => (...args: unknown[]) => {
		calls.push({ level, args });
	};
	const logger: HutchLogger = { info: at("info"), warn: at("warn"), error: at("error"), debug: at("debug") };
	return { calls, logger };
}

const disconnectStub: DisconnectGmail = async () => ({ ok: true, filterRemoved: true, grantRevoked: true });
const rewriteStub: RewriteGmailFilter = async () => ({ ok: true, filterCount: 1, senderCount: 1 });

describe("initLocalGmailCommands", () => {
	describe("publishRewriteGmailFilter", () => {
		it("logs the filter and sender counts and the reason on success", async () => {
			const { calls, logger } = capturingLogger();
			const rewriteGmailFilter: RewriteGmailFilter = async () => ({ ok: true, filterCount: 2, senderCount: 5 });

			await initLocalGmailCommands({ rewriteGmailFilter, disconnectGmail: disconnectStub, logger }).publishRewriteGmailFilter({
				userId: USER,
				reason: "sender-added",
			});

			assert.deepEqual(calls, [
				{
					level: "info",
					args: ["[rewrite-gmail-filter] filter reconciled", { userId: USER, filterCount: 2, senderCount: 5, reason: "sender-added" }],
				},
			]);
		});

		it("warns when Gmail is unavailable", async () => {
			const { calls, logger } = capturingLogger();
			const rewriteGmailFilter: RewriteGmailFilter = async () => ({ ok: false, reason: "unavailable", status: 503 });

			await initLocalGmailCommands({ rewriteGmailFilter, disconnectGmail: disconnectStub, logger }).publishRewriteGmailFilter({
				userId: USER,
				reason: "sender-removed",
			});

			assert.deepEqual(calls, [
				{ level: "warn", args: ["[rewrite-gmail-filter] gmail unavailable", { userId: USER, status: 503 }] },
			]);
		});

		it("logs an error for any other failure", async () => {
			const { calls, logger } = capturingLogger();
			const rewriteGmailFilter: RewriteGmailFilter = async () => ({ ok: false, reason: "rejected", message: "Gmail rejected the query" });

			await initLocalGmailCommands({ rewriteGmailFilter, disconnectGmail: disconnectStub, logger }).publishRewriteGmailFilter({
				userId: USER,
				reason: "forwarding-confirmed",
			});

			assert.deepEqual(calls, [
				{ level: "error", args: ["[rewrite-gmail-filter] filter not written", { userId: USER, reason: "rejected" }] },
			]);
		});
	});

	describe("publishDisconnectGmail", () => {
		it("reports what was removed and revoked on success", async () => {
			const { calls, logger } = capturingLogger();
			const disconnectGmail: DisconnectGmail = async () => ({ ok: true, filterRemoved: true, grantRevoked: false });

			await initLocalGmailCommands({ rewriteGmailFilter: rewriteStub, disconnectGmail, logger }).publishDisconnectGmail({ userId: USER });

			assert.deepEqual(calls, [
				{ level: "info", args: ["[disconnect-gmail] disconnected", { userId: USER, filterRemoved: true, grantRevoked: false }] },
			]);
		});

		it("warns when Google is unavailable", async () => {
			const { calls, logger } = capturingLogger();
			const disconnectGmail: DisconnectGmail = async () => ({ ok: false, reason: "unavailable" });

			await initLocalGmailCommands({ rewriteGmailFilter: rewriteStub, disconnectGmail, logger }).publishDisconnectGmail({ userId: USER });

			assert.deepEqual(calls, [{ level: "warn", args: ["[disconnect-gmail] google unavailable", { userId: USER }] }]);
		});

		it("warns when there is nothing to disconnect", async () => {
			const { calls, logger } = capturingLogger();
			const disconnectGmail: DisconnectGmail = async () => ({ ok: false, reason: "not-connected" });

			await initLocalGmailCommands({ rewriteGmailFilter: rewriteStub, disconnectGmail, logger }).publishDisconnectGmail({ userId: USER });

			assert.deepEqual(calls, [{ level: "warn", args: ["[disconnect-gmail] nothing to disconnect", { userId: USER }] }]);
		});
	});
});
