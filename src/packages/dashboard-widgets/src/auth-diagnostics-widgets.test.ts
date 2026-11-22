import assert from "node:assert/strict";
import { AUTH_DIAGNOSTICS_LOG_GROUP, authDiagnosticsWidgets } from "./auth-diagnostics-widgets";

const widgets = authDiagnosticsWidgets({ logGroupName: AUTH_DIAGNOSTICS_LOG_GROUP });

describe("authDiagnosticsWidgets", () => {
	it("reads only the auth-diagnostics stream of the given group, as tables", () => {
		for (const widget of Object.values(widgets)) {
			assert.deepEqual(widget.logGroupNames, ["/readplace/auth-diagnostics"]);
			assert.ok(widget.query.startsWith(`filter stream = "auth-diagnostics"`), widget.title);
			assert.equal(widget.view, "table");
		}
	});

	it("names five widgets in a fixed order", () => {
		assert.deepEqual(Object.keys(widgets), [
			"authenticationFailures",
			"interruptedRefreshCheckpoints",
			"repeatedTransportRequests",
			"sessionDeletionAndBridgeFailures",
			"journalAndStorageHealth",
		]);
	});

	it("builds the authentication investigation views in order", () => {
		const queries = Object.values(widgets).map(({ query }) => query);
		const expected = [
			"count_distinct(event_id)",
			"latest(client_version) as last_client_version",
			"count_distinct(request_id)",
			"session_deleted",
			"maximum_dropped",
		];

		assert.equal(queries.length, expected.length);
		expected.forEach((fragment, index) => {
			assert.ok(queries[index].includes(fragment), `widget ${index} must contain ${fragment}`);
		});
	});
});
