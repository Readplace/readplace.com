package com.readplace.android.app

import com.readplace.android.core.CaptureTrigger
import com.readplace.android.core.CapturedPage
import com.readplace.android.core.HtmlCapturing
import com.readplace.android.core.ReadplaceApi
import com.readplace.android.share.saveContentForm

enum class CaptureEnding { Copied, NotCopied }

enum class HealBlockedOutcome {
	HEALED,
	CAPTURE_WAS_EMPTY,
	NO_SAVE_CONTENT_ACTION,
	PAGE_NOT_SERVED,
	;

	val failureText: String?
		get() = when (this) {
			HEALED -> null
			CAPTURE_WAS_EMPTY -> "This device couldn't capture that page either — the site returned nothing to save."
			NO_SAVE_CONTENT_ACTION -> "The server offered no way to save the captured page."
			PAGE_NOT_SERVED -> "This device couldn't load the article either — the site answered with an error page instead of it."
		}

	val ending: CaptureEnding
		get() = if (this == HEALED) CaptureEnding.Copied else CaptureEnding.NotCopied
}

class HealBlockedArticle(
	private val api: ReadplaceApi,
	private val captor: HtmlCapturing,
) {
	suspend fun run(url: String, trigger: CaptureTrigger): HealBlockedOutcome {
		val captured = captor.capture(url)
		if (captured !is CapturedPage.Html || captured.html.isEmpty()) return HealBlockedOutcome.CAPTURE_WAS_EMPTY
		if (!captured.servedArticle) return HealBlockedOutcome.PAGE_NOT_SERVED
		val page = api.loadReadlist()
		val action = page.action(named = "save-content") ?: return HealBlockedOutcome.NO_SAVE_CONTENT_ACTION
		api.saveContent(
			action,
			saveContentForm(
				url = url,
				bytes = captured.html.toByteArray(Charsets.UTF_8),
				mediaType = "text/html",
				title = captured.title,
				captureTrigger = trigger,
			),
		)
		return HealBlockedOutcome.HEALED
	}
}
