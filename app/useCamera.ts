"use client";

import { useEffect, useState } from "react";

export type Camera =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "on"; stream: MediaStream }
  | { kind: "error"; message: string };

// Opens a camera while `enabled`, and lists the cameras to pick from. An
// iPhone shows up here through Continuity Camera once the Mac has seen it.
export function useCamera(enabled: boolean, deviceId: string | null) {
  // Tagged with the device it was opened for, so a stale result reads as
  // "starting" while the next camera opens.
  const [opened, setOpened] = useState<{ for: string | null; camera: Camera }>();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    const done = (camera: Camera) => setOpened({ for: deviceId, camera });

    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      .then(async (media) => {
        if (stopped) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = media;
        done({ kind: "on", stream });
        // Labels are only filled in once permission has been granted.
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!stopped) setDevices(all.filter((d) => d.kind === "videoinput"));
      })
      .catch((err: Error) => {
        if (stopped) return;
        done({
          kind: "error",
          message:
            err.name === "NotAllowedError"
              ? "Camera access was blocked. Allow it in the address bar, then reload the page."
              : err.message || "Could not open the camera.",
        });
      });

    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
      setOpened(undefined);
    };
  }, [enabled, deviceId]);

  const camera: Camera = !enabled
    ? { kind: "off" }
    : opened && opened.for === deviceId
      ? opened.camera
      : { kind: "starting" };

  return { camera, devices };
}
