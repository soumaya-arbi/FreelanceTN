"use client";


function Logo({ onClick }: { onClick: () => void }) {
  return <button className="logo" onClick={onClick} aria-label="FreelanceTN home"><span className="logo-mark">F</span><span>FreelanceTN</span></button>;
}

export { Logo };
