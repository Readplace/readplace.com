package com.readplace.android.app

/**
 * The reader page's load lifecycle, derived from the WebView's navigation
 * callbacks and its reported progress. The sheet drives its loading overlay from
 * this value rather than the web view directly, so the show/hide and progress
 * decisions stay pure and unit-tested while the client/callback glue that produces
 * them is the untested OS boundary — the same split as `ReaderNavigation`.
 */
sealed interface ReaderLoadPhase {
	/** A load is in flight and nothing has painted, so the skeleton covers the page
	 * and no bar shows. The pre-commit progress is deliberately not carried here: it
	 * spikes to 1.0 and drops back as the reader URL redirects, so binding a bar to
	 * it would flash the bar full then back. */
	data object Loading : ReaderLoadPhase

	/** The main frame committed and is painting, so the bar tracks the now-monotonic
	 * reported progress while the skeleton lifts. */
	data class Rendering(val progress: Double) : ReaderLoadPhase

	data object Finished : ReaderLoadPhase

	data object Failed : ReaderLoadPhase
}

/**
 * What the sheet renders for a given load phase: whether the skeleton still covers
 * the page, whether the top progress bar shows, and how full it is.
 */
data class ReaderLoadOverlay(
	val showsSkeleton: Boolean,
	val showsProgressBar: Boolean,
	val progress: Double,
)

object ReaderLoad {
	/** The rendering phase for a post-commit progress report, clamped to [0, 1] (the
	 * progress callback can report slightly out of range). */
	fun rendering(estimatedProgress: Double): ReaderLoadPhase =
		ReaderLoadPhase.Rendering(estimatedProgress.coerceIn(0.0, 1.0))

	fun overlay(phase: ReaderLoadPhase): ReaderLoadOverlay =
		when (phase) {
			ReaderLoadPhase.Loading ->
				// A fixed head start, not the live pre-commit progress (which spikes to
				// 1.0 and drops back): the bar shows work is underway from the first
				// frame without ever flashing full.
				ReaderLoadOverlay(showsSkeleton = true, showsProgressBar = true, progress = HEAD_START)
			is ReaderLoadPhase.Rendering ->
				// Floored at the head start so the bar never moves backwards when the
				// first committed progress report is below it.
				ReaderLoadOverlay(
					showsSkeleton = false,
					showsProgressBar = true,
					progress = maxOf(HEAD_START, phase.progress),
				)
			ReaderLoadPhase.Finished, ReaderLoadPhase.Failed ->
				ReaderLoadOverlay(showsSkeleton = false, showsProgressBar = false, progress = 1.0)
		}

	private const val HEAD_START = 0.1

	/**
	 * Whether a navigation error is a page the user failed to open, versus a
	 * cancellation the reader provokes itself. A first navigation superseded by a
	 * redirect, and a navigation the app cancels from its own navigation client,
	 * both abort as Chromium's `net::ERR_ABORTED` — which has no `WebViewClient`
	 * constant of its own and so arrives as `ERROR_UNKNOWN`. Neither means the
	 * article couldn't load, so both keep the loader waiting for the real result. A
	 * failure the WebView reports without an error code (a TLS or HTTP error handed
	 * to another callback) is a real one.
	 */
	fun isRealFailure(errorCode: Int?): Boolean =
		when (errorCode) {
			ERROR_UNKNOWN -> false
			else -> true
		}

	/** `WebViewClient.ERROR_UNKNOWN`, mirrored rather than imported so this decision
	 * stays a pure core with no framework on its classpath. */
	private const val ERROR_UNKNOWN = -1
}
