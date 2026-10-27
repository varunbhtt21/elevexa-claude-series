// Batman deck: navigation, scaling, comic effects, editing, themes and the slide organiser

const stage = document.getElementById('stage');
let slides = [...stage.querySelectorAll('.slide')];
const counter = document.getElementById('counter');
const progressBar = document.getElementById('progressBar');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const SFX = ['POW!', 'BAM!', 'ZAP!', 'WHAM!', 'BIFF!', 'ZOK!', 'KRAK!', 'THWACK!', 'BOOM!'];
const SFX_COLORS = ['#ffd23f', '#ef3e36', '#2ec4f1', '#3ddc84', '#ff5fa2', '#ff8c42'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const pad = (n) => String(n).padStart(2, '0');

// Every slide keeps a stable id so order and skips survive a reload
slides.forEach((slide, i) => { slide.dataset.id = i; });
const skipped = new Set();

let current = -1;

function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}
function recall(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

// Scale the fixed 1600x900 stage to fit the window
function fit() {
  const scale = Math.min(innerWidth / 1600, innerHeight / 900) * 0.96;
  stage.style.setProperty('--scale', scale);
}

// ---------- Navigation ----------

const isSkipped = (i) => skipped.has(slides[i].dataset.id);
const visibleIndexes = () => slides.map((_, i) => i).filter((i) => !isSkipped(i));

function go(index) {
  if (index < 0 || index >= slides.length || index === current) return;

  const forward = index > current;
  stage.style.setProperty('--ox', forward ? '100%' : '0%');

  const old = slides[current];
  if (old) {
    old.classList.remove('is-active');
    old.classList.add('is-prev');
    setTimeout(() => old.classList.remove('is-prev'), 950);
    comicHit(forward);
  }

  slides[index].classList.remove('is-prev');
  slides[index].classList.add('is-active');
  current = index;
  updateUI();
}

// Move to the next/previous slide that isn't skipped
function step(dir) {
  for (let i = current + dir; i >= 0 && i < slides.length; i += dir) {
    if (!isSkipped(i)) return go(i);
  }
}

function updateUI() {
  const visible = visibleIndexes();
  const pos = visible.indexOf(current) + 1;
  counter.textContent = `${pos ? pad(pos) : '––'} / ${pad(visible.length)}`;
  progressBar.style.width = `${(pos / visible.length) * 100}%`;
  prevBtn.disabled = !visible.some((i) => i < current);
  nextBtn.disabled = !visible.some((i) => i > current);
  history.replaceState(null, '', `#${current + 1}`);
  highlightCard();
}

// A bat swoops across and a sound effect pops on every slide change
function comicHit(forward) {
  if (reduceMotion) return;

  const bat = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  bat.classList.add('flyer');
  if (!forward) bat.classList.add('reverse');
  bat.innerHTML = '<use href="#bat"/>';
  bat.addEventListener('animationend', () => bat.remove());
  stage.appendChild(bat);

  const sfx = document.createElement('div');
  sfx.className = 'sfx';
  sfx.textContent = pick(SFX);
  sfx.style.setProperty('--c', pick(SFX_COLORS));
  sfx.style.setProperty('--r', `${Math.round(Math.random() * 30 - 15)}deg`);
  sfx.style.left = `${200 + Math.random() * 900}px`;
  sfx.style.top = `${120 + Math.random() * 450}px`;
  sfx.addEventListener('animationend', () => sfx.remove());
  stage.appendChild(sfx);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}

function toast(text, color, small) {
  const el = document.createElement('div');
  el.className = small ? 'toast small' : 'toast';
  el.textContent = text;
  if (color) el.style.setProperty('--c', color);
  el.addEventListener('animationend', () => el.remove());
  document.body.appendChild(el);
}

// ---------- Keyboard, buttons, touch ----------

addEventListener('keydown', (e) => {
  const key = e.key;

  if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 's') {
    e.preventDefault();
    if (editing) save();
    return;
  }
  // While typing in a text box, keys belong to the text, not the deck
  if (e.target.isContentEditable) {
    if (key === 'Escape' || (key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      e.target.blur();
    }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // Let focused buttons and checkboxes handle their own Enter/Space
  if ((key === 'Enter' || key === ' ') && e.target.closest('button, input, [role="button"]')) return;

  if (key === 'Escape') { closeThemeMenu(); closeSidebar(true); }
  else if (key === 'e' || key === 'E') { if (!editing) setEditing(true); }
  else if (key === 't' || key === 'T') cycleTheme();
  else if (key === 's' || key === 'S') toggleSidebar();
  else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(key)) { e.preventDefault(); step(1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(key)) { e.preventDefault(); step(-1); }
  else if (key === 'Home') go(visibleIndexes()[0]);
  else if (key === 'End') go(visibleIndexes().at(-1));
  else if (key === 'f' || key === 'F') toggleFullscreen();
});

prevBtn.addEventListener('click', () => step(-1));
nextBtn.addEventListener('click', () => step(1));
document.getElementById('fs').addEventListener('click', toggleFullscreen);

let touchX = null;
addEventListener('touchstart', (e) => {
  touchX = editing || e.target.closest('.sidebar') ? null : e.touches[0].clientX;
}, { passive: true });
addEventListener('touchend', (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  touchX = null;
});

// Hide controls when the mouse is idle
let idleTimer;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 2500);
}
addEventListener('mousemove', wake);
addEventListener('keydown', wake);

