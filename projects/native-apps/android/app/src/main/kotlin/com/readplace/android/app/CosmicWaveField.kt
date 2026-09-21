package com.readplace.android.app

import java.time.Duration
import java.time.Instant
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

data class HueVariant(
	val red: Int,
	val green: Int,
	val blue: Int,
	val alpha: Double,
) {
	/** The same colour at full strength — a star burns as the hue itself, not the
	 * translucent veil the lanes are drawn with. */
	fun opaque(): HueVariant = copy(alpha = 1.0)
}

enum class CosmicHue(val light: HueVariant, val dark: HueVariant) {
	AMBER_HIGHLIGHT(
		light = HueVariant(red = 200, green = 146, blue = 60, alpha = 0.20),
		dark = HueVariant(red = 212, green = 160, blue = 74, alpha = 0.28),
	),
	DEEP_AMBER(
		light = HueVariant(red = 200, green = 112, blue = 42, alpha = 0.18),
		dark = HueVariant(red = 212, green = 131, blue = 58, alpha = 0.26),
	),
	VIOLET(
		light = HueVariant(red = 108, green = 66, blue = 158, alpha = 0.15),
		dark = HueVariant(red = 168, green = 128, blue = 214, alpha = 0.22),
	),
	CYAN(
		light = HueVariant(red = 74, green = 127, blue = 181, alpha = 0.14),
		dark = HueVariant(red = 122, green = 178, blue = 222, alpha = 0.20),
	),
	MAGENTA(
		light = HueVariant(red = 176, green = 68, blue = 122, alpha = 0.13),
		dark = HueVariant(red = 222, green = 130, blue = 178, alpha = 0.18),
	),
	;

	fun resolved(darkTheme: Boolean): HueVariant = if (darkTheme) dark else light

	fun star(darkTheme: Boolean): HueVariant = resolved(darkTheme).opaque()
}

data class EdgeFade(
	val leadIn: Double,
	val leadOut: Double,
)

enum class CosmicZone {
	ABOVE_BRAND,
	BELOW_ACTIONS,
	;

	val horizontalFade: EdgeFade
		get() = EdgeFade(leadIn = 0.10, leadOut = 0.10)

	val verticalFade: EdgeFade
		get() = when (this) {
			ABOVE_BRAND -> EdgeFade(leadIn = 0.06, leadOut = 0.10)
			BELOW_ACTIONS -> EdgeFade(leadIn = 0.12, leadOut = 0.12)
		}
}

private val CosmicZone.salt: ULong
	get() = when (this) {
		CosmicZone.ABOVE_BRAND -> 0uL
		CosmicZone.BELOW_ACTIONS -> 1uL
	}

private val CosmicZone.filaments: List<FilamentSlot>
	get() = when (this) {
		CosmicZone.ABOVE_BRAND -> listOf(
			FilamentSlot(hue = CosmicHue.AMBER_HIGHLIGHT, band = 0.105..0.135),
			FilamentSlot(hue = CosmicHue.CYAN, band = 0.285..0.315),
			FilamentSlot(hue = CosmicHue.MAGENTA, band = 0.465..0.495),
			FilamentSlot(hue = CosmicHue.VIOLET, band = 0.645..0.675),
			FilamentSlot(hue = CosmicHue.DEEP_AMBER, band = 0.825..0.855),
		)
		CosmicZone.BELOW_ACTIONS -> listOf(
			FilamentSlot(hue = CosmicHue.VIOLET, band = 0.185..0.215),
			FilamentSlot(hue = CosmicHue.DEEP_AMBER, band = 0.485..0.515),
			FilamentSlot(hue = CosmicHue.CYAN, band = 0.785..0.815),
		)
	}

private val CosmicZone.spanScale: Double
	get() = when (this) {
		CosmicZone.ABOVE_BRAND -> 1.0
		CosmicZone.BELOW_ACTIONS -> 0.6
	}

private val CosmicZone.opacityScale: Double
	get() = when (this) {
		CosmicZone.ABOVE_BRAND -> 1.0
		CosmicZone.BELOW_ACTIONS -> 0.8
	}

private fun CosmicZone.startOffset(filament: Int): Double =
	when (this) {
		CosmicZone.ABOVE_BRAND -> 0.31 * filament.toDouble()
		CosmicZone.BELOW_ACTIONS -> 0.17 + 0.43 * filament.toDouble()
	}

