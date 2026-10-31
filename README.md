# RoboCop AI

Fruehwarnung statt Nacherzaehlung: das System bewertet Ueberwachungs-Footage
sekundenweise und schlaegt an, bevor der Vorfall passiert.

Nicht um Leute zu verhaften, sondern damit in den Sekunden davor
ueberhaupt jemand hinschaut.

## Warum das ohne localhost laeuft

Zur Demo-Zeit laeuft **keine** Inferenz. Die komplette Analyse passiert vorab
und landet als JSON im Repo. Das Frontend ist eine statische Seite, die nur
noch ein Video abspielt und die vorberechnete Kurve dazu zeichnet.

Ergebnis: deploybar auf Vercel, oeffnet auf jedem Handy, braucht keine GPU,
keine Webcam-Permission und kein laufendes Notebook.

## Aufbau

```
pipeline/   Offline-Analyse (Python). Laeuft vor der Demo.
web/        Statische Seite. Das ist, was deployed wird.
data/       Rohvideos. Nicht im Git.
```

## Pipeline, drei Schritte

```bash
cd pipeline
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env     # ANTHROPIC_API_KEY eintragen
```

```bash
# 1. Video in Frames zerlegen (1 Bild pro Sekunde)
python extract_frames.py ../data/RoadAccidents012.mp4 --clip accident-01

# 2. Frames in Gleitfenstern durchs Modell schicken
python analyze.py --clip accident-01

# 3. Zu events.json fuer das Frontend verdichten
python build_events.py --clip accident-01 --incident 47 \
    --label "Road Accident" --location "Kreuzung, feststehende Kamera"
```

`--incident` ist der echte Vorfallszeitpunkt aus der Ground-Truth-Annotation
des Datensatzes. Daraus berechnet sich der Vorlauf, den die Demo zeigt.

Danach den Clip in `web/events/index.json` eintragen.

## Frontend lokal ansehen

```bash
cd web && python3 -m http.server 8000
```

Zum Deployen: Vercel, Root Directory auf `web`, kein Build Command.
Rein statisch, geht in zwei Minuten durch.

## Material

Akademische Anomaly-Detection-Datensaetze, keine zusammengesuchten Clips
aus dem Netz. Die bringen frame-genaue Annotationen mit, und das ist genau,
was fuer den Vorlauf-Vergleich gebraucht wird.

- **UCF-Crime** (crcv.ucf.edu) - 1.900 echte Ueberwachungsvideos, 13 Kategorien.
  Nur `Anomaly-Videos-Part-1.zip` holen, nicht die vollen 95 GB.
- **ShanghaiTech Campus** / **CUHK Avenue** - sauberes Normalverhalten,
  gestellte und harmlose Anomalien.
- **DoTA** - Dashcam-Unfaelle mit Anomalie-Start-Timestamp.

Kategorien bewusst unblutig waehlen: Road Accident, Vandalism, Burglary,
Stealing. Alles research-only lizenziert.

## Was das hier nicht ist

Ein Showcase, keine Validierung. Die Clips sind ausgewaehlt, der Schwellwert
ist von Hand gesetzt, und ueber die False-Positive-Rate sagt die Demo nichts.
Das ist der eigentliche Engineering-Teil und kommt danach.
