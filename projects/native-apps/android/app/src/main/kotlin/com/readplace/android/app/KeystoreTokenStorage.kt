package com.readplace.android.app

import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.readplace.android.core.TokenKey
import com.readplace.android.core.TokenStorage
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The Keychain's Android counterpart: each token string is sealed with an
 * AES-GCM key that lives in the AndroidKeyStore (never exportable) and the sealed
 * bytes sit in app-private SharedPreferences. `allowBackup=false` in the manifest
 * keeps the sealed values off cloud backups, as the Keychain's device-only
 * accessibility did on iOS.
 *
 * Reads keep the two failure classes apart the way the iOS store did: an absent
 * entry is a signed-out account (success carrying null), while a Keystore or
 * decrypt failure is an unreadable store (failure) — the share target reports
 * that as "store unavailable", never as "sign in first".
 */
class KeystoreTokenStorage(private val preferences: SharedPreferences) : TokenStorage {
	override fun readValue(key: TokenKey): Result<String?> {
		val sealed = preferences.getString(key.storageKey, null) ?: return Result.success(null)
		return runCatching { open(Base64.decode(sealed, Base64.NO_WRAP)) }
	}

	override fun setValue(key: TokenKey, value: String) {
		val sealed = seal(value)
		preferences.edit().putString(key.storageKey, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
	}

	override fun removeValue(key: TokenKey) {
		preferences.edit().remove(key.storageKey).apply()
	}

	private fun seal(plain: String): ByteArray {
		val cipher = Cipher.getInstance(TRANSFORMATION)
		cipher.init(Cipher.ENCRYPT_MODE, secretKey())
		val iv = cipher.iv
		val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
		return byteArrayOf(iv.size.toByte()) + iv + body
	}

	private fun open(sealed: ByteArray): String {
		if (sealed.isEmpty()) throw GeneralSecurityException("empty sealed value")
		val ivLength = sealed[0].toInt()
		if (ivLength <= 0 || sealed.size < 1 + ivLength) throw GeneralSecurityException("truncated sealed value")
		val iv = sealed.copyOfRange(1, 1 + ivLength)
		val body = sealed.copyOfRange(1 + ivLength, sealed.size)
		val cipher = Cipher.getInstance(TRANSFORMATION)
		cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, iv))
		return String(cipher.doFinal(body), Charsets.UTF_8)
	}

	private fun secretKey(): SecretKey {
		val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
		val existing = keyStore.getKey(KEY_ALIAS, null)
		if (existing is SecretKey) return existing
		val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
		generator.init(
			KeyGenParameterSpec.Builder(
				KEY_ALIAS,
				KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
			)
				.setBlockModes(KeyProperties.BLOCK_MODE_GCM)
				.setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
				.setKeySize(256)
				.build(),
		)
		return generator.generateKey()
	}

	companion object {
		const val PREFERENCES_NAME = "com.readplace.oauth"
		private const val KEYSTORE = "AndroidKeyStore"
		private const val KEY_ALIAS = "com.readplace.oauth.tokens"
		private const val TRANSFORMATION = "AES/GCM/NoPadding"
		private const val TAG_BITS = 128
	}
}
