export type Detection = {
  label: string;
  score: number;
  box: { xmin: number; ymin: number; xmax: number; ymax: number };
};

export type WorkerRequest = { type: "frame"; id: number; bitmap: ImageBitmap };

export type WorkerResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; device: string; dtype: string }
  | { type: "error"; message: string }
  | {
      type: "result";
      id: number;
      detections: Detection[];
      width: number;
      height: number;
      ms: number;
    };

export const MODEL_ID = "onnx-community/rfdetr_nano-ONNX";

// Lowest score the worker returns; the UI filters further with its slider.
export const MIN_SCORE = 0.2;

export const CLASSES = [
  { label: "car", color: "#3b9eff" },
  { label: "person", color: "#fb7185" },
] as const;
