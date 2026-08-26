package com.readplace.android.app

import com.readplace.android.core.WebAuthPresentation
import kotlinx.coroutines.CompletableDeferred

/**
 * Relays the auth presentation's two ways back into the app onto the flow's
 * outcome. Android has no `ASWebAuthenticationSession` handing the callback to its
 * caller: the `readplace://oauth-callback` redirect re-enters the app as an
 * intent, and the user closing the sign-in page re-enters it as a plain resume
 * carrying no callback, which maps to [WebAuthPresentation.Dismissed].
 *
 * The first signal wins. A completed sign-in delivers the callback intent *and*
 * then resumes the activity, so the resume that follows a callback must not turn
 * a success into a dismissal; any later signal has no presentation left to answer.
 */
class AuthCallbackRelay {
	private val outcome = CompletableDeferred<WebAuthPresentation>()

	fun onCallback(callbackUrl: String) {
		outcome.complete(WebAuthPresentation.Returned(callbackUrl))
	}

	fun onResumedWithoutCallback() {
		outcome.complete(WebAuthPresentation.Dismissed)
	}

	suspend fun await(): WebAuthPresentation = outcome.await()
}

/**
 * The single in-flight relay the activity forwards its lifecycle signals to. One at
 * a time: a second sign-in cannot start while a tab is open, so a stale relay can
 * never swallow a fresh callback. Launching the tab pauses and stops the activity
 * without resuming it, so the first resume while a relay is registered is the
 * user coming back — with the callback already delivered by `onNewIntent`, or
 * with nothing, which is the dismissal.
 */
class AuthRelays {
	private var current: AuthCallbackRelay? = null

	fun begin(relay: AuthCallbackRelay) {
		current = relay
	}

	fun end(relay: AuthCallbackRelay) {
		if (current === relay) current = null
	}

	fun onCallback(url: String) {
		current?.onCallback(url)
	}

	fun onResume() {
		current?.onResumedWithoutCallback()
	}
}
