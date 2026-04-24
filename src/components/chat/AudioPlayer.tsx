import React, { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  src: string;
  // "isMe" chat bubbles invert the palette (light marks on the primary
  // background). Inbound bubbles use the regular foreground palette.
  variant?: "light" | "dark";
  // Fallback duration shown before the audio has loaded its metadata.
  fallbackDuration?: string;
  className?: string;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Shared audio message player. Uses a single <audio> element per message —
// browsers will lazy-load the stream on first play and pause releases the
// connection. Parallel players are allowed (each instance is independent).
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
  // Initially undefined — we don't know the real duration until the browser
  // fires `loadedmetadata`. `fallbackDuration` (a string like "0:45" captured
  // server-side) fills the UI until then.
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);

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

  // Reset playback state when the source changes (e.g. the same component
  // gets reused across messages during virtualization).
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    setPlaying(false);
    setCurrentTime(0);
    setDuration(undefined);
    setErrored(false);
  }, [src]);

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

  const progress = duration && duration > 0 ? (currentTime / duration) * 100 : 0;

  const isLight = variant === "light";
  const btnClasses = isLight
    ? "bg-white/20 hover:bg-white/30 text-white disabled:bg-white/10"
    : "bg-primary/10 hover:bg-primary/20 text-primary disabled:bg-primary/5";
  const trackBg = isLight ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.1)";
  const fillClass = isLight ? "bg-white" : "bg-primary";

  return (
    <div
      className={cn(
        "flex items-center gap-4 min-w-[220px] sm:min-w-[280px] py-1.5",
        isLight ? "text-primary-foreground" : "text-foreground",
        className
      )}
    >
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        disabled={errored}
        aria-label={errored ? "No se pudo cargar el audio" : playing ? "Pausar" : "Reproducir"}
        className={cn(
          "flex items-center justify-center h-12 w-12 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          btnClasses,
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
          <Play className="h-5 w-5 ml-1" fill="currentColor" />
        )}
      </button>
      <div className="flex-1 flex flex-col justify-center gap-2">
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
          className="w-full h-1.5 rounded-full relative mt-1 cursor-pointer"
          style={{ backgroundColor: trackBg }}
        >
          <div
            className={cn("absolute left-0 top-0 bottom-0 rounded-full transition-[width] duration-100", fillClass)}
            style={{ width: `${progress}%` }}
          />
          <div
            className={cn("absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full shadow-sm transition-[left] duration-100", fillClass)}
            style={{ left: `calc(${progress}% - 7px)` }}
          />
        </div>
        <div className="flex justify-between items-center text-[11px] font-medium opacity-80 tabular-nums">
          <span>{formatTime(currentTime)}</span>
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
  );
}
