export type Stream = {
  id: string;
  title: string;
  location: string;
  youtubeId: string;
  // Recorded with scripts/capture-clip.ts and uploaded to Vercel Blob.
  clipUrl: string;
};

export const streams: Stream[] = [
  {
    id: "watertown-public-square",
    title: "Public Square",
    location: "Watertown, NY",
    youtubeId: "Zz9hMrxl20I",
    clipUrl:
      "https://hkwsf0fpqsbgajr7.public.blob.vercel-storage.com/clips/watertown-public-square.mp4",
  },
];
