// DOM HUD / menus
const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'objective', 'team', 'prompt', 'message', 'hint', 'm-battery', 'm-stamina', 'breath', 'revive', 'revive-fg', 'locker-overlay', 'down-overlay', 'escaped-overlay', 'intro', 'note', 'note-title', 'note-text']) this.el[id] = $(id);
    this.msgT = 0;
    this.cache = {};
  }
  screen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
    if (id) $(id).classList.remove('hidden');
  }
  show(id, on = true) { $(id).classList.toggle('hidden', !on); }
  set(id, html) {
    if (this.cache[id] === html) return;
    this.cache[id] = html;
    this.el[id].innerHTML = html;
  }
  hud(on) { this.show('hud', on); }
  prompt(text) { this.set('prompt', text || ''); }
  message(text, dur = 3.5) {
    this.el.message.style.opacity = 1;
    this.el.message.innerHTML = text;
    this.msgT = dur;
  }
  tick(dt) {
    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.el.message.style.opacity = 0;
    }
  }
  meters(battery, flOn, stamina) {
    const b = this.el['m-battery'].querySelector('.fill');
    b.style.width = Math.round(battery * 100) + '%';
    b.classList.toggle('low', battery < 0.2);
    this.el['m-battery'].style.opacity = flOn ? 1 : 0.45;
    const s = this.el['m-stamina'];
    s.querySelector('.fill').style.width = Math.round(stamina * 100) + '%';
    s.style.opacity = stamina < 0.995 ? 1 : 0;
  }
  breath(show, v) {
    this.el.breath.style.display = show ? 'block' : 'none';
    if (show) this.el.breath.querySelector('.fill').style.width = Math.round(v * 100) + '%';
  }
  revive(p) {
    this.el.revive.style.display = p > 0 ? 'block' : 'none';
    this.el['revive-fg'].style.strokeDashoffset = String(94.25 * (1 - p));
  }
  showNote(note) {
    this.el['note-title'].textContent = note.title;
    this.el['note-text'].textContent = note.text;
    this.show('note', true);
  }
  hideNote() { this.show('note', false); }
  intro() {
    const el = this.el.intro;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    setTimeout(() => el.classList.add('hidden'), 7200);
  }
  hint(text) { this.set('hint', text); }
}
export { $ };
