/** The deep links a native app's web view intercepts (and cancels) rather than
 * navigating to. These strings are every shipped app's interception rules, so
 * they are a contract with builds already on users' phones: a rename here
 * silently strips the control from every installed build. They name no platform
 * precisely so a second app implements the same two rules rather than minting
 * its own pair. */

/** Closes the in-app web sheet, returning the user to the native reading list.
 * The chromeless reader's, account page's and add-links help page's back links all
 * point here — one close contract every in-app sheet shares. */
const READER_CLOSE_HREF = "readplace://reader/close";

export const APP_BACK_LINK = {
	topHref: READER_CLOSE_HREF,
	label: "Back to readlist",
} as const;

/** Dismisses the sheet and signs the user out locally. Deleting the account
 * destroys every session server-side, so the app must drop its own token rather
 * than paint the logged-out marketing home inside the sheet. */
export const ACCOUNT_LOGOUT_HREF = "readplace://account/logout";
