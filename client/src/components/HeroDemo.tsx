// Animated illustration for the landing page, driven by the real layout
// engine: a 40-seat class that slides aside when a screen is shared.
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeLayout, type LayoutItem } from '../lib/layout.ts';
import { avatarGradient } from '../lib/format.ts';
import { useSize } from '../lib/hooks.ts';

const ROWS = 5;
const COLS = 8;
const EMPTY = new Set([6, 13, 22, 29, 35, 38]);
const NAMES =
  'AL BK CJ DM EV FN GR HS IT JW KO LP MA NB OC PD QE RF SG TH UI VJ WK XL YM ZN AO BP CQ DR ES FT GU HV IW JX KY LZ MA NB'.split(' ');

export function HeroDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const { width, height } = useSize(ref);
  const [sharing, setSharing] = useState(false);
  const [speaker, setSpeaker] = useState(10);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const a = window.setInterval(() => setSharing((s) => !s), reduce ? 6000 : 3400);
    const b = window.setInterval(() => {
      setSpeaker(() => {
        let n = Math.floor(Math.random() * ROWS * COLS);
        while (EMPTY.has(n)) n = (n + 1) % (ROWS * COLS);
        return n;
      });
    }, 1300);
    return () => {
      window.clearInterval(a);
      window.clearInterval(b);
    };
  }, []);

  const items: LayoutItem[] = useMemo(
    () => Array.from({ length: ROWS * COLS }, (_, i) => ({ key: String(i), row: Math.floor(i / COLS), col: i % COLS })),
    [],
  );
  const layout = useMemo(
    () =>
      computeLayout({
        width,
        height,
        rows: ROWS,
        cols: COLS,
        items,
        compact: false,
        stage: sharing,
        mode: 'sides',
        split: null,
      }),
    [width, height, items, sharing],
  );

  return (
    <div className="hero-demo" role="img" aria-label="Illustration: a class of 40 faces that slides to the sides when a screen is shared">
      <div className="hero-demo-chrome" aria-hidden="true">
        <span />
        <span />
        <span />
        <em>{sharing ? 'Presenting · all 34 faces still on screen' : 'Class in session · seats A1–E8'}</em>
      </div>
      <div className="hero-demo-canvas" ref={ref} aria-hidden="true">
        {items.map((item) => {
          const r = layout.tiles.get(item.key);
          if (!r) return null;
          const i = Number(item.key);
          const empty = EMPTY.has(i);
          return (
            <div
              key={item.key}
              className={`demo-tile${empty ? ' empty' : ''}${i === speaker && !empty ? ' speaking' : ''}`}
              style={{
                transform: `translate(${r.x}px, ${r.y}px)`,
                width: r.w,
                height: r.h,
                background: empty ? undefined : avatarGradient(NAMES[i] + i),
              }}
            >
              {!empty && <span>{NAMES[i]}</span>}
            </div>
          );
        })}
        <div
          className={`demo-stage${sharing && layout.stage ? ' on' : ''}`}
          style={
            layout.stage
              ? { transform: `translate(${layout.stage.x}px, ${layout.stage.y}px)`, width: layout.stage.w, height: layout.stage.h }
              : { transform: `translate(${width / 2}px, ${height / 2}px)`, width: 0, height: 0 }
          }
        >
          <div className="demo-slide">
            <div className="demo-slide-title" />
            <div className="demo-slide-row">
              <div className="demo-slide-lines">
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="demo-slide-chart">
                <b style={{ height: '40%' }} />
                <b style={{ height: '65%' }} />
                <b style={{ height: '52%' }} />
                <b style={{ height: '85%' }} />
                <b style={{ height: '72%' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
