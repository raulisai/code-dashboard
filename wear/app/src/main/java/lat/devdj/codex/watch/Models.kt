package lat.devdj.codex.watch

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

/** One usage window of a coding agent: `used` is 0-100, `resetsAt` in epoch seconds (0 = unknown). */
data class QuotaWindow(val minutes: Int, val used: Double, val resetsAt: Long) {
    val left get() = (100 - used).roundToInt().coerceIn(0, 100)
    val session get() = minutes <= 300
}

data class ProviderQuota(val windows: List<QuotaWindow>, val plan: String = "") {
    val session get() = windows.firstOrNull { it.session } ?: windows.firstOrNull()
    val weekly get() = windows.firstOrNull { !it.session }
    val left get() = session?.left
}

enum class Level { Good, Warn, Low }

fun levelOf(left: Int?) = when {
    left == null || left >= 40 -> Level.Good
    left >= 15 -> Level.Warn
    else -> Level.Low
}

/** What happened on the server that deserves a glance: an approval to give or work that finished or failed. */
data class Notice(val kind: String, val project: String, val title: String, val at: Long, val provider: String) {
    val general get() = project == "_general" || project.isBlank()
    val where get() = if (general) "Agente" else project
}

internal fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

internal fun parseQuota(data: JSONObject?): ProviderQuota? {
    if (data == null) return null
    val windows = data.optJSONArray("windows").objects().map { QuotaWindow(it.optInt("minutes"), it.optDouble("used"), it.optDouble("resets_at", 0.0).toLong()) }
    return if (windows.isEmpty()) null else ProviderQuota(windows, data.optString("plan"))
}

internal fun parseNotices(data: JSONArray?): List<Notice> = data.objects().map {
    Notice(it.optString("kind"), it.optString("project"), it.optString("title"), it.optLong("at"), it.optString("provider"))
}.take(6)

/** Spanish relative age; `at` and `now` in epoch seconds, unknown dates stay silent. */
fun ago(at: Long, now: Long): String {
    if (at <= 0) return ""
    val seconds = now - at
    return when {
        seconds < 60 -> "ahora"
        seconds < 3600 -> "hace ${seconds / 60} min"
        seconds < 86400 -> "hace ${seconds / 3600} h"
        else -> "hace ${seconds / 86400} d"
    }
}

/** Which agent has more of its 5-hour window left, for the "conviene" hint. */
fun bestAgent(claude: ProviderQuota?, codex: ProviderQuota?): String? {
    val a = claude?.left ?: return if (codex?.left != null) "Codex" else null
    val b = codex?.left ?: return "Claude"
    return if (a >= b) "Claude" else "Codex"
}
