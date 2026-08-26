package com.readplace.android.share

import android.content.Context
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.readplace.android.BuildConfig
import com.readplace.android.app.BrandColors
import com.readplace.android.app.HtmlCaptor
import com.readplace.android.app.KeystoreTokenStorage
import com.readplace.android.app.LocalBrandColors
import com.readplace.android.app.ReadplaceTheme
import com.readplace.android.core.AppConfig
import com.readplace.android.core.DiscoveryHttpCache
import com.readplace.android.core.EphemeralCookieJar
import com.readplace.android.core.OAuth
import com.readplace.android.core.ReadplaceApi
import com.readplace.android.core.ServerMessage
import com.readplace.android.core.TokenStore
import com.readplace.android.core.UnseenSave
import com.readplace.android.core.UploadJobStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.time.Clock

/**
 * The share target's composition root. A share arrives in its own task with no
 * app state behind it, so the storage, HTTP and auth dependencies are built here
 * from the same app-private roots MainActivity uses, and handed to the tested
 * save journey; this activity only paints what the journey reports.
 */
class ShareActivity : ComponentActivity() {
	private val sheet = ShareSheetState()

	/** Called by the backdrop tap to end the sheet's wait early; null until the
	 * wait is running. */
	private var dismissNow: (() -> Unit)? = null

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		val saver = makeSaver()
		setContent {
			ReadplaceTheme {
				ShareSheet(
					sheet = sheet,
					onBackdropTap = { dismissNow?.invoke() },
					onEnded = ::finish,
				)
			}
		}
		lifecycleScope.launch { runJourney(saver) }
	}

	private fun makeSaver(): SaveSharedPage {
		val store = TokenStore(
			KeystoreTokenStorage(getSharedPreferences(KeystoreTokenStorage.PREFERENCES_NAME, Context.MODE_PRIVATE)),
		)
		val http = OkHttpClient.Builder()
			.cookieJar(EphemeralCookieJar())
			.cache(DiscoveryHttpCache(cacheDir).cache)
			.build()
		return SaveSharedPage(
			store = store,
			api = ReadplaceApi(
				baseUrl = AppConfig.serverBaseUrl,
				client = http,
				store = store,
				oauth = OAuth(baseUrl = AppConfig.serverBaseUrl, store = store, http = http),
				nativeUserAgent = AppConfig.nativeUserAgent(BuildConfig.VERSION_CODE, Build.VERSION.RELEASE),
				ioDispatcher = Dispatchers.IO,
			),
			captor = HtmlCaptor(this),
			jobs = UploadJobStore(filesDir, Dispatchers.IO),
			unseenSave = UnseenSave(filesDir),
			clock = Clock.systemUTC(),
		)
	}

	private suspend fun runJourney(saver: SaveSharedPage) {
		sheet.status = "Saving…"
		val shared = ShareExtractor.extract(ShareIntentReader(contentResolver).read(intent))

		val sharedPdf = shared?.pdf?.let { pdf ->
			suspend { pdf.bytes(maxBytes = ReadplaceApi.DEFAULT_MAX_EXTERNAL_CONTENT_BYTES) }
		}
		val settled = lifecycleScope.launch {
			sheet.outcome = saver.run(
				url = shared?.url,
				fallbackTitle = shared?.title,
				sharedPdf = sharedPdf,
				onNotice = { messages -> sheet.notice = messages },
				onSaved = {
					// The server has answered and the link is on it, so leaving now
					// costs nothing the reader was promised.
					sheet.canDismiss = true
				},
				onStillSaving = { sheet.status = "Still saving…" },
			)
		}
		endOfSheet(settled)
		sheet.ended = true
	}

	/** Returns once the journey has settled, or as soon as the reader taps outside
	 * the card — whichever lands first. */
	private suspend fun endOfSheet(settled: Job) {
		val claim = FirstClaim()
		val ended = CompletableDeferred<Unit>()
		dismissNow = { if (claim.take()) ended.complete(Unit) }
		settled.invokeOnCompletion { if (claim.take()) ended.complete(Unit) }
		ended.await()
	}
}

private class ShareSheetState {
	var status by mutableStateOf("Preparing…")
	var notice by mutableStateOf<List<ServerMessage>>(emptyList())
	var outcome by mutableStateOf<SaveSharedOutcome?>(null)

	/** Tapping outside the card dismisses. Disabled until the server has confirmed
	 * the save, because until then a dismissal would abandon a save in flight. */
	var canDismiss by mutableStateOf(false)
	var ended by mutableStateOf(false)
}

