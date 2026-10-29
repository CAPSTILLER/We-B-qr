export function Nav({ on }: { on: string }) {
  const l = [["/", "Studio"], ["/paper", "Paper Gears"], ["/art-qr", "Art QR"]];
  return (<div className="noprint"><h1>We B <span>qr</span></h1>
    <div className="nav">{l.map(([h, t]) => <a key={h} href={h} className={on === h ? "on" : ""}>{t}</a>)}</div></div>);
}
