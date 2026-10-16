package com.readplace.android.app

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import com.readplace.android.core.AuthRecordStorage
import java.io.File
import java.io.RandomAccessFile
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class AtomicAuthRecordStorage(directory: File,
	private val file: AtomicFile = AtomicFile(File(directory, "oauth-auth-record"))) : AuthRecordStorage {
	private val lock = File(directory, "oauth-auth-record.lock")
	private val alias = "com.readplace.oauth.record"

	override fun <T> locked(work: () -> T): T = synchronized(processLock) {
		RandomAccessFile(lock, "rw").use { descriptor -> descriptor.channel.lock().use { work() } }
	}

	override fun read(): String? {
		if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) return null
		val data = file.readFully()
		require(data.size >= 13) { "Invalid encrypted authentication record" }
		val cipher = Cipher.getInstance("AES/GCM/NoPadding")
		cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(0, 12)))
		return String(cipher.doFinal(data.copyOfRange(12, data.size)), Charsets.UTF_8)
	}

	override fun write(value: String) {
		val cipher = Cipher.getInstance("AES/GCM/NoPadding")
		cipher.init(Cipher.ENCRYPT_MODE, key())
		val bytes = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
		val output = file.startWrite()
		try { output.write(bytes); file.finishWrite(output) }
		catch (error: Exception) { file.failWrite(output); throw error }
	}

	private fun key(): SecretKey {
		val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
		(store.getKey(alias, null) as? SecretKey)?.let { return it }
		val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
		generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
			.setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
		return generator.generateKey()
	}

	companion object { private val processLock = Any() }
}
