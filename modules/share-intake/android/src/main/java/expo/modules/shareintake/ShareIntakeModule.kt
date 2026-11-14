package expo.modules.shareintake

import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val CONSUMED_EXTRA = "expo.modules.shareintake.CONSUMED"

/**
 * Hands text that another app shared to Trip Prep (ACTION_SEND, text/plain —
 * e.g. Google Maps → Share → Trip Prep) to JavaScript. The activity's intent
 * filter is added by app.plugin.js. Nothing is saved here: the app shows a
 * preview and saves only after the user confirms.
 */
class ShareIntakeModule : Module() {
  private fun read(intent: Intent?): Map<String, String?>? {
    if (intent == null || intent.action != Intent.ACTION_SEND) return null
    if (intent.getBooleanExtra(CONSUMED_EXTRA, false)) return null
    val type = intent.type ?: return null
    if (!type.startsWith("text/")) return null
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: return null
    if (text.isBlank()) return null
    return mapOf(
      "text" to text,
      "subject" to intent.getStringExtra(Intent.EXTRA_SUBJECT)
    )
  }

  override fun definition() = ModuleDefinition {
    Name("ShareIntake")

    Events("onShare")

    // The share that launched the app (cold start), if any and not yet handled.
    Function("getInitialShare") {
      read(appContext.currentActivity?.intent)
    }

    // Marks the launch share as handled so it is not offered again after a reload.
    Function("clearInitialShare") {
      appContext.currentActivity?.intent?.putExtra(CONSUMED_EXTRA, true)
      Unit
    }

    // A share while Trip Prep is already running (singleTask activity).
    OnNewIntent { intent ->
      read(intent)?.let { payload ->
        intent.putExtra(CONSUMED_EXTRA, true)
        sendEvent("onShare", payload)
      }
    }
  }
}