private class FilamentSlot(
	val hue: CosmicHue,
	val band: ClosedFloatingPointRange<Double>,
)

data class WaveClock(
	val accumulated: Double,
	val resumedAt: Instant?,
) {
	fun elapsed(date: Instant): Double =
		accumulated + (resumedAt?.let { maxOf(0.0, secondsBetween(from = it, to = date)) } ?: 0.0)

	fun pausing(date: Instant): WaveClock {
		val resumedAt = resumedAt ?: return this
		return WaveClock(
			accumulated = accumulated + maxOf(0.0, secondsBetween(from = resumedAt, to = date)),
			resumedAt = null,
		)
	}

	fun resuming(date: Instant): WaveClock =
		if (resumedAt == null) WaveClock(accumulated = accumulated, resumedAt = date) else this
}

private fun secondsBetween(from: Instant, to: Instant): Double {
	val duration = Duration.between(from, to)
	return duration.seconds.toDouble() + duration.nano.toDouble() / NANOS_PER_SECOND
}

private const val NANOS_PER_SECOND = 1_000_000_000.0

data class WavePoint(
	val x: Double,
	val y: Double,
)

data class WaveSize(
	val width: Double,
	val height: Double,
)

data class WaveRect(
	val x: Double,
	val y: Double,
	val width: Double,
	val height: Double,
) {
	/** `CGRect.contains`: inside, or on the minimum edges; the maximum edges are
	 * outside. Kept here so the visit-head walk and its tests read one definition. */
	fun contains(point: WavePoint): Boolean =
		point.x >= x && point.x < x + width && point.y >= y && point.y < y + height
}

/** A veil stroke draws with the hue's translucent variant; a star burns the same
 * hue at full strength. The comet and a freshly-struck visit are stars. */
enum class StrokeTone {
	VEIL,
	STAR,
}

data class FilamentStroke(
	val points: List<WavePoint>,
	val hue: CosmicHue,
	val lane: Int,
	val tone: StrokeTone,
	val opacity: Double,
	val lineWidth: Double,
	val blurRadius: Double,
) {
	companion object {
		const val SEGMENT_COUNT = 8
		const val POINTS_PER_SEGMENT = 10

		/** Every polyline the field or the comet taper carries exactly this many
		 * samples: eight drawable segments of ten steps, plus the shared end point. */
		const val SAMPLE_COUNT = SEGMENT_COUNT * POINTS_PER_SEGMENT + 1

		private const val TAIL_FALLOFF = 0.9
		private const val TAIL_MIN_THICKNESS = 0.72
		private const val GLOW_OPACITY_FACTOR = 0.5
		private const val CORE_LINE_WIDTH = 2.3
		private const val GLOW_LINE_WIDTH = 7.6
		private const val CORE_BLUR_RADIUS = 0.0
		private const val GLOW_BLUR_RADIUS = 6.0

		/** Splits a full-length polyline into brightness-and-width-tapered segments,
		 * each drawn as a wide faint glow under a crisp core, so the trail dissolves
		 * toward its tail without whipping to a point. */
		fun tapered(
			along: List<WavePoint>,
			hue: CosmicHue,
			lane: Int,
			tone: StrokeTone,
			coreOpacity: Double,
		): List<FilamentStroke> =
			(0 until SEGMENT_COUNT).flatMap { segment ->
				val start = segment * POINTS_PER_SEGMENT
				val points = along.slice(start..start + POINTS_PER_SEGMENT)
				val alongTail = (segment.toDouble() + 0.5) / SEGMENT_COUNT.toDouble()
				val brightness = alongTail.pow(TAIL_FALLOFF)
				val thickness = TAIL_MIN_THICKNESS + (1 - TAIL_MIN_THICKNESS) * alongTail
				val core = coreOpacity * brightness
				listOf(
					FilamentStroke(
						points = points,
						hue = hue,
						lane = lane,
						tone = tone,
						opacity = GLOW_OPACITY_FACTOR * core,
						lineWidth = GLOW_LINE_WIDTH * thickness,
						blurRadius = GLOW_BLUR_RADIUS,
					),
					FilamentStroke(
						points = points,
						hue = hue,
						lane = lane,
						tone = tone,
						opacity = core,
						lineWidth = CORE_LINE_WIDTH * thickness,
						blurRadius = CORE_BLUR_RADIUS,
					),
				)
			}
	}
}