// ---------- Edit mode ----------

const EDITABLE = [
  '.issue', '.mega', '.tagline', '.hint', '.caption', '.headline',
  '.fact b', '.fact span', '.stamp',
  '.panel-cap', '.panel-art:not(.bat-art)', '.panel p', '.bubble', '.burst',
  '.skill-icon', '.skill h3', '.skill p',
  '.pouch-icon', '.pouch h3', '.pouch p',
  '.avatar', '.ally h3', '.ally p',
  '.wanted', '.mug', '.poster h3', '.poster p',
  '.year', '.card h3', '.card p',
  '.moral-sub', '.key', '.the-end',
].join(',');
const EDITS_KEY = 'batman-deck-edits';

const editBtn = document.getElementById('editBtn');
const saveBtn = document.getElementById('saveBtn');
const cancelBtn = document.getElementById('cancelBtn');
const resetBtn = document.getElementById('resetBtn');

// Captured in the original slide order, so reordering slides never shifts saved edits
const editables = [...stage.querySelectorAll(EDITABLE)];
const originals = editables.map((el) => el.innerHTML);
let editing = false;
let snapshot = null;
let resetTimer;

const contentNow = () => editables.map((el) => el.innerHTML);
const applyContent = (items) => items.forEach((html, i) => { editables[i].innerHTML = html; });

function loadSavedEdits() {
  const data = recall(EDITS_KEY);
  // Ignore saves made against a different version of the slides
  if (data && data.count === editables.length) applyContent(data.items);
}

function setEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', on);
  editables.forEach((el) => {
    if (on) { el.contentEditable = 'true'; el.spellcheck = false; }
    else el.removeAttribute('contenteditable');
  });
  editBtn.hidden = on;
  saveBtn.hidden = cancelBtn.hidden = resetBtn.hidden = !on;
  saveBtn.classList.remove('dirty');
  disarmReset();

  if (on) {
    snapshot = contentNow();
  } else {
    document.activeElement?.blur();
    getSelection()?.removeAllRanges();
    renderSidebar();
  }
  wake();
}

function save() {
  if (!store(EDITS_KEY, { count: editables.length, items: contentNow() })) {
    toast('Save failed!', 'var(--red)', true);
    return;
  }
  setEditing(false);
  toast('SAVED!');
}

function cancel() {
  applyContent(snapshot);
  setEditing(false);
  toast('Undone!', 'var(--yellow)', true);
}

