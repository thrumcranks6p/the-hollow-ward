export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set();
    this.dx = 0;
    this.dy = 0;
    this.enabled = true;
    this.mouseDown = false;
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && this.locked) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX || 0;
      this.dy += e.movementY || 0;
    });
    el.addEventListener('mousedown', (e) => {
      if (this.locked && e.button === 0) this.pressed.add('Mouse0');
      if (this.locked && e.button === 2) this.pressed.add('Mouse2');
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  get locked() {
    return document.pointerLockElement === this.el || this.forceLocked;
  }
  lock() {
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.el.requestPointerLock(); } catch (e) { /* */ } });
    } catch (e) {
      try { this.el.requestPointerLock(); } catch (e2) { /* */ }
    }
  }
  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
  down(c) { return this.keys.has(c); }
  hit(c) { return this.pressed.has(c); }
  endFrame() {
    this.pressed.clear();
    this.dx = 0;
    this.dy = 0;
  }
}
