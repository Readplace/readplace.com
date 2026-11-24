import assert from "node:assert/strict";
import { type ExcludedIdentities, excludeNonAudienceClauses } from "./excluded-identities";
import { ANALYTICS_LOG_GROUP } from "./log-groups";
import { mcpWidgets } from "./mcp-widgets";

const IDENTITIES: ExcludedIdentities = {
	excludedVisitorIds: ["11111111-1111-4111-8111-111111111111"],
	excludedUserIds: ["22222222222222222222222222222222"],
};

const EXCLUDE = excludeNonAudienceClauses(IDENTITIES).join(" ");
const AUDIENCE_CLAUSES = excludeNonAudienceClauses(IDENTITIES);

const widgets = mcpWidgets({ analyticsLogGroupName: ANALYTICS_LOG_GROUP, identities: IDENTITIES });

describe("mcpWidgets", () => {
	it("reads only the analytics group", () => {
		for (const widget of Object.values(widgets)) {
			assert.deepEqual(widget.logGroupNames, [ANALYTICS_LOG_GROUP]);
		}
	});

	it("drops operator accounts, operator visitors and bots from the tool-call widgets", () => {
		for (const widget of [widgets.toolCalls, widgets.toolCallsPerDay, widgets.calledButNeverSaved]) {
			assert.ok(widget.query.includes(EXCLUDE), `${widget.title} must carry the audience exclusions`);
		}
	});

	it("keeps the transport refusals and handshakes unfiltered by audience, each for its named reason, and every clause on the tool-call widgets", () => {
		const unfiltered = [
			{
				widget: widgets.transportRefusalsPerDay,
				title: "MCP requests refused by the transport — per day by reason × client",
				reason:
					"An operational view of why the MCP transport refused a request: a bare 401 carries no user_id or visitor_id to filter on, and an internal account's refusal is exactly the signal — the plugin-directory scanner's dead credential went unseen for 30 days because nothing recorded these refusals.",
			},
			{
				widget: widgets.handshakes,
				title: "MCP handshakes — initialize and tools/list by declared client",
				reason:
					"An operational view of what an assistant platform's client declares when it connects, grouped by declared name and version rather than counted per reader: a directory scanner may authenticate as an internal account, and its request shape is what this widget exists to show.",
			},
		];
		const named = new Set(unfiltered.map(({ title }) => title));

		for (const { widget, title, reason } of unfiltered) {
			assert.equal(widget.title, title, reason);
			assert.ok(!AUDIENCE_CLAUSES.some((clause) => widget.query.includes(clause)), `${title}: ${reason}`);
		}
		const filterable = Object.values(widgets).filter(({ title }) => !named.has(title));
		assert.equal(filterable.length, 3);
		for (const widget of filterable) {
			assert.ok(AUDIENCE_CLAUSES.every((clause) => widget.query.includes(clause)), `${widget.title} must carry every audience clause`);
		}
	});

	it("counts a save as a successful save_link call", () => {
		assert.ok(widgets.calledButNeverSaved.query.includes(`sum(tool = "save_link" and outcome = "ok") as saves by user_id`));
	});
});
