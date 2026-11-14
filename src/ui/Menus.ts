/**
 * Menus over the running scene: level select (difficulty, unlocks, best
 * stars), the tutorial card with a top-down diagram, the result card and the
 * pause menu with assist settings. Plain DOM; one screen at a time.
 */

import type { CarDimensions } from '../config';
import { isUnlocked, scoreKey, type MirrorMode, type Progress, type Settings } from '../core/storage';
import type { SessionResult } from '../levels/LevelSession';
import { DIFFICULTIES, type Difficulty, type LevelDef, type LevelLayout } from '../levels/types';
import { levelDiagram } from './levelDiagram';

export interface MenuActions {
  startLevel(id: number): void;
  begin(): void;
  retry(): void;
  next(): void;
  showLevels(): void;
  resume(): void;
  checkpoint(): void;
  demo(): void;
  setDifficulty(d: Difficulty): void;
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void;
}

const DIFF_LABEL: Record<Difficulty, string> = { beginner: 'Beginner', normal: 'Normal', hard: 'Hard' };

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

export type MenuScreen = 'none' | 'levels' | 'tutorial' | 'result' | 'pause';

export class Menus {
  screen: MenuScreen = 'none';
  private readonly root: HTMLElement;
  private primary: (() => void) | null = null;
  private escape: (() => void) | null = null;

  constructor(
    private readonly actions: MenuActions,
    private readonly dim: CarDimensions,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'menu hidden';
    document.body.appendChild(this.root);
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('change', this.onChange);
    // Keys reach the menu before the game's keyboard handler (capture phase).
    window.addEventListener('keydown', this.onKey, true);
  }

  get isOpen(): boolean {
    return this.screen !== 'none';
  }

  hide(): void {
    this.screen = 'none';
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
    this.primary = this.escape = null;
  }

  showLevels(levels: LevelDef[], progress: Progress, s: Settings, canClose: boolean): void {
    const cards = levels
      .map((l) => {
        const open = isUnlocked(l.id, progress, s.allLevelsOpen);
        const best = DIFFICULTIES.map((d) => {
          const b = progress[scoreKey(l.id, d)];
          return `<span class="best ${b ? '' : 'none'}" title="${DIFF_LABEL[d]}">${b ? stars(b.stars) : '☆☆☆'}</span>`;
        }).join('');
        return `<button class="level-card ${open ? '' : 'locked'}" data-act="level" data-id="${l.id}" ${open ? '' : 'disabled'}>
          <span class="level-num">${l.id}</span>
          <span class="level-title">${l.title}</span>
          <span class="level-sum">${open ? l.summary : 'Complete the previous level to unlock.'}</span>
          ${l.id > 1 ? `<span class="level-best">${best}</span>` : ''}
        </button>`;
      })
      .join('');
    this.open(
      'levels',
      `<div class="panel wide">
        <h1>Park Pro XUV</h1>
        <p class="sub">Learn to drive and park a Mahindra XUV 7XO — right-hand drive, left-hand traffic.</p>
        <div class="row">
          <div class="seg" role="radiogroup" aria-label="Difficulty">
            ${DIFFICULTIES.map((d) => `<button data-act="diff" data-d="${d}" class="${s.difficulty === d ? 'on' : ''}">${DIFF_LABEL[d]}</button>`).join('')}
          </div>
          <label class="check"><input type="checkbox" data-set="allLevelsOpen" ${s.allLevelsOpen ? 'checked' : ''}/> All levels open</label>
        </div>
        <div class="level-grid">${cards}</div>
        ${canClose ? '<div class="buttons"><button data-act="resume">Back to driving</button></div>' : ''}
      </div>`,
      null,
      canClose ? () => this.actions.resume() : null,
    );
  }

  showTutorial(def: LevelDef, layout: LevelLayout, d: Difficulty): void {
    const facts: string[] = [];
    if (layout.target) {
      facts.push(`Space: ${layout.target.zone.w.toFixed(1)} × ${layout.target.zone.l.toFixed(1)} m`);
      facts.push(`Straight within ${layout.target.maxAngleDeg}°`);
      if (layout.target.kerb) facts.push(`Within ${(layout.target.kerb.maxGapM * 100).toFixed(0)} cm of the kerb`);
    }
    if (layout.parTimeS > 0) facts.push(`Par time ${layout.parTimeS} s`);
    this.open(
      'tutorial',
      `<div class="panel">
        <h2><span class="tag">Level ${def.id} · ${DIFF_LABEL[d]}</span>${def.title}</h2>
        <div class="diagram">${levelDiagram(layout, this.dim)}</div>
        <div class="legend"><span class="lg fwd">Forward</span><span class="lg rev">Reverse</span><span class="lg tgt">Target</span></div>
        <ol class="steps">${def.technique.map((t) => `<li>${t}</li>`).join('')}</ol>
        ${facts.length ? `<p class="facts">${facts.join(' · ')}</p>` : ''}
        ${layout.target ? '<p class="note">Finish by stopping inside the space and selecting P or applying the parking brake.</p>' : ''}
        <div class="buttons">
          <button class="primary" data-act="begin">Start</button>
          ${layout.ideal ? '<button data-act="demo">Watch the ideal manoeuvre</button>' : ''}
          <button data-act="levels">Levels</button>
        </div>
      </div>`,
      () => this.actions.begin(),
      () => this.actions.begin(),
    );
  }

