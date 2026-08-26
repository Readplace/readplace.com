package com.readplace.android.app

/**
 * The native dialog a page's JS dialog call maps to. WebView suppresses
 * `window.confirm()`/`window.alert()` unless the host implements
 * `WebChromeClient`, so a suppressed dialog silently answers false and whatever it
 * gated does nothing in-app — the app hosts the server's pages, so it must answer
 * the dialogs those pages raise. Pure and a value type so the panel-kind → dialog
 * mapping is unit-tested without a web view, like `ReaderNavigation` before it; the
 * `AlertDialog` glue that presents it is `presentWebDialog` in `ReaderWebView.kt`
 * (OS boundary).
 */
data class WebDialog(
	val message: String,
	val choices: List<Choice>,
	/** The answer given when no dialog can be presented (the web view has no
	 * window). The page's script must never hang on an unanswered handler, and an
	 * unpresentable confirm must refuse — never affirm — the action it gates. */
	val unpresentedAnswer: Boolean,
) {
	/**
	 * One tappable choice, carrying the boolean it answers the page's `confirm()`
	 * with. An alert's single OK carries one too — the alert completion ignores it —
	 * so both dialog kinds flow through the one presentation path with a single
	 * answer contract.
	 */
	data class Choice(
		val title: String,
		val style: Style,
		val answer: Boolean,
	) {
		/** The role the presentation glue renders a choice in: the same three the
		 * iOS app names with `UIAlertAction.Style`, kept as a value here because the
		 * platform's dialog buttons carry no style of their own. */
		enum class Style { CANCEL, DESTRUCTIVE, DEFAULT }
	}

	companion object {
		/** `window.confirm()`: Cancel/OK, matching the browser's two-button
		 * semantics. The affirmative choice renders destructive because a page only
		 * reaches for a confirm to gate something it can't take back: over-warning a
		 * benign confirm is safer than under-warning a destructive one, and the
		 * message itself is the page's to write. */
		fun confirm(message: String): WebDialog =
			WebDialog(
				message = message,
				choices = listOf(
					Choice(title = "Cancel", style = Choice.Style.CANCEL, answer = false),
					Choice(title = "OK", style = Choice.Style.DESTRUCTIVE, answer = true),
				),
				unpresentedAnswer = false,
			)

		/** `window.alert()`: a single OK that only acknowledges. */
		fun alert(message: String): WebDialog =
			WebDialog(
				message = message,
				choices = listOf(Choice(title = "OK", style = Choice.Style.DEFAULT, answer = true)),
				unpresentedAnswer = true,
			)
	}
}
