"""Schritt 2: Frames in Fenstern durch das Modell schicken.

    python pipeline/analyze.py --clip accident-01

Ergebnis: pipeline/out/<clip>.jsonl, eine Zeile pro Fenster mit
Risk Score, Begruendung und Beobachtung. Laeuft offline, lange vor der Demo.
Zur Demo-Zeit wird nichts mehr gerechnet.
"""

import argparse
import base64
import io
import json
import os
import sys
import time

from anthropic import Anthropic
from dotenv import load_dotenv
from PIL import Image

from config import (
    FRAMES_DIR,
    MAX_EDGE,
    MODEL,
    OUT_DIR,
    WINDOW_FRAMES,
    WINDOW_STRIDE,
)

SYSTEM_PROMPT = """Du bist ein Analysemodul fuer Videoueberwachung in oeffentlichen Raeumen.

Du bekommst eine kurze Bildfolge aus einer feststehenden Kamera, ein Bild pro Sekunde,
in zeitlicher Reihenfolge. Beurteile ausschliesslich, was in diesen Bildern zu sehen ist.

Deine Aufgabe ist Fruehwarnung, nicht Nacherzaehlung: bewerte, wie wahrscheinlich sich
in den naechsten Sekunden ein sicherheitsrelevanter Vorfall ereignet.

Achte auf Vorboten statt auf den Vorfall selbst:
- ungewoehnliche Geschwindigkeit oder Richtungswechsel
- Personen, die aufeinander zulaufen oder sich auffaellig gruppieren
- Koerperhaltung, die auf Anspannung hindeutet
- Gegenstaende, die abgestellt und zurueckgelassen werden
- jemand bewegt sich gegen den allgemeinen Strom
- Fahrzeuge und Personen auf Kollisionskurs

Sei konservativ. Normale Szenen sind normal. Gedraenge allein ist kein Vorfall,
ein wartendes Fahrzeug ist kein Vorfall, eine rennende Person allein auch nicht.
Vergib hohe Scores nur, wenn mehrere Signale zusammenkommen.

Antworte ausschliesslich mit einem JSON-Objekt, ohne Codefence, in diesem Format:
{"score": <0-100>, "reason": "<ein kurzer Satz, was du siehst>", "watch": "<was du als naechstes beobachten wuerdest>"}

score bedeutet:
0-25   nichts Auffaelliges
26-55  leicht ungewoehnlich, aber harmlos erklaerbar
56-75  mehrere Vorboten gleichzeitig, aufmerksam werden
76-100 unmittelbar bevorstehender Vorfall"""


def encode_frame(path):
    """Frame verkleinern und als base64 JPEG zurueckgeben."""
    picture = Image.open(path).convert("RGB")
    longest = max(picture.size)
    if longest > MAX_EDGE:
        factor = MAX_EDGE / longest
        new_size = (int(picture.width * factor), int(picture.height * factor))
        picture = picture.resize(new_size, Image.LANCZOS)

    buffer = io.BytesIO()
    picture.save(buffer, format="JPEG", quality=80)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def build_windows(frames, size, stride):
    """Liste von (start_index, [frame_paths]) ueber ein Gleitfenster."""
    windows = []
    cursor = 0
    while cursor + size <= len(frames):
        windows.append((cursor, frames[cursor:cursor + size]))
        cursor = cursor + stride
    return windows


def parse_reply(raw_text):
    """Modellantwort in ein Dict verwandeln, auch wenn Text drumherum steht."""
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    first = cleaned.find("{")
    last = cleaned.rfind("}")
    if first == -1 or last == -1:
        return {"score": 0, "reason": "keine Antwort lesbar", "watch": ""}
    return json.loads(cleaned[first:last + 1])


def analyze_window(client, frame_paths, start_second):
    content = []
    position = 0
    while position < len(frame_paths):
        second = start_second + position
        content.append({"type": "text", "text": f"Sekunde {second}:"})
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": encode_frame(frame_paths[position]),
            },
        })
        position = position + 1

    content.append({
        "type": "text",
        "text": "Bewerte diese Bildfolge. Nur das JSON-Objekt, sonst nichts.",
    })

    response = client.messages.create(
        model=MODEL,
        max_tokens=300,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": content}],
    )
    return parse_reply(response.content[0].text)


def main():
    load_dotenv()

    parser = argparse.ArgumentParser()
    parser.add_argument("--clip", required=True)
    parser.add_argument("--limit", type=int, default=0, help="nur die ersten N Fenster")
    args = parser.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY fehlt. Siehe .env.example", file=sys.stderr)
        return 1

    clip_dir = FRAMES_DIR / args.clip
    frames = sorted(clip_dir.glob("frame_*.jpg"))
    if not frames:
        print(f"Keine Frames in {clip_dir}. Erst extract_frames.py laufen lassen.", file=sys.stderr)
        return 1

    meta = json.loads((clip_dir / "meta.json").read_text())
    windows = build_windows(frames, WINDOW_FRAMES, WINDOW_STRIDE)
    if args.limit > 0:
        windows = windows[:args.limit]

    client = Anthropic()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{args.clip}.jsonl"

    started = time.time()
    with out_path.open("w") as sink:
        index = 0
        while index < len(windows):
            start_index, frame_paths = windows[index]
            start_second = int(start_index / meta["fps"])

            try:
                verdict = analyze_window(client, frame_paths, start_second)
            except Exception as problem:
                print(f"  Fenster {index} fehlgeschlagen: {problem}", file=sys.stderr)
                verdict = {"score": 0, "reason": "Analyse fehlgeschlagen", "watch": ""}

            record = {
                "window": index,
                "t_start": start_second,
                "t_end": start_second + WINDOW_FRAMES - 1,
                "score": int(verdict.get("score", 0)),
                "reason": verdict.get("reason", ""),
                "watch": verdict.get("watch", ""),
            }
            sink.write(json.dumps(record, ensure_ascii=False) + "\n")
            sink.flush()

            print(f"[{index + 1}/{len(windows)}] t={start_second}s score={record['score']} {record['reason'][:60]}")
            index = index + 1

    elapsed = time.time() - started
    print(f"\nFertig in {elapsed:.0f}s -> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
