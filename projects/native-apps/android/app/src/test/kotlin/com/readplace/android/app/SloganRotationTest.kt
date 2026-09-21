package com.readplace.android.app

import java.time.Instant
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SloganRotationTest {
	private val start: Instant = Instant.ofEpochSecond(1000)

	private fun at(seconds: Double): Instant = start.plusMillis((seconds * 1000).toLong())

	private fun makeRotation(): SloganRotation =
		SloganRotation(seed = 42uL, intervalMillis = 1L, startedAt = start, fallback = "Fallback.")

	@Test
	fun `a slogan reads as a review`() {
		assertEquals("“It just works - Matthew Motz”", sloganAsReview("It just works - Matthew Motz"))
	}

	@Test
	fun `the fallback slogan stands quoted until anything is published`() {
		val rotation = makeRotation()

		assertEquals("Fallback.", rotation.current)
		assertEquals(
			SubtitleFrame(
				outgoing = SloganLine(text = "", pose = TextPose.hidden),
				incoming = SloganLine(text = "“Fallback.”", pose = TextPose.shown),
			),
			rotation.subtitle(start),
		)
		assertEquals(rotation.settledSubtitle(), rotation.subtitle(start))
	}

	@Test
	fun `an empty publication keeps the fallback`() {
		val rotation = makeRotation()

		rotation.publish(emptyList())

		assertEquals("Fallback.", rotation.current)
	}

	@Test
	fun `publishing starts from the first entry and advancing wraps around`() {
		val rotation = makeRotation()
		rotation.publish(listOf("A", "B", "C"))
		assertEquals("A", rotation.current)

		rotation.advance(at(5.0))
		assertEquals("B", rotation.current)
		assertEquals(
			"the handoff is timed on the storm clock so the sky and the words agree",
			SloganHandoff(outgoing = "A", incoming = "B", startedAt = 5.0, ordinal = 0, seed = 42uL),
			rotation.handoff.value,
		)

		rotation.advance(at(20.0))
		rotation.advance(at(35.0))
		assertEquals("A", rotation.current)
		assertEquals(
			SloganHandoff(outgoing = "C", incoming = "A", startedAt = 35.0, ordinal = 2, seed = 42uL),
			rotation.handoff.value,
		)
	}

	@Test
	fun `the subtitle follows the handoff on the storm clock`() {
		val rotation = makeRotation()
		rotation.publish(listOf("A", "B"))
		rotation.advance(at(5.0))

		assertEquals(
			SubtitleFrame(
				outgoing = SloganLine(text = "“A”", pose = TextPose.shown),
				incoming = SloganLine(text = "“B”", pose = TextPose.hidden),
			),
			rotation.subtitle(at(4.0)),
		)
		assertEquals(0.5, rotation.subtitle(at(5.15)).outgoing.pose.opacity, 1e-9)
		assertEquals(
			SubtitleFrame(
				outgoing = SloganLine(text = "“A”", pose = TextPose.hidden),
				incoming = SloganLine(text = "“B”", pose = TextPose.shown),
			),
			rotation.subtitle(at(5.0 + SloganHandoff.DURATION)),
		)
	}

	@Test
	fun `a freshly published list drops the finished handoff`() {
		val rotation = makeRotation()
		rotation.publish(listOf("A", "B"))
		rotation.advance(at(5.0))
		assertEquals("B", rotation.current)

		rotation.publish(listOf("C", "D"))

		assertNull("a stale handoff would keep rendering a slogan the new list no longer holds", rotation.handoff.value)
		assertEquals(
			"the screen shows the new list's first entry, not the previous list's incoming slogan",
			"“C”",
			rotation.subtitle(at(6.0)).incoming.text,
		)
	}

	@Test
	fun `a paused clock holds the handoff where the storm stopped`() {
		val rotation = makeRotation()
		rotation.publish(listOf("A", "B"))
		rotation.setPaused(paused = true, at = at(5.0))

		rotation.advance(at(30.0))

		assertEquals("time the app spent in the background never plays back", 5.0, rotation.handoff.value?.startedAt)
	}

	@Test
	fun `resuming after a pause keeps the storm continuous`() {
		val rotation = makeRotation()
		rotation.publish(listOf("A", "B"))
		rotation.setPaused(paused = true, at = at(5.0))
		rotation.setPaused(paused = false, at = at(20.0))

		rotation.advance(at(23.0))

		assertEquals(
			"the storm resumes where it paused, not where wall-clock time reached",
			8.0,
			rotation.handoff.value?.startedAt,
		)
	}

	@Test
	fun `run loads the published list then cycles until cancelled`() = runTest {
		val rotation = makeRotation()

		val cycling = launch { rotation.run(reduceMotion = false, now = { start }, load = { listOf("A", "B", "C") }) }
		runCurrent()
		advanceTimeBy(80)
		runCurrent()
		cycling.cancel()

		assertEquals(listOf("A", "B", "C"), rotation.slogans.value)
		val handoff = requireNotNull(rotation.handoff.value)
		assertEquals(handoff.incoming, rotation.current)
		assertTrue("the rotation keeps advancing until its task is cancelled", handoff.ordinal >= 1)
	}

	@Test
	fun `run leaves the first slogan alone under reduced motion`() = runTest {
		val rotation = makeRotation()

		rotation.run(reduceMotion = true, now = { start }, load = { listOf("A", "B", "C") })

		assertEquals("A", rotation.current)
		assertEquals("“A”", rotation.subtitle(start).incoming.text)
		assertNull(rotation.handoff.value)
	}

	@Test
	fun `run never cycles a single slogan`() = runTest {
		val rotation = makeRotation()

		rotation.run(reduceMotion = false, now = { start }, load = { emptyList() })

		assertEquals("Fallback.", rotation.current)
		assertNull(rotation.handoff.value)
	}
}
