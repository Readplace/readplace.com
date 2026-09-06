package com.readplace.android.app

import android.content.res.Configuration
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.readplace.android.R
import com.readplace.android.core.AppConfig
import kotlin.math.max
import kotlin.random.Random
import kotlin.random.nextULong
import kotlinx.coroutines.delay

@Composable
fun LoginScreen(
	/** Seeded by the caller with the compiled-in slogan so the screen never renders
	 * blank, then replaced by whatever the server publishes. */
	slogans: List<String>,
	/** Owned by the root, the app's auth-state root, so a failed Login or Sign up
	 * message outlives any remount of this screen. */
	errorText: String?,
	reduceMotion: Boolean,
	isForeground: Boolean,
	intro: LaunchIntroModel,
	/** Injected so the composition point wires the live auth-session flow; there is
	 * deliberately no internal default. */
	onLogin: () -> Unit,
	onSignup: () -> Unit,
	onOpenPrivacyPolicy: () -> Unit,
	/** Disables both buttons while an auth sheet is up, so a second tap can't start
	 * a competing session (whose start would be refused and surface a spurious error
	 * under the live sheet). */
	busy: Boolean,
) {
	AlwaysLight {
		val brand = LocalBrandColors.current
		val isMuted by intro.isMuted.collectAsState()
		val cosmicSeed = remember { Random.nextULong() }
		var sloganIndex by remember { mutableIntStateOf(0) }
		val currentSlogan = if (slogans.isEmpty()) AppConfig.FALLBACK_SLOGAN else slogans[sloganIndex % slogans.size]

		// Cycles the slogans for as long as this screen is up — leaving composition
		// cancels the delay, and a signed-in user never sees the screen again.
		//
		// A reader who asked for reduced motion gets the first slogan and no cycling:
		// text swapping under them is exactly the motion that setting turns off.
		LaunchedEffect(slogans, reduceMotion) {
			sloganIndex = 0
			if (reduceMotion || slogans.size <= 1) return@LaunchedEffect
			while (true) {
				delay(SLOGAN_INTERVAL_MILLIS)
				sloganIndex = (sloganIndex + 1) % slogans.size
			}
		}

		val density = LocalDensity.current
		val windowHeight = LocalWindowInfo.current.containerSize.height
		var contentTop by remember { mutableFloatStateOf(0f) }
		val topGap = with(density) {
			val markCenter = LaunchIntro.LOGO_SCREEN_FRACTION.toFloat() * windowHeight
			val markTop = markCenter - BrandMarkGeometry.SIDE.dp.toPx() / 2
			max(0f, markTop - contentTop - CONTENT_PADDING.toPx() - STACK_SPACING.toPx()).toDp()
		}

		Box(
			modifier = Modifier
				.fillMaxSize()
				.background(Color.White)
				.safeDrawingPadding()
				.clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
					intro.toggleMute()
				}
				.onGloballyPositioned { contentTop = it.positionInWindow().y },
		) {
			Column(
				modifier = Modifier.fillMaxSize().padding(CONTENT_PADDING),
				horizontalAlignment = Alignment.CenterHorizontally,
				verticalArrangement = Arrangement.spacedBy(STACK_SPACING),
			) {
				CosmicWavesCanvas(
					zone = CosmicZone.ABOVE_BRAND,
					seed = cosmicSeed,
					reduceMotion = reduceMotion,
					paused = !isForeground,
					modifier = Modifier.fillMaxWidth().height(topGap),
				)

				Column(
					horizontalAlignment = Alignment.CenterHorizontally,
					verticalArrangement = Arrangement.spacedBy(10.dp),
				) {
					BrandMark(onReplay = intro::replay)
					Text(
						text = buildAnnotatedString {
							append("Read")
							withStyle(SpanStyle(color = brand.highlight)) { append("place") }
						},
						style = MaterialTheme.typography.headlineLarge,
						fontWeight = FontWeight.Bold,
					)
					Crossfade(
						targetState = currentSlogan,
						animationSpec = tween(durationMillis = SLOGAN_FADE_MILLIS),
						label = "slogan",
					) { slogan ->
						Text(
							text = slogan,
							style = MaterialTheme.typography.bodyMedium,
							color = MaterialTheme.colorScheme.onSurfaceVariant,
							textAlign = TextAlign.Center,
							// One line, so a longer slogan swapping in cannot move the brand mark
							// the launch intro lands on.
							maxLines = 1,
							overflow = TextOverflow.Ellipsis,
						)
					}
				}

				Column(
					modifier = Modifier.fillMaxWidth(),
					verticalArrangement = Arrangement.spacedBy(14.dp),
				) {
					Button(
						onClick = onLogin,
						enabled = !busy,
						modifier = Modifier.fillMaxWidth(),
						shape = MaterialTheme.shapes.small,
						contentPadding = ACTION_PADDING,
					) {
						ActionLabel(glyph = LoginGlyph.LOGIN, text = "Login")
					}
					FilledTonalButton(
						onClick = onSignup,
						enabled = !busy,
						modifier = Modifier.fillMaxWidth(),
						shape = MaterialTheme.shapes.small,
						contentPadding = ACTION_PADDING,
					) {
						ActionLabel(glyph = LoginGlyph.SIGN_UP, text = "Sign up")
					}
				}

				if (errorText != null) {
					Text(
						text = errorText,
						style = MaterialTheme.typography.bodySmall,
						color = brand.error,
						textAlign = TextAlign.Center,
					)
				}

				CosmicWavesCanvas(
					zone = CosmicZone.BELOW_ACTIONS,
					seed = cosmicSeed,
					reduceMotion = reduceMotion,
					paused = !isForeground,
					modifier = Modifier.fillMaxWidth().weight(1f),
				)

				Footer(onOpenPrivacyPolicy = onOpenPrivacyPolicy, onReplay = intro::replay)
			}

			MuteButton(
				isMuted = isMuted,
				onToggle = intro::toggleMute,
				modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp),
			)
		}
	}
}

