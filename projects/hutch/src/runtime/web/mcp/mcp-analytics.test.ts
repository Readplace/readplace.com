import { authenticatedUserIdFrom } from "@packages/domain/user";
import type { AnalyticsEvent, RecordUngatedEvent } from "@packages/web-analytics";
import { initRecordMcpHandshake, initRecordMcpToolCall } from "./mcp-analytics";
import type { McpToolCallRecord } from "./mcp-server";

const userId = authenticatedUserIdFrom("00000000000000000000000000000001");

function capture(): {
	recordUngatedAnalyticsEvent: RecordUngatedEvent<AnalyticsEvent>;
	captured: AnalyticsEvent[];
} {
	const captured: AnalyticsEvent[] = [];
	return {
		recordUngatedAnalyticsEvent: (data) => {
			captured.push(data);
		},
		captured,
	};
}

function record(overrides: Partial<McpToolCallRecord> = {}): McpToolCallRecord {
	return {
		tool: "list_queue",
		outcome: "ok",
		userId,
		oauthClientId: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm",
		...overrides,
	};
}

function run(overrides: Partial<McpToolCallRecord> = {}): AnalyticsEvent[] {
	const { recordUngatedAnalyticsEvent, captured } = capture();
	initRecordMcpToolCall({
		recordUngatedAnalyticsEvent,
		now: () => new Date("2026-08-18T00:00:00.000Z"),
	})(record(overrides));
	return captured;
}

describe("initRecordMcpToolCall", () => {
	it("emits one mcp_tool_called for a non-save tool", () => {
		const captured = run();
		expect(captured).toHaveLength(1);
		expect(captured[0]).toMatchObject({
			event: "mcp_tool_called",
			tool: "list_queue",
			outcome: "ok",
			oauth_client_id: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm",
			user_id: userId,
		});
	});

	it("also puts a successful save_link into the shared save funnel as surface=mcp, so MCP saves compare against the extension and the readlist save bar", () => {
		const captured = run({ tool: "save_link", outcome: "ok", submittedUrl: "https://example.com/a" });
		expect(captured).toHaveLength(2);
		expect(captured[1]).toMatchObject({
			event: "view_save_intent",
			surface: "mcp",
			outcome: "saved",
			client: "mcp",
			article_host: "example.com",
			path: "/mcp",
		});
	});

	it.each([["error"], ["paywalled"], ["access_check_failed"]] as const)(
		"records a save_link that did not save as a failed save-intent (outcome=%s)",
		(outcome) => {
			const captured = run({ tool: "save_link", outcome, submittedUrl: "https://example.com/a" });
			expect(captured).toHaveLength(2);
			expect(captured[1]).toMatchObject({ event: "view_save_intent", outcome: "error" });
		},
	);

	it("emits no save-intent for a save_link whose arguments carried no usable url", () => {
		const captured = run({ tool: "save_link", outcome: "error" });
		expect(captured).toHaveLength(1);
		expect(captured[0]).toMatchObject({ event: "mcp_tool_called" });
	});

	it("never records the submitted url itself, only its host", () => {
		const captured = run({
			tool: "save_link",
			outcome: "ok",
			submittedUrl: "https://example.com/secret-path?token=abc",
		});
		const serialized = JSON.stringify(captured);
		expect(serialized).not.toContain("secret-path");
		expect(serialized).not.toContain("abc");
		expect(serialized).toContain("example.com");
	});
});

describe("initRecordMcpHandshake", () => {
	const now = () => new Date("2026-09-12T04:47:00.000Z");

	it("records an initialize as mcp_session_initialized with what the client declared", () => {
		const { recordUngatedAnalyticsEvent, captured } = capture();
		initRecordMcpHandshake({ recordUngatedAnalyticsEvent, now })({
			method: "initialize",
			userId,
			oauthClientId: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm",
			clientProtocolVersion: "2025-06-18",
			clientName: "openai-mcp",
			clientVersion: "1.0.0",
		});
		expect(captured).toEqual([
			{
				stream: "analytics",
				event: "mcp_session_initialized",
				timestamp: "2026-09-12T04:47:00.000Z",
				oauth_client_id: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm",
				user_id: userId,
				client_protocol_version: "2025-06-18",
				client_name: "openai-mcp",
				client_version: "1.0.0",
			},
		]);
	});

	it("leaves the client fields out of the line when the client declared nothing", () => {
		const { recordUngatedAnalyticsEvent, captured } = capture();
		initRecordMcpHandshake({ recordUngatedAnalyticsEvent, now })({
			method: "initialize",
			userId,
			oauthClientId: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm",
			clientProtocolVersion: undefined,
			clientName: undefined,
			clientVersion: undefined,
		});
		expect(JSON.parse(JSON.stringify(captured))).toEqual([
			{
				stream: "analytics",
				event: "mcp_session_initialized",
				timestamp: "2026-09-12T04:47:00.000Z",
				oauth_client_id: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm",
				user_id: userId,
			},
		]);
	});

	it("records a tools/list as mcp_tools_listed with the tool count", () => {
		const { recordUngatedAnalyticsEvent, captured } = capture();
		initRecordMcpHandshake({ recordUngatedAnalyticsEvent, now })({
			method: "tools/list",
			userId,
			oauthClientId: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm",
			toolCount: 12,
		});
		expect(captured).toEqual([
			{
				stream: "analytics",
				event: "mcp_tools_listed",
				timestamp: "2026-09-12T04:47:00.000Z",
				oauth_client_id: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm",
				user_id: userId,
				tool_count: 12,
			},
		]);
	});
});
