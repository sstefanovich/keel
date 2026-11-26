import { MouseEvent, ReactNode, useEffect, useState } from "react";
import { imageUrl } from "../lib/platform";
import { useHold } from "./HoldContext";

/** A recipe's picture or a book's cover: a web link as is, a hold path loaded from disk. `fallback` (or nothing) when it can't load. */
export function RecipePhoto({
  src,
  className = "recipe-photo",
  fallback = null,
  onOpen,
  title,
}: {
  src?: string;
  className?: string;
  fallback?: ReactNode;
  /** Clicking the picture opens what it's of (a middle-click, or Ctrl+click, asks for a new tab). Mouse only: the title beside it is the keyboard way in. */
  onOpen?: (e: MouseEvent) => void;
  title?: string;
}) {
  const { dir } = useHold();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    setUrl(undefined);
    if (!src) return;
    if (/^(https?:|data:)/i.test(src)) return setUrl(src);
    let live = true;
    imageUrl(dir, decodeURI(src.replace(/^\.?\//, ""))).then(
      (u) => live && setUrl(u),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [src, dir]);
  if (!url) return <>{fallback}</>;
  return (
    <img
      className={onOpen ? `${className} opens` : className}
      src={url}
      alt=""
      title={title}
      loading="lazy"
      onError={() => setUrl(undefined)}
      onClick={onOpen}
      onAuxClick={onOpen && ((e) => e.button === 1 && onOpen(e))}
    />
  );
}
