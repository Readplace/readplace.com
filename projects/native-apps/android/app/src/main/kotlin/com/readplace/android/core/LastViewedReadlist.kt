package com.readplace.android.core

/**
 * The last readlist the server confirmed as current, remembered so a cold launch
 * reopens it directly instead of flashing the entry point first. Written only when
 * a server response marks a readlist current — never on a menu tap the server has
 * not yet confirmed — and forgotten on deliberate sign-out (not on a forced or
 * expiry logout, which preserves it).
 */
class LastViewedReadlist(private val storage: ReaderChoiceStorage) {
	val href: String? get() = storage.getString(KEY)

	fun remember(href: String) {
		storage.putString(KEY, href)
	}

	fun forget() {
		storage.remove(KEY)
	}

	private companion object {
		const val KEY = "readingList.lastViewedReadlistHref"
	}
}
