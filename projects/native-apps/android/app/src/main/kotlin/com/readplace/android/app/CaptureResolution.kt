package com.readplace.android.app

import com.readplace.android.core.CapturedPage

/**
 * How an off-screen capture concludes once the WebView race settles, decided from
 * three facts the [HtmlCaptor] holds when its timeout budget returns: whether a
 * navigation callback already resolved the page (a main-frame PDF, or an
 * error/HTTP failure that fails the load), whether navigation ever started, and
 * whether the first load finished. Kept apart from the WebView so the branching
 * is a pure value the tests exercise directly, the way [CaptureDecision] already
 * is — the WebView glue that feeds it is not unit-coverable.
 *
 * The load now waits for a nonzero phone-sized layout before navigating, and that
 * wait shares the one capture timeout. So the budget can elapse *before* a page is
 * ever requested, which is the case [NothingLoaded] names: there is no partial DOM
 * to keep, and extracting a never-navigated WebView would upload a blank document.
 */
sealed interface CaptureResolution {
	/** A navigation callback already resolved the page (a PDF captured as a file,
	 * or a load that failed): hand it back untouched, no extraction. */
	data class Settled(val page: CapturedPage) : CaptureResolution

	/** The timeout elapsed before navigation began — the layout never reached a
	 * nonzero size in budget, so nothing was loaded and there is nothing to
	 * extract. */
	data object NothingLoaded : CaptureResolution

	/** The first load finished within budget: extract after the settle delay so
	 * script-rendered content is present. */
	data object ExtractAfterSettle : CaptureResolution

	/** The timeout elapsed after navigation began: extract whatever partial DOM
	 * the page holds now, with no further settle. */
	data object ExtractPartial : CaptureResolution

	companion object {
		/**
		 * @param settledPage the page a navigation callback resolved, or null when
		 *   the capture ended by finishing its first load or by timing out.
		 * @param navigationStarted whether the WebView was ever asked to load — false
		 *   when the timeout elapsed during the pre-navigation layout wait.
		 * @param loadFinished whether the first load reported completion.
		 */
		fun of(
			settledPage: CapturedPage?,
			navigationStarted: Boolean,
			loadFinished: Boolean,
		): CaptureResolution =
			when {
				settledPage != null -> Settled(settledPage)
				!navigationStarted -> NothingLoaded
				loadFinished -> ExtractAfterSettle
				else -> ExtractPartial
			}
	}
}
