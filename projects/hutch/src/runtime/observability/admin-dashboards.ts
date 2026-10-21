import { authDiagnosticsWidgets } from "../auth-diagnostics/dashboard";
import type { ExcludedIdentities } from "./excluded-identities";
import { hnStarterWidgets } from "./hn-starter-widgets";
import type { LogWidgetSpec } from "./log-widget-spec.types";
import { mcpWidgets } from "./mcp-widgets";
import { oauthTokenWidgets } from "./oauth-token-widgets";

export const ADMIN_DASHBOARD_SLUGS = ["hn-experiment", "mcp", "login"] as const;

export type AdminDashboardSlug = (typeof ADMIN_DASHBOARD_SLUGS)[number];

export interface AdminDashboard {
	title: string;
	description: string;
	usesExclusions: boolean;
	widgets: (identities: ExcludedIdentities) => readonly LogWidgetSpec[];
}

export function buildAdminDashboards(deps: {
	analyticsLogGroupName: string;
	authDiagnosticsLogGroupName: string;
}): Record<AdminDashboardSlug, AdminDashboard> {
	const { analyticsLogGroupName } = deps;
	return {
		"hn-experiment": {
			title: "Hacker News experiment",
			description: "Starter assignments, delivery, reader activity and the experiment's latest report.",
			usesExclusions: true,
			widgets: (identities) => {
				const hn = hnStarterWidgets({ analyticsLogGroupName, identities });
				return [
					hn.latestReport,
					hn.latestReportByCohort,
					hn.activatedOverTime,
					hn.deliveryOutcomes,
					hn.readerActivity,
					hn.unsubscribesByArm,
				];
			},
		},
		mcp: {
			title: "Connected AI assistants (MCP)",
			description: "Tool calls, transport refusals and handshakes from connected assistants.",
			usesExclusions: true,
			widgets: (identities) => {
				const mcp = mcpWidgets({ analyticsLogGroupName, identities });
				return [
					mcp.toolCalls,
					mcp.toolCallsPerDay,
					mcp.calledButNeverSaved,
					mcp.transportRefusalsPerDay,
					mcp.handshakes,
				];
			},
		},
		login: {
			title: "Login",
			description: "OAuth token grants and revocations, and the authentication diagnostics clients report.",
			usesExclusions: false,
			widgets: () => {
				const oauth = oauthTokenWidgets({ analyticsLogGroupName });
				return [
					oauth.tokenGrants,
					oauth.revocationsPerDay,
					...Object.values(authDiagnosticsWidgets({ logGroupName: deps.authDiagnosticsLogGroupName })),
				];
			},
		},
	};
}
