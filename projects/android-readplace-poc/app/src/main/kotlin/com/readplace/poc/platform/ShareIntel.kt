package com.readplace.poc.platform

import android.content.Intent
import com.readplace.poc.core.UrlDetection

/** A link (and any provided title) pulled out of an Android share intent. */
data class SharedLink(val url: String, val title: String?)

/**
 * Pulls the shared URL (and any provided title) out of an `ACTION_SEND` text/plain
 * intent — the Android analogue of the iOS `ShareURLExtractor`. Apps usually share a
 * link as the bare URL or "Title https://…" in `EXTRA_TEXT`; both are handled by
 * extracting the first http(s) URL.
 */
object ShareIntel {
	fun extract(intent: Intent?): SharedLink? {
		if (intent?.action != Intent.ACTION_SEND) return null
		val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
		val url = UrlDetection.firstWebUrl(text) ?: return null
		return SharedLink(url, intent.getStringExtra(Intent.EXTRA_SUBJECT))
	}
}
