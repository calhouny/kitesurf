import type { InputState } from './types';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function moveToward(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

const INPUT_STYLE_ID = 'kiterush-touch-input-styles';

const TOUCH_OVERLAY_CSS = `
.kr-touch-overlay {
  position: fixed;
  inset: 0;
  z-index: 25;
  pointer-events: none;
  display: none;
  justify-content: space-between;
  align-items: flex-end;
  padding: max(16px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-right)) max(18px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
  transition: opacity 0.2s ease;
}

.kr-touch-overlay.is-visible {
  display: flex;
}

.kr-touch-overlay.is-hidden-state {
  opacity: 0;
  pointer-events: none;
}

.kr-touch-overlay.is-hidden-state * {
  pointer-events: none !important;
}

.kr-joy-zone {
  pointer-events: auto;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  position: relative;
  width: 132px;
  height: 132px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, rgba(12, 32, 54, 0.42), rgba(7, 20, 36, 0.65));
  border: 2px solid rgba(110, 231, 255, 0.35);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), inset 0 0 18px rgba(56, 189, 248, 0.14);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.kr-joy-zone.is-active {
  border-color: rgba(56, 239, 255, 0.9);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4), inset 0 0 24px rgba(56, 239, 255, 0.3);
}

.kr-joy-crosshair {
  position: absolute;
  inset: 14px;
  border-radius: 50%;
  border: 1px dashed rgba(255, 255, 255, 0.16);
  pointer-events: none;
}

.kr-joy-label {
  position: absolute;
  bottom: 9px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(186, 230, 253, 0.72);
  pointer-events: none;
}

.kr-joy-knob {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #e0f7ff, #38bdf8 65%, #0284c7);
  border: 2px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 4px 14px rgba(14, 165, 233, 0.55);
  transform: translate3d(0, 0, 0);
  pointer-events: none;
  transition: transform 0.06s ease-out, box-shadow 0.12s ease;
}

.kr-joy-zone.is-active .kr-joy-knob {
  transition: none;
  box-shadow: 0 0 20px rgba(56, 239, 255, 0.85);
}

.kr-right-cluster {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  pointer-events: none;
}

.kr-trick-diamond {
  display: grid;
  grid-template-columns: repeat(3, 40px);
  grid-template-rows: repeat(3, 36px);
  gap: 4px;
  pointer-events: none;
}

.kr-action-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  pointer-events: none;
}

.kr-btn {
  pointer-events: auto;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.32);
  background: rgba(10, 25, 47, 0.62);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: #f8fafc;
  font-weight: 800;
  letter-spacing: 0.05em;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  transition: transform 0.08s ease, background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
}

.kr-btn-jump {
  width: 78px;
  height: 78px;
  font-size: 12px;
  border-color: rgba(56, 239, 255, 0.65);
  background: linear-gradient(145deg, rgba(14, 165, 233, 0.55), rgba(6, 78, 125, 0.72));
}

.kr-btn-loop {
  width: 60px;
  height: 60px;
  font-size: 10px;
  border-color: rgba(251, 146, 60, 0.65);
  background: linear-gradient(145deg, rgba(249, 115, 22, 0.45), rgba(124, 45, 18, 0.7));
}

.kr-btn-trick {
  width: 40px;
  height: 36px;
  border-radius: 10px;
  font-size: 10px;
  border-color: rgba(167, 139, 250, 0.5);
  background: rgba(30, 27, 75, 0.6);
}

.kr-btn.is-active {
  transform: scale(0.92);
  border-color: #ffffff;
  box-shadow: 0 0 22px rgba(56, 239, 255, 0.8);
}

.kr-btn-loop.is-active {
  box-shadow: 0 0 22px rgba(251, 146, 60, 0.9);
}

.kr-btn-trick.is-active {
  background: rgba(139, 92, 246, 0.78);
  box-shadow: 0 0 16px rgba(167, 139, 250, 0.85);
}
`;

/**
 * Manages desktop keyboard and responsive mobile virtual dual-thumb controls,
 * producing normalized InputState each frame plus an Auto-Assist Kite Stabilizer toggle.
 */
export class InputManager {
  public autoAssist = false;

  private readonly keysDown = new Set<string>();
  private jumpQueued = false;
  private kiteloopQueued = false;
  private pauseQueued = false;

  // Virtual thumbstick state
  private joyPointerId: number | null = null;
  private joyX = 0; // [-1, 1]
  private joyY = 0; // [-1, 1] (+1 = up)

  // Touch action buttons
  private touchJumpActive = false;
  private touchJumpPointerId: number | null = null;
  private touchLoopPointerId: number | null = null;
  private readonly activeTrickPointers = new Map<
    number,
    { x: number; y: number; btn: HTMLElement }
  >();

  // Smoothed continuous axes
  private smoothSteer = 0;
  private smoothBar = 0.5;
  private smoothEdge = 0;

  private readonly currentState: InputState = {
    kiteSteer: 0,
    barTension: 0.5,
    edgeAngle: 0,
    jumpPressed: false,
    jumpJustPressed: false,
    trickDir: { x: 0, y: 0 },
    kiteloopRequested: false,
    pauseJustPressed: false,
  };

  // DOM overlay elements
  private overlayEl: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private joyZoneEl: HTMLDivElement | null = null;
  private joyKnobEl: HTMLDivElement | null = null;
  private jumpBtnEl: HTMLButtonElement | null = null;
  private loopBtnEl: HTMLButtonElement | null = null;

  private touchOverride: boolean | null = null;
  private hasSeenTouchPointer = false;
  private gameplayActive = true;
  private disposed = false;

  private readonly maxJoyRadius = 42;

  constructor(container?: HTMLElement) {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      this.attachKeyboardListeners();
      this.mountTouchOverlay(container ?? document.body);
      this.refreshOverlayVisibility();
      window.addEventListener('resize', this.onResize, { passive: true });
    }
  }

  public setAutoAssist(enabled: boolean): void {
    this.autoAssist = enabled;
  }

  public isAutoAssist(): boolean {
    return this.autoAssist;
  }

  public toggleAutoAssist(): boolean {
    this.autoAssist = !this.autoAssist;
    return this.autoAssist;
  }

  /**
   * Controls whether the touch overlay can show (e.g. only during active PLAYING).
   */
  public setGameplayActive(active: boolean): void {
    if (this.gameplayActive === active) return;
    this.gameplayActive = active;
    if (!active) {
      this.clearTouchState();
    }
    this.refreshOverlayVisibility();
  }

  /**
   * Force virtual touch controls on/off, or pass null for automatic touch/narrow-viewport detection.
   */
  public setTouchControlsVisible(visible: boolean | null): void {
    this.touchOverride = visible;
    this.refreshOverlayVisibility();
  }

  /**
   * Call once per frame from the game loop to advance smoothed axes and consume
   * single-frame trigger latches (`jumpJustPressed`, `kiteloopRequested`, `pauseJustPressed`).
   */
  public update(dt = 1 / 60): InputState {
    const safeDt = clamp(dt, 0.001, 0.1);

    // 1. Kite steering [-1, 1]
    let keySteer = 0;
    if (this.isAnyDown('KeyA', 'ArrowLeft')) keySteer -= 1;
    if (this.isAnyDown('KeyD', 'ArrowRight')) keySteer += 1;

    const rawSteer = clamp(
      Math.abs(this.joyX) > 0.08 ? this.joyX : keySteer,
      -1,
      1
    );

    // 2. Bar sheet tension [0, 1] (idle ~0.5, W/Up -> 1.0, S/Down -> 0.0)
    let keySheet = 0;
    if (this.isAnyDown('KeyW', 'ArrowUp')) keySheet += 1;
    if (this.isAnyDown('KeyS', 'ArrowDown')) keySheet -= 1;

    const rawSheet = clamp(
      Math.abs(this.joyY) > 0.08 ? this.joyY : keySheet,
      -1,
      1
    );
    const targetBar = 0.5 + rawSheet * 0.5;

    // 3. Signed board edgeAngle [-1, 1] following carve/steer direction scaled by sheet/charge
    const targetEdge =
      Math.abs(rawSteer) > 0.04
        ? clamp(rawSteer * (0.65 + 0.35 * targetBar), -1, 1)
        : 0;

    const steerRate = this.joyPointerId !== null ? 28 : 16;
    const barRate = this.joyPointerId !== null ? 22 : 12;

    this.smoothSteer = moveToward(this.smoothSteer, rawSteer, steerRate * safeDt);
    this.smoothBar = moveToward(this.smoothBar, targetBar, barRate * safeDt);
    this.smoothEdge = moveToward(this.smoothEdge, targetEdge, steerRate * safeDt);

    // 4. Mid-air tricks { x, y } in [-1, 1]
    let trickX = 0;
    let trickY = 0;
    if (this.isAnyDown('KeyJ', 'Digit1')) trickX -= 1;
    if (this.isAnyDown('KeyL', 'Digit3')) trickX += 1;
    if (this.isAnyDown('KeyI', 'Digit2')) trickY += 1;
    if (this.isAnyDown('KeyK', 'Digit4')) trickY -= 1;

    for (const active of this.activeTrickPointers.values()) {
      trickX += active.x;
      trickY += active.y;
    }

    this.currentState.kiteSteer = clamp(this.smoothSteer, -1, 1);
    this.currentState.barTension = clamp(this.smoothBar, 0, 1);
    this.currentState.edgeAngle = clamp(this.smoothEdge, -1, 1);
    this.currentState.jumpPressed =
      this.keysDown.has('Space') || this.touchJumpActive;
    this.currentState.jumpJustPressed = this.jumpQueued;
    this.currentState.kiteloopRequested = this.kiteloopQueued;
    this.currentState.pauseJustPressed = this.pauseQueued;
    this.currentState.trickDir.x = clamp(trickX, -1, 1);
    this.currentState.trickDir.y = clamp(trickY, -1, 1);

    // Clear per-frame trigger latches
    this.jumpQueued = false;
    this.kiteloopQueued = false;
    this.pauseQueued = false;

    return this.currentState;
  }

  /**
   * Read the latest computed InputState without clearing single-frame edge triggers.
   */
  public getState(): InputState {
    return this.currentState;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('resize', this.onResize);
      window.removeEventListener('pointerdown', this.onGlobalPointerDown, true);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }

    this.overlayEl?.remove();
    this.styleEl?.remove();
    this.overlayEl = null;
    this.styleEl = null;
    this.keysDown.clear();
    this.clearTouchState();
  }

  private isAnyDown(...codes: string[]): boolean {
    for (const c of codes) {
      if (this.keysDown.has(c)) return true;
    }
    return false;
  }

  private isInputElementFocused(): boolean {
    if (typeof document === 'undefined') return false;
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      (el as HTMLElement).isContentEditable
    );
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.isInputElementFocused()) return;

    const code = e.code;
    if (
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      e.preventDefault();
    }

    if (!e.repeat) {
      if (code === 'Space') {
        this.jumpQueued = true;
      }
      if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyE') {
        this.kiteloopQueued = true;
      }
      if (code === 'Escape' || code === 'KeyP') {
        this.pauseQueued = true;
      }
    }

    this.keysDown.add(code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.keysDown.clear();
    this.clearTouchState();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.keysDown.clear();
      this.clearTouchState();
    }
  };

  private readonly onResize = (): void => {
    this.refreshOverlayVisibility();
  };

  private readonly onGlobalPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' && !this.hasSeenTouchPointer) {
      this.hasSeenTouchPointer = true;
      this.refreshOverlayVisibility();
    }
  };

  private attachKeyboardListeners(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pointerdown', this.onGlobalPointerDown, true);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private shouldShowTouchControls(): boolean {
    if (this.touchOverride !== null) return this.touchOverride;
    if (typeof window === 'undefined') return false;
    const isTouchCapable =
      this.hasSeenTouchPointer ||
      'ontouchstart' in window ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
    const isNarrow = window.innerWidth <= 900;
    return isTouchCapable || isNarrow;
  }

  private refreshOverlayVisibility(): void {
    if (!this.overlayEl) return;
    const visible = this.shouldShowTouchControls();
    this.overlayEl.classList.toggle('is-visible', visible);
    this.overlayEl.classList.toggle('is-hidden-state', !this.gameplayActive);
  }

  private clearTouchState(): void {
    this.joyPointerId = null;
    this.joyX = 0;
    this.joyY = 0;
    this.joyZoneEl?.classList.remove('is-active');
    if (this.joyKnobEl) {
      this.joyKnobEl.style.transform = 'translate3d(0px, 0px, 0px)';
    }

    this.touchJumpActive = false;
    this.touchJumpPointerId = null;
    this.jumpBtnEl?.classList.remove('is-active');

    this.touchLoopPointerId = null;
    this.loopBtnEl?.classList.remove('is-active');

    for (const active of this.activeTrickPointers.values()) {
      active.btn.classList.remove('is-active');
    }
    this.activeTrickPointers.clear();
  }

  private mountTouchOverlay(container: HTMLElement): void {
    if (!document.getElementById(INPUT_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = INPUT_STYLE_ID;
      style.textContent = TOUCH_OVERLAY_CSS;
      document.head.appendChild(style);
      this.styleEl = style;
    }

    const overlay = document.createElement('div');
    overlay.className = 'kr-touch-overlay';
    overlay.setAttribute('aria-label', 'Virtual touch controls');

    // Left virtual thumbstick (kite steer + bar sheet)
    const joyZone = document.createElement('div');
    joyZone.className = 'kr-joy-zone';

    const crosshair = document.createElement('div');
    crosshair.className = 'kr-joy-crosshair';

    const knob = document.createElement('div');
    knob.className = 'kr-joy-knob';

    const label = document.createElement('div');
    label.className = 'kr-joy-label';
    label.textContent = 'STEER / BAR';

    joyZone.append(crosshair, knob, label);
    this.wireJoystickEvents(joyZone, knob);

    // Right action cluster (Tricks D-pad + Loop + Jump)
    const rightCluster = document.createElement('div');
    rightCluster.className = 'kr-right-cluster';

    const trickPad = document.createElement('div');
    trickPad.className = 'kr-trick-diamond';

    const trickSpecs: Array<{
      col: number;
      row: number;
      label: string;
      x: number;
      y: number;
    }> = [
      { col: 2, row: 1, label: 'AIR', x: 0, y: 1 },
      { col: 1, row: 2, label: 'BACK', x: -1, y: 0 },
      { col: 3, row: 2, label: 'FRNT', x: 1, y: 0 },
      { col: 2, row: 3, label: 'GRAB', x: 0, y: -1 },
    ];

    for (const spec of trickSpecs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kr-btn kr-btn-trick';
      btn.textContent = spec.label;
      btn.style.gridColumn = String(spec.col);
      btn.style.gridRow = String(spec.row);
      this.wireTrickButton(btn, spec.x, spec.y);
      trickPad.appendChild(btn);
    }

    const actionRow = document.createElement('div');
    actionRow.className = 'kr-action-row';

    const loopBtn = document.createElement('button');
    loopBtn.type = 'button';
    loopBtn.className = 'kr-btn kr-btn-loop';
    loopBtn.textContent = 'LOOP';
    this.wireLoopButton(loopBtn);

    const jumpBtn = document.createElement('button');
    jumpBtn.type = 'button';
    jumpBtn.className = 'kr-btn kr-btn-jump';
    jumpBtn.textContent = 'BOOST';
    this.wireJumpButton(jumpBtn);

    actionRow.append(loopBtn, jumpBtn);
    rightCluster.append(trickPad, actionRow);

    overlay.append(joyZone, rightCluster);
    container.appendChild(overlay);

    this.overlayEl = overlay;
    this.joyZoneEl = joyZone;
    this.joyKnobEl = knob;
    this.jumpBtnEl = jumpBtn;
    this.loopBtnEl = loopBtn;
  }

  private wireJoystickEvents(
    zone: HTMLDivElement,
    knob: HTMLDivElement
  ): void {
    const updateStickFromEvent = (e: PointerEvent): void => {
      const rect = zone.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > this.maxJoyRadius) {
        const scale = this.maxJoyRadius / dist;
        dx *= scale;
        dy *= scale;
      }
      this.joyX = clamp(dx / this.maxJoyRadius, -1, 1);
      // Upward screen drag (negative dy) sheets bar IN (+1)
      this.joyY = clamp(-dy / this.maxJoyRadius, -1, 1);
      knob.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0px)`;
    };

    zone.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      if (this.joyPointerId !== null) return;
      this.joyPointerId = e.pointerId;
      zone.classList.add('is-active');
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture issues on synthetic pointers
      }
      updateStickFromEvent(e);
    });

    zone.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.joyPointerId) return;
      e.preventDefault();
      updateStickFromEvent(e);
    });

    const releaseStick = (e: PointerEvent): void => {
      if (e.pointerId !== this.joyPointerId) return;
      this.joyPointerId = null;
      this.joyX = 0;
      this.joyY = 0;
      zone.classList.remove('is-active');
      knob.style.transform = 'translate3d(0px, 0px, 0px)';
    };

    zone.addEventListener('pointerup', releaseStick);
    zone.addEventListener('pointercancel', releaseStick);
  }

  private wireJumpButton(btn: HTMLButtonElement): void {
    btn.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      if (this.touchJumpPointerId !== null) return;
      this.touchJumpPointerId = e.pointerId;
      this.touchJumpActive = true;
      this.jumpQueued = true;
      btn.classList.add('is-active');
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic pointer capture failure
      }
    });

    const releaseJump = (e: PointerEvent): void => {
      if (e.pointerId !== this.touchJumpPointerId) return;
      this.touchJumpPointerId = null;
      this.touchJumpActive = false;
      btn.classList.remove('is-active');
    };

    btn.addEventListener('pointerup', releaseJump);
    btn.addEventListener('pointercancel', releaseJump);
  }

  private wireLoopButton(btn: HTMLButtonElement): void {
    btn.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      if (this.touchLoopPointerId !== null) return;
      this.touchLoopPointerId = e.pointerId;
      this.kiteloopQueued = true;
      btn.classList.add('is-active');
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic pointer capture failure
      }
    });

    const releaseLoop = (e: PointerEvent): void => {
      if (e.pointerId !== this.touchLoopPointerId) return;
      this.touchLoopPointerId = null;
      btn.classList.remove('is-active');
    };

    btn.addEventListener('pointerup', releaseLoop);
    btn.addEventListener('pointercancel', releaseLoop);
  }

  private wireTrickButton(
    btn: HTMLButtonElement,
    x: number,
    y: number
  ): void {
    btn.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      this.activeTrickPointers.set(e.pointerId, { x, y, btn });
      btn.classList.add('is-active');
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic pointer capture failure
      }
    });

    const releaseTrick = (e: PointerEvent): void => {
      const entry = this.activeTrickPointers.get(e.pointerId);
      if (!entry) return;
      entry.btn.classList.remove('is-active');
      this.activeTrickPointers.delete(e.pointerId);
    };

    btn.addEventListener('pointerup', releaseTrick);
    btn.addEventListener('pointercancel', releaseTrick);
  }
}
