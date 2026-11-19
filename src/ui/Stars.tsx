import { Star } from "lucide-react";
import { useState } from "react";

/** A 1–5 star rating. Clicking the current rating clears it. Read-only without `onChange`. */
export function Stars({ value, onChange, size = 14 }: { value: number; onChange?: (stars: number) => void; size?: number }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  if (!onChange) {
    if (!value) return null;
    return (
      <span className="stars" role="img" aria-label={`Rated ${value} of 5`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} size={size} className={n <= value ? "on" : ""} aria-hidden="true" />
        ))}
      </span>
    );
  }
  return (
    <span className="stars editable" role="group" aria-label={value ? `Rated ${value} of 5` : "Not rated"} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= shown ? "on" : ""}
          aria-pressed={n <= value}
          aria-label={n === value ? `Clear the rating` : `Rate ${n} star${n === 1 ? "" : "s"}`}
          title={n === value ? "Clear the rating" : `${n} star${n === 1 ? "" : "s"}`}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(0)}
          onClick={(e) => {
            e.stopPropagation();
            onChange(n === value ? 0 : n);
          }}
        >
          <Star size={size} aria-hidden="true" />
        </button>
      ))}
    </span>
  );
}
