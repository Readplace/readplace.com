package com.readplace.android.core

/**
 * The rendered page content captured from a WebView, keyed by what the loaded
 * main-frame resource turned out to be: a rendered page (`text/html`) and its
 * title, a PDF the captor declined to render, or nothing because the load failed
 * before a response. Telling the PDF apart lets the save journey pick the
 * matching `save-content` upload instead of degrading every non-HTML resource
 * to a URL-only crawl.
 */
sealed interface CapturedPage {
	data class Html(val html: String, val title: String?) : CapturedPage

	data object PdfDetected : CapturedPage

	data object Empty : CapturedPage
}

/**
 * Renders a page to its HTML. Abstracted so a test can supply a canned page
 * instead of driving a real (and non-deterministic) WebView. Never throws: a
 * failed load yields [CapturedPage.Empty] so the caller can degrade to a
 * URL-only save.
 */
interface HtmlCapturing {
	suspend fun capture(url: String): CapturedPage
}
