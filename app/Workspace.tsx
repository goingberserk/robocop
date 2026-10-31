"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  OTHER_CATEGORIES,
  STREET_CATEGORIES,
  type Detection,
} from "@/lib/detection";
import {
  type Bag,
  BAG_TRACKING,
  type BagState,
  dedupeBags,
  LUGGAGE_CATEGORIES,
  LuggageWatch,
} from "@/lib/luggage";
import type { NotifyRequest, NotifyResponse, NotifyStatus } from "@/lib/notify";
import type { Stream } from "@/lib/streams";
import { type Track, Tracker } from "@/lib/tracker";
import { boxInZone, type Point } from "@/lib/watch";
import Detector, {
  type Annotation,
  type Status,
  type VisibleResult,
} from "./Detector";
import { useCamera } from "./useCamera";
import styles from "./Workspace.module.css";

const MIN_POINTS = 3;
// Boxes flicker, so an entry needs this many frames in a row, and the zone must
// stay empty this long before the same activity can raise another event.
const EVENT_MIN_FRAMES = 2;
const EVENT_COOLDOWN_MS = 5000;
const CROP_MAX_EDGE = 1024;
const CROP_ZOOM_OUT = 1.3;
// A left bag only alerts once, so it waits for the send limit instead of being
// dropped by it.
const LUGGAGE_SEND_ATTEMPTS = 4;
const SEND_RETRY_MS = 5500;

const BAG_COLORS: Record<BagState, string> = {
  moving: "#a0a0a0",
  attended: "#34d399",
  unattended: "#f59e0b",
  abandoned: "#ef4444",
};
const OWNER_COLOR = "#3b9eff";

const STEPS = ["footage", "goal", "zone", "object", "start"] as const;
const STEP_LABELS = ["Footage", "Goal", "Area", "Rule", "Start"];

const GOALS = [
  {
    id: "trespassing",
    label: "Trespassing",
    description: "Someone or something enters an area you mark.",
    available: true,
  },
  {
    id: "luggage",
    label: "Left luggage",
    description: "A bag stays behind without its owner.",
    available: true,
  },
  {
    id: "crowd",
    label: "Crowded space",
    description: "More people than you allow are in an area you mark.",
    available: true,
  },
  {
    id: "theft",
    label: "Theft",
    description: "An item is taken from a person or a place.",
    available: false,
  },
];

const LOADING: Status = { kind: "loading", progress: 0 };

type ZoneEvent = {
  id: string;
  time: number;
  text: string;
  imessage?: NotifyStatus | "sending" | "off";
};

const IMESSAGE_LABELS: Record<NonNullable<ZoneEvent["imessage"]>, string> = {
  sending: "Sending…",
  sent: "Sent with photo",
  sent_without_image: "Sent, no photo",
  off: "",
  not_configured: "Messages not set up",
  invalid: "Not sent",
  rate_limited: "Skipped (limit)",
  no_conversation: "Text the Photon line first",
  failed: "Not sent",
};

const zoneBox = (zone: Point[], width: number, height: number) => ({
  xmin: Math.min(...zone.map((p) => p.x)) * width,
  ymin: Math.min(...zone.map((p) => p.y)) * height,
  xmax: Math.max(...zone.map((p) => p.x)) * width,
  ymax: Math.max(...zone.map((p) => p.y)) * height,
});

// One object gets a close-up with some surroundings; several get the whole zone.
function cropDetection(
  frame: HTMLCanvasElement,
  box: Detection["box"],
  marginRatio: number,
) {
  const margin =
    marginRatio * Math.max(box.xmax - box.xmin, box.ymax - box.ymin);
  const width = Math.min(
    frame.width,
    (box.xmax - box.xmin + 2 * margin) * CROP_ZOOM_OUT,
  );
  const height = Math.min(
    frame.height,
    (box.ymax - box.ymin + 2 * margin) * CROP_ZOOM_OUT,
  );
  // Slide the crop back into the frame near an edge instead of cutting it.
  const clamp = (start: number, size: number, max: number) =>
    Math.min(Math.max(0, start), max - size);
  const x = clamp((box.xmin + box.xmax - width) / 2, width, frame.width);
  const y = clamp((box.ymin + box.ymax - height) / 2, height, frame.height);
  const scale = Math.min(3, CROP_MAX_EDGE / Math.max(width, height));
  const crop = document.createElement("canvas");
  crop.width = Math.round(width * scale);
  crop.height = Math.round(height * scale);
  crop
    .getContext("2d")!
    .drawImage(frame, x, y, width, height, 0, 0, crop.width, crop.height);
  return crop.toDataURL("image/jpeg", 0.85).split(",")[1];
}

