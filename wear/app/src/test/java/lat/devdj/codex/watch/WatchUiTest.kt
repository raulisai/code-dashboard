package lat.devdj.codex.watch

import org.junit.Assert.*
import org.junit.Test

class WatchUiTest {
    @Test fun statusReflectsActualLifecycleWithoutProviderOrFakeProgress() {
        assertEquals("Aquí estoy", WatchUi().label)
        assertEquals("Estoy en ello", WatchUi(state = "working").label)
        assertEquals("Leyendo", WatchUi(state = "working", activity = "Leyendo").label)
        assertEquals("Necesito tu atención", WatchUi(state = "attention").label)
        assertEquals("Sin actualizar", WatchUi(state = "working", error = "sin red").label)
        assertFalse(WatchUi(state = "idle").working)
        assertTrue(WatchUi(state = "queued").working)
    }
}
