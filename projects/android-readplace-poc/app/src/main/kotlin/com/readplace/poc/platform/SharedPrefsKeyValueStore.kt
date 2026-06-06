package com.readplace.poc.platform

import android.content.Context
import androidx.core.content.edit
import com.readplace.poc.core.KeyValueStore

/**
 * A `SharedPreferences`-backed [KeyValueStore]. POC-grade: a production app would
 * keep the OAuth tokens in `EncryptedSharedPreferences` / the Android Keystore.
 */
class SharedPrefsKeyValueStore(context: Context) : KeyValueStore {
	private val prefs = context.applicationContext.getSharedPreferences("readplace", Context.MODE_PRIVATE)

	override fun getString(key: String): String? = prefs.getString(key, null)

	override fun putString(key: String, value: String) = prefs.edit { putString(key, value) }

	override fun remove(key: String) = prefs.edit { remove(key) }
}