// Reset needs two clicks so it can't happen by accident
function disarmReset() {
  clearTimeout(resetTimer);
  resetBtn.classList.remove('armed');
  resetBtn.textContent = '↺ Reset';
}
function reset() {
  if (!resetBtn.classList.contains('armed')) {
    resetBtn.classList.add('armed');
    resetBtn.textContent = 'Sure? Click again';
    resetTimer = setTimeout(disarmReset, 3000);
    return;
  }
  applyContent(originals);
  store(EDITS_KEY, null);
  setEditing(false);
  toast('RESET!', 'var(--cyan)');
}

// Put the caret where the user double-clicked
function placeCaret(x, y) {
  const range = document.caretRangeFromPoint?.(x, y)
    ?? (() => {
      const pos = document.caretPositionFromPoint?.(x, y);
      if (!pos) return null;
      const r = document.createRange();
      r.setStart(pos.offsetNode, pos.offset);
      return r;
    })();
  if (!range) return;
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

editBtn.addEventListener('click', () => setEditing(true));
saveBtn.addEventListener('click', save);
cancelBtn.addEventListener('click', cancel);
resetBtn.addEventListener('click', reset);

// Double-click any text to jump straight into editing it
stage.addEventListener('dblclick', (e) => {
  const target = e.target.closest(EDITABLE);
  if (editing || !target) return;
  setEditing(true);
  target.focus();
  placeCaret(e.clientX, e.clientY);
});

stage.addEventListener('input', () => saveBtn.classList.add('dirty'));

// Paste as plain text so comic styling isn't overwritten
stage.addEventListener('paste', (e) => {
  if (!e.target.closest('[contenteditable]')) return;
  e.preventDefault();
  document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
});

addEventListener('beforeunload', (e) => {
  if (editing && saveBtn.classList.contains('dirty')) e.preventDefault();
});

// ---------- Themes ----------

const THEMES = [
  { id: 'classic', name: 'Classic Comic', blurb: '1960s POW! BAM!' },
  { id: 'noir', name: 'Gotham Noir', blurb: 'Black, white & one signal' },
  { id: 'neon', name: 'Neon Arkham', blurb: 'Synthwave glow' },
  { id: 'golden', name: 'Golden Age', blurb: '1940s newsprint' },
  { id: 'joker', name: 'Joker Chaos', blurb: 'Acid green mischief' },
];
const THEME_KEY = 'batman-deck-theme';
const themeBtn = document.getElementById('themeBtn');
const themeMenu = document.getElementById('themeMenu');

THEMES.forEach((theme) => {
  const option = document.createElement('button');
  option.className = 'theme-option';
  option.setAttribute('role', 'menuitemradio');
  option.dataset.pick = theme.id;
  option.innerHTML = `
    <span class="theme-swatch" data-theme="${theme.id}"><b>BATMAN</b><i></i><i></i><i></i></span>
    <span>${theme.name}<br><small style="opacity:.6">${theme.blurb}</small></span>`;
  option.addEventListener('click', () => { setTheme(theme.id); closeThemeMenu(); });
  themeMenu.appendChild(option);
});

function setTheme(id, quiet) {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  const root = document.documentElement;
  if (!quiet) {
    root.classList.add('theme-switching');
    setTimeout(() => root.classList.remove('theme-switching'), 700);
  }
  root.dataset.theme = theme.id;
  try { localStorage.setItem(THEME_KEY, theme.id); } catch { /* not remembered */ }
  themeMenu.querySelectorAll('.theme-option').forEach((o) => {
    o.setAttribute('aria-checked', String(o.dataset.pick === theme.id));
  });
  if (!quiet) {
    comicHit(true);
    toast(theme.name, null, true);
  }
}

function cycleTheme() {
  const i = THEMES.findIndex((t) => t.id === document.documentElement.dataset.theme);
  setTheme(THEMES[(i + 1) % THEMES.length].id);
}

function closeThemeMenu() {
  themeMenu.classList.remove('open');
  themeBtn.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-open');
}

themeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = !themeMenu.classList.contains('open');
  themeMenu.classList.toggle('open', open);
  themeBtn.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('menu-open', open);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#themeMenu')) closeThemeMenu();
});

