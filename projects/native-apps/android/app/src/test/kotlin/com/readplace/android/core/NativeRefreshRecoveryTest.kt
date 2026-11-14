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
		repeat(513) { client.record(AuthEvent.CONTEXT_STARTED) }
		assertEquals(512, records.read().diagnostics.size)
		assertEquals(operation, records.read().pending)
		assertEquals(AuthEvent.JOURNAL_HEALTH, records.read().diagnostics.last().event.event)
		assertEquals(2, records.read().diagnostics.last().event.dropped_events)
		client.record(AuthEvent.CONTEXT_STARTED)
		assertEquals(1, records.read().diagnostics.count { it.event.event == AuthEvent.JOURNAL_HEALTH })
		assertEquals(3, records.read().diagnostics.last().event.dropped_events)
	}
	@Test fun `minimal diagnostic event omits absent optional values`() {
		val event = NativeAuthEvent(UUID.randomUUID().toString(), AuthEvent.CONTEXT_STARTED, "2026-10-16T00:00:00Z", "android", AuthSurface.APP, UUID.randomUUID().toString(), "117")
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
		ServerEndpoints(server.url("/").toString().removeSuffix("/")), records, OkHttpClient(), proof, "117", AuthSurface.APP)
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

	@Test fun `terminal refusal records the reason the server gave`() = runTest {
		for ((wire, reason) in listOf("revoked" to AuthReason.REVOKED, "expired" to AuthReason.EXPIRED, "superseded" to AuthReason.SUPERSEDED)) {
			val records = records(); records.replace(old); records.prepare(old)
			server.enqueue(MockResponse.Builder().code(400).body("{\"error\":\"invalid_grant\",\"readplace_reason\":\"$wire\"}").build())
			assertTrue(runCatching { recovery(records).refresh(old) }.exceptionOrNull() is OAuthError.NoRefreshToken)
			val cleared = records.read().diagnostics.single { it.event.event == AuthEvent.CREDENTIALS_CLEARED }.event
			assertEquals(AuthOutcome.FAILURE, cleared.outcome)
			assertEquals(reason, cleared.reason)
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
		assertEquals(AuthReason.STORAGE_WRITE_FAILED, records.read().diagnostics.last().event.reason)
	}

	@Test fun `diagnostics stay associated with original permit across logout and account change`() = runTest {
		val records = records(); records.replace(old)
		val recovery = recovery(records)
		val operation = records.prepare(old)
		recovery.record(AuthEvent.REFRESH_PREPARED, operation = operation.id)
		records.commit(old, operation, "old-permit")
		val owned = records.prepare(old)
		records.replace(null)
		recovery.record(AuthEvent.LOGOUT_COMPLETED)
		records.update { it.diagnosticIdentity = UUID.randomUUID().toString(); it.diagnosticsPermit = null }
		recovery.record(AuthEvent.LOGIN_STARTED)
		recovery.record(AuthEvent.REFRESH_RESPONSE_RECEIVED, operation = owned.id, owner = owned)
		val retained = records.read().diagnostics
		val ids = retained.filter { it.permit == "old-permit" }.map { it.event.event_id }
		server.enqueue(MockResponse.Builder().code(202).body(buildJsonObject { put("accepted_event_ids", JsonArray(ids.map(::JsonPrimitive))) }.toString()).build())
		recovery.flush()
		val request = server.takeRequest()
		assertEquals("Bearer old-permit", request.headers["Authorization"])
		assertEquals(listOf(AuthEvent.LOGIN_STARTED), records.read().diagnostics.map { it.event.event })
	}

	@Test fun `OAuth coordinator wires bound refresh logout and a generation fenced login`() = runTest {
		val legacy = Legacy(); val records = records(legacy = legacy); records.replace(old)
		val store = TokenStore(legacy, records)
		val operation = records.prepare(old)
		val recovery = recovery(records)
		val oauth = OAuth(ServerEndpoints(server.url("/").toString().removeSuffix("/")), store, OkHttpClient(), "Readplace/117", recovery)
		server.enqueue(success(operation.id))
		assertEquals("new-access", oauth.refresh(requireNotNull(oauth.snapshot())).tokens.accessToken.raw)
		oauth.recordAuthEvent(AuthEvent.LOGIN_PROMPT_SHOWN, reason = AuthReason.NO_CREDENTIALS)
		server.enqueue(MockResponse.Builder().code(200).body("{}").build())
		oauth.revoke()
		assertNull(store.tokens)
		server.takeRequest()
		val revoked = server.takeRequest()
		assertEquals("/oauth/revoke", revoked.url.encodedPath)
		assertEquals("new-refresh", Json.parseToJsonElement(requireNotNull(revoked.body).utf8()).jsonObject["token"]?.jsonPrimitive?.content)
		oauth.recordAuthEvent(AuthEvent.LOGIN_STARTED)
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

	@Test fun `an event recorded for another surface carries it and the next carries the recovery's own`() {
		val records = records(); val client = recovery(records)
		client.record(AuthEvent.CONTEXT_STARTED, surface = AuthSurface.SHARE)
		client.record(AuthEvent.CONTEXT_STARTED)
		val entries = records.read().diagnostics
		assertEquals(listOf(AuthSurface.SHARE, AuthSurface.APP), entries.map { it.event.surface })
		assertEquals(entries[0].event.context_id, entries[1].event.context_id)
	}

	@Test fun `a share event recorded through OAuth uploads with the share surface`() {
		val legacy = Legacy(); val records = records(legacy = legacy); val store = TokenStore(legacy, records)
		val recovery = recovery(records)
		records.update { it.diagnosticsPermit = "share-permit" }
		val oauth = OAuth(ServerEndpoints(server.url("/").toString().removeSuffix("/")), store, OkHttpClient(), "Readplace/117", recovery)
		server.enqueue(MockResponse.Builder().code(202).body("""{"accepted_event_ids":[]}""").build())
		oauth.recordAuthEvent(AuthEvent.CONTEXT_STARTED, surface = AuthSurface.SHARE)
		val uploaded = requireNotNull(server.takeRequest(2, java.util.concurrent.TimeUnit.SECONDS))
		assertEquals("/diagnostics/auth", uploaded.url.encodedPath)
		val events = requireNotNull(Json.parseToJsonElement(requireNotNull(uploaded.body).utf8()).jsonObject["events"]).jsonArray
		assertEquals(listOf("context_started" to "share"), events.map {
			requireNotNull(it.jsonObject["event"]).jsonPrimitive.content to requireNotNull(it.jsonObject["surface"]).jsonPrimitive.content
		})
	}

	@Test fun `transport failure keeps parent and prepared operation`() = runTest {
		val records = records(); records.replace(old); val operation = records.prepare(old)
		val http = OkHttpClient.Builder().addInterceptor { throw java.io.IOException("connection lost") }.build()
		val recovery = NativeRefreshRecovery(ServerEndpoints("https://readplace.com"), records, http, NativeProof { "signed" }, "117", AuthSurface.SHARE)
		assertTrue(runCatching { recovery.refresh(old) }.exceptionOrNull() is java.io.IOException)
		assertEquals(operation, records.read().pending)
		assertEquals(old, records.read().tokens)
	}

	@Test fun `newer credentials win over a late network response`() = runTest {
		val records = records(); records.replace(old); val operation = records.prepare(old)
		val other = OAuthTokens(AccessToken("other"), RefreshToken("other"))
		val http = OkHttpClient.Builder().addInterceptor { chain -> chain.proceed(chain.request()).also { records.replace(other) } }.build()
		server.enqueue(success(operation.id))
		val recovery = NativeRefreshRecovery(ServerEndpoints(server.url("/").toString().removeSuffix("/")), records, http, NativeProof { "signed" }, "117", AuthSurface.APP)
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
		val oauth = OAuth(ServerEndpoints(server.url("/").toString().removeSuffix("/")), TokenStore(legacy, records), OkHttpClient(), "Readplace/117")
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
		val client = NativeRefreshRecovery(ServerEndpoints(server.url("/").toString().removeSuffix("/")), records, http, NativeProof { "signed" }, "117", AuthSurface.APP)
		assertTrue(runCatching { client.refresh(old) }.exceptionOrNull() is OAuthError.SessionChanged)
		assertEquals(1, server.requestCount)
		records.replace(old); records.prepare(old)
		server.enqueue(MockResponse.Builder().code(307).addHeader("Location", server.url("/unexpected")).build())
		assertTrue(runCatching { recovery(records).refresh(old) }.isFailure)
		assertEquals(old, records.read().tokens)
		assertEquals(2, server.requestCount)
	}
}
