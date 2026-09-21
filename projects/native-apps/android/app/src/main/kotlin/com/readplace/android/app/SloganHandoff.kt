package com.readplace.android.app

/**
 * A subtitle line's visual state: fully shown ([shown]) collapses toward gone
 * ([hidden]) as the words condense into the spark that carries them away.
 */
data class TextPose(
	val opacity: Double,
	val scale: Double,
	val blur: Double,
) {
	companion object {
		/** The words at [amount] of the way condensed: fading, shrinking, and
		 * blurring together in step. */
		fun condensed(amount: Double): TextPose =
			TextPose(opacity = 1 - amount, scale = 1 - 0.55 * amount, blur = 6 * amount)

		val shown: TextPose = condensed(0.0)
		val hidden: TextPose = condensed(1.0)
	}
}

data class TextPoses(
	val outgoing: TextPose,
	val incoming: TextPose,
)

/** The comet's bright point: a solid core inside a softer glow, in the hue of the
 * slogan it is carrying. */
data class StarHead(
	val center: WavePoint,
	val coreRadius: Double,
	val glowRadius: Double,
	val opacity: Double,
	val hue: CosmicHue,
)

/** One frame of the comet: its tapered trail and, while it burns, its head. */
data class SloganComet(
	val strokes: List<FilamentStroke>,
	val head: StarHead?,
) {
	companion object {
		val idle = SloganComet(strokes = emptyList(), head = null)
	}
}

/**
 * A quadratic curve bowed off the straight line between two points, so the comet
 * arcs across the wordmark instead of shooting through it like a bullet.
 */
class CometPath(
	val start: WavePoint,
	val control: WavePoint,
	val end: WavePoint,
) {
	fun point(u: Double): WavePoint {
		val v = 1 - u
		return WavePoint(
			x = v * v * start.x + 2 * v * u * control.x + u * u * end.x,
			y = v * v * start.y + 2 * v * u * control.y + u * u * end.y,
		)
	}

	fun samples(from: Double, to: Double, count: Int): List<WavePoint> =
		(0 until count).map { point(from + (to - from) * it.toDouble() / (count - 1).toDouble()) }

	companion object {
		fun bowed(from: WavePoint, to: WavePoint, bow: Double): CometPath {
			val chordX = to.x - from.x
			val chordY = to.y - from.y
			return CometPath(
				start = from,
				control = WavePoint(
					x = (from.x + to.x) / 2 - chordY * bow,
					y = (from.y + to.y) / 2 + chordX * bow,
				),
				end = to,
			)
		}
	}
}

/**
 * The whole slogan hand-over as pure geometry over one storm-clock timeline: the
 * outgoing words condense into a spark, the spark flies up and strikes the sky,
 * a star leaves that strike, descends, and blooms into the incoming words. Seeded
 * off [seed] and [ordinal] so every hand-over lands somewhere new in its own hue,
 * and deterministic in [elapsed] so the same moment always draws the same frame.
 */
