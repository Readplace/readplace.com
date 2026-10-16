package com.readplace.android.app

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.readplace.android.core.NativeProof
import com.readplace.android.core.NativeProofInput
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import java.util.UUID

class KeystoreRefreshProof : NativeProof {
	override fun sign(input: NativeProofInput): String = synchronized(lock) {
		val alias = "com.readplace.oauth.dpop.${input.installation}"
		val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
		if (!store.containsAlias(alias)) {
			val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
			generator.initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
				.setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build())
			generator.generateKeyPair()
		}
		val entry = store.getEntry(alias, null) as KeyStore.PrivateKeyEntry
		val point = (entry.certificate.publicKey as ECPublicKey).w
		fun coordinate(value: java.math.BigInteger): String = encode(value.toByteArray().takeLast(32).toByteArray().let { ByteArray(32 - it.size) + it })
		val header = buildJsonObject {
			put("typ", "dpop+jwt"); put("alg", "ES256")
			put("jwk", buildJsonObject { put("kty", "EC"); put("crv", "P-256"); put("x", coordinate(point.affineX)); put("y", coordinate(point.affineY)) })
		}
		val claims = buildJsonObject {
			put("htu", input.url); put("htm", "POST"); put("iat", System.currentTimeMillis() / 1000)
			put("jti", UUID.randomUUID().toString()); put("readplace_operation_id", input.operation)
			put("readplace_body_sha256", encode(MessageDigest.getInstance("SHA-256").digest(input.body)))
			input.nonce?.let { put("nonce", it) }
		}
		val unsigned = encode(header.toString().toByteArray()) + "." + encode(claims.toString().toByteArray())
		val signature = Signature.getInstance("SHA256withECDSA").apply { initSign(entry.privateKey); update(unsigned.toByteArray()) }.sign()
		val rLength = signature[3].toInt() and 255
		val sOffset = 4 + rLength
		val sLength = signature[sOffset + 1].toInt() and 255
		fun scalar(bytes: ByteArray): ByteArray = bytes.takeLast(32).toByteArray().let { ByteArray(32 - it.size) + it }
		val raw = scalar(signature.copyOfRange(4, sOffset)) + scalar(signature.copyOfRange(sOffset + 2, sOffset + 2 + sLength))
		unsigned + "." + encode(raw)
	}
	private fun encode(value: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(value)
	companion object { private val lock = Any() }
}
