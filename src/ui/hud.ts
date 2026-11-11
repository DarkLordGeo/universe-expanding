import { EPOCHS, epochAt, formatTime, T0_YR, U_NOW } from '../cosmology/timeline';
import { VisualState } from '../sim/visual';

export interface HudActions {
  togglePlay(): void;
  reset(): void;
  now(): void;
  scrub(u: number): void;
  jump(u: number): void;
  cycleSpeed(): number;
  toggleDirection(): number;
  toggleMode(): void;
  thrust(on: boolean): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const ICON = {
  play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>',
  reset: '<svg viewBox="0 0 16 16"><path d="M8 3a5 5 0 1 1-4.6 3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1.5 2.5v4h4z"/></svg>',
};

/** Minimal overlay: one read-out, one timeline, a handful of controls. */
export class Hud {
  private epoch = el('div', 'epoch');
  private time = el('div', 'time');
  private facts = el('div', 'facts');
  private fill = el('div', 'fill');
  private knob = el('div', 'knob');
  private track = el('div', 'track');
  private playBtn = el('button', 'btn icon');
  private modeBtn = el('button', 'btn', 'Fly');
  private speedBtn = el('button', 'btn', '1×');
  private dirBtn = el('button', 'btn', '▸▸');
  private help = el('div', 'help');
  private lastText = '';

  constructor(root: HTMLElement, act: HudActions, touch: boolean) {
    const read = el('div', 'readout');
    read.append(this.epoch, this.time, this.facts);

    const bar = el('div', 'bar');
    const row = el('div', 'row');
    const resetBtn = el('button', 'btn icon');
    resetBtn.innerHTML = ICON.reset;
    resetBtn.title = 'Reset to the beginning';
    resetBtn.setAttribute('aria-label', 'Reset');
    resetBtn.onclick = () => act.reset();
    this.playBtn.innerHTML = ICON.pause;
    this.playBtn.title = 'Play / pause (space)';
    this.playBtn.setAttribute('aria-label', 'Play or pause');
    this.playBtn.onclick = () => act.togglePlay();
    this.dirBtn.title = 'Direction of time';
    this.dirBtn.onclick = () => (this.dirBtn.textContent = act.toggleDirection() > 0 ? '▸▸' : '◂◂');
    this.speedBtn.title = 'Simulation speed';
    this.speedBtn.onclick = () => (this.speedBtn.textContent = `${act.cycleSpeed()}×`);
    const nowBtn = el('button', 'btn', 'Now');
    nowBtn.title = 'Return to the present universe';
    nowBtn.onclick = () => act.now();
    this.modeBtn.title = 'Camera: free flight / orbit (click a galaxy to orbit it)';
    this.modeBtn.onclick = () => act.toggleMode();
    const helpBtn = el('button', 'btn', '?');
    helpBtn.title = 'Controls & notes';
    helpBtn.onclick = () => this.help.classList.toggle('open');

    // timeline
    this.track.tabIndex = 0;
    this.track.setAttribute('role', 'slider');
    this.track.setAttribute('aria-label', 'Cosmic time');
    const future = el('div', 'future');
    future.style.left = `${U_NOW * 100}%`;
    this.track.append(future, this.fill);
    for (const e of EPOCHS) {
      if (e.id === 'plasma') continue;
      const t = el('button', 'tick' + (e.id === 'now' ? ' now' : ''));
      t.style.left = `${e.jump * 100}%`;
      t.title = e.name;
      t.setAttribute('aria-label', `Jump to ${e.name}`);
      t.onpointerdown = (ev) => ev.stopPropagation();
      t.onclick = () => act.jump(e.jump);
      this.track.append(t);
    }
    this.track.append(this.knob);
    const setFromEvent = (ev: PointerEvent) => {
      const r = this.track.getBoundingClientRect();
      act.scrub(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)));
    };
    this.track.onpointerdown = (ev) => {
      this.track.setPointerCapture(ev.pointerId);
      setFromEvent(ev);
      this.track.onpointermove = setFromEvent;
    };
    this.track.onpointerup = this.track.onpointercancel = () => (this.track.onpointermove = null);

    row.append(resetBtn, this.playBtn, this.dirBtn, this.speedBtn, this.track, nowBtn, this.modeBtn, helpBtn);
    bar.append(row);

    this.help.innerHTML = `
      <b>Explore</b> drag to look · W A S D / arrows to fly · Q E down / up · scroll or pinch to move · Shift to boost<br>
      <b>Orbit</b> click a galaxy to orbit it · scroll to zoom · click empty space to leave<br>
      <b>Time</b> space play / pause · , and . step · drag the timeline or tap a marker to jump<br>
      <span>A procedural model, not observational data. Expansion follows flat ΛCDM (Planck 2018);
      on-screen distances use a compressed function of the true scale factor shown above, and galaxy sizes
      and background ripples are exaggerated to be visible. Everything right of “Now” is a projection.</span>`;

    root.append(read, bar, this.help);

    if (touch) {
      const fly = el('button', 'thrust', 'Go');
      fly.setAttribute('aria-label', 'Hold to fly forward');
      const on = (e: Event) => {
        e.preventDefault();
        act.thrust(true);
      };
      const off = () => act.thrust(false);
      fly.addEventListener('pointerdown', on);
      fly.addEventListener('pointerup', off);
      fly.addEventListener('pointercancel', off);
      fly.addEventListener('pointerleave', off);
      root.append(fly);
    }
  }

  setPlaying(p: boolean): void {
    this.playBtn.innerHTML = p ? ICON.pause : ICON.play;
  }

  setMode(orbit: boolean): void {
    this.modeBtn.textContent = orbit ? 'Orbit' : 'Fly';
    this.modeBtn.classList.toggle('on', orbit);
  }

  update(u: number, v: VisualState): void {
    this.fill.style.width = `${Math.min(u, 1) * 100}%`;
    this.knob.style.left = `${u * 100}%`;
    const future = v.years > T0_YR * 1.0005;
    const e = epochAt(u);
    const time = future
      ? `Now + ${((v.years - T0_YR) / 1e9).toFixed(1)} billion years`
      : `${formatTime(v.years)} after the Big Bang`;
    const sig = (x: number) => (x >= 100 ? Math.round(x).toLocaleString('en-US') : String(Number(x.toPrecision(2))));
    const big = (x: number) =>
      x >= 1e12 ? `${sig(x / 1e12)} trillion` : x >= 1e9 ? `${sig(x / 1e9)} billion` : x >= 1e6 ? `${sig(x / 1e6)} million` : sig(x);
    const size = future
      ? `space ${v.a.toFixed(2)}× larger than today`
      : v.a > 0.995 ? 'space at today\u2019s scale'
      : v.a >= 0.1 ? `space at ${Math.round(v.a * 100)}% of today\u2019s scale`
      : `space ${big(1 / v.a)}× smaller than today`;
    const temp = `${v.T >= 100 ? big(v.T) : v.T.toFixed(1)} K`;
    const motion = v.a > 0.02 ? ` · expansion ${v.q < 0 ? 'accelerating' : 'slowing'}` : '';
    const facts = `${size} · ${temp}${motion}`;
    const text = `${e.name}|${time}|${facts}`;
    if (text === this.lastText) return;
    this.lastText = text;
    this.epoch.textContent = e.name;
    this.epoch.classList.toggle('projection', future);
    this.time.textContent = time;
    this.facts.textContent = facts;
    this.track.setAttribute('aria-valuetext', `${e.name}, ${time}`);
  }
}