data class SloganHandoff(
	val outgoing: String,
	val incoming: String,
	val startedAt: Double,
	val ordinal: Int,
	val seed: ULong,
) {
	val hue: CosmicHue
		get() = CosmicHue.entries[(unit(Slot.HUE) * CosmicHue.entries.size.toDouble()).toInt()]

	fun landing(sky: WaveRect): WavePoint =
		WavePoint(
			x = sky.x + (0.18 + 0.64 * unit(Slot.LANDING_X)) * sky.width,
			y = sky.y + (0.15 + 0.60 * unit(Slot.LANDING_Y)) * sky.height,
		)

	fun visit(sky: WaveRect): StarVisit =
		StarVisit(anchor = landing(sky), bornAt = startedAt + LANDING_AT, hue = hue, ordinal = ordinal)

	fun poses(elapsed: Double): TextPoses {
		val t = elapsed - startedAt
		return TextPoses(
			outgoing = TextPose.condensed(smoothstep(clamped(t / COLLAPSE_SECONDS))),
			incoming = TextPose.condensed(1 - smoothstep(clamped((t - ARRIVAL_AT) / BLOOM_SECONDS))),
		)
	}

	fun comet(elapsed: Double, subtitleCenter: WavePoint, sky: WaveRect, launch: WavePoint): SloganComet {
		val t = elapsed - startedAt
		if (t < 0 || t >= DURATION) return SloganComet.idle
		if (t < ASCENT_START) {
			val spark = smoothstep(t / ASCENT_START)
			return SloganComet(
				strokes = emptyList(),
				head = StarHead(
					center = subtitleCenter,
					coreRadius = CORE_RADIUS * spark,
					glowRadius = GLOW_RADIUS * spark,
					opacity = COMET_OPACITY * spark,
					hue = hue,
				),
			)
		}
		val bow = if (unit(Slot.BOW) < 0.5) -BOW else BOW
		if (t < DESCENT_START) {
			val ascent = CometPath.bowed(from = subtitleCenter, to = landing(sky), bow = bow)
			return flight(path = ascent, since = t - ASCENT_START, headFades = true)
		}
		val descent = CometPath.bowed(from = launch, to = subtitleCenter, bow = bow)
		val inFlight = flight(path = descent, since = t - DESCENT_START, headFades = false)
		if (t < ARRIVAL_AT) return inFlight
		val bloom = smoothstep((t - ARRIVAL_AT) / BLOOM_SECONDS)
		return SloganComet(
			strokes = inFlight.strokes,
			head = StarHead(
				center = subtitleCenter,
				coreRadius = CORE_RADIUS,
				glowRadius = GLOW_RADIUS + (BLOOM_RADIUS - GLOW_RADIUS) * bloom,
				opacity = COMET_OPACITY * (1 - bloom),
				hue = hue,
			),
		)
	}

	private fun flight(path: CometPath, since: Double, headFades: Boolean): SloganComet {
		val u = smoothstep(minOf(1.0, since / FLIGHT_SECONDS))
		val drain = clamped((since - FLIGHT_SECONDS) / DRAIN_SECONDS)
		val tailStart = maxOf(0.0, u - TAIL_SPAN * (1 - drain))
		val strokes = if (u > tailStart) {
			FilamentStroke.tapered(
				along = path.samples(from = tailStart, to = u, count = FilamentStroke.SAMPLE_COUNT),
				hue = hue,
				lane = COMET_LANE,
				tone = StrokeTone.STAR,
				coreOpacity = COMET_OPACITY,
			)
		} else {
			emptyList()
		}
		val headOpacity = COMET_OPACITY * (if (headFades) 1 - drain else 1.0)
		val head = if (headOpacity > 0) {
			StarHead(
				center = path.point(u),
				coreRadius = CORE_RADIUS,
				glowRadius = GLOW_RADIUS,
				opacity = headOpacity,
				hue = hue,
			)
		} else {
			null
		}
		return SloganComet(strokes = strokes, head = head)
	}

	private fun clamped(x: Double): Double = minOf(1.0, maxOf(0.0, x))

	private enum class Slot(val raw: ULong) {
		LANDING_X(1uL),
		LANDING_Y(2uL),
		BOW(3uL),
		HUE(4uL),
	}

	private fun unit(slot: Slot): Double {
		var z = seed
		z = z xor (ordinal.toULong() * 0x9E37_79B9_7F4A_7C15uL)
		z = z xor (slot.raw * 0xBF58_476D_1CE4_E5B9uL)
		return splitMix64Unit(z)
	}

	companion object {
		const val COLLAPSE_SECONDS = 0.30
		const val ASCENT_START = 0.20
		const val FLIGHT_SECONDS = 0.70
		const val DRAIN_SECONDS = 0.20
		const val LANDING_AT = ASCENT_START + FLIGHT_SECONDS
		const val DESCENT_START = LANDING_AT + 0.45
		const val ARRIVAL_AT = DESCENT_START + FLIGHT_SECONDS
		const val BLOOM_SECONDS = 0.45
		const val DURATION = ARRIVAL_AT + BLOOM_SECONDS

		private const val TAIL_SPAN = 0.35
		private const val BOW = 0.28
		private const val CORE_RADIUS = 4.5
		private const val GLOW_RADIUS = 13.0
		private const val BLOOM_RADIUS = 64.0
		private const val COMET_OPACITY = 0.85
		private const val COMET_LANE = -1
	}
}
