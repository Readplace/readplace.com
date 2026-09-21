package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SloganCometsTest {
	private val sky = WaveRect(x = 24.0, y = 60.0, width = 342.0, height = 240.0)
	private val subtitle = WaveRect(x = 60.0, y = 420.0, width = 270.0, height = 20.0)
	private val screenSize = WaveSize(width = 390.0, height = 844.0)
	private val subtitleCenter = WavePoint(x = 195.0, y = 430.0)

	private fun makeHandoff(startedAt: Double = 0.0, ordinal: Int = 0): SloganHandoff =
		SloganHandoff(outgoing = "A", incoming = "B", startedAt = startedAt, ordinal = ordinal, seed = 42uL)

	private fun comet(elapsed: Double, handoff: SloganHandoff?, sky: WaveRect?, subtitle: WaveRect?): SloganComet =
		loginComet(handoff = handoff, sky = sky, subtitle = subtitle, seed = 42uL, screenSize = screenSize, elapsed = elapsed)

	@Test
	fun `a screen with nothing to hand over draws no comet`() {
		assertEquals(SloganComet.idle, comet(0.5, handoff = null, sky = sky, subtitle = subtitle))
	}

	@Test
	fun `a comet waits until the screen has reported both landmarks`() {
		val handoff = makeHandoff()

		assertEquals(SloganComet.idle, comet(0.5, handoff = handoff, sky = null, subtitle = null))
		assertEquals(SloganComet.idle, comet(0.5, handoff = handoff, sky = sky, subtitle = null))
		assertEquals(SloganComet.idle, comet(0.5, handoff = handoff, sky = null, subtitle = subtitle))
		assertNotEquals(SloganComet.idle, comet(0.5, handoff = handoff, sky = sky, subtitle = subtitle))
	}

	@Test
	fun `the spark is born on the subtitle and lands on the strike point`() {
		val handoff = makeHandoff()

		val spark = requireNotNull(comet(0.1, handoff, sky, subtitle).head)
		val landed = requireNotNull(comet(SloganHandoff.LANDING_AT, handoff, sky, subtitle).head)

		assertEquals(subtitleCenter, spark.center)
		assertEquals(handoff.landing(sky).x, landed.center.x, 1e-9)
		assertEquals(handoff.landing(sky).y, landed.center.y, 1e-9)
	}

	@Test
	fun `the descending star always leaves from inside the sky panel`() {
		for (ordinal in 0 until 25) {
			val handoff = makeHandoff(ordinal = ordinal)

			val leaving = requireNotNull(comet(SloganHandoff.DESCENT_START + 0.02, handoff, sky, subtitle).head)

			assertTrue(
				"handoff $ordinal starts its star at ${leaving.center}, outside the sky panel at $sky",
				WaveRect(x = sky.x - 0.5, y = sky.y - 0.5, width = sky.width + 1, height = sky.height + 1).contains(leaving.center),
			)
		}
	}

	@Test
	fun `the comet blooms back onto the subtitle`() {
		val handoff = makeHandoff()

		val arrived = requireNotNull(comet(SloganHandoff.ARRIVAL_AT, handoff, sky, subtitle).head)
		val blooming = requireNotNull(comet(SloganHandoff.ARRIVAL_AT + 0.25, handoff, sky, subtitle).head)

		assertEquals(subtitleCenter, arrived.center)
		assertEquals(arrived.center, blooming.center)
		assertTrue(blooming.glowRadius > arrived.glowRadius)
	}

	@Test
	fun `the sky hosts a visit only once there is a handoff and a panel to strike`() {
		val handoff = makeHandoff()

		assertEquals(emptyList<StarVisit>(), skyVisits(handoff = null, sky = sky))
		assertEquals(emptyList<StarVisit>(), skyVisits(handoff = handoff, sky = null))
		assertEquals(listOf(handoff.visit(sky)), skyVisits(handoff = handoff, sky = sky))
	}
}
