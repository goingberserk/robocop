"""Schritt 1: Video in Einzelbilder zerlegen.

    python pipeline/extract_frames.py data/roadaccident_012.mp4 --clip accident-01

Legt die Frames unter pipeline/frames/<clip>/ ab und kopiert das Video
nach web/public/clips/<clip>.mp4, damit das Frontend es abspielen kann.
"""

import argparse
import json
import shutil
import subprocess
import sys

from config import CLIPS_DIR, FPS, FRAMES_DIR


def probe_duration(video_path):
    """Laenge des Videos in Sekunden, ueber ffprobe."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json",
            str(video_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(result.stdout)
    return float(payload["format"]["duration"])


def extract(video_path, clip_name, fps):
    target_dir = FRAMES_DIR / clip_name
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True)

    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "error",
            "-i", str(video_path),
            "-vf", f"fps={fps}",
            "-q:v", "3",
            str(target_dir / "frame_%05d.jpg"),
        ],
        check=True,
    )

    frames = sorted(target_dir.glob("frame_*.jpg"))
    return frames


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video", help="Pfad zum Quellvideo")
    parser.add_argument("--clip", required=True, help="Kurzname, z.B. accident-01")
    parser.add_argument("--fps", type=float, default=FPS)
    args = parser.parse_args()

    video_path = args.video

    duration = probe_duration(video_path)
    frames = extract(video_path, args.clip, args.fps)

    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    playback_copy = CLIPS_DIR / f"{args.clip}.mp4"
    shutil.copy(video_path, playback_copy)

    meta = {
        "clip": args.clip,
        "source": str(video_path),
        "duration_s": round(duration, 2),
        "fps": args.fps,
        "frame_count": len(frames),
    }
    meta_path = FRAMES_DIR / args.clip / "meta.json"
    meta_path.write_text(json.dumps(meta, indent=2))

    print(f"{len(frames)} Frames aus {duration:.1f}s Video -> {FRAMES_DIR / args.clip}")
    print(f"Abspielkopie -> {playback_copy}")


if __name__ == "__main__":
    sys.exit(main())