  showResult(def: LevelDef, r: SessionResult, newBest: boolean, hasNext: boolean, hasIdeal: boolean): void {
    const rows = r.score.breakdown
      .filter((b) => b.value !== 0)
      .map((b) => `<tr><td>${b.label}</td><td>${b.value}</td></tr>`)
      .join('');
    const v = r.verdict;
    const detail = v
      ? `Angle ${v.angleDeg.toFixed(1)}°${v.kerbGapM !== undefined ? ` · kerb gap ${Math.max(0, v.kerbGapM * 100).toFixed(0)} cm` : ` · off-centre ${(v.offsetM * 100).toFixed(0)} cm`}`
      : '';
    this.open(
      'result',
      `<div class="panel">
        <h2><span class="tag">Level ${def.id} complete</span>${def.title}</h2>
        <div class="stars s${r.score.stars}">${stars(r.score.stars)}</div>
        <p class="score">${r.score.points} points · ${r.timeS.toFixed(1)} s${newBest ? ' · <b>New best!</b>' : ''}</p>
        ${detail ? `<p class="facts">${detail}</p>` : ''}
        ${rows ? `<table class="breakdown">${rows}</table>` : '<p class="facts">A perfect run.</p>'}
        ${r.usedCheckpoint ? '<p class="note">Checkpoint used: three stars need a run without checkpoints.</p>' : ''}
        <div class="buttons">
          ${hasNext ? '<button class="primary" data-act="next">Next level</button>' : ''}
          <button class="${hasNext ? '' : 'primary'}" data-act="retry">Retry</button>
          ${hasIdeal ? '<button data-act="demo">Watch the ideal manoeuvre</button>' : ''}
          <button data-act="levels">Levels</button>
        </div>
      </div>`,
      () => (hasNext ? this.actions.next() : this.actions.retry()),
      null,
    );
  }

  showPause(s: Settings, hasIdeal: boolean): void {
    const check = (k: keyof Settings, label: string) =>
      `<label class="check"><input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''}/> ${label}</label>`;
    const mirror = (m: MirrorMode, label: string) => `<option value="${m}" ${s.mirrors === m ? 'selected' : ''}>${label}</option>`;
    this.open(
      'pause',
      `<div class="panel">
        <h2>Paused</h2>
        <p class="sub">Drag to look around (orbit view). T toggles slow motion while driving.</p>
        <div class="buttons">
          <button class="primary" data-act="resume">Resume</button>
          <button data-act="retry">Retry level</button>
          <button data-act="checkpoint">Back to last stop</button>
          ${hasIdeal ? '<button data-act="demo">Watch the ideal manoeuvre</button>' : ''}
          <button data-act="levels">Levels</button>
        </div>
        <div class="settings">
          ${check('guides', 'Ideal path, stop markers and hints (G)')}
          ${check('predictedPath', 'Predicted path for the current steering')}
          ${check('autoRearCamera', 'Rear camera when reversing (V)')}
          ${check('eonOutline', 'Hyundai Eon size outline (O)')}
          <label class="check">Door mirrors (M) <select data-set="mirrors">${mirror('off', 'Off')}${mirror('cabin', 'Cabin views')}${mirror('all', 'All views')}</select></label>
        </div>
      </div>`,
      () => this.actions.resume(),
      () => this.actions.resume(),
    );
  }

  private open(screen: MenuScreen, html: string, primary: (() => void) | null, escape: (() => void) | null): void {
    this.screen = screen;
    this.root.innerHTML = html;
    this.root.classList.remove('hidden');
    // The pause menu sits at the side so the scene stays visible and draggable (free-look).
    this.root.classList.toggle('side', screen === 'pause');
    this.primary = primary;
    this.escape = escape;
    this.root.querySelector<HTMLButtonElement>('button.primary')?.focus({ preventScroll: true });
  }

  private readonly onClick = (e: MouseEvent): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const a = this.actions;
    switch (el.dataset.act) {
      case 'level':
        a.startLevel(Number(el.dataset.id));
        break;
      case 'diff':
        a.setDifficulty(el.dataset.d as Difficulty);
        break;
      case 'begin':
        a.begin();
        break;
      case 'retry':
        a.retry();
        break;
      case 'next':
        a.next();
        break;
      case 'levels':
        a.showLevels();
        break;
      case 'resume':
        a.resume();
        break;
      case 'checkpoint':
        a.checkpoint();
        break;
      case 'demo':
        a.demo();
        break;
    }
  };

  private readonly onChange = (e: Event): void => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const key = el.dataset.set as keyof Settings | undefined;
    if (!key) return;
    const value = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
    this.actions.setSetting(key, value as never);
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      // Let a focused non-primary button handle its own Enter.
      const f = document.activeElement as HTMLElement | null;
      if (f && this.root.contains(f) && f.tagName === 'BUTTON' && !f.classList.contains('primary')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.primary?.();
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.escape?.();
    }
  };
}
