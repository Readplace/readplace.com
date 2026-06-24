/** The detail page's tab scaffold. M2 ships the View tab; the Articles tab is
 * present but renders an M3 placeholder. Adding the M3 behaviour fills the
 * Articles panel without touching this list or the route (Open/Closed). */
export const MAIL_TAB_DEFINITIONS = [
	{ key: "view", label: "View" },
	{ key: "articles", label: "Articles" },
] as const;

export type MailTabKey = (typeof MAIL_TAB_DEFINITIONS)[number]["key"];

export interface MailTab {
	key: MailTabKey;
	label: string;
	ariaCurrent: "page" | undefined;
}

export function buildMailTabs(active: MailTabKey): MailTab[] {
	return MAIL_TAB_DEFINITIONS.map(({ key, label }) => ({
		key,
		label,
		ariaCurrent: key === active ? "page" : undefined,
	}));
}
