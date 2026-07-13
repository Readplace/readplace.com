/** The deep links the iOS app's WKWebView delegate intercepts (and cancels)
 * rather than navigating to. These strings are the shipped app's interception
 * rules, so they are a contract with builds already on users' phones: a rename
 * here silently strips the control from every installed build. */

/** Closes the in-app web sheet, returning the user to the native reading list.
 * The chromeless reader's and the chromeless account page's back link point here. */
const READER_CLOSE_HREF = "readplace://reader/close";

export const APP_BACK_LINK = {
	topHref: READER_CLOSE_HREF,
	label: "← Back to queue",
} as const;

/** Dismisses the sheet and signs the user out locally. Deleting the account
 * destroys every session server-side, so the app must drop its own token rather
 * than paint the logged-out marketing home inside the sheet. */
export const ACCOUNT_LOGOUT_HREF = "readplace://account/logout";
