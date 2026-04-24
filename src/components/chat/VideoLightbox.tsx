import React, { useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface VideoLightboxProps {
  src: string;
  alt?: string;
  // Thumbnail trigger — typically a <video preload="metadata"> showing the
  // first frame, or a custom preview element with a play overlay.
  children: React.ReactNode;
  className?: string;
}

// Click-to-play video viewer. Mirrors ImageLightbox's structure (custom
// Dialog composition, full-viewport content, backdrop dismiss) but the
// playable surface is a <video controls autoPlay> so users get native
// scrubbing, volume, fullscreen, and keyboard controls without extra work.
export function VideoLightbox({ src, alt, children, className }: VideoLightboxProps) {
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const filename = alt?.trim() || deriveFilename(src);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Pause playback when the dialog closes — otherwise the audio
        // continues to play off-screen until the element is garbage-collected.
        if (!next && videoRef.current) {
          videoRef.current.pause();
          videoRef.current.currentTime = 0;
        }
      }}
    >
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            "group relative block cursor-pointer overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            className
          )}
          aria-label={filename ? `Reproducir video: ${filename}` : "Reproducir video"}
        >
          {children}
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center p-4 focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {filename || "Video"}
          </DialogPrimitive.Title>
          <video
            ref={videoRef}
            src={src}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl bg-black"
          />
          <div className="absolute right-4 top-4 flex gap-2">
            <a
              href={src}
              download={filename}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Descargar video"
              title="Descargar"
            >
              <Download className="h-5 w-5" />
            </a>
            <DialogPrimitive.Close
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function deriveFilename(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "video";
  } catch {
    return "video";
  }
}