/** A star that has landed in a zone: it draws its own bolt from [anchor] the way a
 * lane does, blazing at full strength before settling into the veil. */
data class StarVisit(
	val anchor: WavePoint,
	val bornAt: Double,
	val hue: CosmicHue,
	val ordinal: Int,
)

fun smoothstep(x: Double): Double = x * x * (3 - 2 * x)

fun splitMix64Unit(seed: ULong): Double {
	var z = seed
	z = z xor (z shr 30)
	z *= 0xBF58_476D_1CE4_E5B9uL
	z = z xor (z shr 27)
	z *= 0x94D0_49BB_1331_11EBuL
	z = z xor (z shr 31)
	return (z shr 40).toDouble() / (1 shl 24).toDouble()
}

private class Vector3(
	val x: Double,
	val y: Double,
	val z: Double,
) {
	fun dot(other: Vector3): Double =
		x * other.x + y * other.y + z * other.z

	fun scaled(factor: Double): Vector3 =
		Vector3(x = x * factor, y = y * factor, z = z * factor)

	fun adding(other: Vector3): Vector3 =
		Vector3(x = x + other.x, y = y + other.y, z = z + other.z)

	fun subtracting(other: Vector3): Vector3 =
		Vector3(x = x - other.x, y = y - other.y, z = z - other.z)

	fun normalized(): Vector3 =
		scaled(1 / sqrt(dot(this)))
}

private class SphereGeometry(
	val center: WavePoint,
	val radius: Double,
)

/** Everything that fixes one bolt's shape and colour: the lane it belongs to, the
 * seed coordinates its geometry is hashed from, and where it leaves the ring. */
private class BoltShape(
	val filament: Int,
	val generation: Int,
	val anchor: WavePoint,
	val hue: CosmicHue,
	val lane: Int,
)

private const val DRAW_SECONDS = 0.32
private const val MIN_KINKS = 2
private const val MAX_KINKS = 6
private const val KINK_AMPLITUDE_BASE = 7.0
private const val KINK_AMPLITUDE_JITTER = 9.0
private const val FADE_OUT_SECONDS = 0.5
private const val BREATH_PERIOD_SECONDS = 1.6
private const val TANGENT_TILT_RANGE = 0.30
private const val SPAN_BASE = 0.055
private const val SPAN_JITTER = 0.040
private const val STATIC_OPACITY_FACTOR = 0.7
private const val SPHERE_SCOPE_FILAMENT = 1000
private const val VISIT_FILAMENT_BASE = 100
private const val VISIT_LANE_BASE = 100
private const val VISIT_LIFETIME_SECONDS = 2.4
private const val VISIT_SETTLE_SECONDS = 0.6

