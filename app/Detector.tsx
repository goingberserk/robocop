"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CLASSES,
  type Detection,
  type WorkerRequest,
  type WorkerResponse,
} from "@/lib/detection";
import styles from "./Detector.module.css";

// Frames are downscaled before inference; the model works at 384px anyway.
const FRAME_WIDTH = 640;

type Status =
  | { kind: "loading"; progress: number }
  | { kind: "ready"; device: string; dtype: string }
  | { kind: "error"; message: string };

type Result = {
  detections: Detection[];
  width: number;
  height: number;
};

const COLORS = new Map<string, string>(CLASSES.map((c) => [c.label, c.color]));

export default function Detector({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [status, setStatus] = useState<Status>({ kind: "loading", progress: 0 });
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(CLASSES.map((c) => c.label)),
  );
  const [threshold, setThreshold] = useState(0.35);
  const [result, setResult] = useState<Result | null>(null);
  const [inferenceMs, setInferenceMs] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const visible = useMemo(
    () =>
      result?.detections.filter(
        (d) => d.score >= threshold && enabled.has(d.label),
      ) ?? [],
    [result, enabled, threshold],
  );

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const d of visible) tally[d.label] = (tally[d.label] ?? 0) + 1;
    return tally;
  }, [visible]);

  // Inference loop: one frame in flight at a time, always the newest frame.
  useEffect(() => {
    const video = videoRef.current!;
    const worker = new Worker(new URL("./detector.worker.ts", import.meta.url), {
      type: "module",
    });
    let busy = false;
    let ready = false;
    let nextId = 0;
    let stopped = false;

    const send = async () => {
      if (stopped || busy || !ready || video.readyState < 2) return;
      busy = true;
      try {
        const height = Math.round(
          (FRAME_WIDTH * video.videoHeight) / video.videoWidth,
        );
        const bitmap = await createImageBitmap(video, {
          resizeWidth: FRAME_WIDTH,
          resizeHeight: height,
        });
        const message: WorkerRequest = { type: "frame", id: nextId++, bitmap };
        worker.postMessage(message, [bitmap]);
      } catch {
        busy = false;
      }
    };

    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      switch (data.type) {
        case "progress":
          setStatus({
            kind: "loading",
            progress: data.total ? data.loaded / data.total : 0,
          });
          break;
        case "ready":
          ready = true;
          setStatus({ kind: "ready", device: data.device, dtype: data.dtype });
          send();
          break;
        case "error":
          busy = false;
          setStatus({ kind: "error", message: data.message });
          break;
        case "result":
          busy = false;
          setResult(data);
          setInferenceMs(data.ms);
          if (!video.paused) send();
          break;
      }
    };

    const onFrameChange = () => send();
    video.addEventListener("play", onFrameChange);
    video.addEventListener("seeked", onFrameChange);
    video.addEventListener("loadeddata", onFrameChange);

    return () => {
      stopped = true;
      worker.terminate();
      video.removeEventListener("play", onFrameChange);
      video.removeEventListener("seeked", onFrameChange);
      video.removeEventListener("loadeddata", onFrameChange);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Redraw boxes whenever a result, filter, or the canvas size changes.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    if (!result) return;

    const sx = size.width / result.width;
    const sy = size.height / result.height;
    ctx.font = "600 12px ui-monospace, monospace";
    ctx.textBaseline = "top";
    ctx.lineWidth = 2;
    for (const d of visible) {
      const color = COLORS.get(d.label) ?? "#fff";
      const x = d.box.xmin * sx;
      const y = d.box.ymin * sy;
      const w = (d.box.xmax - d.box.xmin) * sx;
      const h = (d.box.ymax - d.box.ymin) * sy;

      ctx.strokeStyle = color;
      ctx.strokeRect(x, y, w, h);

      const text = `${d.label} ${Math.round(d.score * 100)}`;
      const tw = ctx.measureText(text).width + 8;
      const ty = y >= 18 ? y - 18 : y;
      ctx.fillStyle = color;
      ctx.fillRect(x - 1, ty, tw, 18);
      ctx.fillStyle = "#000";
      ctx.fillText(text, x + 3, ty + 3);
    }
  }, [result, visible, size]);

  const toggle = (label: string) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  return (
    <div className={styles.root}>
      <div className={styles.stage}>
        <video
          ref={videoRef}
          className={styles.video}
          src={src}
          crossOrigin="anonymous"
          autoPlay
          muted
          loop
          playsInline
          controls
        />
        <canvas ref={canvasRef} className={styles.overlay} />
        {status.kind !== "ready" && (
          <div className={styles.status}>
            {status.kind === "loading"
              ? `Loading model… ${Math.round(status.progress * 100)}%`
              : `Detection failed: ${status.message}`}
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <div className={styles.chips}>
          {CLASSES.map((c) => (
            <button
              key={c.label}
              type="button"
              className={styles.chip}
              aria-pressed={enabled.has(c.label)}
              onClick={() => toggle(c.label)}
              style={{ "--chip": c.color } as React.CSSProperties}
            >
              {c.label}
              <span className={styles.count}>{counts[c.label] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className={styles.threshold}>
          Confidence ≥ {Math.round(threshold * 100)}%
          <input
            type="range"
            min={0.2}
            max={0.9}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
        </label>
        <div className={styles.stats}>
          RF-DETR nano
          {status.kind === "ready" && ` · ${status.device} ${status.dtype}`}
          {inferenceMs !== null && ` · ${Math.round(inferenceMs)} ms/frame`}
        </div>
      </div>
    </div>
  );
}
