// Records the most recent minutes of a YouTube live stream to an MP4.
//
//   node scripts/capture-clip.ts <videoId> [minutes=5] [height=720]
//
// YouTube blocks datacenter IPs (including Vercel), so run this locally.
// Output: clips/<videoId>-<timestamp>.mp4 (video only, faststart).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const ffmpeg: string = require("ffmpeg-static");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

// The visionOS client returns HLS for live streams without a PO token.
const CLIENT = {
  clientName: "VISIONOS",
  clientVersion: "1.02",
  deviceMake: "Apple",
  deviceModel: "RealityDevice17,1",
  userAgent: UA,
  osName: "visionOS",
  osVersion: "26.5.23O471",
  hl: "en",
};

async function text(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${url.slice(0, 80)}`);
  return res.text();
}

async function resolveMaster(videoId: string): Promise<string> {
  const embed = await text(`https://www.youtube.com/embed/${videoId}`, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US" },
  });
  const visitorData = embed.match(/"VISITOR_DATA":"([^"]+)"/)?.[1];
  if (!visitorData) throw new Error("visitor data not found");

  const player = JSON.parse(
    await text("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
        "X-YouTube-Client-Name": "101",
        "X-YouTube-Client-Version": CLIENT.clientVersion,
        "X-Goog-Visitor-Id": visitorData,
        Origin: "https://www.youtube.com",
      },
      body: JSON.stringify({
        context: { client: { ...CLIENT, visitorData } },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    }),
  );
  const url = player?.streamingData?.hlsManifestUrl;
  if (!url) {
    const status = player?.playabilityStatus;
    throw new Error(`no HLS manifest: ${status?.status} ${status?.reason ?? ""}`);
  }
  return url;
}

function pickVariant(master: string, height: number): string {
  const lines = master.split("\n");
  let best: { url: string; height: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^#EXT-X-STREAM-INF:.*RESOLUTION=\d+x(\d+)/);
    const url = lines[i + 1]?.trim();
    if (!match || !url) continue;
    const h = Number(match[1]);
    if (!best || Math.abs(h - height) < Math.abs(best.height - height)) {
      best = { url, height: h };
    }
  }
  if (!best) throw new Error("no video variant in master playlist");
  console.log(`variant: ${best.height}p`);
  return best.url;
}

function segmentsFor(playlist: string, seconds: number) {
  const segments: { duration: number; url: string }[] = [];
  let duration = 0;
  for (const raw of playlist.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) duration = parseFloat(line.slice(8));
    else if (line && !line.startsWith("#")) segments.push({ duration, url: line });
  }
  const picked = [];
  let total = 0;
  for (let i = segments.length - 1; i >= 0 && total < seconds; i--) {
    picked.unshift(segments[i]);
    total += segments[i].duration;
  }
  return picked;
}

async function main() {
  const [videoId, minutesArg = "5", heightArg = "720"] = process.argv.slice(2);
  if (!videoId) {
    console.error("usage: node scripts/capture-clip.ts <videoId> [minutes] [height]");
    process.exit(1);
  }

  const master = await text(await resolveMaster(videoId));
  const playlist = await text(pickVariant(master, Number(heightArg)));
  const segments = segmentsFor(playlist, Number(minutesArg) * 60);
  console.log(`downloading ${segments.length} segments`);

  const chunks: Buffer[] = [];
  for (const [i, segment] of segments.entries()) {
    const res = await fetch(segment.url);
    if (!res.ok) throw new Error(`segment ${i}: ${res.status}`);
    chunks.push(Buffer.from(await res.arrayBuffer()));
    process.stdout.write(`\r${i + 1}/${segments.length}`);
  }
  process.stdout.write("\n");

  mkdirSync("clips", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ts = path.join("clips", `${videoId}-${stamp}.ts`);
  const mp4 = ts.replace(/\.ts$/, ".mp4");
  writeFileSync(ts, Buffer.concat(chunks));
  execFileSync(
    ffmpeg,
    ["-loglevel", "error", "-i", ts, "-map", "0:v:0", "-an", "-c", "copy",
      "-movflags", "+faststart", "-y", mp4],
    { stdio: "inherit" },
  );
  rmSync(ts);
  console.log(mp4);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
