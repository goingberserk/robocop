export type Stream = {
  id: string;
  label: string;
  description: string;
  // Hosted on Vercel Blob; see README for uploading new clips.
  clipUrl: string;
  // Set for clips recorded from a YouTube live stream.
  youtubeId?: string;
};

const BLOB = "https://hkwsf0fpqsbgajr7.public.blob.vercel-storage.com/clips";

export const streams: Stream[] = [
  {
    id: "watertown-public-square",
    label: "Auto video 1",
    description: "Public Square, Watertown, NY · 5:00 street cam at night",
    clipUrl: `${BLOB}/watertown-public-square.mp4`,
    youtubeId: "Zz9hMrxl20I",
  },
  {
    id: "airport-security-queue",
    label: "Airport security queue",
    description: "Passengers queueing at security, London · 0:31",
    clipUrl: `${BLOB}/tl-passengers-queue-at-airport-security-london-uk.mp4`,
  },
  {
    id: "airport-check-in-timelapse",
    label: "Airport check-in time-lapse",
    description: "Check-in hall from above · 0:35",
    clipUrl: `${BLOB}/time-lapse-concept-of-4k-resolution.mp4`,
  },
  {
    id: "aboda-1",
    label: "ABODA video 1",
    description: "Abandoned-object dataset · 1:13",
    clipUrl: `${BLOB}/aboda_video1.mp4`,
  },
  {
    id: "aboda-5",
    label: "ABODA video 5",
    description: "Abandoned-object dataset · 1:50",
    clipUrl: `${BLOB}/aboda_video5.mp4`,
  },
  {
    id: "aboda-11",
    label: "ABODA video 11",
    description: "Abandoned-object dataset, busy concourse · 2:30",
    clipUrl: `${BLOB}/aboda_video11.mp4`,
  },
  {
    id: "img-7919",
    label: "IMG_7919",
    description: "Crowd in an office lounge, phone footage · 0:32",
    clipUrl: `${BLOB}/img_7919.mp4`,
  },
  {
    id: "img-7921",
    label: "IMG_7921",
    description: "Hackathon room with bags on the floor, phone footage · 0:25",
    clipUrl: `${BLOB}/img_7921.mp4`,
  },
  {
    id: "img-7928",
    label: "IMG_7928",
    description: "Office lounge with people passing through, phone footage · 0:30",
    clipUrl: `${BLOB}/img_7928.mp4`,
  },
];
