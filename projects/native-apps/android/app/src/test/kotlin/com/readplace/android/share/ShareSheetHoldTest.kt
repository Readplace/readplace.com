package com.readplace.android.share

import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

class ShareSheetHoldTest {
	@Test
	fun `keeps the outcome on screen after the journey settles`() = runTest {
		val events = mutableListOf<String>()
		val hold = ShareSheetHold(holdDuration = 300.milliseconds)
		val settled = launch { events += "settled" }
		val midHold = launch {
			delay(200.milliseconds)
			events += "0.2s on from the outcome"
		}

		hold.untilSettledAndRead(settled)
		events += "sheet closed"
		midHold.cancel()

		assertEquals(
			"the card holds the painted outcome through the hold rather than closing the moment the save lands",
			listOf("settled", "0.2s on from the outcome", "sheet closed"),
			events,
		)
	}

	@Test
	fun `holds a settled outcome for the full duration then closes exactly once`() = runTest {
		val hold = ShareSheetHold(holdDuration = 3.seconds)
		val settled = launch {}
		var closed = 0
		val sheet = launch {
			hold.untilSettledAndRead(settled)
			closed += 1
		}

		advanceTimeBy(2_999)
		runCurrent()
		assertEquals("2,999 ms after the outcome settles the card is still up", 0, closed)
		assertTrue("the sheet is still holding at 2,999 ms", sheet.isActive)

		advanceTimeBy(1)
		runCurrent()
		assertEquals("at 3,000 ms the hold closes the card", 1, closed)
		assertFalse("the sheet has finished once the hold elapses", sheet.isActive)

		advanceUntilIdle()
		assertEquals("the hold closes the card exactly once, not again as time runs on", 1, closed)
		sheet.join()
	}

	@Test
	fun `a tap outside ends a long hold at once`() = runTest {
		val events = mutableListOf<String>()
		val hold = ShareSheetHold(holdDuration = 30.seconds)
		val settled = launch {}
		val satOutTheHold = launch {
			delay(1.seconds)
			events += "sat out the hold"
		}
		val tap = launch {
			delay(50.milliseconds)
			hold.end()
		}

		hold.untilSettledAndRead(settled)
		events += "sheet closed"
		satOutTheHold.cancel()
		tap.join()

		assertEquals(
			"a tap outside the card closes the sheet at once rather than sitting out the rest of the 30 s hold",
			listOf("sheet closed"),
			events,
		)
	}

	@Test
	fun `a settle that lands after a tap does not close the sheet a second time`() = runTest {
		val events = mutableListOf<String>()
		val hold = ShareSheetHold(holdDuration = 50.milliseconds)
		val settled = launch {
			delay(300.milliseconds)
			events += "settled"
		}
		val tap = launch {
			delay(50.milliseconds)
			hold.end()
		}

		hold.untilSettledAndRead(settled)
		events += "sheet closed"
		tap.join()
		settled.join()

		assertEquals(
			"a journey that settles after the tap finds the claim already taken, so the sheet does not re-close",
			listOf("sheet closed", "settled"),
			events,
		)
	}

	@Test
	fun `a cancelled journey never closes the sheet, and a tap still ends it`() = runTest {
		val hold = ShareSheetHold(holdDuration = 3.seconds)
		val settled = launch { delay(10.seconds) }
		var closed = 0
		val sheet = launch {
			hold.untilSettledAndRead(settled)
			closed += 1
		}
		runCurrent()

		settled.cancel()
		advanceTimeBy(60_000)
		runCurrent()
		assertEquals("a journey that ended in cancellation never closes the card on its own", 0, closed)
		assertTrue("the sheet keeps waiting because the cancelled journey started no hold", sheet.isActive)

		hold.end()
		runCurrent()
		assertEquals("a tap still closes a card the cancelled journey left up", 1, closed)
		assertFalse("the sheet finishes on the tap", sheet.isActive)
		sheet.join()
	}

	@Test
	fun `repeated taps finish the sheet once and a tap after it is gone does nothing`() = runTest {
		val hold = ShareSheetHold(holdDuration = 30.seconds)
		val settled = launch {}
		var closed = 0
		val sheet = launch {
			hold.untilSettledAndRead(settled)
			closed += 1
		}
		runCurrent()

		hold.end()
		hold.end()
		runCurrent()
		hold.end()
		runCurrent()

		assertEquals("the sheet finishes exactly once no matter how many times the reader taps", 1, closed)
		sheet.join()
	}

	@Test
	fun `a tap before any hold is running does nothing`() {
		ShareSheetHold(holdDuration = 3.seconds).end()
	}
}
