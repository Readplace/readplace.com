package com.readplace.android.app

import java.time.Instant
import kotlin.math.hypot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CosmicWaveFieldTest {
	private val screenSize = WaveSize(width = 390.0, height = 844.0)
	private val topFrame = WaveRect(x = 0.0, y = 100.0, width = 390.0, height = 330.0)
	private val bottomFrame = WaveRect(x = 0.0, y = 600.0, width = 390.0, height = 150.0)
	private val zeroFrame = WaveRect(x = 0.0, y = 0.0, width = 0.0, height = 0.0)
	private val zeroSize = WaveSize(width = 0.0, height = 0.0)
	private val field = CosmicWaveField(seed = 42uL, zone = CosmicZone.ABOVE_BRAND)

	private fun strokes(elapsed: Double): List<FilamentStroke> =
		field.strokes(zoneFrame = topFrame, screenSize = screenSize, elapsed = elapsed)

	private fun cores(elapsed: Double, hue: CosmicHue): List<FilamentStroke> =
		strokes(elapsed).filterIndexed { offset, stroke -> offset % 2 == 1 && stroke.hue == hue }

	private fun arcLength(elapsed: Double, hue: CosmicHue): Double =
		cores(elapsed, hue).sumOf { stroke ->
			stroke.points.zipWithNext { from, to -> hypot(to.x - from.x, to.y - from.y) }.sum()
		}

	private fun peakOpacity(elapsed: Double, hue: CosmicHue): Double =
		cores(elapsed, hue).maxOfOrNull { it.opacity } ?: 0.0

	private fun birth(hue: CosmicHue, after: Double): Double {
		var elapsed = after
		while (arcLength(elapsed, hue) == 0.0 && elapsed < after + 14) {
			elapsed += 0.01
		}
		return elapsed
	}

	/**
	 * A moment when this hue's bolt has finished drawing itself in — bolts live
	 * for under two seconds, so no fixed timestamp is reliably mid-life.
	 */
	private fun matured(hue: CosmicHue, after: Double): Double? {
		var elapsed = after
		while (elapsed < after + 20) {
			val trail = cores(elapsed, hue)
			val points = trail.flatMap { it.points }
			val first = points.firstOrNull()
			val last = points.lastOrNull()
			if (trail.size == 8 && first != null && last != null &&
				hypot(last.x - first.x, last.y - first.y) > 40
			) {
				return elapsed
			}
			elapsed += 0.02
		}
		return null
	}

	@Test
	fun `same seed and time produce identical strokes`() {
		assertEquals(strokes(4.0), strokes(4.0))
	}

	@Test
	fun `different seeds produce different geometry`() {
		val other = CosmicWaveField(seed = 43uL, zone = CosmicZone.ABOVE_BRAND)

		assertNotEquals(
			strokes(4.0).firstOrNull()?.points,
			other.strokes(zoneFrame = topFrame, screenSize = screenSize, elapsed = 4.0).firstOrNull()?.points,
		)
	}

	@Test
	fun `degenerate geometry produces no strokes`() {
		assertEquals(emptyList<FilamentStroke>(), field.strokes(zoneFrame = zeroFrame, screenSize = screenSize, elapsed = 6.0))
		assertEquals(emptyList<FilamentStroke>(), field.strokes(zoneFrame = topFrame, screenSize = zeroSize, elapsed = 6.0))
		assertEquals(emptyList<FilamentStroke>(), field.staticStrokes(zoneFrame = zeroFrame, screenSize = screenSize))
		assertEquals(emptyList<FilamentStroke>(), field.staticStrokes(zoneFrame = topFrame, screenSize = zeroSize))
	}

	@Test
	fun `nothing is visible at launch`() {
		assertEquals(emptyList<FilamentStroke>(), strokes(0.0))
	}

	@Test
	fun `every segment draws a glow under its core`() {
		val visible = strokes(requireNotNull(matured(CosmicHue.AMBER_HIGHLIGHT, after = 0.0)))
		assertFalse(visible.isEmpty())
		assertEquals(0, visible.size % 2)
		for (pair in visible.indices step 2) {
			val glow = visible[pair]
			val core = visible[pair + 1]
			assertEquals(glow.points, core.points)
			assertEquals(glow.hue, core.hue)
			assertEquals(0.5 * core.opacity, glow.opacity, 1e-12)
			assertTrue(glow.lineWidth > core.lineWidth)
			assertEquals(6.0, glow.blurRadius, 0.0)
			assertEquals(
				"the crisp core draws straight, without paying for an offscreen blur layer",
				0.0,
				core.blurRadius,
				0.0,
			)
		}
	}

	@Test
	fun `the tail fades and thins away from the head`() {
		val moment = requireNotNull(matured(CosmicHue.AMBER_HIGHLIGHT, after = 0.0))
		val trail = cores(moment, CosmicHue.AMBER_HIGHLIGHT)
		assertEquals(8, trail.size)

		val tail = trail[0]
		val head = trail[7]
		assertTrue("the tail must dissolve, not end in a blunt line", tail.opacity < head.opacity * 0.2)
		// Brightness alone carries the taper: a bolt whose width also collapsed to a
		// point would read as a tadpole rather than a strike.
		assertTrue("the bolt must keep an even width, not whip to a tip", tail.lineWidth > head.lineWidth * 0.6)
		for ((nearer, further) in trail.zipWithNext()) {
			assertTrue("brightness must rise steadily toward the head", nearer.opacity < further.opacity)
		}
	}

	@Test
	fun `the bolt is pinned between two fixed points for its whole life`() {
		val born = birth(CosmicHue.AMBER_HIGHLIGHT, after = 0.0)
		val drawing = cores(born + 0.06, CosmicHue.AMBER_HIGHLIGHT)
		val drawn = cores(born + 0.36, CosmicHue.AMBER_HIGHLIGHT)
		val dying = cores(born + 0.60, CosmicHue.AMBER_HIGHLIGHT)

		val tails = listOf(drawing, drawn, dying).map { requireNotNull(it.firstOrNull()?.points?.firstOrNull()) }
		assertEquals("the start never moves", 0.0, hypot(tails[1].x - tails[0].x, tails[1].y - tails[0].y), 0.001)
		assertEquals("the start never moves", 0.0, hypot(tails[2].x - tails[0].x, tails[2].y - tails[0].y), 0.001)

		val settledHead = requireNotNull(drawn.lastOrNull()?.points?.lastOrNull())
		val dyingHead = requireNotNull(dying.lastOrNull()?.points?.lastOrNull())
		assertEquals(
			"once drawn, the end stays where it landed instead of trailing onward",
			0.0,
			hypot(dyingHead.x - settledHead.x, dyingHead.y - settledHead.y),
			0.001,
		)
	}

	@Test
	fun `the bolt breaks direction instead of undulating`() {
		var kinked = 0
		for (lane in 0 until 5) {
			val bolt = maturePolyline(lane) ?: continue
			val turns = (1 until bolt.size - 1).map { index ->
				val inbound = WavePoint(x = bolt[index].x - bolt[index - 1].x, y = bolt[index].y - bolt[index - 1].y)
				val outbound = WavePoint(x = bolt[index + 1].x - bolt[index].x, y = bolt[index + 1].y - bolt[index].y)
				inbound.x * outbound.y - inbound.y * outbound.x
			}
			val reversals = turns.zipWithNext().count { (earlier, later) -> (earlier < 0) != (later < 0) }
			if (reversals >= 2) kinked += 1
		}

		assertTrue("bolts must zigzag, not run as one smooth curve", kinked >= 2)
	}

	@Test
	fun `the arc grows from nothing to its full length`() {
		val born = birth(CosmicHue.AMBER_HIGHLIGHT, after = 0.0)

		val justBorn = arcLength(born + 0.04, CosmicHue.AMBER_HIGHLIGHT)
		val halfway = arcLength(born + 0.16, CosmicHue.AMBER_HIGHLIGHT)
		val grown = arcLength(born + 0.5, CosmicHue.AMBER_HIGHLIGHT)

		assertTrue(justBorn > 0)
		assertTrue("the streak must draw itself out, not pop in at full length", halfway > justBorn * 2)
		assertTrue(grown > halfway)
	}

	@Test
	fun `the bolt fades out at full length instead of retracting`() {
		val moment = requireNotNull(matured(CosmicHue.AMBER_HIGHLIGHT, after = 0.0))
		val grown = arcLength(moment, CosmicHue.AMBER_HIGHLIGHT)
		val midLifeOpacity = peakOpacity(moment, CosmicHue.AMBER_HIGHLIGHT)

		var elapsed = moment
		var lastVisible = elapsed
		while (peakOpacity(elapsed, CosmicHue.AMBER_HIGHLIGHT) > 0 && elapsed < moment + 5) {
			lastVisible = elapsed
			elapsed += 0.02
		}
		val dyingLength = arcLength(lastVisible, CosmicHue.AMBER_HIGHLIGHT)
		val dyingOpacity = peakOpacity(lastVisible, CosmicHue.AMBER_HIGHLIGHT)

		assertTrue("the bolt keeps its full length while it fades", dyingLength > grown * 0.9)
		assertTrue("the bolt leaves by fading, not by shrinking", dyingOpacity < midLifeOpacity * 0.35)
	}

	@Test
	fun `every bolt is long enough to read`() {
		for (lane in 0 until 5) {
			val bolt = requireNotNull(maturePolyline(lane)) { "lane $lane must produce a bolt" }
			val start = requireNotNull(bolt.firstOrNull())
			val end = requireNotNull(bolt.lastOrNull())

			assertTrue("lane $lane draws a bolt, not a dot", hypot(end.x - start.x, end.y - start.y) > 40)
		}
	}

	@Test
	fun `the sphere is anchored to the screen not to the zone`() {
		val higher = field.strokes(
			zoneFrame = WaveRect(x = 0.0, y = 60.0, width = 390.0, height = 330.0),
			screenSize = screenSize,
			elapsed = 4.0,
		)
		val lower = field.strokes(
			zoneFrame = WaveRect(x = 0.0, y = 400.0, width = 390.0, height = 330.0),
			screenSize = screenSize,
			elapsed = 4.0,
		)

		assertNotEquals("moving the zone must slide it over one fixed sphere", higher.firstOrNull()?.points, lower.firstOrNull()?.points)
	}

	@Test
	fun `filaments never overlap each other`() {
		val below = CosmicWaveField(seed = 42uL, zone = CosmicZone.BELOW_ACTIONS)
		for (elapsed in stride(from = 0.5, through = 40.0, by = 0.1)) {
			assertBandsStayApart(
				field.strokes(zoneFrame = topFrame, screenSize = screenSize, elapsed = elapsed),
				zoneSize = topFrame.size,
				elapsed = elapsed,
			)
			assertBandsStayApart(
				below.strokes(zoneFrame = bottomFrame, screenSize = screenSize, elapsed = elapsed),
				zoneSize = bottomFrame.size,
				elapsed = elapsed,
			)
		}
	}

	@Test
	fun `the static composition also keeps its filaments apart`() {
		assertBandsStayApart(
			field.staticStrokes(zoneFrame = topFrame, screenSize = screenSize),
			zoneSize = topFrame.size,
			elapsed = 0.0,
		)
		assertBandsStayApart(
			CosmicWaveField(seed = 42uL, zone = CosmicZone.BELOW_ACTIONS).staticStrokes(zoneFrame = bottomFrame, screenSize = screenSize),
			zoneSize = bottomFrame.size,
			elapsed = 0.0,
		)
	}

	@Test
	fun `the projection keeps every streak in front of the eye`() {
		for (elapsed in stride(from = 0.5, through = 20.0, by = 0.25)) {
			for (stroke in strokes(elapsed)) {
				assertTrue("a point behind the eye would invert the stroke", stroke.lineWidth > 0)
				assertTrue("a point near the focal plane would blow the stroke up", stroke.lineWidth < 40)
			}
		}
	}

	@Test
	fun `filaments remain visible inside the zone`() {
		val rect = WaveRect(x = 0.0, y = 0.0, width = topFrame.width, height = topFrame.height)

		val inside = strokes(requireNotNull(matured(CosmicHue.AMBER_HIGHLIGHT, after = 0.0)))
			.flatMap { it.points }
			.filter { rect.contains(it) }

		assertTrue("arcs must actually cross the visible zone", inside.size >= 20)
	}

	@Test
	fun `core opacity never exceeds the ceiling`() {
		for (elapsed in stride(from = 0.0, through = 60.0, by = 0.25)) {
			for (stroke in strokes(elapsed)) {
				assertTrue(stroke.opacity <= 1.0)
				assertTrue(stroke.opacity > 0)
			}
		}
	}

	@Test
	fun `the storm keeps several streaks in flight at once`() {
		var busiest = 0
		var totalLanes = 0
		var samples = 0
		for (elapsed in stride(from = 2.0, through = 30.0, by = 0.1)) {
			val lanes = strokes(elapsed).map { it.lane }.toSet().size
			busiest = maxOf(busiest, lanes)
			totalLanes += lanes
			samples += 1
		}
		val average = totalLanes.toDouble() / samples.toDouble()

		assertTrue("a storm must light up most lanes at its peak", busiest >= 4)
		assertTrue("on average several streaks are in flight together", average > 2.0)
	}

	@Test
	fun `every streak lives and dies within a few seconds`() {
		val born = birth(CosmicHue.AMBER_HIGHLIGHT, after = 0.0)
		var elapsed = born
		while (peakOpacity(elapsed, CosmicHue.AMBER_HIGHLIGHT) > 0 && elapsed < born + 10) {
			elapsed += 0.02
		}

		assertTrue("a storm streak flashes past, it does not linger", elapsed - born < 3.0)
	}

	@Test
	fun `respawn strikes somewhere else`() {
		val moment = requireNotNull(matured(CosmicHue.AMBER_HIGHLIGHT, after = 0.0))
		val first = requireNotNull(centroid(moment, CosmicHue.AMBER_HIGHLIGHT))
		val later = requireNotNull(matured(CosmicHue.AMBER_HIGHLIGHT, after = moment + 2.5))
		val second = requireNotNull(centroid(later, CosmicHue.AMBER_HIGHLIGHT))

		assertTrue("the next strike lands somewhere else", hypot(first.x - second.x, first.y - second.y) > 5)
	}

	@Test
	fun `the quiet zone runs at eighty percent opacity`() {
		val below = CosmicWaveField(seed = 42uL, zone = CosmicZone.BELOW_ACTIONS)

		val quiet = below.staticStrokes(zoneFrame = bottomFrame, screenSize = screenSize)

		assertEquals(48, quiet.size)
		assertEquals(setOf(CosmicHue.DEEP_AMBER, CosmicHue.VIOLET, CosmicHue.CYAN), quiet.map { it.hue }.toSet())
		assertTrue((quiet.maxOfOrNull { it.opacity } ?: 0.0) <= 0.7 * 0.8 + 1e-9)
		val peak = quiet.filterIndexed { offset, _ -> offset % 2 == 1 }.maxOfOrNull { it.opacity } ?: 0.0
		assertTrue(peak <= 0.7 * 0.8 + 1e-9)
	}

	@Test
	fun `static composition is fully populated and timeless`() {
		val still = field.staticStrokes(zoneFrame = topFrame, screenSize = screenSize)

		assertEquals(80, still.size)
		assertEquals(still, field.staticStrokes(zoneFrame = topFrame, screenSize = screenSize))
		val peak = still.filterIndexed { offset, _ -> offset % 2 == 1 }.maxOfOrNull { it.opacity } ?: 0.0
		assertTrue(peak <= 0.7 + 1e-9)
	}

	@Test
	fun `edge fades keep filaments away from content`() {
		assertEquals(EdgeFade(leadIn = 0.10, leadOut = 0.10), CosmicZone.ABOVE_BRAND.horizontalFade)
		assertEquals(EdgeFade(leadIn = 0.06, leadOut = 0.10), CosmicZone.ABOVE_BRAND.verticalFade)
		assertEquals(EdgeFade(leadIn = 0.10, leadOut = 0.10), CosmicZone.BELOW_ACTIONS.horizontalFade)
		assertEquals(EdgeFade(leadIn = 0.12, leadOut = 0.12), CosmicZone.BELOW_ACTIONS.verticalFade)
	}

	@Test
	fun `hues resolve to their cosmic tokens`() {
		assertHue(CosmicHue.AMBER_HIGHLIGHT, light = "#C8923C", lightAlpha = 0.20, dark = "#D4A04A", darkAlpha = 0.28)
		assertHue(CosmicHue.DEEP_AMBER, light = "#C8702A", lightAlpha = 0.18, dark = "#D4833A", darkAlpha = 0.26)
		assertHue(CosmicHue.VIOLET, light = "#6C429E", lightAlpha = 0.15, dark = "#A880D6", darkAlpha = 0.22)
		assertHue(CosmicHue.CYAN, light = "#4A7FB5", lightAlpha = 0.14, dark = "#7AB2DE", darkAlpha = 0.20)
		assertHue(CosmicHue.MAGENTA, light = "#B0447A", lightAlpha = 0.13, dark = "#DE82B2", darkAlpha = 0.18)
	}

	/**
	 * Pins that the variant handed to the canvas is the brand token for that theme
	 * and not some other hue — for every case, so a hue added without both tokens
	 * cannot slip through the light/dark contract pinned on `resolved` above.
	 */
	@Test
	fun `every hue resolves to its own variant under either theme`() {
		for (hue in CosmicHue.entries) {
			assertEquals(hue.name, hue.light, hue.resolved(darkTheme = false))
			assertEquals(hue.name, hue.dark, hue.resolved(darkTheme = true))
			assertNotEquals(hue.name, hue.light, hue.dark)
		}
	}

	@Test
	fun `the clock accumulates only while running`() {
		val start = Instant.ofEpochSecond(1000)
		val running = WaveClock(accumulated = 0.0, resumedAt = start)
		assertEquals(5.0, running.elapsed(start.plusSeconds(5)), 1e-12)

		val pausedClock = running.pausing(start.plusSeconds(8))
		assertEquals(8.0, pausedClock.elapsed(start.plusSeconds(60)), 1e-12)

		val resumed = pausedClock.resuming(start.plusSeconds(60))
		assertEquals(11.0, resumed.elapsed(start.plusSeconds(63)), 1e-12)
	}

	@Test
	fun `redundant clock transitions are ignored`() {
		val start = Instant.ofEpochSecond(1000)
		val running = WaveClock(accumulated = 3.0, resumedAt = start)
		val pausedClock = WaveClock(accumulated = 3.0, resumedAt = null)

		assertEquals(running, running.resuming(start.plusSeconds(9)))
		assertEquals(pausedClock, pausedClock.pausing(start.plusSeconds(9)))
	}

	@Test
	fun `a clock setback freezes the waves instead of blanking them`() {
		val start = Instant.ofEpochSecond(1000)
		val running = WaveClock(accumulated = 3.0, resumedAt = start)

		assertEquals(3.0, running.elapsed(start.minusSeconds(30)), 1e-12)
		assertEquals(3.0, running.pausing(start.minusSeconds(30)).accumulated, 1e-12)
	}

	private fun assertBandsStayApart(visible: List<FilamentStroke>, zoneSize: WaveSize, elapsed: Double) {
		val onScreen = WaveRect(x = -8.0, y = -8.0, width = zoneSize.width + 16, height = zoneSize.height + 16)
		val spans = mutableMapOf<Int, ClosedFloatingPointRange<Double>>()
		for (stroke in visible) {
			// Only what the zone actually shows can visibly collide; a streak that
			// has flown past the zone edge is clipped away by the mask.
			for (point in stroke.points.filter { onScreen.contains(it) }) {
				val existing = spans[stroke.lane]
				val low = minOf(existing?.start ?: point.y, point.y)
				val high = maxOf(existing?.endInclusive ?: point.y, point.y)
				spans[stroke.lane] = low..high
			}
		}
		val ordered = spans.entries.sortedBy { it.value.start }
		for ((earlier, later) in ordered.zipWithNext()) {
			assertTrue(
				"lanes ${earlier.key} and ${later.key} overlap at t=$elapsed",
				earlier.value.endInclusive < later.value.start,
			)
		}
	}

	/** The full polyline of a lane's bolt once it has finished drawing itself in. */
	private fun maturePolyline(lane: Int): List<WavePoint>? {
		for (step in 0 until 400) {
			val elapsed = 0.5 + step.toDouble() * 0.05
			val drawn = strokes(elapsed).filter { it.lane == lane }
			if (drawn.size != 16) continue
			val points = drawn.filterIndexed { offset, _ -> offset % 2 == 1 }.flatMap { it.points }
			val start = points.firstOrNull() ?: continue
			val end = points.lastOrNull() ?: continue
			if (hypot(end.x - start.x, end.y - start.y) <= 40) continue
			return points
		}
		return null
	}

	private fun centroid(elapsed: Double, hue: CosmicHue): WavePoint? {
		val points = strokes(elapsed).filter { it.hue == hue }.flatMap { it.points }
		if (points.isEmpty()) return null
		val sum = points.fold(WavePoint(x = 0.0, y = 0.0)) { total, point -> WavePoint(x = total.x + point.x, y = total.y + point.y) }
		return WavePoint(x = sum.x / points.size.toDouble(), y = sum.y / points.size.toDouble())
	}

	private fun assertHue(hue: CosmicHue, light: String, lightAlpha: Double, dark: String, darkAlpha: Double) {
		val lightResolved = hue.resolved(darkTheme = false)
		val darkResolved = hue.resolved(darkTheme = true)
		assertEquals("light", light, hex(lightResolved))
		assertEquals("light alpha", lightAlpha, lightResolved.alpha, 1e-9)
		assertEquals("dark", dark, hex(darkResolved))
		assertEquals("dark alpha", darkAlpha, darkResolved.alpha, 1e-9)
	}

	private fun hex(variant: HueVariant): String =
		String.format("#%02X%02X%02X", variant.red, variant.green, variant.blue)

	/** Swift's `stride(from:through:by:)`: `from + i * by` for every `i` that keeps it at or below `through`. */
	private fun stride(from: Double, through: Double, by: Double): List<Double> =
		generateSequence(0) { it + 1 }.map { from + it.toDouble() * by }.takeWhile { it <= through }.toList()

	private val WaveRect.size: WaveSize
		get() = WaveSize(width = width, height = height)

	/** `CGRect.contains`: inside, or on the minimum edges; the maximum edges are outside. */
	private fun WaveRect.contains(point: WavePoint): Boolean =
		point.x >= x && point.x < x + width && point.y >= y && point.y < y + height
}
