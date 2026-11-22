import assert from "node:assert/strict";
import { type ExcludedIdentities, excludeNonAudienceClauses } from "./excluded-identities";
import { ANALYTICS_LOG_GROUP } from "./log-groups";
import { oauthTokenWidgets } from "./oauth-token-widgets";

const widgets = oauthTokenWidgets({ analyticsLogGroupName: ANALYTICS_LOG_GROUP });

const IDENTITIES: ExcludedIdentities = {
	excludedVisitorIds: ["11111111-1111-4111-8111-111111111111"],
	excludedUserIds: ["22222222222222222222222222222222"],
};

const AUDIENCE_CLAUSES = excludeNonAudienceClauses(IDENTITIES);

describe("oauthTokenWidgets", () => {
	it("reads only the analytics group", () => {
		for (const widget of Object.values(widgets)) {
			assert.deepEqual(widget.logGroupNames, [ANALYTICS_LOG_GROUP]);
		}
	});

	it("shows grants as a table and revocations per day as a time series", () => {
		assert.equal(widgets.tokenGrants.view, "table");
		assert.equal(widgets.revocationsPerDay.view, "timeSeries");
	});

	it("leaves grants and revocations unfiltered by audience, each for its named reason", () => {
		const unfiltered = [
			{
				widget: widgets.tokenGrants,
				title: "OAuth token grants — issued vs refused by client",
				reason:
					"An operational auth view keyed on the OAuth client id, not on a reader identity: the oauth_token_issued/refused events carry neither visitor_id nor user_id, and an internal-account refresh storm must still count toward the sign-out alarm this widget backs.",
			},
			{
				widget: widgets.revocationsPerDay,
				title: "OAuth token revocations — per day by client × outcome",
				reason:
					"The twin of the token-grants table, keyed on the OAuth client id rather than a reader identity: the oauth_token_revoked event carries neither visitor_id nor user_id, and an internal account's revoke must stay visible because it is the evidence that rules a client-side revoke in or out when an assistant's credential dies.",
			},
		];

		assert.equal(Object.keys(widgets).length, unfiltered.length);
		for (const { widget, title, reason } of unfiltered) {
			assert.equal(widget.title, title, reason);
			assert.ok(!AUDIENCE_CLAUSES.some((clause) => widget.query.includes(clause)), `${title}: ${reason}`);
		}
	});
});
