"""Zentrale Einstellungen fuer die Offline-Pipeline."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FRAMES_DIR = ROOT / "pipeline" / "frames"
OUT_DIR = ROOT / "pipeline" / "out"
EVENTS_DIR = ROOT / "web" / "events"
CLIPS_DIR = ROOT / "web" / "clips"

# Wie viele Frames pro Sekunde aus dem Video gezogen werden.
FPS = 1.0

# Ein Fenster = so viele aufeinanderfolgende Frames, die das Modell
# zusammen sieht. Bei FPS=1.0 entspricht das Sekunden.
WINDOW_FRAMES = 4

# Ueberlappung zwischen zwei Fenstern, in Frames.
WINDOW_STRIDE = 2

# Laengste Kante eines Frames vor dem Upload. Kleiner = schneller + billiger.
MAX_EDGE = 768

# Ab welchem Score ein Alert ausgeloest wird (0-100).
ALERT_THRESHOLD = 60

# Gleitender Mittelwert ueber so viele Fenster, damit die Kurve nicht zappelt.
SMOOTHING_WINDOW = 3

# Nach einem Alert so viele Sekunden lang keinen neuen ausloesen.
ALERT_COOLDOWN_S = 10

MODEL = "claude-opus-5"
