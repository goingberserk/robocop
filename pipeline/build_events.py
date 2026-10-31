"""Schritt 3: Rohbewertungen zu events.json fuer das Frontend verdichten.

    python pipeline/build_events.py --clip accident-01 --incident 47 --label "Road Accident"

--incident ist der Zeitstempel des echten Vorfalls in Sekunden, aus der
Ground-Truth-Annotation des Datensatzes. Daraus berechnet sich der Vorlauf,
den die Demo zeigt.
"""

import argparse
import json
import sys

from config import (
    ALERT_COOLDOWN_S,
    ALERT_THRESHOLD,
    EVENTS_DIR,
    FRAMES_DIR,
    OUT_DIR,
    SMOOTHING_WINDOW,
)


def load_records(clip_name):
    path = OUT_DIR / f"{clip_name}.jsonl"
    records = []
    for line in path.read_text().splitlines():
        if line.strip():
            records.append(json.loads(line))
    return records


def smooth(records, span):
    """Gleitender Mittelwert ueber die Scores, damit die Kurve lesbar bleibt."""
    smoothed = []
    index = 0
    while index < len(records):
        first = index - span + 1
        if first < 0:
            first = 0
        window = records[first:index + 1]

        total = 0
        for entry in window:
            total = total + entry["score"]
        average = total / len(window)

        copy = dict(records[index])
        copy["score_smooth"] = round(average, 1)
        smoothed.append(copy)
        index = index + 1
    return smoothed


def pick_alerts(records, threshold, cooldown):
    """Erster Ausschlag ueber dem Schwellwert, danach Pause."""
    alerts = []
    last_fired = None
    index = 0
    while index < len(records):
        entry = records[index]
        if entry["score_smooth"] >= threshold:
            if last_fired is None or entry["t_start"] - last_fired >= cooldown:
                alerts.append({
                    "t": entry["t_start"],
                    "score": entry["score_smooth"],
                    "reason": entry["reason"],
                    "watch": entry["watch"],
                })
                last_fired = entry["t_start"]
        index = index + 1
    return alerts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--clip", required=True)
    parser.add_argument("--incident", type=float, default=None,
                        help="Sekunde des echten Vorfalls laut Ground Truth")
    parser.add_argument("--label", default="", help="Kategorie, z.B. Road Accident")
    parser.add_argument("--location", default="", help="Kurzbeschreibung der Szene")
    parser.add_argument("--threshold", type=float, default=ALERT_THRESHOLD)
    args = parser.parse_args()

    records = load_records(args.clip)
    if not records:
        print(f"Keine Daten fuer {args.clip}", file=sys.stderr)
        return 1

    meta = json.loads((FRAMES_DIR / args.clip / "meta.json").read_text())
    smoothed = smooth(records, SMOOTHING_WINDOW)
    alerts = pick_alerts(smoothed, args.threshold, ALERT_COOLDOWN_S)

    lead_time = None
    if args.incident is not None and alerts:
        lead_time = round(args.incident - alerts[0]["t"], 1)

    timeline = []
    for entry in smoothed:
        timeline.append({
            "t": entry["t_start"],
            "score": entry["score_smooth"],
            "raw": entry["score"],
            "reason": entry["reason"],
        })

    payload = {
        "clip": args.clip,
        "video": f"clips/{args.clip}.mp4",
        "label": args.label,
        "location": args.location,
        "duration_s": meta["duration_s"],
        "threshold": args.threshold,
        "incident_t": args.incident,
        "lead_time_s": lead_time,
        "timeline": timeline,
        "alerts": alerts,
    }

    EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = EVENTS_DIR / f"{args.clip}.json"
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))

    print(f"{len(timeline)} Zeitpunkte, {len(alerts)} Alerts -> {out_path}")
    if lead_time is not None:
        print(f"Vorlauf erster Alert vor Vorfall: {lead_time}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
