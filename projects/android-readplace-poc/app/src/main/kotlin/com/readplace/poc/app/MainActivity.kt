package com.readplace.poc.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import com.readplace.poc.AppGraph
import com.readplace.poc.core.AuthRedirect
import com.readplace.poc.core.AuthorizationRequest
import com.readplace.poc.ui.AuthWebView
import com.readplace.poc.ui.LoginScreen
import com.readplace.poc.ui.ReadingListScreen
import com.readplace.poc.ui.ReadplaceTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The launcher app — mirrors the iOS POC's SwiftUI app. A tiny state machine moves
 * between sign-in, the in-app OAuth WebView, and the reading list. OAuth happens in an
 * embedded WebView whose navigation to the registered HTTPS callback is intercepted
 * (custom URL schemes are rejected by the server's redirect allowlist), so no
 * server-side change is needed — the same strategy the iOS POC uses.
 */
class MainActivity : ComponentActivity() {
	private sealed interface Screen {
		data object Login : Screen
		data class Auth(val request: AuthorizationRequest) : Screen
		data object ReadingList : Screen
	}

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		val graph = AppGraph(this)

		setContent {
			ReadplaceTheme {
				val scope = rememberCoroutineScope()
				var baseUrl by remember { mutableStateOf(graph.tokenStore.baseUrl) }
				var loginError by remember { mutableStateOf<String?>(null) }
				var screen by remember {
					mutableStateOf<Screen>(if (graph.tokenStore.isLoggedIn) Screen.ReadingList else Screen.Login)
				}

				when (val current = screen) {
					is Screen.Login -> LoginScreen(
						baseUrl = baseUrl,
						errorText = loginError,
						onBaseUrlChange = { baseUrl = it },
						onSignIn = {
							val normalized = normalizeBaseUrl(baseUrl, fallback = graph.tokenStore.baseUrl)
							baseUrl = normalized
							graph.tokenStore.baseUrl = normalized
							loginError = null
							screen = Screen.Auth(graph.oauth(normalized).makeAuthorizationRequest())
						},
					)

					is Screen.Auth -> AuthWebView(
						request = current.request,
						onCancel = { screen = Screen.Login },
						onResult = { result ->
							when (result) {
								is AuthRedirect.Failed -> {
									loginError = result.message
									screen = Screen.Login
								}
								is AuthRedirect.Granted -> scope.launch {
									val outcome = withContext(Dispatchers.IO) {
										runCatching {
											graph.oauth(baseUrl).exchangeCode(result.code, current.request.codeVerifier)
										}
									}
									screen = outcome.fold(
										onSuccess = { Screen.ReadingList },
										onFailure = { error ->
											loginError = error.message
											Screen.Login
										},
									)
								}
							}
						},
					)

					is Screen.ReadingList -> ReadingListScreen(
						api = remember(baseUrl) { graph.api(baseUrl) },
						onLogout = {
							scope.launch {
								withContext(Dispatchers.IO) { graph.oauth(baseUrl).revoke() }
								screen = Screen.Login
							}
						},
						onSessionExpired = {
							graph.tokenStore.clear()
							screen = Screen.Login
						},
					)
				}
			}
		}
	}
}

/** Trims surrounding whitespace and trailing slashes so the share target targets the same server. */
internal fun normalizeBaseUrl(raw: String, fallback: String): String =
	raw.trim().trimEnd('/').ifEmpty { fallback }
