package lat.devdj.codex.watch

import android.app.Application
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
    val origin: String = "https://codex-dashboard.devdj.lat",
) {
    val working get() = state in setOf("working", "queued")
    val label get() = when {
        busy -> "Conectando"
        error.isNotBlank() -> "Sin actualizar"
        state == "attention" -> "Necesito tu atención"
        state == "error" -> "Necesito tu atención"
        state == "working" -> activity.ifBlank { "Estoy en ello" }
        state == "queued" -> "En un momento"
        else -> "Aquí estoy"
    }
}

class WatchViewModel @JvmOverloads constructor(application: Application, injectedApi: WatchApi? = null) : AndroidViewModel(application) {
    val store = WatchStore(application)
    val api = injectedApi ?: WatchApi(store)
    private val mutable = MutableStateFlow(WatchUi(linked = store.read("token").isNotBlank(),
        draft = store.read("draft"), pending = store.read("request_id").isNotBlank(), origin = api.origin,
        code = store.read("pair_code"), expires = store.read("pair_expires").toLongOrNull() ?: 0))
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
    val nav = Nav()
    val hub = ToolHub()
    fun generalVisible(value: Boolean) { generalVisible = value }
    init {
        if (mutable.value.linked) {
            store.json("snapshot")?.let { applySnapshot(it) }
            store.json("home")?.let { applyHome(it) }
            store.json("quota")?.let { applyQuota(it, stale = true) }
        }
    }
    private fun change(update: (WatchUi) -> WatchUi) { mutable.value = update(mutable.value) }
    private fun failure(error: Exception) {
        if (error is CancellationException) throw error
        if (error is ApiError && error.status == 401) {
            // Retain an unsent draft, remove every credential/cache from the revoked session.
            val draft = store.read("draft"); val origin = api.origin
            store.clear(); store.write("draft", draft); store.write("origin", origin)
            mutable.value = WatchUi(draft = draft, origin = origin, error = "Vuelve a vincular el reloj")
        } else change { it.copy(error = error.message?.take(140) ?: "No pude conectar. Inténtalo de nuevo.") }
    }
    private fun applySnapshot(data: JSONObject) {
        val last = data.optJSONObject("last_task")
        val task = data.optJSONObject("task")
        val state = data.optString("state", "idle")
        val reply = data.optString("reply")
        change { it.copy(state = state, activity = data.optString("activity"), reply = reply,
            freshReply = it.freshReply || (it.working && state !in setOf("working", "queued") && reply.isNotBlank()),
            question = task?.optString("title") ?: "", taskTitle = last?.optString("title") ?: "",
            taskProject = last?.optString("project") ?: "", taskStatus = last?.optString("status") ?: "",
            updated = data.optLong("updated_at"), mode = data.optString("notifications", "attention")) }
        data.optJSONObject("firebase")?.let { store.write("firebase", it.toString()) }
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
    suspend fun refresh() = network.withLock {
        if (!ui.value.linked) return@withLock
        try {
            val data = api.call("/api/wear/state")
            store.write("snapshot", data.toString()); applySnapshot(data); change { it.copy(error = "") }
            WatchPush.register(getApplication(), store, api)
        } catch (error: Exception) { failure(error) }
    }
    /** Called only from repeatOnLifecycle(RESUMED); no background socket, timer or service. */
    suspend fun foreground() = coroutineScope {
        if (ui.value.linked) { launch { loadHome() }; launch { loadQuota() }; refresh() }
        else if (store.read("pair_secret").isBlank() || ui.value.expires <= System.currentTimeMillis() / 1000) network.withLock { startPair() }
        var failures = 0
        while (true) {
            delay(if (!ui.value.linked) 5000 else if (ui.value.working) 6000 else 30000)
            if (!ui.value.linked) {
                if (store.read("pair_secret").isNotBlank()) {
                    network.withLock { pollPair() }
                    if (ui.value.linked) { launch { loadHome() }; launch { loadQuota() }; refresh() }
                }
            } else if (ui.value.working && generalVisible) {
                if (ui.value.error.isNotBlank()) failures++ else failures = 0
                val before = ui.value.working
                if (failures < 3) refresh()
                // The agent just finished: the newest notice is what the first screen should show now.
                if (before && !ui.value.working) launch { loadHome() }
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
        // Freeze the exact draft immediately, even if a refresh currently owns the connection.
        change { it.copy(busy = true, pending = true, error = "") }
        viewModelScope.launch {
            var accepted = false
            network.withLock {
                try {
                    api.call("/api/wear/send", JSONObject().put("request_id", id).put("text", text))
                    store.remove("request_id"); store.remove("draft")
                    accepted = true
                    change { it.copy(draft = "", pending = false, state = "queued", reply = "", question = text, freshReply = false) }
                } catch (error: Exception) {
                    if (error is ApiError && error.status in setOf(400, 403, 409, 413, 429)) {
                        store.remove("request_id"); change { it.copy(pending = false) }
                    }
                    failure(error)
                } finally { change { it.copy(busy = false) } }
            }
            if (accepted) refresh()
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
            WatchPush.disable(getApplication()); store.clear(); mutable.value = WatchUi()
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
