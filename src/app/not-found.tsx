import Link from "next/link";

export default function NotFound() {
  return (
    <main className="workspace">
      <div className="editor-success">
        <span>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01" />
          </svg>
        </span>
        <h1>Page not found.</h1>
        <p>The page you are looking for does not exist or has been moved.</p>
        <div>
          <Link className="btn btn-primary" href="/">Back to home</Link>
          <Link className="btn btn-secondary" href="/freelancer/dashboard">Open workspace</Link>
        </div>
      </div>
    </main>
  );
}
