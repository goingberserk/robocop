import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  formatClock,
  plainSentence,
  type IncidentInput,
} from "@/lib/incident";

// The incident card sent as the alert image. Rendered with satori, so every
// box with more than one child is display:flex and sizes are explicit.
const W = 1200;
const SHOT_H = Math.round((W * 9) / 16);
const H = 64 + 104 + SHOT_H + 112 + 118 + 62;

const NAVY = "#0d1424";
const MUTED = "#93a0b8";
const RED = "#e5484d";
const TEAL = "#2bc4a8";

let fonts: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 600 | 700 }[]>;

function loadFonts() {
  fonts ??= Promise.all(
    (
      [
        ["Inter-Regular.ttf", 400],
        ["Inter-SemiBold.ttf", 600],
        ["Inter-Bold.ttf", 700],
      ] as const
    ).map(async ([file, weight]) => {
      const buf = await readFile(
        path.join(process.cwd(), "lib", "card", "fonts", file),
      );
      return {
        name: "Inter",
        data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        weight,
      };
    }),
  );
  return fonts;
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

export async function renderIncidentCard(input: IncidentInput): Promise<Buffer> {
  const sentence = input.sentence ?? plainSentence(input);
  const heading = input.kind === "luggage" ? "Left luggage" : "Intrusion";
  const zonePoints = input.zone
    .map((p) => `${(p.x * W).toFixed(1)},${(p.y * SHOT_H).toFixed(1)}`)
    .join(" ");
  const metaA =
    input.kind === "luggage"
      ? { k: "Alone for", v: `${input.dwellSeconds ?? 0} s` }
      : { k: "In zone", v: `${input.count} ${input.category}${input.count === 1 ? "" : "s"}` };
  const metaB =
    input.kind === "luggage"
      ? { k: "Item", v: input.category }
      : { k: "Dwell", v: input.dwellSeconds !== undefined ? `${input.dwellSeconds} s` : "just now" };

  const response = new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          background: NAVY,
          color: "#f2f5fa",
          fontFamily: "Inter",
        }}
      >
        <div
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 36px",
            background: RED,
            color: "#fff",
          }}
        >
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 5 }}>
            {heading.toUpperCase()}
          </span>
          <span style={{ fontSize: 22, fontWeight: 400, opacity: 0.92 }}>
            Zone armed
          </span>
        </div>

        <div
          style={{
            height: 104,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 36px",
          }}
        >
          <span style={{ fontSize: 44, fontWeight: 600, letterSpacing: -0.5 }}>
            {input.title}
          </span>
          <span style={{ fontSize: 24, color: MUTED }}>
            {input.camera} · {formatClock(input.at)}
          </span>
        </div>

        <div
          style={{
            width: W,
            height: SHOT_H,
            display: "flex",
            position: "relative",
            background: "#000",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/jpeg;base64,${input.frame}`}
            width={W}
            height={SHOT_H}
            style={{ objectFit: "cover" }}
            alt=""
          />
          <svg
            width={W}
            height={SHOT_H}
            viewBox={`0 0 ${W} ${SHOT_H}`}
            style={{ position: "absolute", top: 0, left: 0 }}
          >
            {input.zone.length >= 3 && (
              <polygon
                points={zonePoints}
                fill="rgba(229,72,77,0.18)"
                stroke={RED}
                strokeWidth={4}
              />
            )}
            {input.boxes.map((b, i) => (
              <rect
                key={i}
                x={b.x * W}
                y={b.y * SHOT_H}
                width={b.w * W}
                height={b.h * SHOT_H}
                fill="none"
                stroke="#fff"
                strokeWidth={4}
              />
            ))}
          </svg>
          {input.boxes.slice(0, 4).map((b, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: Math.round(b.x * W),
                top: Math.max(0, Math.round(b.y * SHOT_H) - 34),
                display: "flex",
                padding: "4px 10px",
                background: "#fff",
                color: "#000",
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              {b.label.toUpperCase()} {Math.round(b.score * 100)}
            </div>
          ))}
          <div
            style={{
              position: "absolute",
              left: 24,
              bottom: 20,
              display: "flex",
              padding: "8px 14px",
              background: "rgba(0,0,0,0.6)",
              color: "#fff",
              fontSize: 20,
              letterSpacing: 1,
            }}
          >
            REC · {input.camera.toUpperCase()} · {input.at.slice(0, 19).replace("T", " ")}
          </div>
        </div>

        <div
          style={{
            height: 112,
            display: "flex",
            padding: "0 36px",
            alignItems: "center",
          }}
        >
          {[metaA, metaB, { k: "Incident", v: `#${input.incident}` }].map((m) => (
            <div
              key={m.k}
              style={{ display: "flex", flexDirection: "column", width: 376 }}
            >
              <span style={{ fontSize: 20, color: MUTED, letterSpacing: 3 }}>
                {m.k.toUpperCase()}
              </span>
              <span style={{ fontSize: 30, fontWeight: 600, marginTop: 4 }}>
                {m.v}
              </span>
            </div>
          ))}
        </div>

        <div
          style={{
            height: 118,
            display: "flex",
            alignItems: "flex-start",
            padding: "0 36px",
            fontSize: 28,
            lineHeight: 1.35,
            color: "#d7deea",
          }}
        >
          {sentence}
        </div>

        <div
          style={{
            height: 62,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 36px",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            fontSize: 21,
            color: MUTED,
          }}
        >
          <span>robocop · detection ran on device</span>
          <span style={{ display: "flex", alignItems: "center" }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                background: TEAL,
                marginRight: 10,
              }}
            />
            Live
          </span>
        </div>
      </div>
    ),
    { width: W, height: H, fonts: await loadFonts() },
  );
  return Buffer.from(await response.arrayBuffer());
}
