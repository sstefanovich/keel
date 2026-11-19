import { useEffect, useState } from "react";
import { imageUrl } from "../lib/platform";
import { useHold } from "./HoldContext";

/** A recipe's picture: a web link as is, a hold path loaded from disk. Nothing when it can't load. */
export function RecipePhoto({ src, className = "recipe-photo" }: { src?: string; className?: string }) {
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
  if (!url) return null;
  return <img className={className} src={url} alt="" loading="lazy" onError={() => setUrl(undefined)} />;
}
