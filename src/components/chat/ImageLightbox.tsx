import React, { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageLightboxProps {
  src: string;
  alt?: string;
  // The thumbnail trigger — usually the existing <img> element at the call
  // site. Wrapped in a button so keyboard users can Enter/Space to open, and
  // the cursor turns into a pointer on hover.
  children: React.ReactNode;
  className?: string;
}

// Click-to-enlarge image viewer. Uses the Radix Dialog primitives directly
// (rather than the shadcn DialogContent wrapper) so the content can fill the
// viewport without inheriting the default max-w-lg sizing.
export function ImageLightbox({ src, alt, children, className }: ImageLightboxProps) {
  const [open, setOpen] = useState(false);
  const filename = alt?.trim() || deriveFilename(src);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            "group relative block cursor-zoom-in overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            className
          )}
          aria-label={filename ? `Ver imagen: ${filename}` : "Ver imagen"}
        >
          {children}
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center p-4 focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onClick={(e) => {
            // Click on the backdrop (anywhere outside the image itself) closes.
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {filename || "Imagen"}
          </DialogPrimitive.Title>
          <img
            src={src}
            alt={alt ?? ""}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
          <div className="absolute right-4 top-4 flex gap-2">
            <a
              href={src}
              download={filename}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Descargar imagen"
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
    return parts[parts.length - 1] || "imagen";
  } catch {
    return "imagen";
  }
}