// ---------- Slide organiser sidebar ----------

const LAYOUT_KEY = 'batman-deck-layout';
const sidebar = document.getElementById('sidebar');
const slideList = document.getElementById('slideList');
const pinBtn = document.getElementById('pinBtn');
let pinned = false;
let dragId = null;
let closeTimer;

function saveLayout() {
  store(LAYOUT_KEY, { order: slides.map((s) => s.dataset.id), skipped: [...skipped] });
}

function loadLayout() {
  const data = recall(LAYOUT_KEY);
  if (!data) return;
  const ids = slides.map((s) => s.dataset.id);
  if (Array.isArray(data.order)) {
    // Keep the saved order for known slides; slides added later go at the end
    const known = [...new Set(data.order)].filter((id) => ids.includes(id));
    const order = [...known, ...ids.filter((id) => !known.includes(id))];
    slides = order.map((id) => slides.find((s) => s.dataset.id === id));
    slides.forEach((s) => stage.appendChild(s));
  }
  (data.skipped ?? []).filter((id) => ids.includes(id)).forEach((id) => skipped.add(id));
  if (skipped.size === slides.length) skipped.clear();
}

function makeCard(slide, index) {
  const id = slide.dataset.id;
  const card = document.createElement('li');
  card.className = 'slide-card';
  card.draggable = true;
  card.dataset.id = id;
  card.classList.toggle('skipped', skipped.has(id));

  // A frozen, fully revealed copy of the slide for the thumbnail
  const clone = slide.cloneNode(true);
  clone.classList.remove('is-active', 'is-prev');
  clone.classList.add('thumb-slide');
  clone.removeAttribute('aria-label');
  clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));

  const title = slide.getAttribute('aria-label') || `Slide ${index + 1}`;
  card.innerHTML = `
    <span class="card-num">${pad(index + 1)}</span>
    <div class="thumb" role="button" tabindex="0" aria-label="Go to slide: ${title}">
      <div class="thumb-inner" aria-hidden="true"></div>
    </div>
    <div class="card-foot">
      <span class="card-title">${title}</span>
      <label class="skip" title="Skip this slide while presenting">
        <input type="checkbox" ${skipped.has(id) ? 'checked' : ''}> Skip
      </label>
    </div>`;
  card.querySelector('.thumb-inner').appendChild(clone);
  return card;
}

function renderSidebar() {
  slideList.replaceChildren(...slides.map(makeCard));
  highlightCard();
}

function highlightCard() {
  slideList.querySelectorAll('.slide-card').forEach((card) => {
    const isCurrent = card.dataset.id === slides[current]?.dataset.id;
    card.classList.toggle('current', isCurrent);
    if (isCurrent && sidebar.classList.contains('open')) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

function renumberCards() {
  slideList.querySelectorAll('.card-num').forEach((num, i) => { num.textContent = pad(i + 1); });
}

function openSidebar() {
  clearTimeout(closeTimer);
  if (sidebar.classList.contains('open')) return;
  renderSidebar();
  sidebar.classList.add('open');
  highlightCard();
}
function closeSidebar(force) {
  if ((pinned && !force) || dragId) return;
  if (force) setPinned(false);
  sidebar.classList.remove('open');
}
function toggleSidebar() {
  if (sidebar.classList.contains('open')) closeSidebar(true);
  else { openSidebar(); setPinned(true); }
}
function setPinned(on) {
  pinned = on;
  pinBtn.setAttribute('aria-pressed', String(on));
}

// Auto-hide: open near the left edge, close shortly after the mouse leaves
document.getElementById('hotzone').addEventListener('mouseenter', openSidebar);
document.getElementById('sidebarTab').addEventListener('mouseenter', openSidebar);
document.getElementById('sidebarTab').addEventListener('click', toggleSidebar);
sidebar.addEventListener('mouseenter', () => clearTimeout(closeTimer));
sidebar.addEventListener('mouseleave', () => {
  closeTimer = setTimeout(() => closeSidebar(false), 400);
});
pinBtn.addEventListener('click', () => setPinned(!pinned));

// Click a thumbnail to jump to that slide
slideList.addEventListener('click', (e) => {
  const thumb = e.target.closest('.thumb');
  if (!thumb) return;
  go(slides.findIndex((s) => s.dataset.id === thumb.closest('.slide-card').dataset.id));
});
slideList.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('thumb')) {
    e.preventDefault();
    e.target.click();
  }
});

