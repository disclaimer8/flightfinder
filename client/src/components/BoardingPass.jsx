// BoardingPass — skeuomorphic ticket card. Two halves divided by perforation.
// Ported from design_handoff_flightfinder/ui_kits/web/BoardingPass.jsx.
//
// Shape:
//   pass = {
//     cabin:   'ECONOMY' | 'BUSINESS' | ...      // optional, defaults to ECONOMY
//     passenger, flight, date, gate, boarding,
//     seat, group, pnr, duration,
//     from: { iata, city, time },
//     to:   { iata, city, time },
//   }
import './BoardingPass.css';

function Cell({ label, value, accent }) {
  return (
    <div className="bpass__cell">
      <div className="bpass__cell-l">{label}</div>
      <div className={'bpass__cell-v ' + (accent ? 'is-accent' : '')}>{value}</div>
    </div>
  );
}

export default function BoardingPass({ pass }) {
  if (!pass) return null;
  const p = pass;
  return (
    <div className="bpass" role="group" aria-label="Boarding pass">
      <div className="bpass__main">
        <div className="bpass__hdr">
          <span className="bpass__brand">Flight Finder</span>
          <span className="bpass__cls">{p.cabin || 'ECONOMY'}</span>
        </div>

        <div className="bpass__route">
          <div className="bpass__city">
            <div className="bpass__iata">{p.from.iata}</div>
            <div className="bpass__cityname">{p.from.city}</div>
            <div className="bpass__time">{p.from.time}</div>
          </div>
          <div className="bpass__arrow">
            <div className="bpass__arc">
              <svg viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true">
                <path d="M 4 26 Q 60 -8 116 26" fill="none"
                      stroke="currentColor" strokeWidth="1.4"
                      strokeDasharray="2 4" strokeLinecap="round"/>
                <circle cx="4"  cy="26" r="2.5" fill="currentColor"/>
                <circle cx="116" cy="26" r="2.5" fill="currentColor"/>
              </svg>
            </div>
            {p.duration && <div className="bpass__dur">{p.duration}</div>}
          </div>
          <div className="bpass__city bpass__city--right">
            <div className="bpass__iata">{p.to.iata}</div>
            <div className="bpass__cityname">{p.to.city}</div>
            <div className="bpass__time">{p.to.time}</div>
          </div>
        </div>

        <div className="bpass__meta">
          <Cell label="Passenger" value={p.passenger} />
          <Cell label="Flight"    value={p.flight} />
          <Cell label="Date"      value={p.date} />
          <Cell label="Gate"      value={p.gate} accent />
          <Cell label="Boarding"  value={p.boarding} />
          <Cell label="Seat"      value={p.seat} accent />
        </div>
      </div>

      <div className="bpass__perf" aria-hidden="true">
        <span/><span/><span/><span/><span/><span/><span/><span/><span/><span/>
      </div>

      <div className="bpass__stub">
        <div className="bpass__stub-iatas">
          <span>{p.from.iata}</span>
          <svg width="20" height="10" viewBox="0 0 20 10" aria-hidden="true">
            <path d="M2 5 H18 M14 1 L18 5 L14 9"
                  stroke="currentColor" strokeWidth="1.5" fill="none"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>{p.to.iata}</span>
        </div>
        <Cell label="Seat"  value={p.seat} />
        <Cell label="Gate"  value={p.gate} />
        <Cell label="Group" value={p.group || 'B'} />
        {/* Stub barcode — 48 visual bars of pseudo-random width (1–4 px).
            Decorative only; do not encode the PNR here. */}
        <div className="bpass__barcode" aria-hidden="true">
          {Array.from({ length: 48 }).map((_, i) => (
            <span key={i} style={{ width: ((i * 37) % 4) + 1 + 'px' }} />
          ))}
        </div>
        {p.pnr && <div className="bpass__pnr">PNR · {p.pnr}</div>}
      </div>
    </div>
  );
}
