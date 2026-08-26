package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Test

class ReaderMessageRouteTest {
	private fun route(
		messageType: String?,
		captureInFlight: Boolean = false,
		alreadyMarkedRead: Boolean = false,
		channelName: String = ReaderMessageRoute.BRIDGE_NAME,
	): ReaderMessageRoute =
		ReaderMessageRoute.of(
			channelName = channelName,
			messageType = messageType,
			captureInFlight = captureInFlight,
			alreadyMarkedRead = alreadyMarkedRead,
		)

	@Test
	fun `a capture request starts a capture`() {
		assertEquals(ReaderMessageRoute.START_CAPTURE, route("captureBlocked"))
	}

	@Test
	fun `a second capture request is ignored while the first is still running`() {
		assertEquals(
			"the blocked notice can be tapped again while the hidden render is still in flight; " +
				"a second render would upload the same page twice",
			ReaderMessageRoute.IGNORE,
			route("captureBlocked", captureInFlight = true),
		)
	}

	@Test
	fun `a capture request starts a capture even once the article was marked read`() {
		assertEquals(
			"the mark-read latch belongs to mark-read only — it must not swallow a capture",
			ReaderMessageRoute.START_CAPTURE,
			route("captureBlocked", alreadyMarkedRead = true),
		)
	}

	@Test
	fun `a mark-read report marks the article read`() {
		assertEquals(ReaderMessageRoute.MARK_READ, route("markedRead"))
	}

	@Test
	fun `a second mark-read report is ignored`() {
		assertEquals(
			"the sheet closes and the row leaves the list once; a repeat report must not re-fire it",
			ReaderMessageRoute.IGNORE,
			route("markedRead", alreadyMarkedRead = true),
		)
	}

	@Test
	fun `a mark-read report is still honoured while a capture is running`() {
		assertEquals(
			"the capture latch belongs to capture only",
			ReaderMessageRoute.MARK_READ,
			route("markedRead", captureInFlight = true),
		)
	}

	@Test
	fun `a message the bridge does not recognise is ignored`() {
		assertEquals(ReaderMessageRoute.IGNORE, route("scrolled"))
	}

	@Test
	fun `a message carrying no type drives neither side effect`() {
		assertEquals(ReaderMessageRoute.IGNORE, route(null))
	}

	@Test
	fun `a well-formed message arriving on another channel is ignored`() {
		assertEquals(
			"only the reader bridge's own channel may drive the reader; a page that " +
				"registers its own interface must not be able to mark an article read",
			ReaderMessageRoute.IGNORE,
			route("markedRead", channelName = "SomeOtherBridge"),
		)
	}

	@Test
	fun `the bridge name is the one the server's injected script posts to`() {
		assertEquals("ReadplaceReader", ReaderMessageRoute.BRIDGE_NAME)
	}
}
