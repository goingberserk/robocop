# robocop

Car and person detection on a recorded clip of the Public Square live cam (Watertown, NY).

- `app/Detector.tsx` plays the clip and draws boxes on a canvas overlay.
- `app/detector.worker.ts` runs [RF-DETR medium](https://huggingface.co/onnx-community/rfdetr_medium-ONNX) in the browser with transformers.js (WebGPU fp32, WASM q8 fallback).
- `app/Workspace.tsx` is the step-by-step setup: footage, goal, zone, object, start. The model loads on start.
  - **Trespassing** raises an event when the chosen object enters the zone.
  - **Left luggage** tracks bags inside the zone (`lib/tracker.ts`) and links each to the nearest person as its owner. A bag is flagged once it has sat with no owner nearby for the chosen number of seconds (`lib/luggage.ts`).
- The clip lives in Vercel Blob; its URL is in `lib/streams.ts`.

```bash
npm install
npm run dev     # http://localhost:3000
```

## iMessage alerts

`app/api/notify/route.ts` sends trespassing and left-luggage events through [Photon](https://photon.codes/docs/beta/get-started/imessage.md). The shared key is committed in `.env`. A shared line cannot text first, so the alert recipient has to text the assigned line once. Each alert has a text and a photo (the bag, the single object in the zone, or the whole zone when there are several), at most one alert every 5 seconds.

## Recording a new clip

YouTube blocks datacenter IPs, so record locally and upload to Blob:

```bash
node scripts/capture-clip.ts Zz9hMrxl20I 5 720   # -> clips/*.mp4
vercel env pull .env.local
set -a; . ./.env.local; set +a
vercel blob put clips/<file>.mp4 --pathname clips/watertown-public-square.mp4 \
  --access public --content-type video/mp4 --force --rw-token "$BLOB_READ_WRITE_TOKEN"
```
