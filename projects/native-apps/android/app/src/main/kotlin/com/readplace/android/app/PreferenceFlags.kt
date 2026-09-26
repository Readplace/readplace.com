package com.readplace.android.app

import android.content.SharedPreferences
import com.readplace.android.core.ReaderChoiceStorage

/** The SharedPreferences seam behind [KeyValueFlags], the one place the launch
 * intro's flags touch the OS. */
class PreferenceFlags(private val preferences: SharedPreferences) : KeyValueFlags {
	override fun getBoolean(key: String): Boolean? =
		if (preferences.contains(key)) preferences.getBoolean(key, false) else null

	override fun putBoolean(key: String, value: Boolean) {
		preferences.edit().putBoolean(key, value).apply()
	}

	companion object {
		const val PREFERENCES_NAME = "com.readplace.flags"
	}
}

/** The SharedPreferences seam behind [ReaderChoiceStorage], the one place the
 * reader's persistent readlist/share choices touch the OS. In its own app-private
 * preferences file, kept apart from the launch-intro flags and from the share
 * artifacts a sign-out purges. `getStringSet(key, null)` returns null only when the
 * key was never written, so a written empty set reads back as empty (a real
 * answer); the set is copied out of, and into, the store so no caller shares
 * SharedPreferences' own instance. */
class PreferenceReaderChoiceStorage(private val preferences: SharedPreferences) : ReaderChoiceStorage {
	override fun getString(key: String): String? = preferences.getString(key, null)

	override fun putString(key: String, value: String) {
		preferences.edit().putString(key, value).apply()
	}

	override fun getStringSet(key: String): Set<String>? = preferences.getStringSet(key, null)?.toSet()

	override fun putStringSet(key: String, values: Set<String>) {
		preferences.edit().putStringSet(key, values.toSet()).apply()
	}

	override fun remove(key: String) {
		preferences.edit().remove(key).apply()
	}

	companion object {
		const val PREFERENCES_NAME = "com.readplace.readerChoices"
	}
}
