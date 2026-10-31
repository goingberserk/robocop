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

export const MODEL_ID = "onnx-community/rfdetr_medium-ONNX";

// Lowest score the worker returns; the UI filters further with its slider.
export const MIN_SCORE = 0.2;

export const STREET_CATEGORIES = [
  "person",
  "car",
  "truck",
  "bus",
  "bicycle",
  "motorcycle",
  "traffic light",
  "stop sign",
  "parking meter",
  "fire hydrant",
  "bench",
];

// The remaining COCO classes the model is trained on.
export const OTHER_CATEGORIES = [
  "airplane", "apple", "backpack", "banana", "baseball bat", "baseball glove",
  "bear", "bed", "bird", "boat", "book", "bottle", "bowl", "broccoli", "cake",
  "carrot", "cat", "cell phone", "chair", "clock", "couch", "cow", "cup",
  "dining table", "dog", "donut", "elephant", "fork", "frisbee", "giraffe",
  "hair drier", "handbag", "horse", "hot dog", "keyboard", "kite", "knife",
  "laptop", "microwave", "mouse", "orange", "oven", "pizza", "potted plant",
  "refrigerator", "remote", "sandwich", "scissors", "sheep", "sink",
  "skateboard", "skis", "snowboard", "spoon", "sports ball", "suitcase",
  "surfboard", "teddy bear", "tennis racket", "tie", "toaster", "toilet",
  "toothbrush", "train", "tv", "umbrella", "vase", "wine glass", "zebra",
];
