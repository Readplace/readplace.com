package com.readplace.android.core

/**
 * The last readlist the server confirmed as current, kept for offline launch. Written only when
 * a server response marks a readlist current — never on a menu tap the server has
 * not yet confirmed — and forgotten on deliberate sign-out (not on a forced or
 * expiry logout, which preserves it).
 */
class LastViewedReadlist(private val storage: ReaderChoiceStorage) {
	val href: String? get() = storage.getString(KEY)

	fun remember(href: String) {
		storage.putString(KEY, href)
	}

	val homeHref: String? get() = storage.getString(HOME_KEY)
	val currentTabHref: String? get() = storage.getString(TAB_KEY)

	fun remember(homeHref: String?, currentTabHref: String?) {
		if (homeHref == null) storage.remove(HOME_KEY) else storage.putString(HOME_KEY, homeHref)
		if (currentTabHref == null) storage.remove(TAB_KEY) else storage.putString(TAB_KEY, currentTabHref)
	}

	fun forget() {
		storage.remove(HOME_KEY)
		storage.remove(TAB_KEY)
		storage.remove(KEY)
	}

	private companion object {
		const val HOME_KEY = "readingList.cachedHomeHref"
		const val TAB_KEY = "readingList.cachedCurrentTabHref"
		const val KEY = "readingList.lastViewedReadlistHref"
	}
}
