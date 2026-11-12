package com.readplace.android.core

import java.io.IOException

object OfflineReading {
	const val BANNER_TEXT = "Your internet is not working, your reading is offline. Readplace is read-only until you're back online."

	const val EMPTY_LIST_TEXT = "You're offline. Your reading list will appear once you're back online."

	fun isTransportFailure(error: Throwable): Boolean = error is IOException
}
