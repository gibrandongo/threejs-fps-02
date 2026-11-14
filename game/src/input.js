// BREACHLINE — input: keyboard, mouse and pointer lock, translated
// into the state.input snapshot the fixed-step simulation reads.
// Mouse deltas are accumulated between steps and consumed exactly
// once, so look sensitivity is frame-rate independent.
export class Input {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.state = state;
    this.locked = false;
    this.sensitivity = 0.0022;
    this.keys = new Set();
    this.mouseDown = false;
    this.aimDown = false;
    this.onLockLost = null;
    this.onAnyGesture = null;
    this._bind();
  }

  _bind() {
    const input = this.state.input;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.onAnyGesture && this.onAnyGesture();
      if (e.code === 'KeyR') input.reload = true;
      if (e.code === 'Digit1') input.slotKey = 0;
      if (e.code === 'Digit2') input.slotKey = 1;
      if (e.code === 'KeyQ') input.slotKey = -2; // quick-switch
      if (e.code === 'KeyG') input.grenadeKey = 'he';
      if (e.code === 'KeyF') input.grenadeKey = 'flash';
      if (e.code === 'KeyB') input.buyToggle = true;
      if (e.code === 'Tab') { e.preventDefault(); input.scoreboard = true; }
      if (e.code === 'KeyM') this.state.muted = !this.state.muted;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') input.scoreboard = false;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
      this.aimDown = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      input.lookDX += e.movementX * this.sensitivity;
      input.lookDY += e.movementY * this.sensitivity;
    });
    document.addEventListener('mousedown', (e) => {
      this.onAnyGesture && this.onAnyGesture();
      if (!this.locked) return;
      if (e.button === 0) {
        this.mouseDown = true;
        input.firePressed = true;
      }
      if (e.button === 2) this.aimDown = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.aimDown = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.mouseDown = false;
        this.aimDown = false;
        this.onLockLost && this.onLockLost();
      }
    });
    // Wheel cycles weapon slots.
    window.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      input.slotKey = e.deltaY > 0 ? 1 : 0;
    }, { passive: true });
  }

  requestLock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* pointer lock unavailable; game still renders */ }
  }

  // Refresh the held-key snapshot from the key set. Called once per
  // rendered frame; the simulation consumes it on its fixed steps.
  poll() {
    const input = this.state.input;
    const k = this.keys;
    input.forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) -
      (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    input.strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) -
      (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    input.jump = k.has('Space');
    input.crouch = k.has('ControlLeft') || k.has('KeyC');
    input.sneak = k.has('ShiftLeft') || k.has('ShiftRight');
    input.useHeld = k.has('KeyE');
    input.fire = this.mouseDown;
  }

  // One-shot flags are cleared after the simulation consumes them.
  consumeStep() {
    const input = this.state.input;
    input.lookDX = 0;
    input.lookDY = 0;
    input.firePressed = false;
    input.reload = false;
    input.slotKey = -1;
    input.grenadeKey = '';
    input.buyToggle = false;
  }
}
