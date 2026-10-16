package com.readplace.android.app

import android.security.keystore.KeyGenParameterSpec
import com.readplace.android.core.NativeProofInput
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.InputStream
import java.io.OutputStream
import java.security.*
import java.security.cert.Certificate
import java.security.spec.AlgorithmParameterSpec
import java.security.spec.ECGenParameterSpec
import java.util.*
import javax.crypto.KeyGenerator
import javax.crypto.KeyGeneratorSpi
import javax.crypto.SecretKey

class NativeTestKeys : KeyStoreSpi() {
	companion object { val entries = mutableMapOf<String, KeyStore.Entry>() }
	override fun engineGetEntry(alias: String, protection: KeyStore.ProtectionParameter?) = entries[alias]
	override fun engineGetKey(alias: String, password: CharArray?): Key? = when (val entry = entries[alias]) {
		is KeyStore.PrivateKeyEntry -> entry.privateKey
		is KeyStore.SecretKeyEntry -> entry.secretKey
		else -> null
	}
	override fun engineGetCertificateChain(alias: String) = (entries[alias] as? KeyStore.PrivateKeyEntry)?.certificateChain
	override fun engineGetCertificate(alias: String) = (entries[alias] as? KeyStore.PrivateKeyEntry)?.certificate
	override fun engineGetCreationDate(alias: String) = Date(0)
	override fun engineSetKeyEntry(alias: String, key: Key, password: CharArray?, chain: Array<out Certificate>?) = Unit
	override fun engineSetKeyEntry(alias: String, key: ByteArray, chain: Array<out Certificate>?) = Unit
	override fun engineSetCertificateEntry(alias: String, cert: Certificate) = Unit
	override fun engineDeleteEntry(alias: String) { entries.remove(alias) }
	override fun engineAliases(): Enumeration<String> = Collections.enumeration(entries.keys)
	override fun engineContainsAlias(alias: String) = entries.containsKey(alias)
	override fun engineSize() = entries.size
	override fun engineIsKeyEntry(alias: String) = entries.containsKey(alias)
	override fun engineIsCertificateEntry(alias: String) = false
	override fun engineGetCertificateAlias(cert: Certificate): String? = null
	override fun engineStore(stream: OutputStream?, password: CharArray?) = Unit
	override fun engineLoad(stream: InputStream?, password: CharArray?) = Unit
}

class NativeTestAES : KeyGeneratorSpi() {
	private lateinit var alias: String
	override fun engineInit(random: SecureRandom?) = Unit
	override fun engineInit(keysize: Int, random: SecureRandom?) = Unit
	override fun engineInit(params: AlgorithmParameterSpec, random: SecureRandom?) { alias = (params as KeyGenParameterSpec).keystoreAlias }
	override fun engineGenerateKey(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey().also {
		NativeTestKeys.entries[alias] = KeyStore.SecretKeyEntry(it)
	}
}

class NativeTestEC : KeyPairGeneratorSpi() {
	private lateinit var alias: String
	override fun initialize(keysize: Int, random: SecureRandom?) = Unit
	override fun initialize(params: AlgorithmParameterSpec, random: SecureRandom?) { alias = (params as KeyGenParameterSpec).keystoreAlias }
	override fun generateKeyPair(): KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair().also { pair ->
		val certificate = object : Certificate("X.509") {
			override fun getEncoded() = pair.public.encoded
			override fun verify(key: PublicKey) = Unit
			override fun verify(key: PublicKey, sigProvider: String) = Unit
			override fun toString() = "test-certificate"
			override fun getPublicKey() = pair.public
		}
		NativeTestKeys.entries[alias] = KeyStore.PrivateKeyEntry(pair.private, arrayOf(certificate))
	}
}

@RunWith(RobolectricTestRunner::class)
class NativeAuthStorageTest {
	@Before fun keys() {
		Security.removeProvider("AndroidKeyStore")
		Security.addProvider(object : Provider("AndroidKeyStore", 1.0, "test") {
			init {
				put("KeyStore.AndroidKeyStore", NativeTestKeys::class.java.name)
				put("KeyGenerator.AES", NativeTestAES::class.java.name)
				put("KeyPairGenerator.EC", NativeTestEC::class.java.name)
			}
		})
		NativeTestKeys.entries.clear()
	}

