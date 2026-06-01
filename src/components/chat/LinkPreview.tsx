import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Renders an Open Graph preview card (image / title / domain / description)
// for a URL in a message — like WhatsApp/Messenger. Fetches the metadata from
// the backend (cached per-URL via React Query). Renders nothing while loading
// or when the page has no usable preview, so non-previewable links just stay
// as plain clickable links.
export function LinkPreview({ url }: { url: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["link-preview", url],
    queryFn: () => api.linkPreview(url),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (isLoading || !data || (!data.title && !data.image)) return null;

  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* leave host empty */
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="mt-2 block max-w-[300px] overflow-hidden rounded-xl border border-slate-200 bg-white no-underline transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/60"
    >
      {data.image && (
        <img
          src={data.image}
          alt={data.title || ""}
          loading="lazy"
          className="max-h-[160px] w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="space-y-0.5 p-3">
        {data.title && (
          <div className="line-clamp-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {data.title}
          </div>
        )}
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {host}
          {data.siteName ? ` · ${data.siteName}` : ""}
        </div>
        {data.description && (
          <div className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
            {data.description}
          </div>
        )}
      </div>
    </a>
  );
}
