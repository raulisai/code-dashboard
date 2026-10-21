package lat.devdj.codex.watch

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.MaterialTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val model: WatchViewModel by viewModels()
    private var openReply by mutableStateOf(false)
    private var openAlerts by mutableStateOf(false)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        openReply = intent.getBooleanExtra("show_reply", false)
        openAlerts = intent.getBooleanExtra("show_dashboard", false)
        lifecycleScope.launch { repeatOnLifecycle(Lifecycle.State.RESUMED) { model.foreground() } }
        setContent { MaterialTheme { WatchApp(model, openReply, openAlerts) { openReply = false; openAlerts = false } } }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openReply = intent.getBooleanExtra("show_reply", false)
        openAlerts = intent.getBooleanExtra("show_dashboard", false)
    }
    override fun onStop() {
        model.persistDraft()
        super.onStop()
    }
}

/** Keeps the display on while a conversation is live, so lowering the wrist does not cut the answer that is being read. */
@Composable private fun KeepAwake(on: Boolean) {
    val view = LocalView.current
    DisposableEffect(view, on) {
        view.keepScreenOn = on
        onDispose { view.keepScreenOn = false }
    }
}

/** Everything the watch shows: the general agent first, every other screen one swipe to the right away from it. */
@Composable
fun WatchApp(model: WatchViewModel, openReply: Boolean = false, openAlerts: Boolean = false, consumed: () -> Unit = {}) {
    val state by model.ui.collectAsStateWithLifecycle()
    val nav = model.nav
    val top = nav.top
    LaunchedEffect(top) { model.generalVisible(top is Dest.Home || top is Dest.Compose || top is Dest.Reply) }
    DisposableEffect(model) { onDispose { model.generalVisible(false) } }
    // A revoked or removed pairing must not leave the user deep inside screens that no longer have data.
    LaunchedEffect(state.linked) { if (!state.linked) nav.home() }
    var voiceError by remember { mutableStateOf("") }
    val context = LocalContext.current
    KeepAwake(state.awake || state.listening || state.speaking)
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        // Leaving the screen never keeps the microphone open or the voice talking.
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE) { model.hush(); model.cancelListening() }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(openReply) { if (openReply) { nav.open(Dest.Reply); consumed() } }
    LaunchedEffect(openAlerts) { if (openAlerts) { nav.open(Dest.Alerts); consumed() } }
    BackHandler(nav.stack.size > 1) { nav.pop() }
    // Declared later, so it wins: backing out while listening only stops listening.
    BackHandler(state.listening) { model.cancelListening() }
    val dictate = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val text = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!text.isNullOrBlank()) model.ask(text)
    }
    val systemDictation = {
        try {
            dictate.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, spanishTag())
                .putExtra(RecognizerIntent.EXTRA_PROMPT, "¿Qué hacemos?"))
        } catch (_: ActivityNotFoundException) { voiceError = "Dictado no disponible. Puedes escribir."; if (nav.top !is Dest.Compose) nav.push(Dest.Compose) }
    }
    // The in-app recognizer failed before hearing anything: one more try with the system dictation screen.
    var fallbacks by remember { mutableIntStateOf(state.systemDictation) }
    LaunchedEffect(state.systemDictation) { if (state.systemDictation > fallbacks) { fallbacks = state.systemDictation; systemDictation() } }
    val microphone = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted || !model.listen()) systemDictation()
    }
    val notifyPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        voiceError = if (granted) "" else "Puedes permitir los avisos en Ajustes del reloj."
    }
    val talk = {
        voiceError = ""
        when {
            state.pending -> { if (nav.top !is Dest.Compose) nav.push(Dest.Compose) }
            else -> {
                // Talking happens on the first screen, where the words and the answer appear.
                if (nav.top !is Dest.Home) nav.home()
                if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) microphone.launch(Manifest.permission.RECORD_AUDIO)
                else if (!model.listen()) systemDictation()
            }
        }
    }
    val speak = { text: String -> if (state.speaking) model.hush() else model.speaker.say(text, first = true) }
    CompositionLocalProvider(LocalScrollMemory provides model.hub.scroll) {
        AppScaffold(timeText = {}) {
            if (!state.linked) PairScreen(model, state)
            else Screens(nav) { frame, active ->
                when (val dest = frame.dest) {
                    Dest.Home -> HomeScreen(model, state, talk)
                    Dest.Compose -> ComposeScreen(model, state, voiceError, talk)
                    Dest.Reply -> ReplyScreen(state, speak, talk)
                    Dest.Alerts -> AlertsScreen(model, state)
                    Dest.Quota -> QuotaScreen(model, state)
                    Dest.Push -> PushScreen(model, state, { notifyPermission.launch(it) }, voiceError)
                    Dest.Unlink -> UnlinkScreen(model, state)
                    is Dest.Tool -> ToolScreen(model, dest.route, active)
                    is Dest.Op -> OperationScreen(model, dest.route, dest.op)
                }
            }
        }
    }
}