data class CosmicWaveField(
	val seed: ULong,
	val zone: CosmicZone,
) {
	fun strokes(
		zoneFrame: WaveRect,
		screenSize: WaveSize,
		elapsed: Double,
		visits: List<StarVisit>,
	): List<FilamentStroke> {
		if (!(zoneFrame.width > 0 && zoneFrame.height > 0 && screenSize.width > 0 && screenSize.height > 0)) return emptyList()
		val lanes = zone.filaments.indices.flatMap { index ->
			animatedStrokes(filament = index, zoneFrame = zoneFrame, screenSize = screenSize, elapsed = elapsed)
		}
		val guests = visits.flatMap { visit ->
			visitStrokes(visit = visit, zoneFrame = zoneFrame, screenSize = screenSize, elapsed = elapsed)
		}
		return lanes + guests
	}

	fun staticStrokes(zoneFrame: WaveRect, screenSize: WaveSize): List<FilamentStroke> {
		if (!(zoneFrame.width > 0 && zoneFrame.height > 0 && screenSize.width > 0 && screenSize.height > 0)) return emptyList()
		return zone.filaments.indices.flatMap { index ->
			segmentStrokes(
				bolt = laneBolt(filament = index, generation = 0, zoneFrame = zoneFrame),
				zoneFrame = zoneFrame,
				screenSize = screenSize,
				sinceBirth = DRAW_SECONDS,
				coreOpacity = STATIC_OPACITY_FACTOR * zone.opacityScale,
				tone = StrokeTone.VEIL,
			)
		}
	}

	/** Where a star fired at [visit] would leave this zone: the last point of its
	 * bolt still inside the panel, in the same space [zoneFrame] is given in. */
	fun visitHead(visit: StarVisit, zoneFrame: WaveRect, screenSize: WaveSize): WavePoint {
		val points = arcPoints(
			bolt = visitBolt(visit),
			zoneFrame = zoneFrame,
			screenSize = screenSize,
			sinceBirth = DRAW_SECONDS,
		)
		val visible = WaveRect(x = 0.0, y = 0.0, width = zoneFrame.width, height = zoneFrame.height)
		var tip = points[0]
		for (point in points.drop(1)) {
			if (!visible.contains(point)) break
			tip = point
		}
		return WavePoint(x = tip.x + zoneFrame.x, y = tip.y + zoneFrame.y)
	}

	private fun animatedStrokes(
		filament: Int,
		zoneFrame: WaveRect,
		screenSize: WaveSize,
		elapsed: Double,
	): List<FilamentStroke> {
		val localElapsed = elapsed - zone.startOffset(filament)
		if (localElapsed < 0) return emptyList()
		val period = cyclePeriod(filament)
		val generation = (localElapsed / period).toInt()
		val cyclePhase = localElapsed - generation.toDouble() * period
		val sinceBirth = cyclePhase - gap(filament = filament, generation = generation)
		if (sinceBirth <= 0) return emptyList()
		val opacity = veilOpacity(filament = filament, generation = generation, phase = cyclePhase, period = period)
		return segmentStrokes(
			bolt = laneBolt(filament = filament, generation = generation, zoneFrame = zoneFrame),
			zoneFrame = zoneFrame,
			screenSize = screenSize,
			sinceBirth = sinceBirth,
			coreOpacity = opacity,
			tone = StrokeTone.VEIL,
		)
	}

	private fun visitStrokes(
		visit: StarVisit,
		zoneFrame: WaveRect,
		screenSize: WaveSize,
		elapsed: Double,
	): List<FilamentStroke> {
		val sinceBirth = elapsed - visit.bornAt
		if (!(sinceBirth > 0 && sinceBirth < VISIT_LIFETIME_SECONDS)) return emptyList()
		val bolt = visitBolt(visit)
		val opacity = veilOpacity(
			filament = bolt.filament,
			generation = bolt.generation,
			phase = sinceBirth,
			period = VISIT_LIFETIME_SECONDS,
		)
		val veil = segmentStrokes(
			bolt = bolt,
			zoneFrame = zoneFrame,
			screenSize = screenSize,
			sinceBirth = sinceBirth,
			coreOpacity = opacity,
			tone = StrokeTone.VEIL,
		)
		val settling = 1 - smoothstep(minOf(1.0, sinceBirth / VISIT_SETTLE_SECONDS))
		if (settling <= 0) return veil
		return veil + segmentStrokes(
			bolt = bolt,
			zoneFrame = zoneFrame,
			screenSize = screenSize,
			sinceBirth = sinceBirth,
			coreOpacity = opacity * settling,
			tone = StrokeTone.STAR,
		)
	}

	private fun laneBolt(filament: Int, generation: Int, zoneFrame: WaveRect): BoltShape {
		val band = zone.filaments[filament].band
		val anchorX = unit(filament = filament, generation = generation, slot = HashSlot.AnchorX)
		val anchorY = unit(filament = filament, generation = generation, slot = HashSlot.AnchorY)
		val anchor = WavePoint(
			x = zoneFrame.x + (0.15 + 0.7 * anchorX) * zoneFrame.width,
			y = zoneFrame.y + (band.start + anchorY * (band.endInclusive - band.start)) * zoneFrame.height,
		)
		return BoltShape(
			filament = filament,
			generation = generation,
			anchor = anchor,
			hue = zone.filaments[filament].hue,
			lane = filament,
		)
	}

	private fun visitBolt(visit: StarVisit): BoltShape =
		BoltShape(
			filament = VISIT_FILAMENT_BASE + visit.ordinal,
			generation = 0,
			anchor = visit.anchor,
			hue = visit.hue,
			lane = VISIT_LANE_BASE + visit.ordinal,
		)

	private fun segmentStrokes(
		bolt: BoltShape,
		zoneFrame: WaveRect,
		screenSize: WaveSize,
		sinceBirth: Double,
		coreOpacity: Double,
		tone: StrokeTone,
	): List<FilamentStroke> =
		FilamentStroke.tapered(
			along = arcPoints(bolt = bolt, zoneFrame = zoneFrame, screenSize = screenSize, sinceBirth = sinceBirth),
			hue = bolt.hue,
			lane = bolt.lane,
			tone = tone,
			coreOpacity = coreOpacity,
		)

	private fun arcPoints(
		bolt: BoltShape,
		zoneFrame: WaveRect,
		screenSize: WaveSize,
		sinceBirth: Double,
	): List<WavePoint> {
		val index = bolt.filament
		val generation = bolt.generation
		val sphere = sphereGeometry(screenSize)
		val anchor = bolt.anchor
		val focal = 2.4 * sphere.radius
		val offsetX = anchor.x - sphere.center.x
		val offsetY = anchor.y - sphere.center.y
		val planar = offsetX * offsetX + offsetY * offsetY
		val focalSquared = focal * focal
		val radiusSquared = sphere.radius * sphere.radius
		val discriminant = focalSquared * radiusSquared - planar * (focalSquared - radiusSquared)
		val unprojection = (focalSquared - sqrt(discriminant)) / (planar + focalSquared)
		val anchor3D = Vector3(x = offsetX * unprojection, y = offsetY * unprojection, z = focal * (1 - unprojection))
		val tilt = (unit(filament = index, generation = generation, slot = HashSlot.TangentTilt) - 0.5) * TANGENT_TILT_RANGE
		val heading = Vector3(x = cos(tilt), y = sin(tilt), z = 0.0)
		// The bolt rides the great circle through its anchor, so the plane it turns
		// in is spanned by the anchor itself and a tangent square to it.
		val radialUnit = anchor3D.normalized()
		val tangent = heading.subtracting(radialUnit.scaled(heading.dot(radialUnit))).normalized()
		val direction = if (unit(filament = index, generation = 0, slot = HashSlot.DriftDirection) < 0.5) -1.0 else 1.0
		val span = direction *
			(SPAN_BASE + SPAN_JITTER * unit(filament = index, generation = generation, slot = HashSlot.Span)) *
			zone.spanScale
		// Both ends of the bolt are fixed for its whole life: the drawn fraction
		// reveals a path that never moves, so nothing trails or whips behind.
		val drawn = minOf(1.0, sinceBirth / DRAW_SECONDS)
		val step = span * drawn / (FilamentStroke.SAMPLE_COUNT - 1).toDouble()
		val kinks = MIN_KINKS +
			(unit(filament = index, generation = generation, slot = HashSlot.KinkCount) * (MAX_KINKS - MIN_KINKS + 1).toDouble()).toInt()
		val kinkAmplitude =
			(KINK_AMPLITUDE_BASE + KINK_AMPLITUDE_JITTER * unit(filament = index, generation = generation, slot = HashSlot.AmplitudeJitter)) *
				zone.spanScale
		return (0 until FilamentStroke.SAMPLE_COUNT).map { sample ->
			val angle = sample.toDouble() * step
			val alongPath = sample.toDouble() / (FilamentStroke.SAMPLE_COUNT - 1).toDouble() * drawn
			val radial = sphere.radius + kinkAmplitude * kinkOffset(
				alongPath = alongPath,
				kinks = kinks,
				filament = index,
				generation = generation,
			)
			val point = radialUnit.scaled(radial * cos(angle))
				.adding(tangent.scaled(radial * sin(angle)))
			val scale = focal / (focal - point.z)
			WavePoint(
				x = sphere.center.x + point.x * scale - zoneFrame.x,
				y = sphere.center.y + point.y * scale - zoneFrame.y,
			)
		}
	}

	private fun sphereGeometry(screenSize: WaveSize): SphereGeometry {
		val center = WavePoint(
			x = (0.4 + 0.2 * sphereUnit(HashSlot.SphereCenterX)) * screenSize.width,
			y = (0.35 + 0.2 * sphereUnit(HashSlot.SphereCenterY)) * screenSize.height,
		)
		val radius = (1.9 + 0.7 * sphereUnit(HashSlot.SphereRadius)) * maxOf(screenSize.width, screenSize.height)
		return SphereGeometry(center = center, radius = radius)
	}

	/**
	 * Lateral offset of a lightning-style bolt: seeded kink points joined by
	 * straight runs, so the path breaks direction sharply instead of undulating.
	 */
	private fun kinkOffset(alongPath: Double, kinks: Int, filament: Int, generation: Int): Double {
		val scaled = alongPath * kinks.toDouble()
		val segment = minOf(scaled.toInt(), kinks - 1)
		val within = scaled - segment.toDouble()
		val from = kinkHeight(index = segment, filament = filament, generation = generation)
		val to = kinkHeight(index = segment + 1, filament = filament, generation = generation)
		return from + (to - from) * within
	}

	/**
	 * The bolt leaves its anchor exactly on the ring, so its start never jitters
	 * away from the point the lane placed it at.
	 */
	private fun kinkHeight(index: Int, filament: Int, generation: Int): Double =
		if (index == 0) 0.0 else 2 * unit(filament = filament, generation = generation, slot = HashSlot.Kink(index)) - 1

	private fun gap(filament: Int, generation: Int): Double =
		0.12 + 0.5 * unit(filament = filament, generation = generation, slot = HashSlot.Gap)

	private fun veilOpacity(filament: Int, generation: Int, phase: Double, period: Double): Double {
		val breath = 0.88 + 0.12 * sin(
			2 * PI * phase / BREATH_PERIOD_SECONDS +
				2 * PI * unit(filament = filament, generation = generation, slot = HashSlot.BreathPhase),
		)
		return breath * tailFade(cyclePhase = phase, period = period) * zone.opacityScale
	}

	private fun tailFade(cyclePhase: Double, period: Double): Double =
		if (cyclePhase < period - FADE_OUT_SECONDS) {
			1.0
		} else {
			smoothstep((period - cyclePhase) / FADE_OUT_SECONDS)
		}

	private fun cyclePeriod(filament: Int): Double =
		1.3 + 0.8 * unit(filament = filament, generation = 0, slot = HashSlot.CyclePeriod)

	private sealed interface HashSlot {
		class Kink(val index: Int) : HashSlot
		object KinkCount : HashSlot
		object AmplitudeJitter : HashSlot
		object Gap : HashSlot
		object BreathPhase : HashSlot
		object CyclePeriod : HashSlot
		object DriftDirection : HashSlot
		object TangentTilt : HashSlot
		object Span : HashSlot
		object AnchorX : HashSlot
		object AnchorY : HashSlot
		object SphereCenterX : HashSlot
		object SphereCenterY : HashSlot
		object SphereRadius : HashSlot
	}

	private val HashSlot.rawSlot: ULong
		get() = when (this) {
			is HashSlot.Kink -> 30uL + index.toULong()
			HashSlot.KinkCount -> 4uL
			HashSlot.AmplitudeJitter -> 5uL
			HashSlot.Gap -> 6uL
			HashSlot.BreathPhase -> 7uL
			HashSlot.CyclePeriod -> 8uL
			HashSlot.DriftDirection -> 9uL
			HashSlot.TangentTilt -> 10uL
			HashSlot.Span -> 12uL
			HashSlot.AnchorX -> 13uL
			HashSlot.AnchorY -> 14uL
			HashSlot.SphereCenterX -> 16uL
			HashSlot.SphereCenterY -> 17uL
			HashSlot.SphereRadius -> 18uL
		}

	private fun sphereUnit(slot: HashSlot): Double {
		var z = seed
		z = z xor (SPHERE_SCOPE_FILAMENT.toULong() * 0xBF58_476D_1CE4_E5B9uL)
		z = z xor slot.rawSlot
		return splitMix64Unit(z)
	}

	private fun unit(filament: Int, generation: Int, slot: HashSlot): Double {
		var z = seed
		z = z xor (zone.salt * 0x9E37_79B9_7F4A_7C15uL)
		z = z xor (filament.toULong() * 0xBF58_476D_1CE4_E5B9uL)
		z = z xor (generation.toULong() * 0x94D0_49BB_1331_11EBuL)
		z = z xor slot.rawSlot
		return splitMix64Unit(z)
	}
}
