package com.readplace.android.app

import android.content.Context
import android.net.Uri
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.readplace.android.R
import kotlinx.coroutines.delay

/** The looping intro theme on a Media3 player; muting drops the volume rather than
 * pausing so the loop's position keeps pace with the video it accompanies. */
class SystemIntroMusic(context: Context) : IntroMusic {
	private val player: ExoPlayer = ExoPlayer.Builder(context).build().apply {
		setMediaItem(MediaItem.fromUri(rawUri(context, R.raw.launch_intro_theme)))
		repeatMode = Player.REPEAT_MODE_ONE
		prepare()
	}

	override fun start() {
		if (player.isPlaying) return
		player.play()
	}

	override fun stop() {
		if (!player.isPlaying) return
		player.pause()
	}

	override fun restart() {
		player.seekTo(0)
		player.play()
	}

	override fun seek(seconds: Double) {
		player.seekTo((seconds * 1000).toLong())
		player.play()
	}

	override fun setMuted(muted: Boolean) {
		player.volume = if (muted) 0f else 1f
	}
}

private fun rawUri(context: Context, resource: Int): Uri =
	Uri.parse("android.resource://${context.packageName}/$resource")

/**
 * The full-screen intro video, shown only while the model says so: it plays from
 * the start on appear, reports played-to-end / failure / skip / watchdog timeout
 * to the model, and fades out over [LaunchIntro.FADE_DURATION] before telling the
 * model the fade is done.
 */
@Composable
fun LaunchIntroOverlay(model: LaunchIntroModel, brand: BrandColors) {
	val phase by model.phase.collectAsState()
	val overlay = LaunchIntro.overlay(phase)
	if (!overlay.showsVideo) return

	val context = androidx.compose.ui.platform.LocalContext.current
	val player = remember {
		ExoPlayer.Builder(context).build().apply {
			setMediaItem(MediaItem.fromUri(rawUri(context, R.raw.launch_intro)))
			prepare()
		}
	}
	DisposableEffect(player) {
		val listener = object : Player.Listener {
			override fun onPlaybackStateChanged(playbackState: Int) {
				if (playbackState == Player.STATE_ENDED) model.end(LaunchIntroEnd.PLAYED_TO_END)
			}

			override fun onPlayerError(error: PlaybackException) {
				model.end(LaunchIntroEnd.ASSET_FAILED)
			}
		}
		player.addListener(listener)
		player.seekTo(0)
		player.play()
		onDispose {
			player.removeListener(listener)
			player.release()
		}
	}

	LaunchedEffect(phase) {
		if (phase == LaunchIntroPhase.FADING) {
			delay((LaunchIntro.FADE_DURATION * 1000).toLong())
			model.fadeCompleted()
		}
	}

	LaunchedEffect(player) {
		val assetSeconds = LaunchIntro.VIDEO_DURATION
		delay(((assetSeconds + LaunchIntro.WATCHDOG_SLACK) * 1000).toLong())
		model.end(LaunchIntroEnd.TIMED_OUT)
	}

	val backdrop = if (overlay.usesDarkBackdrop) brand.splashBackground else Color.White
	val opacity by animateFloatAsState(
		targetValue = overlay.opacity.toFloat(),
		animationSpec = tween(durationMillis = (LaunchIntro.FADE_DURATION * 1000).toInt()),
		label = "intro-fade",
	)

	Box(
		modifier = Modifier
			.fillMaxSize()
			.background(backdrop)
			.graphicsLayer { alpha = opacity }
			.clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
				model.end(LaunchIntroEnd.SKIPPED)
			},
	) {
		AndroidView(
			modifier = Modifier.fillMaxSize(),
			factory = { host ->
				PlayerView(host).apply {
					// Off BEFORE the player is attached: attaching a player to a view that
					// still owns a controller shows it once, over the first frames.
					useController = false
					controllerAutoShow = false
					resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
					setShutterBackgroundColor(backdrop.toArgb())
					this.player = player
				}
			},
		)
	}
}
