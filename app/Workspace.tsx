"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { OTHER_CATEGORIES, STREET_CATEGORIES } from "@/lib/detection";
import type { Stream } from "@/lib/streams";
import { boxInZone, type Point } from "@/lib/watch";
import Detector, { type Status, type VisibleResult } from "./Detector";
import styles from "./Workspace.module.css";

const MIN_POINTS = 3;
// Boxes flicker, so an entry needs this many frames in a row, and the zone must
// stay empty this long before the same activity can raise another event.
const EVENT_MIN_FRAMES = 2;
const EVENT_COOLDOWN_MS = 5000;

const STEPS = ["footage", "goal", "zone", "object", "start"] as const;

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
    available: false,
  },
  {
    id: "theft",
    label: "Theft",
    description: "An item is taken from a person or a place.",
    available: false,
  },
];

const LOADING: Status = { kind: "loading", progress: 0 };

type ZoneEvent = { id: string; time: number; count: number };

const countInZone = (result: VisibleResult | null, zone: Point[]) =>
  result?.detections.filter((d) =>
    boxInZone(d.box, zone, result.width, result.height),
  ).length ?? 0;

const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function Workspace({ streams }: { streams: Stream[] }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [footage, setFootage] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [zone, setZone] = useState<Point[]>([]);
  const [zoneClosed, setZoneClosed] = useState(false);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [category, setCategory] = useState("person");
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<Status>(LOADING);
  const [visible, setVisible] = useState<VisibleResult | null>(null);
  const [peak, setPeak] = useState(0);
  const [onlyInZone, setOnlyInZone] = useState(true);
  const [eventsOn, setEventsOn] = useState(true);
  const [events, setEvents] = useState<ZoneEvent[]>([]);
  const eventsEnabled = useRef(true);
  const streak = useRef(0);
  const lastInZone = useRef(0);

  const step = STEPS[stepIndex];
  const stream = streams.find((s) => s.id === footage);
  const drawing = step === "zone" && !zoneClosed;
  const detecting = started && status.kind === "ready";

  const handleVisible = useCallback(
    (result: VisibleResult) => {
      const count = countInZone(result, zone);
      setVisible(result);
      setPeak((prev) => Math.max(prev, count));

      streak.current = count > 0 ? streak.current + 1 : 0;
      if (streak.current < EVENT_MIN_FRAMES) return;
      const now = Date.now();
      if (eventsEnabled.current && now - lastInZone.current > EVENT_COOLDOWN_MS) {
        const event = { id: crypto.randomUUID(), time: result.time, count };
        setEvents((prev) => [event, ...prev]);
      }
      lastInZone.current = now;
    },
    [zone],
  );

  const inZone = useMemo(() => countInZone(visible, zone), [visible, zone]);

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
    setStarted(true);
  };

  const stop = () => {
    setStarted(false);
    setVisible(null);
  };

  const canContinue =
    (step === "footage" && footage !== null) ||
    (step === "goal" && goal !== null) ||
    (step === "zone" && zoneClosed) ||
    step === "object";

  const preview = cursor ? [...zone, cursor] : zone;
  const points = preview.map((p) => `${p.x},${p.y}`).join(" ");
  const percent =
    status.kind === "loading" ? Math.round(status.progress * 100) : 100;

  return (
    <div className={styles.root}>
      <div className={styles.viewer}>
        <Detector
          src={stream?.clipUrl}
          category={category}
          active={started}
          boxZone={onlyInZone ? zone : null}
          onStatus={setStatus}
          onVisible={handleVisible}
        >
          {!stream && (
            <div className={styles.placeholder}>No footage selected</div>
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
                  data-alert={(detecting && inZone > 0) || undefined}
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
                    aria-label="Close zone"
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

        {detecting && (
          <div className={styles.counts}>
            <div className={styles.count} data-alert={inZone > 0 || undefined}>
              <span className={styles.countValue}>{inZone}</span>
              <span className={styles.countLabel}>{category} in zone now</span>
            </div>
            <div className={styles.count}>
              <span className={styles.countValue}>
                {visible?.detections.length ?? 0}
              </span>
              <span className={styles.countLabel}>{category} in view now</span>
            </div>
            <div className={styles.count}>
              <span className={styles.countValue}>{peak}</span>
              <span className={styles.countLabel}>Most in zone at once</span>
            </div>
          </div>
        )}

        {detecting && eventsOn && (
          <section className={styles.events}>
            <h3 className={styles.eventsTitle}>Events ({events.length})</h3>
            {events.length === 0 ? (
              <p className={styles.help}>No events yet.</p>
            ) : (
              <ol className={styles.eventList}>
                {events.map((event) => (
                  <li key={event.id} className={styles.event}>
                    <span className={styles.eventTime}>
                      {formatTime(event.time)}
                    </span>
                    Zone entered: {category} ({event.count} in zone)
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
          Step {stepIndex + 1} of {STEPS.length}
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
            <h2 className={styles.title}>Mark the restricted zone</h2>
            <p className={styles.help}>
              {zoneClosed
                ? "Zone set."
                : zone.length < MIN_POINTS
                  ? `Click in the video to place corners (${zone.length} of ${MIN_POINTS}).`
                  : "Add more corners, or close the zone."}
            </p>
            {!zoneClosed && zone.length >= MIN_POINTS && (
              <button
                type="button"
                className={styles.secondary}
                onClick={closeZone}
              >
                Close zone
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

        {step === "object" && (
          <>
            <h2 className={styles.title}>What may not enter the zone?</h2>
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
              Count every <strong>{category}</strong> inside your zone on{" "}
              {stream?.label}.
            </p>
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
              Watching for <strong>{category}</strong> in your zone. Counts are
              below the video.
            </p>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={onlyInZone}
                onChange={(e) => setOnlyInZone(e.target.checked)}
              />
              Only show boxes in zone
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={eventsOn}
                onChange={(e) => {
                  eventsEnabled.current = e.target.checked;
                  setEventsOn(e.target.checked);
                }}
              />
              Trigger events
            </label>
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
