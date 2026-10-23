import { decodeLinks } from "./lib";

/** Gear-drop style pop-up card for a multi-link QR. No wallet, no claim — just links. */
export function LinksPage() {
  const { title, links } = decodeLinks(location.hash.slice(1));
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  return (<div className="lp-back">
    <div className="lp-card" role="dialog" aria-label={title || "Links"}>
      <div className="lp-title">{title || "Links for you"}</div>
      {links.length ? links.map((l, i) => (
        <a key={i} className="lp-link" href={l.url} target="_blank" rel="noopener noreferrer nofollow">
          <b>{l.label || host(l.url)}</b><small>{host(l.url)}</small><span>↗</span>
        </a>)) : <div className="muted" style={{ textAlign: "center" }}>This QR has no valid links.</div>}
      <a className="lp-gear" href="https://gearup.wtf" aria-label="Gear Up"><img src="/gear.png" alt="GEAR" width={120} height={30} /></a>
    </div>
  </div>);
}
