package lat.devdj.codex.watch

import android.app.Application
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.UUID

data class WatchUi(
    val linked: Boolean = false, val state: String = "idle", val activity: String = "",
    val reply: String = "", val question: String = "", val taskTitle: String = "", val taskProject: String = "",
    val taskStatus: String = "", val updated: Long = 0, val code: String = "", val expires: Long = 0,
    val draft: String = "", val pending: Boolean = false, val busy: Boolean = false,
    val error: String = "", val mode: String = "attention", val pushReady: Boolean = false,
    val freshReply: Boolean = false,
    val notices: List<Notice> = emptyList(), val approvals: Int = 0,
    val claude: ProviderQuota? = null, val codex: ProviderQuota? = null,
    val quotaLoaded: Boolean = false, val quotaStale: Boolean = false,
    // Conversation by voice: what is being heard, the instant reply and what the agent has said so far.
    val listening: Boolean = false, val heard: String = "", val level: Float = 0f,
    val ack: String = "", val speech: String = "", val ahead: Int = 0, val taskId: String = "", val taskState: String = "",
    val speaking: Boolean = false, val voice: Boolean = true, val awake: Boolean = false, val hint: String = "",
    val systemDictation: Int = 0, val turn: Int = 0,
    val origin: String = "https://codex-dashboard.devdj.lat",
) {
    val working get() = state in setOf("working", "queued")
    val label get() = when {
        listening -> "Te escucho"
        busy -> "Enviando"
        error.isNotBlank() -> "Sin actualizar"
        state == "attention" -> "Necesito tu atención"
        state == "error" -> "Necesito tu atención"
        state == "working" -> activity.ifBlank { ack.ifBlank { "Estoy en ello" } }
        state == "queued" -> if (ahead > 0) "En cola · $ahead antes" else ack.ifBlank { "En un momento" }
        else -> "Aquí estoy"
    }
}

