"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  return (
    <main className="workspace">
      <div className="editor-success">
        <span>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" />
          </svg>
        </span>
        <h1>Something went wrong.</h1>
        <p>We could not load this screen. Try again, or return to your workspace.</p>
        <div>
          <Button onClick={reset}>Try again</Button>
          <Button variant="secondary" onClick={() => router.push("/")}>Back to home</Button>
        </div>
      </div>
    </main>
  );
}