	@Test fun `record is encrypted and the next instance sees the committed replacement`() {
		val directory = kotlin.io.path.createTempDirectory().toFile()
		val first = AtomicAuthRecordStorage(directory)
		assertNull(first.read())
		first.locked { first.write("secret record") }
		assertEquals("secret record", AtomicAuthRecordStorage(directory).read())
		first.locked { first.write("replacement") }
		assertEquals("replacement", AtomicAuthRecordStorage(directory).read())
		assertFalse(java.io.File(directory, "oauth-auth-record").readBytes().contentEquals("replacement".toByteArray()))
		java.io.File(directory, "oauth-auth-record").writeBytes(byteArrayOf(1))
		assertTrue(runCatching { first.read() }.isFailure)
	}

	@Test fun `proof uses the persisted installation key and binds the exact request bytes`() {
		val signer = KeystoreRefreshProof()
		val input = NativeProofInput("https://readplace.com/oauth/token", "grant_type=refresh_token&client_id=android-app".toByteArray(), UUID.randomUUID().toString(), "nonce", UUID.randomUUID().toString())
		val encoded = signer.sign(input)
		val second = signer.sign(input.copy(nonce = null))
		val parts = encoded.split('.')
		fun decode(value: String) = Base64.getUrlDecoder().decode(value)
		val header = Json.parseToJsonElement(String(decode(parts[0]))).jsonObject
		val nextHeader = Json.parseToJsonElement(String(decode(second.split('.')[0]))).jsonObject
		assertEquals(header["jwk"], nextHeader["jwk"])
		val claims = Json.parseToJsonElement(String(decode(parts[1]))).jsonObject
		assertEquals("nonce", claims["nonce"]?.jsonPrimitive?.content)
		assertEquals(Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(input.body)), claims["readplace_body_sha256"]?.jsonPrimitive?.content)
		val raw = decode(parts[2]); assertEquals(64, raw.size)
		fun integer(bytes: ByteArray) = java.math.BigInteger(1, bytes).toByteArray().let { byteArrayOf(2, it.size.toByte()) + it }
		val integers = integer(raw.copyOfRange(0, 32)) + integer(raw.copyOfRange(32, 64))
		val der = byteArrayOf(48, integers.size.toByte()) + integers
		val publicKey = (NativeTestKeys.entries["com.readplace.oauth.dpop.${input.installation}"] as KeyStore.PrivateKeyEntry).certificate.publicKey
		assertTrue(Signature.getInstance("SHA256withECDSA").apply { initVerify(publicKey); update("${parts[0]}.${parts[1]}".toByteArray()) }.verify(der))
	}

	@Test fun `failed write rolls back and an interrupted write restores the backup`() {
		val directory = kotlin.io.path.createTempDirectory().toFile()
		val base = java.io.File(directory, "oauth-auth-record")
		AtomicAuthRecordStorage(directory).write("previous")
		val atomic = object : android.util.AtomicFile(base) {
			override fun startWrite(): java.io.FileOutputStream {
				super.startWrite().close()
				return object : java.io.FileOutputStream(java.io.File(base.path + ".new")) {
					override fun write(bytes: ByteArray) { throw java.io.IOException("disk full") }
				}
			}
		}
		assertTrue(runCatching { AtomicAuthRecordStorage(directory, atomic).write("replacement") }.isFailure)
		assertEquals("previous", AtomicAuthRecordStorage(directory).read())
		assertTrue(base.renameTo(java.io.File(directory, base.name + ".bak")))
		assertEquals("previous", AtomicAuthRecordStorage(directory).read())
	}
}
