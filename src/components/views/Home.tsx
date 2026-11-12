"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import type { Page } from "@/lib/types";
import { avatars, freelancers, categories } from "@/lib/data";
import { useMarketplace } from "@/context/MarketplaceContext";
import { useUser } from "@/context/UserContext";
import { AvatarBadge } from "@/components/views/account/AvatarBadge";

function Home({ go }: { go: (p: Page) => void; notify: (s: string) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { catalogProjects, catalogLoading } = useMarketplace();
  const { user, authUser, status } = useUser();
  const search = () => router.push(query.trim() ? `/freelancers?q=${encodeURIComponent(query.trim())}` : "/freelancers");
  // Le catalogue public ne contient que les projets publiés.
  const openProjects = catalogProjects.length;
  const displayName = user.name || user.email;
  return <main>
    <section className="hero">
      <div className="hero-orb orb-one" /><div className="hero-orb orb-two" />
      <div className="container hero-grid">
        <div className="hero-copy">
          <div className="eyebrow"><span className="pulse" /> The smarter way to work</div>
          <h1>Exceptional talent.<br /><em>Remarkable outcomes.</em></h1>
          <p>Connect with world-class independent professionals and bring ambitious ideas to life—beautifully and securely.</p>
          <div className="hero-search">
            <Icon name="search" />
            <input aria-label="Search talent" placeholder="What do you need help with?" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }} />
            <button onClick={search}>Search</button>
          </div>
          <div className="popular"><span>Popular:</span>{["Web design", "AI development", "Branding"].map(x => <button onClick={() => router.push(`/freelancers?q=${encodeURIComponent(x)}`)} key={x}>{x}</button>)}</div>
          <div className="hero-trust">{avatars.length > 0 && <div className="avatar-stack">{avatars.slice(0, 3).map((x) => <img src={x} key={x} alt="" />)}</div>}<div><strong>{freelancers.length} freelancer profile{freelancers.length === 1 ? "" : "s"}</strong><span>{catalogLoading ? "Loading projects…" : `${openProjects} open project${openProjects === 1 ? "" : "s"}`}</span></div></div>
        </div>
        <div className="hero-visual">
          <div className="hero-image-wrap">
            <img className="hero-image" src="https://images.unsplash.com/photo-1787647561979-da6797612e4d?fit=crop&w=1100&h=1200&q=88" alt="Creative professionals collaborating in a studio" />
            {status === "authenticated" && displayName && <div className="floating-card talent-float">
              <AvatarBadge url={authUser?.avatar || undefined} firstName={authUser?.firstName ?? ""} lastName={authUser?.lastName ?? ""} preset={authUser?.avatarPreset} color={authUser?.avatarColor} size={44} source={authUser?.avatarSource} avatarConfig={authUser?.avatarConfig} />
              <div><strong>{displayName}</strong><span>{user.title || "FreelanceTN member"}</span><small><Icon name="check" size={12} /> Signed in</small></div>
            </div>}
            <div className="floating-card match-float"><span className="match-icon"><Icon name="briefcase" /></span><div><strong>Live projects</strong><span>Published on the marketplace</span></div><b>{catalogLoading ? "—" : openProjects}</b></div>
          </div>
        </div>
      </div>
    </section>

    <section className="logo-strip"><div className="container"><span>One workspace for</span><b>Freelancers</b><b>Agencies</b><b>Startups</b><b>Teams</b></div></section>

    <section className="section container">
      <div className="section-head"><div><span className="overline">EXPLORE BY EXPERTISE</span><h2>Whatever you need, find it here.</h2></div><button className="link-btn" onClick={() => go("freelancers")}>View all talent <Icon name="arrow" size={17} /></button></div>
      <div className="category-grid">{categories.map((c) => <button className="category-card" key={c[0]} onClick={() => go("freelancers")}><span className="category-icon">{c[2]}</span><span><strong>{c[0]}</strong><small>{c[1]}</small></span><Icon name="chevron" /></button>)}</div>
    </section>

    <section className="section soft-section">
      <div className="container">
        <div className="section-head"><div><span className="overline">HANDPICKED FOR QUALITY</span><h2>Meet talent that raises the bar.</h2><p>Vetted professionals with proven expertise and outstanding client results.</p></div><button className="link-btn" onClick={() => go("freelancers")}>Explore all talent <Icon name="arrow" size={17} /></button></div>
        <div className="talent-grid">{freelancers.map(f => <article className="talent-card" key={f.name}>
          <div className="talent-top"><img src={f.avatar} alt={f.name} /><span className="available">Available</span></div>
          <h3>{f.name} <span className="verified"><Icon name="check" size={11} /></span></h3><p>{f.role}</p><div className="meta"><span><Icon name="star" size={14} /> <b>{f.rating}</b> ({f.jobs})</span><span>{f.location}</span></div>
          <div className="chips">{f.skills.map(s => <span key={s}>{s}</span>)}</div><div className="card-foot"><strong>{f.rate} TND<small>/hr</small></strong><Button variant="secondary" onClick={() => router.push(`/freelancers/${f.id}`)}>View profile</Button></div>
        </article>)}
          {freelancers.length === 0 && <div className="empty-state" style={{ gridColumn: "1 / -1" }}><span><Icon name="users" size={20} /></span><b>No freelancer profiles published yet</b><p>Profiles are created by the professionals themselves. Once a profile exists on the platform, it appears here.</p></div>}
        </div>
      </div>
    </section>

    <section className="how-section" id="how-it-works"><div className="container how-grid">
      <div><span className="overline light">BUILT FOR BETTER WORK</span><h2>From bold idea<br />to brilliant result.</h2><p>FreelanceTN gives you everything you need to find, hire, and collaborate with exceptional independent talent.</p><Button variant="secondary" onClick={() => go("dashboard")} icon="arrow">See how it works</Button></div>
      <div className="steps">{[
        ["01", "Share your vision", "Post a project or browse talent in minutes."],
        ["02", "Meet your match", "Compare verified talent, portfolios, and trusted reviews."],
        ["03", "Work with confidence", "Collaborate, approve milestones, and pay securely."]
      ].map(x => <div className="step" key={x[0]}><b>{x[0]}</b><span><strong>{x[1]}</strong><small>{x[2]}</small></span></div>)}</div>
    </div></section>

    <section className="section container"><div className="cta"><div><span className="overline light">YOUR NEXT GREAT HIRE IS HERE</span><h2>Great work starts with<br />the right connection.</h2><p>Join thousands of ambitious teams and talented professionals building what&apos;s next.</p></div><div className="cta-actions"><Button variant="secondary" onClick={() => go("freelancers")}>Find talent</Button><Button variant="dark" onClick={() => go("dashboard")}>Start freelancing</Button></div></div></section>
  </main>;
}

export { Home };
