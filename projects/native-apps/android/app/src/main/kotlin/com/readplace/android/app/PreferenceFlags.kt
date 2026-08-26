package com.readplace.android.app

import android.content.SharedPreferences

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
