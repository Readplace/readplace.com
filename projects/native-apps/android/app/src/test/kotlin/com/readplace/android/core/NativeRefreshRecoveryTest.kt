package com.readplace.android.core

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.junit4.MockWebServerRule
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.util.UUID

class NativeRefreshRecoveryTest {
	@Test fun `bounded journal retains a coalesced dropped event checkpoint without losing recovery`() {
		val records = records(); records.replace(old); val operation = records.prepare(old)
		val client = recovery(records)
		repeat(513) { client.record("context_started") }
		assertEquals(512, records.read().diagnostics.size)
		assertEquals(operation, records.read().pending)
		assertEquals("journal_health", records.read().diagnostics.last().event.event)
		assertEquals(2, records.read().diagnostics.last().event.dropped_events)
		client.record("context_started")
		assertEquals(1, records.read().diagnostics.count { it.event.event == "journal_health" })
		assertEquals(3, records.read().diagnostics.last().event.dropped_events)
	}
	@Test fun `minimal diagnostic event omits absent optional values`() {
		val event = NativeAuthEvent(UUID.randomUUID().toString(), "context_started", "2026-10-16T00:00:00Z", "android", "app", UUID.randomUUID().toString(), "117")
		val encoded = Json.encodeToJsonElement(event).jsonObject
		assertEquals(setOf("event_id", "event", "occurred_at", "client", "surface", "context_id", "client_version"), encoded.keys)
	}
	@get:Rule val serverRule = MockWebServerRule()
	private val server get() = serverRule.server
	private class Storage : AuthRecordStorage {
		var value: String? = null
		var fail = false
		var rejectReplacement = false
		override fun read() = value
		override fun write(value: String) { if (fail || (rejectReplacement && value.contains("new-access"))) throw java.io.IOException("unavailable"); this.value = value }
		override fun <T> locked(work: () -> T): T = synchronized(this) { work() }
	}
	private class Legacy : TokenStorage {
		val values = mutableMapOf<TokenKey, String>()
		override fun readValue(key: TokenKey) = Result.success(values[key])
		override fun setValue(key: TokenKey, value: String) { values[key] = value }
		override fun removeValue(key: TokenKey) { values.remove(key) }
	}
	private fun records(storage: Storage = Storage(), legacy: Legacy = Legacy()) = NativeAuthRecords(storage, legacy)
	private fun recovery(records: NativeAuthRecords, proof: NativeProof = NativeProof { "test-proof" }) = NativeRefreshRecovery(
		server.url("/").toString().removeSuffix("/"), records, OkHttpClient(), proof, "117", "app")
	private val old = OAuthTokens(AccessToken("old-access"), RefreshToken("old-refresh"))
	private fun enabled() = MockResponse.Builder().code(200).body("{\"readplace_refresh_protocols_supported\":[1],\"readplace_refresh_enrollment_enabled\":true}").build()
	private fun success(operation: String, expiry: String = "2099-01-01T00:00:00Z", permit: String? = null) = MockResponse.Builder().code(200).body(buildJsonObject {
		put("access_token", "new-access"); put("refresh_token", "new-refresh")
		put("readplace", buildJsonObject {
			put("protocol", 1); put("operation_id", operation); put("access_expires_at", expiry); put("recovered", true)
			permit?.let { put("diagnostics_permit", it) }
		})
	}.toString()).build()

	@Test fun `an operation is durable before wire and nonce challenge repeats its id with fresh attempt`() = runTest {
		val records = records(); records.replace(old)
		val operation = records.prepare(old)
		val proofs = mutableListOf<NativeProofInput>()
		server.enqueue(MockResponse.Builder().code(400).addHeader("DPoP-Nonce", "nonce").body("{\"error\":\"use_dpop_nonce\"}").build())
		server.enqueue(success(operation.id))
		val restored = recovery(records, NativeProof { proofs.add(it); assertEquals(operation.id, records.read().pending?.id); "signed" }).refresh(old)
		assertEquals("new-refresh", restored?.refreshToken?.raw)
		val first = server.takeRequest(); val second = server.takeRequest()
		assertEquals(first.body?.utf8(), second.body?.utf8())
		assertNotEquals(first.headers["X-Readplace-Auth-Attempt-Id"], second.headers["X-Readplace-Auth-Attempt-Id"])
		assertEquals(listOf(null, "nonce"), proofs.map { it.nonce })
		assertEquals(null, records.read().pending)
		assertTrue(records.read().bound)
	}

