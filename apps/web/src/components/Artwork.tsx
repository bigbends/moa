import { useState } from "react";
import { sized } from "../lib/api";
import { artGradient, cx } from "../lib/format";

interface Props {
  src?: string;
  /** Used when the primary image is missing (e.g. backdrop for a poster slot). */
  fallbackSrc?: string;
  title: string;
  ratio: "poster" | "landscape" | "wide";
  width: number;
  className?: string;
  eager?: boolean;
  /** Show the title on generated / substituted artwork. */
  labelFallback?: boolean;
}

/**
 * Image slot with a fixed aspect ratio, a fade-in once decoded, and designed
 * fallbacks: a poster slot without a poster reuses the backdrop (cropped);
 * with no image at all it draws a typographic card.
 */
export function Artwork({ src, fallbackSrc, title, ratio, width, className, eager, labelFallback = true }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const primary = src && failed !== src ? src : undefined;
  const secondary = !primary && fallbackSrc && failed !== fallbackSrc ? fallbackSrc : undefined;
  const url = sized(primary ?? secondary, width);
  return (
    <div className={cx("art", `art-${ratio}`, loaded && "is-loaded", className)} style={{ background: artGradient(title) }}>
      {url && (
        <img
          key={url}
          src={url}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => { setLoaded(false); setFailed(primary ?? secondary ?? null); }}
        />
      )}
      {!url && labelFallback && <span className="art-label art-label-solo">{title}</span>}
    </div>
  );
}

/** Title logo from metadata; falls back to large text while loading fails or is missing. */
export function TitleLogo({ logo, title, className }: { logo?: string; title: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!logo || failed) return <h1 className={className}>{title}</h1>;
  return <h1 className={cx(className, "has-logo")}><img src={logo} alt={title} draggable={false} onError={() => setFailed(true)} /></h1>;
}
