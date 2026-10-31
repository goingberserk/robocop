"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type Detection,
  type WorkerRequest,
  type WorkerResponse,
} from "@/lib/detection";
import { boxInZone, type Point } from "@/lib/watch";
import styles from "./Detector.module.css";

// Frames are downscaled before inference; the model works at 576px anyway.
const FRAME_WIDTH = 1024;
const BOX_COLOR = "#fb7185";

export type Status =
  | { kind: "loading"; progress: number }
  | { kind: "ready"; device: string; dtype: string }
  | { kind: "error"; message: string };

export type Result = {
  detections: Detection[];
  width: number;
  height: number;
};

export type VisibleResult = Result & { time: number };

// A box to draw in place of the raw detections, in result pixels.
export type Annotation = {
  box: Detection["box"];
  // Boxes without a label are drawn thinner.
  label?: string;
  color: string;
};

export default function Detector({
  src,
  categories,
  active,
  boxZone,
  annotations,
  onStatus,
  onVisible,
  children,
}: {
  src?: string;
  categories: string[];
  // The model only loads once detection is started.
  active: boolean;
  // When set, only boxes inside this zone are drawn. Counts are unaffected.
  boxZone: Point[] | null;
  // When set, these are drawn instead of the detections.
  annotations?: Annotation[];
  onStatus: (status: Status) => void;
  onVisible: (visible: VisibleResult) => void;
  children?: React.ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [status, setStatus] = useState<Status>({ kind: "loading", progress: 0 });
  const [threshold, setThreshold] = useState(0.35);
  const [result, setResult] = useState<Result | null>(null);
  const [inferenceMs, setInferenceMs] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // The stage takes the video's shape so boxes and zones line up with it.
  const [aspect, setAspect] = useState(16 / 9);

  const visible = useMemo(
    () =>
      result?.detections.filter(
        (d) => d.score >= threshold && categories.includes(d.label),
      ) ?? [],
    [result, categories, threshold],
  );

  useEffect(() => onStatus(status), [status, onStatus]);

  useEffect(() => {
    if (!result) return;
    onVisible({
      ...result,
      detections: visible,
      time: videoRef.current?.currentTime ?? 0,
    });
  }, [result, visible, onVisible]);

  // Inference loop: one frame in flight at a time, always the newest frame.
  useEffect(() => {
    if (!active) return;
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
      setResult(null);
      setInferenceMs(null);
      setStatus({ kind: "loading", progress: 0 });
    };
  }, [active]);

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
    const boxes: Annotation[] =
      annotations ??
      visible
        .filter(
          (d) =>
            !boxZone || boxInZone(d.box, boxZone, result.width, result.height),
        )
        .map((d) => ({
          box: d.box,
          label: `${d.label} ${Math.round(d.score * 100)}`,
          color: BOX_COLOR,
        }));
    for (const { box, label, color } of boxes) {
      const x = box.xmin * sx;
      const y = box.ymin * sy;
      const w = (box.xmax - box.xmin) * sx;
      const h = (box.ymax - box.ymin) * sy;

      ctx.strokeStyle = color;
      ctx.lineWidth = label ? 2 : 1;
      ctx.strokeRect(x, y, w, h);
      if (!label) continue;

      const tw = ctx.measureText(label).width + 8;
      const ty = y >= 18 ? y - 18 : y;
      ctx.fillStyle = color;
      ctx.fillRect(x - 1, ty, tw, 18);
      ctx.fillStyle = "#000";
      ctx.fillText(label, x + 3, ty + 3);
    }
  }, [result, visible, size, boxZone, annotations]);

  return (
    <div className={styles.root}>
      <div
        className={styles.stage}
        style={{
          aspectRatio: aspect,
          // Cap the height without breaking the aspect ratio.
          width: `min(100%, calc(75vh * ${aspect}))`,
        }}
      >
        <video
          ref={videoRef}
          className={styles.video}
          src={src}
          onLoadedMetadata={(e) => {
            const { videoWidth, videoHeight } = e.currentTarget;
            if (videoWidth && videoHeight) setAspect(videoWidth / videoHeight);
          }}
          crossOrigin="anonymous"
          autoPlay
          muted
          loop
          playsInline
          controls
        />
        <canvas ref={canvasRef} className={styles.overlay} />
        {children}
      </div>

      {active && status.kind === "ready" && (
      <div className={styles.controls}>
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
          RF-DETR medium
          {status.kind === "ready" && ` · ${status.device} ${status.dtype}`}
          {inferenceMs !== null && ` · ${Math.round(inferenceMs)} ms/frame`}
        </div>
      </div>
      )}
    </div>
  );
}
