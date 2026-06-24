"use client";

import { useCallback, useRef, useState } from "react";
import { encodeWav } from "@/lib/audio/wav";

export type VoiceState = "idle" | "recording" | "transcribing";

interface VoiceInput {
  state: VoiceState;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

function getAudioContext(): AudioContext {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new Ctor();
}

/** Pick a MediaRecorder mime the browser actually supports (Safari lacks webm). */
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

/**
 * Records mic audio, transcodes to WAV client-side, and posts it to
 * /api/voice/transcribe. Failures never throw into the UI — they set `error`
 * and reset to idle so the user can always type instead.
 */
export function useVoiceInput(onTranscript: (text: string) => void): VoiceInput {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const transcribe = useCallback(
    async (webm: Blob) => {
      setState("transcribing");
      try {
        const audioCtx = getAudioContext();
        const audioBuffer = await audioCtx.decodeAudioData(await webm.arrayBuffer());
        await audioCtx.close();

        const form = new FormData();
        form.append("audio", encodeWav(audioBuffer), "speech.wav");

        const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "transcription failed");

        const text = String(data.text ?? "").trim();
        if (text) onTranscript(text);
        else setError("Couldn't catch that — try again.");
      } catch {
        setError("Couldn't catch that — try again.");
      } finally {
        setState("idle");
      }
    },
    [onTranscript],
  );

  const start = useCallback(async () => {
    setError(null);

    // Fail honestly when the API isn't available (insecure origin / unsupported
    // browser) instead of pretending the mic is unreachable — and so the user
    // knows to open Cadence over localhost or https.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Voice needs a secure connection — open Cadence at localhost or over https.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("This browser can't record audio — you can type instead.");
      return;
    }

    // Request the mic on its own so the permission prompt appears, and a denial
    // gives a precise, actionable message rather than the generic fallback.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("Mic access is blocked — allow it from your browser's address bar, then try again.");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setError("No microphone found — you can type instead.");
      } else {
        setError("I couldn't reach your mic — you can type instead.");
      }
      setState("idle");
      return;
    }

    // Start recording. Any failure here releases the stream we just opened.
    try {
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        void transcribe(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
      };
      recorder.start();
      recorderRef.current = recorder;
      setState("recording");
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setError("I couldn't start recording — you can type instead.");
      setState("idle");
    }
  }, [transcribe]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  return { state, error, start, stop };
}
