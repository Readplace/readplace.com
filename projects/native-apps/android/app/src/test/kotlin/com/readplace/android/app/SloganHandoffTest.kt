package com.readplace.android.app

import kotlin.math.abs
import kotlin.math.hypot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SloganHandoffTest {
	private val sky = WaveRect(x = 24.0, y = 60.0, width = 342.0, height = 240.0)
	private val subtitle = WavePoint(x = 195.0, y = 430.0)
	private val launch = WavePoint(x = 120.0, y = 150.0)
	private val handoff = SloganHandoff(
		outgoing = "Read what matters",
		incoming = "Paste a link. Read it clean.",
		startedAt = 10.0,
		ordinal = 0,
		seed = 42uL,
	)

	private fun comet(sinceStart: Double): SloganComet =
		handoff.comet(elapsed = 10.0 + sinceStart, subtitleCenter = subtitle, sky = sky, launch = launch)

	private fun poses(sinceStart: Double): TextPoses = handoff.poses(10.0 + sinceStart)

	private fun distance(a: WavePoint, b: WavePoint): Double = hypot(a.x - b.x, a.y - b.y)

	@Test
	fun `before the handoff the outgoing slogan stands alone`() {
		assertEquals(TextPoses(outgoing = TextPose.shown, incoming = TextPose.hidden), poses(-1.0))
		assertEquals(SloganComet.idle, comet(-1.0))
	}

	@Test
	fun `the outgoing slogan condenses into a growing spark`() {
		val condensing = poses(0.15).outgoing
		assertEquals(0.5, condensing.opacity, 1e-9)
		assertEquals(0.725, condensing.scale, 1e-9)
		assertEquals(3.0, condensing.blur, 1e-9)
		assertEquals(TextPose.hidden, poses(0.3).outgoing)

		val early = requireNotNull(comet(0.05).head)
		val late = requireNotNull(comet(0.19).head)
		assertEquals(subtitle, early.center)
		assertEquals(subtitle, late.center)
		assertTrue(early.opacity > 0)
		assertTrue("the spark swells as the words condense into it", late.coreRadius > early.coreRadius)
		assertEquals("a spark that has not flown yet trails nothing", emptyList<FilamentStroke>(), comet(0.1).strokes)
	}

	@Test
	fun `the spark flies up to its landing and its tail drains into the strike`() {
		val landing = handoff.landing(sky)
		val leaving = requireNotNull(comet(0.25).head)
		val midway = requireNotNull(comet(0.6).head)
		val landed = requireNotNull(comet(0.9).head)

		assertTrue(distance(leaving.center, subtitle) < distance(leaving.center, landing))
		assertTrue("the spark closes on its landing", distance(midway.center, landing) < distance(leaving.center, landing))
		assertEquals(landing.x, landed.center.x, 1e-9)
		assertEquals(landing.y, landed.center.y, 1e-9)
		assertEquals("a comet burns at full strength, not in the lanes' veil", setOf(StrokeTone.STAR), comet(0.6).strokes.map { it.tone }.toSet())
		assertEquals(16, comet(0.6).strokes.size)

		val draining = comet(1.0)
		assertEquals("the tail is still catching up with the landed head", 16, draining.strokes.size)
		assertTrue("the head gives way to the bolt it became", requireNotNull(draining.head).opacity < landed.opacity)
		assertEquals("once drained, the sky's bolt is the only trace", SloganComet.idle, comet(1.15))
		assertEquals(SloganComet.idle, comet(1.3))
	}

	@Test
	fun `the flight bows away from the straight line`() {
		val landing = handoff.landing(sky)
		val midway = requireNotNull(comet(0.55).head).center

		val chordX = landing.x - subtitle.x
		val chordY = landing.y - subtitle.y
		val offChord = abs((midway.x - subtitle.x) * chordY - (midway.y - subtitle.y) * chordX) / hypot(chordX, chordY)
		assertTrue("a straight shot through the wordmark would read as a bullet, not a star", offChord > 20)
	}

	@Test
	fun `the visit is born where and when the spark lands`() {
		val visit = handoff.visit(sky)

		assertEquals(StarVisit(anchor = handoff.landing(sky), bornAt = 10.9, hue = handoff.hue, ordinal = 0), visit)
		assertTrue(visit.anchor.x >= sky.x + 0.18 * sky.width)
		assertTrue(visit.anchor.x <= sky.x + 0.82 * sky.width)
		assertTrue(visit.anchor.y >= sky.y + 0.15 * sky.height)
		assertTrue(visit.anchor.y <= sky.y + 0.75 * sky.height)
	}

	@Test
	fun `a star leaves the struck bolt and blooms into the incoming slogan`() {
		val leaving = requireNotNull(comet(1.4).head)
		assertTrue(distance(leaving.center, launch) < distance(leaving.center, subtitle))
		assertEquals(16, comet(1.4).strokes.size)

		val arrived = requireNotNull(comet(2.05).head)
		assertEquals(subtitle, arrived.center)
		assertEquals(TextPose.hidden, poses(2.05).incoming)
		assertEquals("the tail drains into the words as they form", 16, comet(2.05).strokes.size)

		val blooming = requireNotNull(comet(2.3).head)
		assertEquals(subtitle, blooming.center)
		assertTrue("the light spreads out behind the words", blooming.glowRadius > arrived.glowRadius)
		assertTrue(blooming.opacity < arrived.opacity)
		assertTrue(poses(2.3).incoming.opacity > 0)
		assertTrue(poses(2.3).incoming.opacity < 1)
		assertEquals(emptyList<FilamentStroke>(), comet(2.3).strokes)

		assertEquals(TextPoses(outgoing = TextPose.hidden, incoming = TextPose.shown), poses(2.55))
		assertEquals(SloganComet.idle, comet(2.55))
		assertEquals(TextPoses(outgoing = TextPose.hidden, incoming = TextPose.shown), poses(60.0))
	}

	@Test
	fun `the same moment always draws the same comet`() {
		assertEquals(comet(0.6), comet(0.6))
		assertEquals(comet(1.6), comet(1.6))
	}

	@Test
	fun `every handoff lands somewhere else in its own hue`() {
		val handoffs = (0 until 40).map {
			SloganHandoff(outgoing = "a", incoming = "b", startedAt = 0.0, ordinal = it, seed = 42uL)
		}
		val landings = handoffs.map { it.landing(sky) }
		val reseeded = SloganHandoff(outgoing = "a", incoming = "b", startedAt = 0.0, ordinal = 0, seed = 43uL)

		assertTrue(distance(landings[0], landings[1]) > 5)
		assertTrue(distance(landings[0], reseeded.landing(sky)) > 5)
		assertTrue("the sky is not one colour", handoffs.map { it.hue }.toSet().size > 1)
	}

	@Test
	fun `the comet path runs between its ends and bows by its chord`() {
		val straight = CometPath.bowed(from = WavePoint(0.0, 0.0), to = WavePoint(100.0, 0.0), bow = 0.0)
		val bowed = CometPath.bowed(from = WavePoint(0.0, 0.0), to = WavePoint(100.0, 0.0), bow = 0.25)

		assertEquals(WavePoint(0.0, 0.0), straight.point(0.0))
		assertEquals(WavePoint(100.0, 0.0), straight.point(1.0))
		assertEquals(WavePoint(50.0, 0.0), straight.point(0.5))
		assertEquals("the bow is a fraction of the chord's length", WavePoint(50.0, 12.5), bowed.point(0.5))
		assertEquals(
			listOf(WavePoint(0.0, 0.0), WavePoint(50.0, 12.5), WavePoint(100.0, 0.0)),
			bowed.samples(from = 0.0, to = 1.0, count = 3),
		)
	}
}