async function notify(
  request: NotifyRequest,
  attempts = 1,
): Promise<NotifyStatus> {
  try {
    const response = await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const { status } = (await response.json()) as NotifyResponse;
    if (status !== "rate_limited" || attempts <= 1) return status;
    await new Promise((resolve) => setTimeout(resolve, SEND_RETRY_MS));
    return notify(request, attempts - 1);
  } catch {
    return "failed";
  }
}

const countInZone = (result: VisibleResult | null, zone: Point[]) =>
  result?.detections.filter((d) =>
    boxInZone(d.box, zone, result.width, result.height),
  ).length ?? 0;

const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

const bagName = ({ track }: Bag) => `${track.label} #${track.id}`;

const annotate = (bags: Bag[], people: Map<number, Track["box"]>) => {
  const annotations: Annotation[] = [];
  for (const bag of bags) {
    const alone =
      bag.state === "unattended" || bag.state === "abandoned"
        ? ` ${Math.floor(bag.alone)}s`
        : "";
    annotations.push({
      box: bag.track.box,
      label: `${bagName(bag)} · ${bag.state}${alone}`,
      color: BAG_COLORS[bag.state],
    });
    const owner = bag.ownerId === null ? undefined : people.get(bag.ownerId);
    if (owner) annotations.push({ box: owner, color: OWNER_COLOR });
  }
  return annotations;
};

