import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  src: string;
  // "light" inverts the palette for outbound bubbles where the surrounding
  // background is the primary purple. "dark" is for inbound bubbles on a
  // muted background.
  variant?: "light" | "dark";
  // Fallback duration shown before the audio has loaded its metadata.
  fallbackDuration?: string;
  className?: string;
}

const BAR_COUNT = 40;
const SPEEDS = [1, 1.5, 2] as const;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Deterministic waveform from the source URL — we don't decode the audio to
// get a real waveform (that would require Web Audio API and an extra fetch),
// just generate a stable per-message pattern so the bars look "shaped" but
// don't reshuffle on every render.
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function generateBars(seed: string): number[] {
  let s = hashSeed(seed) || 1;
  const out: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    // LCG step
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const r = (s % 10000) / 10000;
    // Bias the centre to be taller and the edges to be shorter for a more
    // "voice-note" look. Range 30%–100%.
    const centreBoost = 1 - Math.abs(i - BAR_COUNT / 2) / (BAR_COUNT / 2);
    const h = 0.3 + r * 0.55 + centreBoost * 0.15;
    out.push(Math.max(0.18, Math.min(1, h)));
  }
  return out;
}

// Voice-note style audio player. Renders a stable waveform of vertical bars,
// a circular play/pause control, current-time + duration, and a speed-cycle
// pill ("1x" → "1.5x" → "2x"). Uses a single <audio> element per message —
// browsers lazy-load on first play and pause releases the connection.
export function AudioPlayer({
  src,
  variant = "dark",
  fallbackDuration,
  className,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);

  const bars = useMemo(() => generateBars(src), [src]);
  const speed = SPEEDS[speedIdx];

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onLoaded = () => {
      if (Number.isFinite(el.duration)) setDuration(el.duration);
      setLoading(false);
    };
    const onTime = () => setCurrentTime(el.currentTime);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };
    const onWaiting = () => setLoading(true);
    const onPlaying = () => setLoading(false);
    const onError = () => {
      setErrored(true);
      setPlaying(false);
      setLoading(false);
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);

    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("error", onError);
    el.addEventListener("pause", onPause);
    el.addEventListener("play", onPlay);
    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("error", onError);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("play", onPlay);
    };
  }, []);

  // Reset playback state when the source changes (e.g. component reuse during
  // virtualization). Speed selection is intentionally preserved.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    setPlaying(false);
    setCurrentTime(0);
    setDuration(undefined);
    setErrored(false);
  }, [src]);

  // Apply the selected playback speed whenever it changes.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = speed;
  }, [speed]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || errored) return;
    if (el.paused) {
      setLoading(true);
      const p = el.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          setErrored(true);
          setPlaying(false);
          setLoading(false);
        });
      }
    } else {
      el.pause();
    }
  }, [errored]);

  const seek = useCallback(
    (clientX: number) => {
      const el = audioRef.current;
      const track = trackRef.current;
      if (!el || !track || !duration) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      el.currentTime = ratio * duration;
      setCurrentTime(el.currentTime);
    },
    [duration]
  );

  const cycleSpeed = useCallback(() => {
    setSpeedIdx((i) => (i + 1) % SPEEDS.length);
  }, []);

  const progressRatio =
    duration && duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const activeBars = Math.floor(progressRatio * bars.length);

  const isLight = variant === "light";
  const playBtn = isLight
    ? "bg-white text-primary hover:bg-white/90"
    : "bg-primary text-primary-foreground hover:bg-primary/90";
  const barActive = isLight ? "bg-white" : "bg-primary";
  const barInactive = isLight ? "bg-white/40" : "bg-primary/30";
  const speedPill = isLight
    ? "bg-white/20 hover:bg-white/30 text-white"
    : "bg-primary/15 hover:bg-primary/25 text-primary";
  const timeText = isLight ? "text-white/90" : "text-foreground/70";

  return (
    <div
      className={cn(
        "flex items-center gap-3 min-w-[280px] sm:min-w-[320px] py-1",
        className
      )}
    >
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        disabled={errored}
        aria-label={
          errored ? "No se pudo cargar el audio" : playing ? "Pausar" : "Reproducir"
        }
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          playBtn,
          errored && "cursor-not-allowed opacity-60"
        )}
      >
        {errored ? (
          <AlertCircle className="h-5 w-5" />
        ) : loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : playing ? (
          <Pause className="h-5 w-5" fill="currentColor" />
        ) : (
          <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={duration ?? 0}
          aria-valuenow={currentTime}
          aria-label="Progreso del audio"
          onClick={(e) => seek(e.clientX)}
          onKeyDown={(e) => {
            const el = audioRef.current;
            if (!el || !duration) return;
            if (e.key === "ArrowRight") {
              el.currentTime = Math.min(duration, el.currentTime + 5);
              setCurrentTime(el.currentTime);
            } else if (e.key === "ArrowLeft") {
              el.currentTime = Math.max(0, el.currentTime - 5);
              setCurrentTime(el.currentTime);
            }
          }}
          className="flex h-7 w-full cursor-pointer items-center gap-[2px]"
        >
          {bars.map((h, i) => (
            <div
              key={i}
              className={cn(
                "flex-1 rounded-full transition-colors duration-100",
                i < activeBars ? barActive : barInactive
              )}
              style={{ height: `${h * 100}%` }}
            />
          ))}
        </div>

        <div className={cn("flex items-center justify-between text-[11px] font-medium tabular-nums", timeText)}>
          <span>{formatTime(currentTime)}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cycleSpeed}
              disabled={errored}
              aria-label={`Velocidad ${speed}x`}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                speedPill,
                errored && "cursor-not-allowed opacity-60"
              )}
            >
              {speed}x
            </button>
            <span>
              {errored
                ? "Error"
                : duration
                ? formatTime(duration)
                : fallbackDuration ?? "--:--"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
