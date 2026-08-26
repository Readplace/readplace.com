package com.readplace.android.app

import com.readplace.android.core.AppConfig
import com.readplace.android.core.WebAuthPresentation
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * The relay that stands in for `ASWebAuthenticationSession`'s completion. What
 * matters: a user closing the sign-in page must arrive as a dismissal rather than
 * an error, and the resume that always follows a delivered callback must not
 * overwrite that callback.
 */
class AuthCallbackRelayTest {
	private val callback = "${AppConfig.NATIVE_CALLBACK_URL}?code=abc&state=S"

	@Test
	fun `a captured callback URL is the returned outcome`() = runTest {
		val relay = AuthCallbackRelay()

		relay.onCallback(callback)

		assertEquals(WebAuthPresentation.Returned(callback), relay.await())
	}

	@Test
	fun `resuming without a callback is a dismissal rather than an error`() = runTest {
		val relay = AuthCallbackRelay()

		relay.onResumedWithoutCallback()

		assertEquals(WebAuthPresentation.Dismissed, relay.await())
	}

	@Test
	fun `the resume after a delivered callback does not turn it into a dismissal`() = runTest {
		val relay = AuthCallbackRelay()

		relay.onCallback(callback)
		relay.onResumedWithoutCallback()

		assertEquals(WebAuthPresentation.Returned(callback), relay.await())
	}

	@Test
	fun `a callback arriving after a dismissal is ignored`() = runTest {
		val relay = AuthCallbackRelay()

		relay.onResumedWithoutCallback()
		relay.onCallback(callback)

		assertEquals(WebAuthPresentation.Dismissed, relay.await())
	}

	@Test
	fun `a second callback is ignored`() = runTest {
		val relay = AuthCallbackRelay()

		relay.onCallback(callback)
		relay.onCallback("${AppConfig.NATIVE_CALLBACK_URL}?code=later&state=S")

		assertEquals(WebAuthPresentation.Returned(callback), relay.await())
	}

	@Test
	fun `a signal reaches a presentation already being awaited`() = runTest {
		val relay = AuthCallbackRelay()
		val awaited = async { relay.await() }
		runCurrent()
		assertFalse("nothing has arrived yet, so the flow is still suspended", awaited.isCompleted)

		relay.onCallback(callback)

		assertEquals(WebAuthPresentation.Returned(callback), awaited.await())
	}

	@Test
	fun `closing the tab resumes the activity once, and that resume is the dismissal`() = runTest {
		val relays = AuthRelays()
		val relay = AuthCallbackRelay()
		relays.begin(relay)

		relays.onResume()

		assertEquals(WebAuthPresentation.Dismissed, relay.await())
	}

	@Test
	fun `a completed sign-in delivers the callback before the resume, and the callback wins`() = runTest {
		val relays = AuthRelays()
		val relay = AuthCallbackRelay()
		relays.begin(relay)

		relays.onCallback(callback)
		relays.onResume()

		assertEquals(WebAuthPresentation.Returned(callback), relay.await())
	}

	@Test
	fun `an ended relay hears nothing, so a later resume cannot reach a finished flow`() = runTest {
		val relays = AuthRelays()
		val relay = AuthCallbackRelay()
		relays.begin(relay)
		relays.end(relay)
		val awaited = async { relay.await() }

		relays.onResume()
		relays.onCallback(callback)
		runCurrent()

		assertFalse("no signal reached the ended relay", awaited.isCompleted)
		awaited.cancel()
	}

	@Test
	fun `ending a relay that was already replaced leaves the newer one registered`() = runTest {
		val relays = AuthRelays()
		val older = AuthCallbackRelay()
		val newer = AuthCallbackRelay()
		relays.begin(older)
		relays.begin(newer)

		relays.end(older)
		relays.onCallback(callback)

		assertEquals(WebAuthPresentation.Returned(callback), newer.await())
	}
}