// Skip toggles
slideList.addEventListener('change', (e) => {
  if (!e.target.matches('.skip input')) return;
  const card = e.target.closest('.slide-card');
  const id = card.dataset.id;

  if (e.target.checked) {
    if (skipped.size === slides.length - 1) {
      e.target.checked = false;
      toast('Keep at least one!', 'var(--red)', true);
      return;
    }
    skipped.add(id);
  } else {
    skipped.delete(id);
  }
  card.classList.toggle('skipped', e.target.checked);
  saveLayout();
  updateUI();
});

// Drag one card onto another to swap the two slides
slideList.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.slide-card');
  if (!card) return;
  dragId = card.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
  requestAnimationFrame(() => card.classList.add('dragging'));
});

slideList.addEventListener('dragover', (e) => {
  const card = e.target.closest('.slide-card');
  if (!dragId || !card || card.dataset.id === dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  slideList.querySelectorAll('.drop-target').forEach((c) => c !== card && c.classList.remove('drop-target'));
  card.classList.add('drop-target');
});

slideList.addEventListener('dragleave', (e) => {
  const card = e.target.closest('.slide-card');
  if (card && !card.contains(e.relatedTarget)) card.classList.remove('drop-target');
});

slideList.addEventListener('drop', (e) => {
  e.preventDefault();
  const card = e.target.closest('.slide-card');
  if (dragId && card && card.dataset.id !== dragId) swapSlides(dragId, card.dataset.id);
});

slideList.addEventListener('dragend', () => {
  dragId = null;
  slideList.querySelectorAll('.dragging, .drop-target').forEach((c) => c.classList.remove('dragging', 'drop-target'));
});

function swapNodes(a, b) {
  const marker = document.createComment('');
  a.replaceWith(marker);
  b.replaceWith(a);
  marker.replaceWith(b);
}

function swapSlides(idA, idB) {
  const a = slides.findIndex((s) => s.dataset.id === idA);
  const b = slides.findIndex((s) => s.dataset.id === idB);
  const active = slides[current];

  swapNodes(slides[a], slides[b]);
  [slides[a], slides[b]] = [slides[b], slides[a]];
  current = slides.indexOf(active);

  // Swap the cards with a FLIP animation so they glide into place
  const cardA = slideList.querySelector(`[data-id="${idA}"]`);
  const cardB = slideList.querySelector(`[data-id="${idB}"]`);
  const before = new Map([cardA, cardB].map((c) => [c, c.getBoundingClientRect()]));
  swapNodes(cardA, cardB);
  renumberCards();
  [cardA, cardB].forEach((card) => {
    const dy = before.get(card).top - card.getBoundingClientRect().top;
    card.animate(
      [{ transform: `translateY(${dy}px) scale(1.04)` }, { transform: 'none' }],
      { duration: reduceMotion ? 0 : 450, easing: 'cubic-bezier(.2, 1.3, .4, 1)' },
    );
  });

  saveLayout();
  updateUI();
  toast('SWAP!', 'var(--cyan)', true);
}

// ---------- Start ----------

loadSavedEdits();
loadLayout();
setTheme(document.documentElement.dataset.theme, true);
addEventListener('resize', fit);
fit();
wake();

const requested = (parseInt(location.hash.slice(1), 10) || 1) - 1;
const startAt = slides[requested] && !isSkipped(requested)
  ? requested
  : visibleIndexes().find((i) => i >= requested) ?? visibleIndexes()[0];
go(startAt);
