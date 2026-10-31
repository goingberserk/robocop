import {
  pipeline,
  RawImage,
  type ObjectDetectionPipeline,
} from "@huggingface/transformers";
import {
  MIN_SCORE,
  type Detection,
  MODEL_ID,
  type WorkerRequest,
  type WorkerResponse,
} from "@/lib/detection";

type WebGPU = { requestAdapter(): Promise<unknown | null> };

const post = (message: WorkerResponse) => self.postMessage(message);

async function pickBackend() {
  const gpu = (navigator as { gpu?: WebGPU }).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  if (!adapter) return { device: "wasm", dtype: "q8" } as const;
  // The fp16 export returns no detections on WebGPU.
  return { device: "webgpu", dtype: "fp32" } as const;
}

const detector = (async () => {
  const backend = await pickBackend();
  const model = (await pipeline("object-detection", MODEL_ID, {
    ...backend,
    progress_callback: (event) => {
      if (event.status !== "progress_total") return;
      post({ type: "progress", loaded: event.loaded, total: event.total });
    },
  })) as ObjectDetectionPipeline;
  post({ type: "ready", ...backend });
  return model;
})();

detector.catch((error) => post({ type: "error", message: String(error) }));

let canvas: OffscreenCanvas | undefined;

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  const { id, bitmap } = data;
  const { width, height } = bitmap;
  try {
    const model = await detector;
    canvas ??= new OffscreenCanvas(width, height);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const image = new RawImage(pixels, width, height, 4);

    const start = performance.now();
    const detections = (await model(image, {
      threshold: MIN_SCORE,
    })) as Detection[];
    const ms = performance.now() - start;
    post({ type: "result", id, detections, width, height, ms });
  } catch (error) {
    post({ type: "error", message: String(error) });
  } finally {
    bitmap.close();
  }
};
