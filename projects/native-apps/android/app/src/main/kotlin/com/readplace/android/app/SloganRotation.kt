package com.readplace.android.app

import java.time.Instant
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** A slogan is always shown as a pull quote — a reader's review of Readplace. */
fun sloganAsReview(slogan: String): String = "“$slogan”"

data class SloganLine(
	val text: String,
	val pose: TextPose,
)

data class SubtitleFrame(
	val outgoing: SloganLine,
	val incoming: SloganLine,
)

/**
 * The sign-in screen's motion state, owned once above login so its storm clock and
 * seed survive the screen coming and going (see [SloganRotationOwner]). It holds
 * the published slogans, which one is current, and the hand-over — if any — that is
 * carrying one slogan into the next, all timed on a single [WaveClock] that both
 * wave zones and the comet read so the sky and the words never disagree.
 *
 * Pure and deterministic: time enters through [advance]/[subtitle]/[setPaused] as
 * an [Instant], so a test drives the whole hand-over without a real clock.
 */
class SloganRotation(
	val seed: ULong,
	private val intervalMillis: Long,
	startedAt: Instant,
	fallback: String,
) {
	private val _clock = MutableStateFlow(WaveClock(accumulated = 0.0, resumedAt = startedAt))
	val clock: StateFlow<WaveClock> = _clock.asStateFlow()

	private val _slogans = MutableStateFlow(listOf(fallback))
	val slogans: StateFlow<List<String>> = _slogans.asStateFlow()

	private val _index = MutableStateFlow(0)
	val index: StateFlow<Int> = _index.asStateFlow()

	private val _handoff = MutableStateFlow<SloganHandoff?>(null)
	val handoff: StateFlow<SloganHandoff?> = _handoff.asStateFlow()

	private var handoffCount = 0

	val current: String
		get() = _slogans.value[_index.value]

	/**
	 * Replaces the list and restarts from its first entry, dropping any in-flight
	 * hand-over. An empty publication is ignored: the compiled-in fallback (or the
	 * previous list) is already the right answer, and sign-in is not worth a blank
	 * where a slogan should be.
	 */
	fun publish(published: List<String>) {
		if (published.isEmpty()) return
		_slogans.value = published
		_index.value = 0
		_handoff.value = null
	}

	fun advance(at: Instant) {
		val next = (_index.value + 1) % _slogans.value.size
		_handoff.value = SloganHandoff(
			outgoing = _slogans.value[_index.value],
			incoming = _slogans.value[next],
			startedAt = _clock.value.elapsed(at),
			ordinal = handoffCount,
			seed = seed,
		)
		handoffCount += 1
		_index.value = next
	}

	fun settledSubtitle(): SubtitleFrame =
		SubtitleFrame(
			outgoing = SloganLine(text = "", pose = TextPose.hidden),
			incoming = SloganLine(text = sloganAsReview(current), pose = TextPose.shown),
		)

	fun subtitle(at: Instant): SubtitleFrame {
		val handoff = _handoff.value ?: return settledSubtitle()
		val poses = handoff.poses(_clock.value.elapsed(at))
		return SubtitleFrame(
			outgoing = SloganLine(text = sloganAsReview(handoff.outgoing), pose = poses.outgoing),
			incoming = SloganLine(text = sloganAsReview(handoff.incoming), pose = poses.incoming),
		)
	}

	/** Freezes or restarts the one clock every zone and the comet read, so the app
	 * going to the background never plays time back on return. */
	fun setPaused(paused: Boolean, at: Instant) {
		_clock.value = if (paused) _clock.value.pausing(at) else _clock.value.resuming(at)
	}

	/**
	 * Loads the published slogans, then hands them over one to the next for as long
	 * as the caller's coroutine lives — the sign-in screen cancels it on leaving,
	 * and a signed-in user never returns to the screen.
	 *
	 * A reader who asked for reduced motion gets the first slogan and no cycling:
	 * text swapping under them is exactly the motion that setting turns off.
	 */
	suspend fun run(reduceMotion: Boolean, now: () -> Instant, load: suspend () -> List<String>) {
		publish(load())
		if (reduceMotion || _slogans.value.size <= 1) return
		while (true) {
			delay(intervalMillis)
			advance(now())
		}
	}
}
