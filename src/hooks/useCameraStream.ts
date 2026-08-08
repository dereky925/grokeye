import { useCallback, useEffect, useRef, useState } from "react";

export type CameraDevice = {
  deviceId: string;
  label: string;
};

type Options = {
  enabled: boolean;
  /** Attach the stream here once it opens. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Force a specific camera; otherwise the USB webcam is auto-picked. */
  deviceId?: string;
};

/**
 * Labels are only exposed after the user has granted camera permission, so the
 * first getUserMedia call is deliberately unconstrained: it unlocks the labels,
 * we pick the USB cam, then re-open with an exact deviceId.
 */
const USB_CAM_RE = /logitech|logi\b|c920|c922|c930|hd\s*pro\s*webcam|usb/i;
/** macOS built-in — never the one we want when an external cam is present. */
const BUILT_IN_RE = /facetime|macbook|built-?in|isight/i;

export function pickCamera(devices: CameraDevice[]): CameraDevice | null {
  if (!devices.length) return null;
  const external = devices.find((d) => USB_CAM_RE.test(d.label));
  if (external) return external;
  const notBuiltIn = devices.find((d) => !BUILT_IN_RE.test(d.label));
  return notBuiltIn ?? devices[0];
}

export function useCameraStream({ enabled, videoRef, deviceId }: Options) {
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const el = videoRef.current;
    if (el) el.srcObject = null;
  }, [videoRef]);

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }

    let cancelled = false;

    const open = async (constraints: MediaTrackConstraints) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Webcam mic stays off on purpose: the Web Speech recognizer owns the
        // mic, and a live audio track here would feed the speakers back in.
        audio: false,
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, ...constraints },
      });
      return stream;
    };

    (async () => {
      setStarting(true);
      setError(null);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("This browser cannot open a camera");
        }

        // Pass 1: any camera, purely to unlock device labels.
        let stream = await open({});
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const all = await navigator.mediaDevices.enumerateDevices();
        const cams: CameraDevice[] = all
          .filter((d) => d.kind === "videoinput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Camera ${i + 1}`,
          }));
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setDevices(cams);

        const wanted =
          (deviceId && cams.find((c) => c.deviceId === deviceId)) ||
          pickCamera(cams);
        const current = stream.getVideoTracks()[0]?.getSettings().deviceId;

        // Pass 2: only if pass 1 landed on the wrong camera.
        if (wanted && wanted.deviceId && wanted.deviceId !== current) {
          stream.getTracks().forEach((t) => t.stop());
          stream = await open({ deviceId: { exact: wanted.deviceId } });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
        }

        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        setActiveDeviceId(track?.getSettings().deviceId ?? null);
        setActiveLabel(track?.label || wanted?.label || "Camera");

        const el = videoRef.current;
        if (el) {
          el.srcObject = stream;
          el.muted = true;
          await el.play().catch(() => {});
        }
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera permission denied — allow it in the address bar and reload."
            : name === "NotFoundError"
              ? "No camera found. Is the webcam plugged in?"
              : name === "NotReadableError"
                ? "The camera is busy — close other apps using it (Zoom, Photo Booth)."
                : err instanceof Error
                  ? err.message
                  : "Could not start the camera",
        );
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled, deviceId, stop, videoRef]);

  return { devices, activeDeviceId, activeLabel, starting, error };
}