	@Test fun `lost response resumes pending operation after coordinator recreation`() = runTest {
		val storage = Storage(); val records = records(storage); records.replace(old)
		val operation = records.prepare(old)
		server.enqueue(MockResponse.Builder().code(503).body("temporarily unavailable").build())
		assertTrue(runCatching { recovery(records).refresh(old) }.isFailure)
		assertEquals(old, records.read().tokens)
		val restarted = records(storage)
		server.enqueue(success(operation.id))
		assertEquals("new-access", recovery(restarted).refresh(old)?.accessToken?.raw)
		assertEquals("/oauth/token", server.takeRequest().url.encodedPath)
		assertEquals("/oauth/token", server.takeRequest().url.encodedPath)
	}

	@Test fun `logout and new login prevent a delayed response from replacing credentials`() {
		val records = records(); records.replace(old)
		val operation = records.prepare(old)
		records.replace(null)
		assertTrue(runCatching { records.commit(old, operation, null) }.exceptionOrNull() is OAuthError.SessionChanged)
		assertNull(records.read().tokens)
		val other = OAuthTokens(AccessToken("other"), RefreshToken("other")); records.replace(other)
		assertTrue(runCatching { records.commit(old, operation, null) }.isFailure)
		assertEquals(other, records.read().tokens)
	}

	@Test fun `failed durable write retains legacy credentials for retry`() {
		val storage = Storage(); val legacy = Legacy()
		legacy.setValue(TokenKey.ACCESS_TOKEN, "old-access"); legacy.setValue(TokenKey.REFRESH_TOKEN, "old-refresh")
		val records = records(storage, legacy); storage.fail = true
		assertTrue(runCatching { records.prepare(old) }.isFailure)
		assertEquals(old, records.read().tokens)
		assertEquals(2, legacy.values.size)
		storage.fail = false; records.prepare(old)
		assertEquals(0, legacy.values.size)
	}

	@Test fun `explicit revocation clears but unknown refusal preserves`() = runTest {
		for (reason in listOf("unknown", "revoked", "expired", "superseded")) {
			val records = records(); records.replace(old); records.prepare(old)
			server.enqueue(MockResponse.Builder().code(400).body("{\"error\":\"invalid_grant\",\"readplace_reason\":\"$reason\"}").build())
			assertTrue(runCatching { recovery(records).refresh(old) }.isFailure)
			assertEquals(if (reason == "unknown") old else null, records.read().tokens)
		}
	}

	@Test fun `unsupported discovery does not bind or rotate`() = runTest {
		val records = records(); records.replace(old)
		server.enqueue(MockResponse.Builder().code(200).body("{}").build())
		assertNull(recovery(records).refresh(old))
		assertEquals(old, records.read().tokens)
		assertEquals(1, server.requestCount)
	}

	@Test fun `failed replacement commit keeps pending operation and records the failure`() = runTest {
		val storage = Storage(); val records = records(storage); records.replace(old)
		val operation = records.prepare(old); storage.rejectReplacement = true
		server.enqueue(success(operation.id))
		assertTrue(runCatching { recovery(records).refresh(old) }.isFailure)
		assertEquals(operation, records.read().pending)
		assertEquals(old, records.read().tokens)
		assertEquals("storage_write_failed", records.read().diagnostics.last().event.reason)
	}

