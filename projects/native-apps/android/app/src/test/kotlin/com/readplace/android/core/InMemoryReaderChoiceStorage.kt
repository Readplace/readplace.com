package com.readplace.android.core

/**
 * An in-memory [ReaderChoiceStorage] for tests: a single backing map so store
 * instances built over the same fake read each other's writes, the way separate
 * store instances over one `SharedPreferences` file do. Values are held as given —
 * the fake never copies — so a test that mutates a set it wrote can prove the store,
 * not the seam, is what copies at the boundary.
 */
class InMemoryReaderChoiceStorage : ReaderChoiceStorage {
	val strings = mutableMapOf<String, String>()
	val sets = mutableMapOf<String, Set<String>>()

	override fun getString(key: String): String? = strings[key]

	override fun putString(key: String, value: String) {
		strings[key] = value
	}

	override fun getStringSet(key: String): Set<String>? = sets[key]

	override fun putStringSet(key: String, values: Set<String>) {
		sets[key] = values
	}

	override fun remove(key: String) {
		strings.remove(key)
		sets.remove(key)
	}
}
