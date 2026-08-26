package com.readplace.android.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException

private const val APPLICATION_JSON = "application/json"

/**
 * The seam the sign-in screen reads its slogans through, injected so tests never
 * hit the network.
 */
fun interface SloganSource {
	suspend fun load(): List<String>
}

/**
 * Partial application (`init*`) wiring an HTTP client into a [SloganSource].
 *
 * Sign-in runs before there is an access token, so this deliberately does not go
 * through the Siren client, whose every request presents a Bearer token and fails
 * without one.
 *
 * Every failure — an unusable base URL, transport, status, media type, malformed
 * body — answers with an empty list rather than throwing. The caller's fallback
 * slogan is already the right answer for all of them, and a slogan is not worth an
 * error on the screen a user is trying to sign in from.
 */
fun initSloganSource(client: OkHttpClient, baseUrl: String): SloganSource =
	SloganSource { publishedSlogans(client, baseUrl) }

private suspend fun publishedSlogans(client: OkHttpClient, baseUrl: String): List<String> {
	val url = "$baseUrl${AppConfig.SLOGANS_PATH}".toHttpUrlOrNull() ?: return emptyList()
	val request = Request.Builder()
		.url(url)
		.header("Accept", APPLICATION_JSON)
		.header(AppConfig.CLIENT_HEADER, AppConfig.CLIENT_ANDROID)
		.build()
	return withContext(Dispatchers.IO) {
		try {
			client.newCall(request).execute().use { slogansIn(it) }
		} catch (_: IOException) {
			emptyList()
		}
	}
}

private fun slogansIn(response: Response): List<String> {
	if (response.code != 200) return emptyList()
	if (!MediaType.matches(response.header("Content-Type"), APPLICATION_JSON)) return emptyList()
	return slogansIn(response.body.string())
}

/**
 * Reads the list out of the object the server publishes — an object rather than a
 * bare array, so the server can add a sibling field without breaking a shipped
 * build. A body that is not that object, or that carries anything but strings in
 * it, is not a slogan list at all: the answer is empty rather than half-decoded.
 */
private fun slogansIn(body: String): List<String> {
	val slogans = jsonObjectOf(body)?.get("slogans") as? JsonArray ?: return emptyList()
	return slogans.map { stringOf(it) ?: return emptyList() }.filter { it.isNotEmpty() }
}

private fun jsonObjectOf(body: String): JsonObject? =
	try {
		Json.parseToJsonElement(body) as? JsonObject
	} catch (_: SerializationException) {
		null
	}

private fun stringOf(element: JsonElement): String? =
	(element as? JsonPrimitive)?.takeIf { it.isString }?.content