	@Test fun `diagnostics stay associated with original permit across logout and account change`() = runTest {
		val records = records(); records.replace(old)
		val recovery = recovery(records)
		val operation = records.prepare(old)
		recovery.record("refresh_prepared", operation = operation.id)
		records.commit(old, operation, "old-permit")
		val owned = records.prepare(old)
		records.replace(null)
		recovery.record("logout_completed")
		records.update { it.diagnosticIdentity = UUID.randomUUID().toString(); it.diagnosticsPermit = null }
		recovery.record("login_started")
		recovery.record("refresh_response_received", operation = owned.id, owner = owned)
		val retained = records.read().diagnostics
		val ids = retained.filter { it.permit == "old-permit" }.map { it.event.event_id }
		server.enqueue(MockResponse.Builder().code(202).body(buildJsonObject { put("accepted_event_ids", JsonArray(ids.map(::JsonPrimitive))) }.toString()).build())
		recovery.flush()
		val request = server.takeRequest()
		assertEquals("Bearer old-permit", request.headers["Authorization"])
		assertEquals(listOf("login_started"), records.read().diagnostics.map { it.event.event })
	}

	@Test fun `OAuth coordinator wires bound refresh logout and a generation fenced login`() = runTest {
		val legacy = Legacy(); val records = records(legacy = legacy); records.replace(old)
		val store = TokenStore(legacy, records)
		val operation = records.prepare(old)
		val recovery = recovery(records)
		val oauth = OAuth(server.url("/").toString().removeSuffix("/"), store, OkHttpClient(), "Readplace/117", recovery)
		server.enqueue(success(operation.id))
		assertEquals("new-access", oauth.refresh(requireNotNull(oauth.snapshot())).tokens.accessToken.raw)
		oauth.recordAuthEvent("login_prompt_shown", reason = "no_credentials")
		server.enqueue(MockResponse.Builder().code(200).body("{}").build())
		oauth.revoke()
		assertNull(store.tokens)
		server.takeRequest()
		val revoked = server.takeRequest()
		assertEquals("/oauth/revoke", revoked.url.encodedPath)
		assertEquals("new-refresh", Json.parseToJsonElement(requireNotNull(revoked.body).utf8()).jsonObject["token"]?.jsonPrimitive?.content)
		oauth.recordAuthEvent("login_started")
		server.enqueue(MockResponse.Builder().code(200).body("{\"access_token\":\"signed-in\",\"refresh_token\":\"signed-in-r\",\"diagnostics_permit\":\"login-permit\"}").build())
		server.enqueue(MockResponse.Builder().code(503).body("{}").build())
		assertEquals("signed-in", oauth.exchangeCode("code", "verifier", "readplace://oauth-callback/android").accessToken.raw)
		assertEquals("signed-in", store.tokens?.accessToken?.raw)
		val login = server.takeRequest()
		assertNull(login.headers["DPoP"])
		for (name in listOf("X-Readplace-Auth-Attempt-Id", "X-Readplace-Auth-Context-Id", "X-Readplace-Installation-Id")) assertNotNull(UUID.fromString(login.headers[name]))
		assertEquals("117", login.headers["X-Readplace-Client-Version"])
		val uploaded = server.takeRequest(2, java.util.concurrent.TimeUnit.SECONDS)
		assertEquals("Bearer login-permit", uploaded?.headers?.get("Authorization"))
		assertEquals("login-permit", records.read().diagnosticsPermit)
		assertTrue(uploaded?.body?.utf8()?.contains("login_completed") == true)
	}

	@Test fun `transport failure keeps parent and prepared operation`() = runTest {
		val records = records(); records.replace(old); val operation = records.prepare(old)
		val http = OkHttpClient.Builder().addInterceptor { throw java.io.IOException("connection lost") }.build()
		val recovery = NativeRefreshRecovery("https://readplace.com", records, http, NativeProof { "signed" }, "117", "share")
		assertTrue(runCatching { recovery.refresh(old) }.exceptionOrNull() is java.io.IOException)
		assertEquals(operation, records.read().pending)
		assertEquals(old, records.read().tokens)
	}