private const val SLOGAN_INTERVAL_MILLIS = 12_000L
private const val SLOGAN_FADE_MILLIS = 300
private val CONTENT_PADDING = 24.dp
private val STACK_SPACING = 28.dp
private val ACTION_PADDING = PaddingValues(horizontal = 24.dp, vertical = 14.dp)

@Composable
private fun AlwaysLight(content: @Composable () -> Unit) {
	val configuration = LocalConfiguration.current
	val context = LocalContext.current
	val light = remember(configuration) {
		Configuration(configuration).apply {
			uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or Configuration.UI_MODE_NIGHT_NO
		}
	}
	val lightContext = remember(context, light) { context.createConfigurationContext(light) }
	CompositionLocalProvider(LocalConfiguration provides light, LocalContext provides lightContext) {
		ReadplaceTheme(content = content)
	}
}

@Composable
private fun BrandMark(onReplay: () -> Unit) {
	Box(modifier = Modifier.size(BrandMarkGeometry.SIDE.dp)) {
		Image(
			painter = painterResource(R.drawable.brand_mark),
			contentDescription = null,
			contentScale = ContentScale.Fit,
			modifier = Modifier.fillMaxSize(),
		)
		Box(
			modifier = Modifier
				.offset(
					x = (BrandMarkGeometry.dotX - BrandMarkGeometry.TAP_DIAMETER / 2).dp,
					y = (BrandMarkGeometry.dotY - BrandMarkGeometry.TAP_DIAMETER / 2).dp,
				)
				.size(BrandMarkGeometry.TAP_DIAMETER.dp)
				.clip(CircleShape)
				.clickable(
					interactionSource = remember { MutableInteractionSource() },
					indication = null,
					role = Role.Button,
					onClick = onReplay,
				)
				.semantics { contentDescription = "Replay intro" },
		)
	}
}

@Composable
private fun ActionLabel(glyph: ImageVector, text: String) {
	Icon(imageVector = glyph, contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
	Spacer(modifier = Modifier.width(ButtonDefaults.IconSpacing))
	Text(text = text, style = MaterialTheme.typography.titleMedium)
}

@Composable
private fun Footer(onOpenPrivacyPolicy: () -> Unit, onReplay: () -> Unit) {
	val style = MaterialTheme.typography.bodySmall
	val colour = MaterialTheme.colorScheme.onSurfaceVariant
	Row(
		horizontalArrangement = Arrangement.spacedBy(8.dp),
		verticalAlignment = Alignment.CenterVertically,
	) {
		Text(
			text = "Privacy Policy",
			style = style,
			color = colour,
			modifier = Modifier.clickable(role = Role.Button, onClick = onOpenPrivacyPolicy),
		)
		Text(text = "·", style = style, color = colour)
		Text(
			text = "Replay intro",
			style = style,
			color = colour,
			modifier = Modifier.clickable(role = Role.Button, onClick = onReplay),
		)
	}
}

@Composable
private fun MuteButton(isMuted: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier) {
	Box(
		modifier = modifier
			.size(44.dp)
			.clip(CircleShape)
			.background(Color.Gray.copy(alpha = 0.55f))
			.clickable(
				interactionSource = remember { MutableInteractionSource() },
				indication = null,
				role = Role.Button,
				onClick = onToggle,
			)
			.semantics { contentDescription = if (isMuted) "Unmute music" else "Mute music" },
		contentAlignment = Alignment.Center,
	) {
		Icon(
			imageVector = if (isMuted) LoginGlyph.SPEAKER_MUTED else LoginGlyph.SPEAKER,
			contentDescription = null,
			tint = Color.White,
			modifier = Modifier.size(18.dp),
		)
	}
}

object BrandMarkGeometry {
	const val SIDE = 72f
	const val TAP_DIAMETER = 26f

	private const val VIEW_BOX = 512f
	private const val DOT_CENTER_X = 353f
	private const val DOT_CENTER_Y = 182f

	val dotX: Float = DOT_CENTER_X / VIEW_BOX * SIDE
	val dotY: Float = DOT_CENTER_Y / VIEW_BOX * SIDE
}

private object LoginGlyph {
	val LOGIN: ImageVector = glyph(
		name = "login",
		pathData = "M11 7L9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5z" +
			"M20 19h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z",
	)
	val SIGN_UP: ImageVector = glyph(
		name = "person-add",
		pathData = "M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z" +
			"M6 10V7H4v3H1v2h3v3h2v-3h3v-2H6z" +
			"M15 14c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
	)
	val SPEAKER: ImageVector = glyph(
		name = "speaker",
		pathData = "M3 9v6h4l5 5V4L7 9H3z" +
			"M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" +
			"M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
	)
	val SPEAKER_MUTED: ImageVector = glyph(
		name = "speaker-muted",
		pathData = "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63z" +
			"M19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71z" +
			"M4.27 3L3 4.27L7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21L21 19.73l-9-9L4.27 3z" +
			"M12 4L9.91 6.09L12 8.18V4z",
	)
}

private fun glyph(name: String, pathData: String): ImageVector =
	ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
		.addPath(pathData = addPathNodes(pathData), fill = SolidColor(Color.Black))
		.build()
