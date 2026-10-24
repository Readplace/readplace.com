package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
	fun `a capture offer starts an automatic capture`() {
		assertEquals(
			"an offer nobody tapped is routed apart from a tap, so the upload can say it was not the reader's choice",
			ReaderMessageRoute.START_AUTOMATIC_CAPTURE,
			route("captureAvailable"),
		)
	}

	@Test
	fun `a capture offer is ignored while a capture is running`() {
		assertEquals(
			"an offer that arrives during a tapped capture is dropped before it can spend the article's one automatic attempt",
			ReaderMessageRoute.IGNORE,
			route("captureAvailable", captureInFlight = true),
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
	fun `a status change report reconciles the list`() {
		assertEquals(ReaderMessageRoute.RECONCILE_STATUS, route("statusChanged"))
	}

	@Test
	fun `a status change report is honoured after the article was marked read`() {
		assertEquals(
			"the mark-read latch closes the sheet once; a status change keeps it open, so it must not " +
				"be latched with it",
			ReaderMessageRoute.RECONCILE_STATUS,
			route("statusChanged", alreadyMarkedRead = true),
		)
	}

	@Test
	fun `a status change report is still honoured while a capture is running`() {
		assertEquals(
			"the capture latch belongs to capture only",
			ReaderMessageRoute.RECONCILE_STATUS,
			route("statusChanged", captureInFlight = true),
		)
	}

	@Test
	fun `a status change arriving on another channel is ignored`() {
		assertEquals(
			"a page that registers its own interface must not be able to drive the list",
			ReaderMessageRoute.IGNORE,
			route("statusChanged", channelName = "SomeOtherBridge"),
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

	@Test
	fun `a started capture is announced with the DOM event the server's markup listens for`() {
		assertEquals(
			"document.dispatchEvent(new Event(\"readplace-capture-started\"))",
			ReaderMessageRoute.CAPTURE_STARTED_SCRIPT,
		)
	}

	@Test
	fun `a capture that copied nothing is announced with the DOM event the server's markup listens for`() {
		assertEquals(
			"document.dispatchEvent(new Event(\"readplace-capture-failed\"))",
			ReaderMessageRoute.CAPTURE_FAILED_SCRIPT,
		)
	}

	@Test
	fun `a capture that copied nothing tells the page it failed`() {
		assertEquals(
			"without the event the page keeps showing the copy as in flight until its poll gives up",
			ReaderMessageRoute.CAPTURE_FAILED_SCRIPT,
			ReaderMessageRoute.scriptAfterCapture(CaptureEnding.NotCopied),
		)
	}

	@Test
	fun `a capture that copied the page dispatches nothing`() {
		assertNull(
			"the page's own poll picks up the arrived copy, so a failed event would contradict it",
			ReaderMessageRoute.scriptAfterCapture(CaptureEnding.Copied),
		)
	}
}