	@Test fun `newer credentials win over a late network response`() = runTest {
		val records = records(); records.replace(old); val operation = records.prepare(old)
		val other = OAuthTokens(AccessToken("other"), RefreshToken("other"))
		val http = OkHttpClient.Builder().addInterceptor { chain -> chain.proceed(chain.request()).also { records.replace(other) } }.build()
		server.enqueue(success(operation.id))
		val recovery = NativeRefreshRecovery(server.url("/").toString().removeSuffix("/"), records, http, NativeProof { "signed" }, "117", "app")
		assertEquals(other, recovery.refresh(old))
		assertEquals(other, records.read().tokens)
	}

	@Test fun `expired recovery commits child before requesting its new operation`() = runTest {
		val records = records(); records.replace(old); val first = records.prepare(old)
		server.enqueue(success(first.id, "2000-01-01T00:00:00Z"))
		var signed = 0
		val recovery = recovery(records, NativeProof { input ->
			signed++
			if (signed == 2) {
				assertEquals("new-refresh", records.read().tokens?.refreshToken?.raw)
				assertNotEquals(first.id, input.operation)
				server.enqueue(success(input.operation))
			}
			"signed"
		})
		assertEquals("new-refresh", recovery.refresh(old)?.refreshToken?.raw)
		assertEquals(2, signed)
	}

	@Test fun `old requests cannot adopt another account while legacy rollout still commits safely`() = runTest {
		val legacy = Legacy(); val records = records(legacy = legacy); records.replace(old)
		val oauth = OAuth(server.url("/").toString().removeSuffix("/"), TokenStore(legacy, records), OkHttpClient(), "Readplace/117")
		val original = requireNotNull(oauth.snapshot())
		server.enqueue(MockResponse.Builder().code(200).body("{\"access_token\":\"rotated\",\"refresh_token\":\"rotated\"}").build())
		assertEquals("rotated", oauth.refresh(original).tokens.accessToken.raw)
		server.takeRequest()
		val afterRotation = requireNotNull(oauth.snapshot())
		records.update { it.accountEpoch = UUID.randomUUID().toString(); it.access = "other-account"; it.refresh = "other-account" }
		assertTrue(runCatching { oauth.refresh(afterRotation) }.exceptionOrNull() is OAuthError.SessionChanged)
		assertEquals(1, server.requestCount)
		val current = requireNotNull(oauth.snapshot())
		server.enqueue(MockResponse.Builder().code(400).body("{\"error\":\"invalid_grant\"}").build())
		assertTrue(runCatching { oauth.refresh(current) }.exceptionOrNull() is OAuthError.NoRefreshToken)
		assertNull(records.read().tokens)
	}

	@Test fun `logout during nonce challenge prevents another request and redirects preserve credentials`() = runTest {
		val records = records(); records.replace(old); records.prepare(old)
		val http = OkHttpClient.Builder().addInterceptor { chain -> chain.proceed(chain.request()).also { records.replace(null) } }.build()
		server.enqueue(MockResponse.Builder().code(400).addHeader("DPoP-Nonce", "nonce").body("{\"error\":\"use_dpop_nonce\"}").build())
		val client = NativeRefreshRecovery(server.url("/").toString().removeSuffix("/"), records, http, NativeProof { "signed" }, "117", "app")
		assertTrue(runCatching { client.refresh(old) }.exceptionOrNull() is OAuthError.SessionChanged)
		assertEquals(1, server.requestCount)
		records.replace(old); records.prepare(old)
		server.enqueue(MockResponse.Builder().code(307).addHeader("Location", server.url("/unexpected")).build())
		assertTrue(runCatching { recovery(records).refresh(old) }.isFailure)
		assertEquals(old, records.read().tokens)
		assertEquals(2, server.requestCount)
	}
}
