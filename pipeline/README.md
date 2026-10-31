# Pipeline

Drei Skripte, die nacheinander laufen. Jedes schreibt Dateien, die das
naechste liest, damit man jeden Schritt einzeln wiederholen kann.

| Skript | rein | raus |
|---|---|---|
| `extract_frames.py` | Video | `frames/<clip>/*.jpg` + `web/clips/<clip>.mp4` |
| `analyze.py` | Frames | `out/<clip>.jsonl` |
| `build_events.py` | JSONL | `web/events/<clip>.json` |

## Stellschrauben

Alles in `config.py`:

- `WINDOW_FRAMES` / `WINDOW_STRIDE` - wie viele Sekunden das Modell auf
  einmal sieht und wie weit das Fenster weiterrueckt. Groesseres Fenster
  heisst mehr Kontext, weniger Zeitaufloesung.
- `ALERT_THRESHOLD` - ab wann die Alert-Karte aufploppt. Zu niedrig und
  die Demo schlaegt staendig an, zu hoch und der Vorlauf schrumpft.
- `SMOOTHING_WINDOW` - gleitender Mittelwert. Ohne den zappelt die Kurve
  und sieht im Video nervoes aus.
- `MAX_EDGE` - Frames werden vor dem Upload verkleinert. 768px reicht
  fuer Ueberwachungsmaterial und spart deutlich Zeit und Kosten.

## Kosten im Blick behalten

Ein 70-Sekunden-Clip bei `WINDOW_FRAMES=4` und `WINDOW_STRIDE=2` ergibt
rund 34 Fenster mit je 4 Bildern. Erst mit `--limit 5` testen, bevor ein
langer Clip komplett durchlaeuft.
