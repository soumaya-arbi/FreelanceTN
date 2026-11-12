"use client";

import { Icon } from "@/components/ui/Icon";

function Stars({ rating, onChange }: { rating: number; onChange?: (value: number) => void }) {
  return (
    <span className="star-row" role={onChange ? "radiogroup" : undefined} aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((value) => (
        <button
          type="button"
          key={value}
          className={value <= rating ? "star filled" : "star"}
          onClick={onChange ? () => onChange(value) : undefined}
          disabled={!onChange}
          aria-label={`${value} star${value > 1 ? "s" : ""}`}
        >
          <Icon name="star" size={16} />
        </button>
      ))}
    </span>
  );
}

export { Stars };