export default function Workspace({ streams }: { streams: Stream[] }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [footage, setFootage] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [zone, setZone] = useState<Point[]>([]);
  const [zoneClosed, setZoneClosed] = useState(false);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [category, setCategory] = useState("person");
  const [maxPeople, setMaxPeople] = useState(5);
  const [items, setItems] = useState<string[]>(LUGGAGE_CATEGORIES);
  const [abandonAfter, setAbandonAfter] = useState(5);
  const [bags, setBags] = useState<Bag[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>();
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<Status>(LOADING);
  const [visible, setVisible] = useState<VisibleResult | null>(null);
  const [peak, setPeak] = useState(0);
  const [onlyInZone, setOnlyInZone] = useState(true);
  const [eventsOn, setEventsOn] = useState(true);
  const [events, setEvents] = useState<ZoneEvent[]>([]);
  const [imessageOn, setImessageOn] = useState(true);
  const eventsEnabled = useRef(true);
  const imessageEnabled = useRef(true);
  const streak = useRef(0);
  const lastInZone = useRef(0);
  const [tracker] = useState(() => new Tracker(BAG_TRACKING));
  const [luggage] = useState(() => new LuggageWatch());

  const step = STEPS[stepIndex];
  const stream = streams.find((s) => s.id === footage);
  const live = stream !== undefined && !stream.clipUrl;
  const [cameraId, setCameraId] = useState<string | null>(null);
  const { camera, devices } = useCamera(live, cameraId);
  const watchingBags = goal === "luggage";
  const watchingCrowd = goal === "crowd";
  const counted = watchingCrowd ? "person" : category;
  // Trespassing is any object at all; a crowd is more people than allowed.
  const allowed = watchingCrowd ? maxPeople : 0;
  const categories = useMemo(
    () => (watchingBags ? [...items, "person"] : [counted]),
    [watchingBags, items, counted],
  );
  const drawing = step === "zone" && !zoneClosed;
  const detecting = started && status.kind === "ready";

  const handleVisible = useCallback(
    (result: VisibleResult) => {
      setVisible(result);
      const send = (request: NotifyRequest, attempts?: number) =>
        notify(request, attempts).then((imessage) =>
          setEvents((prev) =>
            prev.map((e) => (e.id === request.id ? { ...e, imessage } : e)),
          ),
        );
      if (watchingBags) {
        const tracks = tracker.update(
          dedupeBags(result.detections),
          result.time,
        );
        const { bags, abandoned } = luggage.update(tracks, {
          zone,
          width: result.width,
          height: result.height,
          time: result.time,
          abandonAfter,
        });
        const people = new Map(
          tracks.filter((t) => t.label === "person").map((t) => [t.id, t.box]),
        );
        setBags(bags);
        setAnnotations(annotate(bags, people));
        if (eventsEnabled.current && abandoned.length > 0) {
          const found: ZoneEvent[] = abandoned.map((bag) => ({
            id: crypto.randomUUID(),
            time: result.time,
            text: `Left luggage: ${bagName(bag)} alone for ${Math.floor(bag.alone)} s`,
            imessage: imessageEnabled.current ? "sending" : "off",
          }));
          setEvents((prev) => [...found, ...prev]);
          if (imessageEnabled.current) {
            abandoned.forEach((bag, i) =>
              send(
                {
                  kind: "luggage",
                  id: found[i].id,
                  source: footage!,
                  category: bag.track.label,
                  alone: Math.floor(bag.alone),
                  time: result.time,
                  image: result.frame
                    ? cropDetection(result.frame, bag.track.box, 1)
                    : undefined,
                },
                LUGGAGE_SEND_ATTEMPTS,
              ),
            );
          }
        }
        return;
      }

      const count = countInZone(result, zone);
      setPeak((prev) => Math.max(prev, count));

      streak.current = count > allowed ? streak.current + 1 : 0;
      if (streak.current < EVENT_MIN_FRAMES) return;
      const now = Date.now();
      if (eventsEnabled.current && now - lastInZone.current > EVENT_COOLDOWN_MS) {
        const event: ZoneEvent = {
          id: crypto.randomUUID(),
          time: result.time,
          text: watchingCrowd
            ? `Crowded: ${count} people in area (limit ${allowed})`
            : `Area entered: ${counted} (${count} in area)`,
          imessage: imessageEnabled.current ? "sending" : "off",
        };
        setEvents((prev) => [event, ...prev]);
        if (imessageEnabled.current) {
          const inside = result.detections.filter((d) =>
            boxInZone(d.box, zone, result.width, result.height),
          );
          const box =
            inside.length === 1
              ? inside[0].box
              : zoneBox(zone, result.width, result.height);
          const image = result.frame
            ? cropDetection(result.frame, box, inside.length === 1 ? 0.3 : 0)
            : undefined;
          const details = {
            id: event.id,
            source: footage!,
            category: counted,
            count,
            time: result.time,
            image,
          };
          send(
            watchingCrowd
              ? { ...details, kind: "crowd", limit: allowed }
              : { ...details, kind: "zone" },
          );
        }
      }
      lastInZone.current = now;
    },
    [
      zone,
      watchingBags,
      watchingCrowd,
      tracker,
      luggage,
      abandonAfter,
      counted,
      allowed,
      footage,
    ],
  );

  const inZone = useMemo(() => countInZone(visible, zone), [visible, zone]);
  const bagCount = (state: BagState) =>
    bags.filter((bag) => bag.state === state).length;
  const alert = watchingBags ? bagCount("abandoned") > 0 : inZone > allowed;

  const pointFrom = (e: React.PointerEvent<HTMLDivElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const closeZone = () => {
    setCursor(null);
    setZoneClosed(true);
  };

  const clearZone = () => {
    setZone([]);
    setZoneClosed(false);
    setCursor(null);
  };

  const start = () => {
    setVisible(null);
    setPeak(0);
    setEvents([]);
    streak.current = 0;
    lastInZone.current = 0;
    tracker.reset();
    luggage.reset();
    setBags([]);
    setAnnotations(undefined);
    setStarted(true);
  };

  const stop = () => {
    setStarted(false);
    setVisible(null);
    setBags([]);
    setAnnotations(undefined);
  };

  const canContinue =
    (step === "footage" && footage !== null && (!live || camera.kind === "on")) ||
    (step === "goal" && goal !== null) ||
    (step === "zone" && zoneClosed) ||
    (step === "object" &&
      (watchingCrowd ? maxPeople >= 1 : !watchingBags || items.length > 0));

  const abandonSlider = (
    <label className={styles.slider}>
      Abandoned after {abandonAfter} s alone
      <input
        type="range"
        min={2}
        max={60}
        step={1}
        value={abandonAfter}
        onChange={(e) => setAbandonAfter(Number(e.target.value))}
      />
    </label>
  );

  const preview = cursor ? [...zone, cursor] : zone;
  const points = preview.map((p) => `${p.x},${p.y}`).join(" ");
  const percent =
    status.kind === "loading" ? Math.round(status.progress * 100) : 100;

  return (
    <div className={styles.root}>
      <div className={styles.viewer}>
        <Detector
          src={camera.kind === "on" ? camera.stream : stream?.clipUrl}
          categories={categories}
          active={started}
          boxZone={onlyInZone ? zone : null}
          annotations={watchingBags ? annotations : undefined}
          onStatus={setStatus}
          onVisible={handleVisible}
        >
          {!stream && (
            <div className={styles.placeholder}>
              Choose footage to get started
            </div>
          )}
          {detecting && (
            <div className={styles.livePill} data-alert={alert || undefined}>
              <span className={styles.liveDot} aria-hidden />
              {alert ? "Alert" : "Detecting"}
            </div>
          )}
          {live && camera.kind === "starting" && (
            <div className={styles.placeholder}>Opening camera…</div>
          )}
          <div
            className={styles.layer}
            data-drawing={drawing || undefined}
            onPointerMove={(e) => {
              if (drawing && zone.length > 0) setCursor(pointFrom(e));
            }}
            onPointerUp={(e) => {
              if (!drawing) return;
              const point = pointFrom(e);
              setZone((prev) => [...prev, point]);
            }}
          >
            <svg
              className={styles.shapes}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              aria-hidden
            >
              {zoneClosed ? (
                <polygon
                  points={points}
                  vectorEffect="non-scaling-stroke"
                  className={styles.zone}
                  data-alert={(detecting && alert) || undefined}
                />
              ) : (
                <polyline
                  points={points}
                  vectorEffect="non-scaling-stroke"
                  className={styles.draft}
                />
              )}
            </svg>
            {drawing &&
              zone.map((point, i) =>
                i === 0 && zone.length >= MIN_POINTS ? (
                  <button
                    key={i}
                    type="button"
                    aria-label="Close area"
                    className={`${styles.vertex} ${styles.vertexClose}`}
                    style={{
                      left: `${point.x * 100}%`,
                      top: `${point.y * 100}%`,
                    }}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      closeZone();
                    }}
                  />
                ) : (
                  <span
                    key={i}
                    className={styles.vertex}
                    style={{
                      left: `${point.x * 100}%`,
                      top: `${point.y * 100}%`,
                    }}
                  />
                ),
              )}
          </div>
        </Detector>

        {detecting && watchingBags && (
          <div className={styles.counts}>
            <div className={styles.count}>
              <span className={styles.countValue}>{bags.length}</span>
              <span className={styles.countLabel}>Bags in area</span>
            </div>
            <div className={styles.count}>
              <span className={styles.countValue}>
                {bagCount("unattended")}
              </span>
              <span className={styles.countLabel}>Unattended</span>
            </div>
            <div className={styles.count} data-alert={alert || undefined}>
              <span className={styles.countValue}>
                {bagCount("abandoned")}
              </span>
              <span className={styles.countLabel}>Abandoned</span>
            </div>
          </div>
        )}

        {detecting && !watchingBags && (
          <div className={styles.counts}>
            <div className={styles.count} data-alert={alert || undefined}>
              <span className={styles.countValue}>
                {inZone}
                {watchingCrowd && ` / ${allowed}`}
              </span>
              <span className={styles.countLabel}>
                {watchingCrowd ? "In area / limit" : "In area now"}
              </span>
            </div>
            <div className={styles.count}>
              <span className={styles.countValue}>
                {visible?.detections.length ?? 0}
              </span>
              <span className={styles.countLabel}>In view now</span>
            </div>
            <div className={styles.count}>
              <span className={styles.countValue}>{peak}</span>
              <span className={styles.countLabel}>Peak in area</span>
            </div>
          </div>
        )}

        {detecting && eventsOn && (
          <section className={styles.events}>
            <h3 className={styles.eventsTitle}>
              Events
              <span className={styles.eventsCount}>{events.length}</span>
            </h3>
            {events.length === 0 ? (
              <p className={styles.eventsEmpty}>
                Nothing yet. Events will appear here as they happen.
              </p>
            ) : (
              <ol className={styles.eventList}>
                {events.map((event) => (
                  <li key={event.id} className={styles.event}>
                    <span className={styles.eventTime}>
                      {formatTime(event.time)}
                    </span>
                    <span className={styles.eventText}>{event.text}</span>
                    {event.imessage && (
                      <span
                        className={styles.eventStatus}
                        data-status={event.imessage}
                      >
                        {IMESSAGE_LABELS[event.imessage]}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>

      <aside className={styles.panel}>
        <div className={styles.progress} aria-hidden>
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={styles.progressStep}
              data-done={i <= stepIndex || undefined}
            />
          ))}
        </div>
        <p className={styles.stepCount}>
          Step {stepIndex + 1} of {STEPS.length} · {STEP_LABELS[stepIndex]}
        </p>

        {step === "footage" && (
          <>
            <h2 className={styles.title}>Choose your footage</h2>
            <select
              className={styles.select}
              aria-label="Footage"
              value={footage ?? ""}
              onChange={(e) => {
                // A zone drawn on other footage would not fit this one.
                setFootage(e.target.value);
                clearZone();
              }}
            >
              <option value="" disabled>
                Select a video
              </option>
              {streams.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            {stream && <p className={styles.help}>{stream.description}</p>}
            {live && devices.length > 1 && (
              <select
                className={styles.select}
                aria-label="Camera"
                value={
                  cameraId ??
                  (camera.kind === "on"
                    ? camera.stream.getVideoTracks()[0]?.getSettings().deviceId
                    : "")
                }
                onChange={(e) => {
                  // Cameras differ in framing, so the zone starts over.
                  setCameraId(e.target.value);
                  clearZone();
                }}
              >
                {devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            )}
            {live && camera.kind === "error" && (
              <p className={styles.help}>{camera.message}</p>
            )}
          </>
        )}

        {step === "goal" && (
          <>
            <h2 className={styles.title}>What do you want to detect?</h2>
            {GOALS.map((g) => (
              <button
                key={g.id}
                type="button"
                className={styles.option}
                aria-pressed={goal === g.id}
                disabled={!g.available}
                onClick={() => setGoal(g.id)}
              >
                <span className={styles.optionName}>
                  {g.label}
                  {!g.available && <span className={styles.soon}>Soon</span>}
                </span>
                <span className={styles.optionText}>{g.description}</span>
              </button>
            ))}
          </>
        )}

        {step === "zone" && (
          <>
            <h2 className={styles.title}>
              {watchingBags || watchingCrowd
                ? "Mark the area to watch"
                : "Mark the restricted area"}
            </h2>
            <p className={styles.help}>
              {zoneClosed
                ? "Area set. You can continue."
                : zone.length < MIN_POINTS
                  ? `Click in the video to place corners (${zone.length} of ${MIN_POINTS}).`
                  : "Add more corners, or close the area."}
            </p>
            {!zoneClosed && zone.length >= MIN_POINTS && (
              <button
                type="button"
                className={styles.secondary}
                onClick={closeZone}
              >
                Close area
              </button>
            )}
            {zone.length > 0 && (
              <button
                type="button"
                className={styles.secondary}
                onClick={clearZone}
              >
                Start over
              </button>
            )}
          </>
        )}

        {step === "object" && watchingBags && (
          <>
            <h2 className={styles.title}>What counts as luggage?</h2>
            <p className={styles.help}>
              Only these are tracked inside your area. People anywhere in view
              count as owners.
            </p>
            {LUGGAGE_CATEGORIES.map((c) => (
              <label key={c} className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={items.includes(c)}
                  onChange={(e) =>
                    setItems((prev) =>
                      e.target.checked
                        ? [...prev, c]
                        : prev.filter((item) => item !== c),
                    )
                  }
                />
                {c}
              </label>
            ))}
          </>
        )}

        {step === "object" && watchingCrowd && (
          <>
            <h2 className={styles.title}>How many people are allowed?</h2>
            <p className={styles.help}>
              An event fires when more people than this are in your area.
            </p>
            <input
              className={styles.select}
              type="number"
              aria-label="Allowed people"
              min={1}
              max={500}
              value={maxPeople}
              onChange={(e) =>
                setMaxPeople(
                  Math.min(500, Math.max(0, Math.floor(Number(e.target.value)))),
                )
              }
            />
          </>
        )}

        {step === "object" && !watchingBags && !watchingCrowd && (
          <>
            <h2 className={styles.title}>What may not enter the area?</h2>
            <select
              className={styles.select}
              aria-label="Object"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <optgroup label="Street">
                {STREET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Other">
                {OTHER_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </optgroup>
            </select>
          </>
        )}

        {step === "start" && !started && (
          <>
            <h2 className={styles.title}>Ready to start</h2>
            <p className={styles.help}>
              {watchingBags ? (
                <>
                  Flag any <strong>{items.join(", ")}</strong> left in your
                  area without its owner on {stream?.label}.
                </>
              ) : watchingCrowd ? (
                <>
                  Alert when more than <strong>{maxPeople} people</strong> are
                  inside your area on {stream?.label}.
                </>
              ) : (
                <>
                  Count every <strong>{category}</strong> inside your area on{" "}
                  {stream?.label}.
                </>
              )}
            </p>
            {watchingBags && abandonSlider}
            <button type="button" className={styles.primary} onClick={start}>
              Start detection
            </button>
          </>
        )}

        {step === "start" && started && status.kind === "loading" && (
          <>
            <h2 className={styles.title}>Loading model</h2>
            <div
              className={styles.bar}
              role="progressbar"
              aria-label="Model download"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <p className={styles.help}>
              {percent}% · Detection starts when the model is ready.
            </p>
          </>
        )}

        {step === "start" && detecting && (
          <>
            <h2 className={styles.title}>Detection active</h2>
            <p className={styles.help}>
              {watchingBags ? (
                <>
                  Watching <strong>{items.join(", ")}</strong> in your area.
                  Green is with its owner (blue), amber is alone, red is
                  abandoned.
                </>
              ) : watchingCrowd ? (
                <>
                  Watching for more than <strong>{maxPeople} people</strong> in
                  your area. Counts are below the video.
                </>
              ) : (
                <>
                  Watching for <strong>{category}</strong> in your area. Counts
                  are below the video.
                </>
              )}
            </p>
            {watchingBags ? (
              abandonSlider
            ) : (
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={onlyInZone}
                  onChange={(e) => setOnlyInZone(e.target.checked)}
                />
                Only show boxes in area
              </label>
            )}
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={eventsOn}
                onChange={(e) => {
                  eventsEnabled.current = e.target.checked;
                  setEventsOn(e.target.checked);
                }}
              />
              Log events
            </label>
            {eventsOn && (
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={imessageOn}
                  onChange={(e) => {
                    imessageEnabled.current = e.target.checked;
                    setImessageOn(e.target.checked);
                  }}
                />
                Send iMessage alerts
              </label>
            )}
            <button type="button" className={styles.secondary} onClick={stop}>
              Stop
            </button>
          </>
        )}

        {step === "start" && started && status.kind === "error" && (
          <>
            <h2 className={styles.title}>Detection failed</h2>
            <p className={styles.help}>{status.message}</p>
            <button type="button" className={styles.secondary} onClick={stop}>
              Back
            </button>
          </>
        )}

        {!started && (
          <div className={styles.nav}>
            {stepIndex > 0 && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setStepIndex((i) => i - 1)}
              >
                Back
              </button>
            )}
            {step !== "start" && (
              <button
                type="button"
                className={styles.primary}
                disabled={!canContinue}
                onClick={() => setStepIndex((i) => i + 1)}
              >
                Continue
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
