package com.readplace.android.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.readplace.android.core.AppConfig
import com.readplace.android.core.Href

/**
 * The sheet shown when the user taps + on the reading list. Rather than an
 * in-app paste box (removed), it teaches adding links through the Android Share
 * menu by rendering the server's help page in a WebView, so the copy ships via
 * a hutch deploy rather than a Play Store release. The help URL is a client-held
 * path resolved against the API base ([AppConfig.ADD_LINKS_HELP_PATH]), not a
 * link discovered from the server.
 *
 * Chromeless, like the reader and account sheets: the page renders its own
 * "← Back to queue" deep link, which the WebView intercepts to dismiss, so all
 * three in-app sheets return to the native list the same way rather than this
 * one alone wearing a native app bar. If the URL can't be resolved or the page
 * fails to load, a local fallback still teaches Share — and carries its own
 * native back button, since there is no page to render one.
 */
@Composable
fun AddLinkInstructions(baseUrl: String, onDismiss: () -> Unit) {
	// Append the same app-shell marker the account href carries, so the help page
	// is served chromeless with a deep-link back to the native list, together with
	// the platform marker that lets the server tell this app's sheet from the
	// iPhone app's. A path that can't be resolved yields null — the + control then
	// shows its native fallback rather than opening a marker-less page.
	val helpUrl = remember(baseUrl) {
		Href.resolve(AppConfig.ADD_LINKS_HELP_PATH, baseUrl)
			?.let { Href.appending(it, AppConfig.APP_SHELL_QUERY_NAME, AppConfig.APP_SHELL_QUERY_VALUE) }
			?.let { Href.appending(it, AppConfig.PLATFORM_QUERY_NAME, AppConfig.PLATFORM_QUERY_VALUE) }
	}
	var isLoading by remember { mutableStateOf(true) }
	var loadFailed by remember { mutableStateOf(false) }

	if (helpUrl != null && !loadFailed) {
		Box(modifier = Modifier.fillMaxSize()) {
			WebPageSheet(
				url = helpUrl,
				onClose = onDismiss,
				onFinish = { isLoading = false },
				onFail = {
					isLoading = false
					loadFailed = true
				},
			)
			if (isLoading) {
				CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
			}
		}
	} else {
		AddLinkFallback(onClose = onDismiss)
	}
}

/**
 * A self-contained native version of the help page, shown when the WebView
 * can't be displayed. It still delivers the core instruction so the feature
 * degrades gracefully, and — unlike the happy path, whose back link the page
 * renders — carries its own native "Back to queue" button, mirroring the
 * reader sheet's native unavailable view.
 */
@Composable
private fun AddLinkFallback(onClose: () -> Unit) {
	Column(
		modifier = Modifier
			.fillMaxSize()
			.padding(40.dp),
		verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
		horizontalAlignment = Alignment.CenterHorizontally,
	) {
		Icon(
			painter = painterResource(android.R.drawable.ic_menu_share),
			contentDescription = null,
			modifier = Modifier.size(40.dp),
			tint = MaterialTheme.colorScheme.onSurfaceVariant,
		)
		Text(
			text = "Add links with Share",
			style = MaterialTheme.typography.titleMedium,
		)
		Text(
			text = "Open a link in any app, tap Share, then choose Readplace.",
			style = MaterialTheme.typography.bodyMedium,
			color = MaterialTheme.colorScheme.onSurfaceVariant,
			textAlign = TextAlign.Center,
		)
		TextButton(
			onClick = onClose,
			modifier = Modifier.padding(top = 4.dp),
		) {
			Text(text = "← Back to queue")
		}
	}
}
