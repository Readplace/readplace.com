package com.readplace.android.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import com.readplace.android.core.AuthFlowError
import com.readplace.android.core.WebAuthPresentation

/**
 * Android's stand-in for `ASWebAuthenticationSession`: the authorize URL opens in a
 * Custom Tab — the user's own browser session, so a signed-in Chrome signs them in
 * without retyping — and the redirect comes back as an intent to the singleTask
 * MainActivity, which hands it to the relay this presentation is awaiting.
 *
 * Dismissal is inferred: if the activity resumes with no callback having arrived,
 * the user closed the tab. The tested [AuthCallbackRelay] owns that race ("first
 * signal wins"); this file only launches the tab and registers the relay.
 */
class CustomTabAuth(
	private val activity: Activity,
	private val relays: AuthRelays,
) {
	suspend fun present(authorizeUrl: String): WebAuthPresentation {
		val relay = AuthCallbackRelay()
		relays.begin(relay)
		try {
			try {
				CustomTabsIntent.Builder()
					.setShowTitle(false)
					.build()
					.launchUrl(activity, Uri.parse(authorizeUrl))
			} catch (_: ActivityNotFoundException) {
				return WebAuthPresentation.Failure(AuthFlowError.PresentationFailed.SIGN_IN_PAGE_DID_NOT_OPEN)
			}
			return relay.await()
		} finally {
			relays.end(relay)
		}
	}
}
