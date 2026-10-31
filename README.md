# robocop

Car and person detection on a recorded clip of the Public Square live cam (Watertown, NY).

- `app/Detector.tsx` plays the clip and draws boxes on a canvas overlay.
- `app/detector.worker.ts` runs [RF-DETR nano](https://huggingface.co/onnx-community/rfdetr_nano-ONNX) in the browser with transformers.js (WebGPU fp32, WASM q8 fallback).
- The clip lives in Vercel Blob; its URL is in `lib/streams.ts`.

```bash
npm install
npm run dev     # http://localhost:3000
```

## Recording a new clip

YouTube blocks datacenter IPs, so record locally and upload to Blob:

```bash
node scripts/capture-clip.ts Zz9hMrxl20I 5 720   # -> clips/*.mp4
vercel env pull .env.local
set -a; . ./.env.local; set +a
vercel blob put clips/<file>.mp4 --pathname clips/watertown-public-square.mp4 \
  --access public --content-type video/mp4 --force --rw-token "$BLOB_READ_WRITE_TOKEN"
```