@Composable
private fun ShareSheet(
	sheet: ShareSheetState,
	onBackdropTap: () -> Unit,
	onEnded: () -> Unit,
) {
	val brand = LocalBrandColors.current
	val haptics = LocalHapticFeedback.current
	val status = sheet.outcome?.let { ShareStatusPresentation.of(it) }

	BackHandler { if (sheet.canDismiss) onBackdropTap() }

	Box(
		modifier = Modifier
			.fillMaxSize()
			.clickable(
				interactionSource = remember { MutableInteractionSource() },
				indication = null,
				enabled = sheet.canDismiss,
				onClick = onBackdropTap,
			),
		contentAlignment = Alignment.Center,
	) {
		Surface(
			modifier = Modifier
				.width(260.dp)
				// The card is the sheet's content, not its backdrop: a tap that lands on
				// it is not a request to leave.
				.pointerInput(Unit) { detectTapGestures {} },
			shape = RoundedCornerShape(16.dp),
			color = MaterialTheme.colorScheme.surface,
		) {
			Column(
				modifier = Modifier.padding(horizontal = 24.dp, vertical = 28.dp),
				horizontalAlignment = Alignment.CenterHorizontally,
				verticalArrangement = Arrangement.spacedBy(16.dp),
			) {
				if (status == null) {
					CircularProgressIndicator(
						modifier = Modifier.size(44.dp),
						color = MaterialTheme.colorScheme.onSurfaceVariant,
					)
				} else {
					Icon(
						imageVector = ShareStatusGlyph.of(status.icon),
						contentDescription = null,
						tint = colorFor(status.tone, brand),
						modifier = Modifier.size(44.dp),
					)
				}

				// The title and its caption sit as a tight pair (a 4dp gap), set apart from
				// the icon and spinner by the outer column's larger spacing.
				Column(
					horizontalAlignment = Alignment.CenterHorizontally,
					verticalArrangement = Arrangement.spacedBy(4.dp),
				) {
					Text(
						text = status?.message ?: sheet.status,
						style = MaterialTheme.typography.titleMedium,
						textAlign = TextAlign.Center,
					)
					// A secondary caption below the title, in the app's footnote/secondary
					// house style.
					val caption = when (status) {
						null -> sheet.notice.joinToString("\n") { it.plainText }
						else -> status.subtitle
					}
					if (!caption.isNullOrEmpty()) {
						Text(
							text = caption,
							style = MaterialTheme.typography.bodySmall,
							color = MaterialTheme.colorScheme.onSurfaceVariant,
							textAlign = TextAlign.Center,
						)
					}
				}
			}
		}
	}

	LaunchedEffect(status) {
		if (status?.tone == ShareStatusTone.SUCCESS) haptics.performHapticFeedback(HapticFeedbackType.Confirm)
	}
	LaunchedEffect(sheet.ended) {
		if (sheet.ended) onEnded()
	}
}

private fun colorFor(tone: ShareStatusTone, brand: BrandColors): Color = when (tone) {
	ShareStatusTone.SUCCESS -> brand.success
	ShareStatusTone.WARNING -> brand.warning
	ShareStatusTone.ERROR -> brand.error
}

private object ShareStatusGlyph {
	fun of(icon: ShareStatusIcon): ImageVector = when (icon) {
		ShareStatusIcon.CHECKMARK -> CHECKMARK
		ShareStatusIcon.PERSON_ALERT -> PERSON_ALERT
		ShareStatusIcon.WARNING_TRIANGLE -> WARNING_TRIANGLE
		ShareStatusIcon.LINK -> LINK
		ShareStatusIcon.LOCK -> LOCK
	}

	private val CHECKMARK: ImageVector = materialGlyph(
		name = "CheckmarkCircleFill",
		pathData = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 " +
			"1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
	)

	private val PERSON_ALERT: ImageVector = materialGlyph(
		name = "PersonCircle",
		pathData = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 " +
			"1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 " +
			"4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z",
	)

	private val WARNING_TRIANGLE: ImageVector = materialGlyph(
		name = "WarningTriangleFill",
		pathData = "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
	)

	private val LINK: ImageVector = materialGlyph(
		name = "Link",
		pathData = "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 " +
			"0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 " +
			"3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z",
	)

	private val LOCK: ImageVector = materialGlyph(
		name = "LockFill",
		pathData = "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 " +
			"0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 " +
			"1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z",
	)

	private fun materialGlyph(name: String, pathData: String): ImageVector =
		ImageVector.Builder(
			name = name,
			defaultWidth = 24.dp,
			defaultHeight = 24.dp,
			viewportWidth = 24f,
			viewportHeight = 24f,
		).addPath(
			pathData = PathParser().parsePathString(pathData).toNodes(),
			fill = SolidColor(Color.Black),
		).build()
}