class WatchViewModel @JvmOverloads constructor(application: Application, injectedApi: WatchApi? = null) : AndroidViewModel(application) {
    val store = WatchStore(application)
    val api = injectedApi ?: WatchApi(store)
    private val mutable = MutableStateFlow(WatchUi(linked = store.read("token").isNotBlank(),
        draft = store.read("draft"), pending = store.read("request_id").isNotBlank(), origin = api.origin,
        code = store.read("pair_code"), expires = store.read("pair_expires").toLongOrNull() ?: 0, voice = store.read("voice") != "off"))
    val ui = mutable.asStateFlow()
    suspend fun dashboardCall(path: String, body: JSONObject? = null): JSONObject {
        try { return api.call(path, body) }
        catch (error: Exception) {
            if (error is ApiError && error.status == 401) failure(error)
            throw error
        }
    }
    private val network = Mutex()
    private var draftJob: Job? = null
    private var generalVisible = false
    private var quotaAt = 0L
    // Long wait on /api/wear/state: the fingerprint last seen, and a counter that discards answers a send overtook.
    private var version = ""
    private var sendEpoch = 0
    // The message whose answer is read aloud, how much of it has been said and since when the screen is kept on.
    private var awaited = ""
    private var spokenRun = ""
    private var spokenUpTo = 0
    private var approvalSaid = false
    private var awakeSince = 0L
    private var turns = 0
    private var levelAt = 0L
    val nav = Nav()
    val hub = ToolHub()
    val speaker = Speaker(application)
    private val ear = Ear(application, object : Ear.Listener {
        override fun onLevel(level: Float) {
            val now = SystemClock.elapsedRealtime()
            if (now - levelAt < 90) return
            levelAt = now; change { if (it.listening) it.copy(level = level) else it }
        }
        override fun onPartial(text: String) = change { if (it.listening) it.copy(heard = text) else it }
        override fun onFinal(text: String) {
            if (!ui.value.listening) return
            change { it.copy(listening = false, level = 0f, heard = text) }
            ask(text)
        }
        override fun onError(message: String, beforeSpeech: Boolean) {
            if (!ui.value.listening) return
            // An engine that failed before hearing anything gets one more chance through the system dictation screen.
            change { it.copy(listening = false, level = 0f, heard = "", hint = if (beforeSpeech) "" else message,
                systemDictation = it.systemDictation + if (beforeSpeech) 1 else 0) }
        }
    })
    fun generalVisible(value: Boolean) { generalVisible = value }
    init {
        if (mutable.value.linked) {
            store.json("snapshot")?.let { applySnapshot(it, live = false) }
            store.json("home")?.let { applyHome(it) }
            store.json("quota")?.let { applyQuota(it, stale = true) }
        }
        viewModelScope.launch { speaker.speaking.collect { speaking -> change { it.copy(speaking = speaking) } } }
    }
    override fun onCleared() { ear.destroy(); speaker.shutdown() }
    private fun change(update: (WatchUi) -> WatchUi) { mutable.value = update(mutable.value) }
    /** Local preferences that survive a revoked pairing: they are about this watch, not the account. */
    private fun keepPreferences(block: () -> Unit) {
        val voice = store.read("voice")
        block()
        if (voice.isNotBlank()) store.write("voice", voice)
    }
    private fun failure(error: Exception) {
        if (error is CancellationException) throw error
        if (error is ApiError && error.status == 401) {
            // Retain an unsent draft, remove every credential/cache from the revoked session.
            val draft = store.read("draft"); val origin = api.origin
            keepPreferences { store.clear() }; store.write("draft", draft); store.write("origin", origin)
            awaited = ""; speaker.stop()
            mutable.value = WatchUi(draft = draft, origin = origin, error = "Vuelve a vincular el reloj", voice = store.read("voice") != "off")
        } else change { it.copy(error = error.message?.take(140) ?: "No pude conectar. Inténtalo de nuevo.") }
    }
    private fun applySnapshot(data: JSONObject, live: Boolean = true) {
        val last = data.optJSONObject("last_task")
        val task = data.optJSONObject("task")
        val state = data.optString("state", "idle")
        val reply = data.optString("reply")
        val working = state in setOf("working", "queued")
        change { it.copy(state = state, activity = data.optString("activity"), reply = reply,
            freshReply = it.freshReply || (it.working && !working && reply.isNotBlank()),
            question = task?.optString("title") ?: "", taskTitle = last?.optString("title") ?: "",
            taskProject = last?.optString("project") ?: "", taskStatus = last?.optString("status") ?: "",
            speech = data.optString("speech"), ahead = data.optInt("ahead"), taskId = task?.optString("id").orEmpty(),
            taskState = task?.optString("status").orEmpty(), ack = if (working) it.ack else "", awake = it.awake && working,
            updated = data.optLong("updated_at"), mode = data.optString("notifications", "attention")) }
        data.optJSONObject("firebase")?.let { store.write("firebase", it.toString()) }
        if (live) speakProgress(data)
    }
    /** Reads the awaited answer aloud as it is written: every finished sentence at once, the rest when the turn ends. */
    private fun speakProgress(data: JSONObject) {
        if (awaited.isBlank() || data.optJSONObject("task")?.optString("id") != awaited) return
        val state = data.optString("state", "idle")
        val done = state !in setOf("working", "queued")
        val run = data.optString("run_id")
        if (run != spokenRun) { spokenRun = run; spokenUpTo = 0 }
        val text = data.optString("speech").ifBlank { if (done) data.optString("reply") else "" }
        spokenUpTo = spokenUpTo.coerceAtMost(text.length)
        val end = if (done) text.length else sentenceEnd(text, spokenUpTo)
        if (end > spokenUpTo) {
            if (ui.value.voice) speaker.say(text.substring(spokenUpTo, end))
            spokenUpTo = end
        }
        if (state == "attention" && !approvalSaid) { approvalSaid = true; if (ui.value.voice) speaker.say("Necesito tu aprobación para seguir.") }
        if (done) awaited = ""
    }
    private fun applyHome(data: JSONObject) = change { it.copy(notices = parseNotices(data.optJSONArray("recent")), approvals = data.optInt("approvals")) }
    private fun applyQuota(data: JSONObject, stale: Boolean) = change {
        it.copy(claude = parseQuota(data.optJSONObject("claude")), codex = parseQuota(data.optJSONObject("codex")),
            quotaLoaded = true, quotaStale = stale || data.optBoolean("stale"))
    }
    /** Latest notices and pending approvals. Failures keep what is on screen; a revoked session is handled by [dashboardCall]. */
    suspend fun loadHome() {
        if (!ui.value.linked) return
        try { val data = dashboardCall("/api/wear/view?view=home"); store.write("home", data.toString()); applyHome(data) }
        catch (error: Exception) { if (error is CancellationException) throw error }
    }
    /** What the coding agents have left. The server caches it for two minutes, so a minute here is plenty. */
    suspend fun loadQuota(force: Boolean = false) {
        if (!ui.value.linked || (!force && ui.value.quotaLoaded && System.currentTimeMillis() - quotaAt < 60000)) return
        try {
            val data = dashboardCall("/api/wear/view?view=quota" + if (force) "&refresh=1" else "")
            quotaAt = System.currentTimeMillis(); store.write("quota", data.toString()); applyQuota(data, false)
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            change { it.copy(quotaLoaded = true, quotaStale = true) }
        }
    }
    suspend fun refreshAll() = coroutineScope {
        launch { refresh() }; launch { loadHome() }; launch { loadQuota(true) }
    }
    /**
     * With [wait], the server holds the request until something changes (up to that many seconds), so each sentence and
     * the answer arrive as soon as they exist. That wait never holds the connection lock a new message needs.
     */
    suspend fun refresh(wait: Int = 0) {
        if (!ui.value.linked) return
        val epoch = sendEpoch
        try {
            val data = if (wait > 0 && version.isNotBlank()) api.call("/api/wear/state?wait=$wait&since=$version")
                else network.withLock { api.call("/api/wear/state") }
            // A message left meanwhile: its own refresh brings the state that includes it.
            if (epoch != sendEpoch) return
            version = data.optString("version")
            store.write("snapshot", data.toString()); applySnapshot(data); change { it.copy(error = "") }
            if (wait == 0) WatchPush.register(getApplication(), store, api)
        } catch (error: Exception) { failure(error) }
    }
    /** Called only from repeatOnLifecycle(RESUMED); no background socket, timer or service. */
    suspend fun foreground() = coroutineScope {
        if (ui.value.linked) { launch { loadHome() }; launch { loadQuota() }; refresh() }
        else if (store.read("pair_secret").isBlank() || ui.value.expires <= System.currentTimeMillis() / 1000) network.withLock { startPair() }
        var failures = 0
        while (true) {
            if (ui.value.awake && SystemClock.elapsedRealtime() - awakeSince > 120000) change { it.copy(awake = false) }
            if (!ui.value.linked) {
                delay(5000)
                if (store.read("pair_secret").isNotBlank()) {
                    network.withLock { pollPair() }
                    if (ui.value.linked) { launch { loadHome() }; launch { loadQuota() }; refresh() }
                }
            } else if (ui.value.working && (generalVisible || awaited.isNotBlank()) && failures < 3) {
                val started = SystemClock.elapsedRealtime()
                refresh(wait = 20)
                if (ui.value.error.isNotBlank()) { failures++; delay(2000) } else failures = 0
                // A server without the long wait answers at once and without a fingerprint: poll every few seconds instead.
                if (version.isBlank() && SystemClock.elapsedRealtime() - started < 2000) delay(3000)
                // The agent just finished: the newest notice is what the first screen should show now.
                if (!ui.value.working) launch { loadHome() }
            } else {
                // Nothing to follow: a local check only, so a new message starts its long wait within a second.
                delay(if (failures >= 3) 30000 else 800)
                if (failures >= 3) failures = 0
            }
        }
    }
    private suspend fun startPair() {
        try {
            change { it.copy(busy = true, error = "") }
            val result = api.call("/api/wear/pair/start", JSONObject().put("label", "Galaxy Watch"), false)
            store.write("pair_secret", result.getString("secret"))
            store.write("pair_code", result.getString("code")); store.write("pair_expires", result.getLong("expires").toString())
            change { it.copy(code = result.getString("code"), expires = result.getLong("expires")) }
        } catch (error: Exception) {
            if (error is ApiError && error.status in setOf(401, 404)) change { it.copy(error = "Actualiza el dashboard del servidor para vincular el reloj.") }
            else failure(error)
        }
        finally { change { it.copy(busy = false) } }
    }
    private suspend fun pollPair() {
        try {
            val result = api.call("/api/wear/pair/poll", JSONObject().put("secret", store.read("pair_secret")), false)
            if (result.optString("status") == "linked") {
                store.write("token", result.getString("token")); store.remove("pair_secret")
                result.optJSONObject("firebase")?.let { store.write("firebase", it.toString()) }
                change { it.copy(linked = true, code = "", error = "") }
            }
        } catch (error: Exception) {
            if (error is ApiError && error.status == 410) store.remove("pair_secret")
            failure(error)
        }
    }
    fun retryPair() = viewModelScope.launch { network.withLock { startPair() } }
    /**
     * Starts dictation inside the app. A second tap finishes it early. Returns false when no in-app recognizer can
     * start, and the screen then opens the system dictation instead.
     */
    fun listen(): Boolean {
        if (ui.value.listening) { ear.stop(); return true }
        speaker.stop()
        change { it.copy(listening = true, heard = "", level = 0f, hint = "", error = "") }
        if (ear.start(spanishTag())) return true
        change { it.copy(listening = false) }
        return false
    }
    /** Never keeps the microphone open: cancelled when the user backs out or the app leaves the screen. */
    fun cancelListening() {
        ear.destroy()
        if (ui.value.listening) change { it.copy(listening = false, heard = "", level = 0f) }
    }
    /** A voice turn leaves as soon as it is heard, like a conversation; an unconfirmed message keeps priority. */
    fun ask(text: String) {
        if (ui.value.pending) { change { it.copy(hint = "Primero reintenta el mensaje pendiente.") }; return }
        draft(text); persistDraft()
        send()
    }
    fun voice(on: Boolean) {
        store.write("voice", if (on) "on" else "off")
        if (!on) speaker.stop()
        change { it.copy(voice = on) }
    }
    fun hush() = speaker.stop()
    fun clearHint() = change { it.copy(hint = "") }
    fun draft(text: String) {
        // Once a request may have reached the server, retain its exact text/id until acknowledged.
        if (ui.value.pending) return
        val value = text.take(4000); change { it.copy(draft = value) }
        draftJob?.cancel()
        draftJob = viewModelScope.launch {delay(300); store.write("draft", value)}
    }
    fun persistDraft() {
        if (ui.value.pending) return
        draftJob?.cancel(); store.write("draft", ui.value.draft)
    }
    fun send() {
        if (ui.value.busy || !ui.value.linked) return
        if (!ui.value.pending) persistDraft()
        val text = store.read("draft").trim()
        if (text.isBlank()) return
        val id = store.read("request_id").ifBlank { UUID.randomUUID().toString().also { store.write("request_id", it) } }
        // The instant reply is local: it is heard before the request even reaches the server.
        val phrase = ack(text, turns++)
        sendEpoch++
        if (ui.value.voice) { if (phrase.isNotBlank()) speaker.say(phrase, first = true) else speaker.stop() }
        awakeSince = SystemClock.elapsedRealtime()
        // Freeze the exact draft immediately, even if a refresh currently owns the connection.
        change { it.copy(busy = true, pending = true, error = "", hint = "", ack = phrase, awake = true, turn = it.turn + 1) }
        viewModelScope.launch {
            var accepted = false
            network.withLock {
                try {
                    val result = api.call("/api/wear/send", JSONObject().put("request_id", id).put("text", text))
                    store.remove("request_id"); store.remove("draft")
                    accepted = true
                    awaited = result.optJSONObject("task")?.optString("id").orEmpty(); spokenRun = ""; spokenUpTo = 0; approvalSaid = false
                    change { it.copy(draft = "", pending = false, state = "queued", reply = "", speech = "", question = text, freshReply = false, heard = "") }
                } catch (error: Exception) {
                    if (error is ApiError && error.status in setOf(400, 403, 409, 413, 429)) {
                        store.remove("request_id"); change { it.copy(pending = false) }
                    }
                    if (error !is CancellationException && ui.value.voice) speaker.say("No pude enviarlo.", first = true)
                    change { it.copy(ack = "", awake = false) }
                    failure(error)
                } finally { change { it.copy(busy = false) } }
            }
            if (accepted) refresh()
        }
    }
    /** Stops the general agent's current message, or takes it out of the queue if it has not started yet. */
    fun stopTask() = viewModelScope.launch {
        val id = ui.value.taskId.ifBlank { return@launch }
        val action = if (ui.value.taskState == "espera") "delete" else "stop"
        try {
            dashboardCall("/api/wear/action", JSONObject().put("tool", "tasks").put("action", action).put("id", id).put("confirmed", true)
                .put("project", "_general").put("chat_id", "main"))
            awaited = ""; speaker.stop()
            change { it.copy(awake = false, ack = "", hint = if (action == "stop") "Detenido" else "Quitado de la cola") }
            refresh()
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            change { it.copy(hint = error.message?.take(120) ?: "No pude detenerlo") }
        }
    }
    fun notificationMode(mode: String) = viewModelScope.launch {
        try {
            val result = api.call("/api/wear/notifications", JSONObject().put("mode", mode).put("token", store.read("fcm")))
            store.write("mode", mode); change { it.copy(mode = mode, pushReady = result.optBoolean("ready"), error = "") }
            WatchPush.register(getApplication(), store, api)
        } catch (error: Exception) { failure(error) }
    }
    fun disconnect() = viewModelScope.launch {
        try {
            api.call("/api/wear/disconnect", JSONObject())
            WatchPush.disable(getApplication()); keepPreferences { store.clear() }; speaker.stop()
            mutable.value = WatchUi(voice = store.read("voice") != "off")
            retryPair()
        } catch (error: Exception) { failure(error) }
    }
    fun origin(value: String) {
        if (!value.matches(Regex("https://[a-zA-Z0-9.-]+(?::[0-9]{1,5})?/?"))) {
            change { it.copy(error = "Usa una dirección HTTPS sin ruta") }; return
        }
        store.write("origin", value.trimEnd('/')); store.remove("pair_secret")
        change { it.copy(origin = api.origin, code = "", expires = 0) }
        retryPair()
    }
}
