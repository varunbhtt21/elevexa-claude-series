// Bat-Dash: an endless rooftop runner that lives on the final slide.
// It listens in the capture phase so, while you play, game keys never reach the deck.

(() => {
  const slide = document.querySelector('#stage .s-game');
  if (!slide) return;

  const canvas = slide.querySelector('.game-canvas');
  const ctx = canvas.getContext('2d');
  const overlay = slide.querySelector('.game-overlay');
  const card = slide.querySelector('.game-card');

  const W = 1600;
  const H = 900;
  const BEST_KEY = 'batman-deck-best';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BAT = new Path2D(document.querySelector('#bat path').getAttribute('d')); // 100 x 50

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hash = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

  let state = 'ready'; // ready | playing | paused | over
  let muted = false;
  let best = 0;
  let raf = 0;
  let last = 0;
  let theme = {};
  let world;
  const keys = { jump: false, down: false };

  try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch { /* no storage */ }

  function readTheme() {
    const cs = getComputedStyle(slide);
    const v = (name) => cs.getPropertyValue(name).trim();
    theme = {
      yellow: v('--yellow'), red: v('--red'), deep: v('--deep'), deep2: v('--deep-2'),
      purple: v('--purple'), cyan: v('--cyan'), green: v('--green'), pink: v('--pink'),
      ink: v('--ink'), head: v('--head'),
    };
  }

  // ---------- Sound: tiny synth blips ----------

  let audio;
  function beep(freq, dur, type = 'square', vol = 0.05, slideBy = 0, delay = 0) {
    if (muted) return;
    try {
      audio ||= new AudioContext();
      const t = audio.currentTime + delay;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slideBy) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slideBy), t + dur);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur);
    } catch { /* audio unavailable */ }
  }
  const sfx = {
    jump: () => beep(420, 0.15, 'square', 0.04, 320),
    double: () => beep(640, 0.16, 'square', 0.04, 500),
    token: () => { beep(988, 0.07, 'square', 0.035); beep(1319, 0.12, 'square', 0.035, 0, 0.07); },
    pow: () => { beep(160, 0.22, 'sawtooth', 0.08, -90); beep(90, 0.18, 'square', 0.05, -40); },
    hurt: () => beep(320, 0.4, 'sawtooth', 0.07, -240),
    throw: () => beep(900, 0.12, 'triangle', 0.05, -500),
    speed: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.1, 'square', 0.035, 0, i * 0.08)),
    over: () => [392, 330, 262, 196].forEach((f, i) => beep(f, 0.22, 'triangle', 0.06, 0, i * 0.18)),
  };

  // ---------- World ----------

  function makeSkyline(count, minH, maxH) {
    const buildings = [];
    let x = 0;
    for (let i = 0; i < count; i++) {
      const w = rand(90, 220);
      buildings.push({ x, w, h: rand(minH, maxH), seed: Math.random() * 1000, spire: Math.random() < 0.25 });
      x += w + rand(4, 30);
    }
    return { buildings, width: x };
  }

  function newWorld() {
    world = {
      t: 0, speed: 9, score: 0, lives: 3, level: 1, nextSpeedUp: 1000,
      invuln: 0, shake: 0, bgX: 0, rangCooldown: 0, flash: 0,
      hero: { x: 300, y: 0, w: 56, h: 84, vy: 0, onGround: false, jumps: 0, gliding: false, runT: 0 },
      roofs: [], tokens: [], goons: [], clouds: [], rangs: [], popups: [], particles: [],
      far: makeSkyline(24, 160, 420),
      near: makeSkyline(20, 110, 300),
      stars: Array.from({ length: 90 }, () => ({ x: rand(0, W), y: rand(0, 520), r: rand(0.8, 2.4), p: rand(0, 6) })),
    };
    world.roofs.push({ x: -200, w: 1500, y: 680, seed: 1, deco: 'tower' });
    world.hero.y = 680 - world.hero.h;
    world.hero.onGround = true;
    fillRoofs();
  }

  function fillRoofs() {
    let lastRoof = world.roofs.at(-1);
    while (lastRoof.x + lastRoof.w < W + 700) {
      const gap = clamp(rand(130, 190 + world.speed * 11), 120, 380);
      const roof = {
        x: lastRoof.x + lastRoof.w + gap,
        w: rand(460, 1000),
        y: clamp(lastRoof.y + rand(-130, 120), 540, 770),
        seed: Math.random() * 1000,
        deco: pickDeco(),
      };
      world.roofs.push(roof);
      populate(roof, lastRoof, gap);
      lastRoof = roof;
    }
  }

  function pickDeco() {
    const r = Math.random();
    return r < 0.25 ? 'tower' : r < 0.45 ? 'antenna' : r < 0.6 ? 'sign' : null;
  }

  function populate(roof, prev, gap) {
    const difficulty = Math.min(1, world.score / 6000);

    // An arc of tokens over the gap rewards a well-timed jump
    if (Math.random() < 0.55) {
      const startX = prev.x + prev.w - 40;
      const span = gap + 80;
      for (let i = 0; i < 5; i++) {
        const f = i / 4;
        world.tokens.push({ x: startX + span * f, y: Math.min(prev.y, roof.y) - 90 - Math.sin(f * Math.PI) * 130, bob: rand(0, 6) });
      }
    }
    // A row of tokens along the roof
    if (Math.random() < 0.4) {
      const n = Math.floor(rand(3, 6));
      const sx = roof.x + rand(60, roof.w - n * 70 - 60);
      for (let i = 0; i < n; i++) world.tokens.push({ x: sx + i * 70, y: roof.y - 60, bob: rand(0, 6) });
    }
    // Henchmen patrol wider roofs
    if (roof.w > 560 && Math.random() < 0.35 + difficulty * 0.45) {
      world.goons.push({ x: roof.x + rand(220, roof.w - 120), roof, w: 62, h: 82, dir: -1, t: rand(0, 10), dead: 0 });
    }
    // Laughing-gas clouds once things warm up
    if (world.score > 400 && Math.random() < 0.25 + difficulty * 0.35) {
      world.clouds.push({ x: roof.x + rand(100, roof.w), baseY: rand(300, roof.y - 200), r: rand(46, 64), p: rand(0, 6) });
    }
  }

  // ---------- Actions ----------

  function jump() {
    const h = world.hero;
    if (h.onGround) {
      h.vy = -18.5;
      h.onGround = false;
      h.jumps = 1;
      sfx.jump();
      burst(h.x + h.w / 2, h.y + h.h, theme.yellow, 8, 3);
    } else if (h.jumps < 2) {
      h.vy = -15.5;
      h.jumps = 2;
      sfx.double();
      burst(h.x + h.w / 2, h.y + h.h, '#ffffff', 12, 4);
    }
  }

  function throwRang() {
    if (world.rangCooldown > 0 || world.rangs.length >= 3) return;
    const h = world.hero;
    world.rangs.push({ x: h.x + h.w, y: h.y + 34, vx: 24, rot: 0 });
    world.rangCooldown = 22;
    sfx.throw();
  }

  function hurt(reason) {
    if (world.invuln > 0) return;
    world.lives -= 1;
    world.invuln = 100;
    world.shake = reduceMotion ? 0 : 22;
    world.flash = 10;
    sfx.hurt();
    popup(world.hero.x + 30, world.hero.y - 20, reason, theme.red, 70);
    if (world.lives <= 0) gameOver();
  }

  function fellOff(reason) {
    hurt(reason);
    if (state !== 'playing') return;
    respawn();
  }

  // Slide the world so the next rooftop sits under Batman, then drop him in
  function respawn() {
    const h = world.hero;
    const target = world.roofs.find((r) => r.x + r.w > h.x + 120);
    if (!target) return;
    const shift = Math.max(0, target.x - (h.x - 80));
    for (const list of [world.roofs, world.tokens, world.goons, world.clouds]) {
      for (const o of list) o.x -= shift;
    }
    world.goons = world.goons.filter((g) => !(g.roof === target && g.x < h.x + 260));
    h.y = target.y - h.h - 260;
    h.vy = 0;
    h.jumps = 1;
    h.onGround = false;
    fillRoofs();
  }

  function popup(x, y, text, color, size = 48) {
    world.popups.push({ x, y, text, color, size, life: 60, rot: rand(-0.2, 0.2) });
  }

  function burst(x, y, color, n, power) {
    for (let i = 0; i < n; i++) {
      world.particles.push({
        x, y, vx: rand(-power, power), vy: rand(-power, power * 0.4),
        life: rand(20, 40), color, size: rand(3, 7),
      });
    }
  }

  // ---------- Update ----------

  function update(k) {
    const w = world;
    const h = w.hero;
    w.t += k;
    w.invuln = Math.max(0, w.invuln - k);
    w.shake = Math.max(0, w.shake - k * 1.4);
    w.flash = Math.max(0, w.flash - k);
    w.rangCooldown = Math.max(0, w.rangCooldown - k);

    const dx = w.speed * k;
    w.bgX += dx;
    w.score += dx * 0.1;

    if (w.score >= w.nextSpeedUp) {
      w.nextSpeedUp += 1000;
      w.speed = Math.min(21, w.speed + 1.2);
      w.level += 1;
      sfx.speed();
      popup(W / 2 - 140, 260, `SPEED UP! LV ${w.level}`, theme.cyan, 72);
    }

    for (const list of [w.roofs, w.tokens, w.goons, w.clouds]) {
      for (const o of list) o.x -= dx;
    }
    w.roofs = w.roofs.filter((r) => r.x + r.w > -300);
    w.tokens = w.tokens.filter((t) => t.x > -60 && !t.taken);
    w.clouds = w.clouds.filter((c) => c.x > -150);
    w.goons = w.goons.filter((g) => g.x > -120 && (g.dead === 0 || g.dead < 40));
    fillRoofs();

    // Hero physics: gravity, glide, dive
    const prevBottom = h.y + h.h;
    let gravity = 0.95;
    if (keys.down && !h.onGround) gravity = 2.4;
    h.vy += gravity * k;
    h.gliding = keys.jump && !keys.down && !h.onGround && h.vy > 0;
    if (h.gliding) h.vy = Math.min(h.vy, 2.6);
    h.y += h.vy * k;
    h.onGround = false;

    for (const r of w.roofs) {
      const overlaps = h.x + 12 < r.x + r.w && h.x + h.w - 12 > r.x;
      if (!overlaps) continue;
      if (h.vy >= 0 && prevBottom <= r.y + 2 && h.y + h.h >= r.y) {
        h.y = r.y - h.h;
        h.vy = 0;
        h.onGround = true;
        h.jumps = 0;
      } else if (h.y + h.h > r.y + 24 && h.x + h.w - 12 > r.x && h.x + h.w - 12 < r.x + 40) {
        fellOff('SPLAT!');
        return;
      }
    }
    if (h.y > H + 60) { fellOff('WHOOPS!'); return; }
    h.runT += h.onGround ? k * w.speed * 0.045 : 0;

    const hx1 = h.x + 8, hx2 = h.x + h.w - 8, hy1 = h.y + 6, hy2 = h.y + h.h;

    // Tokens
    for (const t of w.tokens) {
      if (Math.abs(t.x - (h.x + h.w / 2)) < 44 && Math.abs(t.y - (h.y + h.h / 2)) < 56) {
        t.taken = true;
        w.score += 10;
        sfx.token();
        burst(t.x, t.y, theme.yellow, 10, 4);
        popup(t.x - 20, t.y - 20, '+10', theme.yellow, 34);
      }
    }

    // Henchmen
    for (const g of w.goons) {
      g.t += k;
      if (g.dead) { g.dead += k; continue; }
      g.x += g.dir * 1.6 * k;
      if (g.x < g.roof.x + 20 || g.x + g.w > g.roof.x + g.roof.w - 20) g.dir *= -1;
      const gy = g.roof.y - g.h;
      if (hx2 > g.x + 6 && hx1 < g.x + g.w - 6 && hy2 > gy + 4 && hy1 < gy + g.h) {
        if (h.vy > 1 && prevBottom <= gy + 26) {
          g.dead = 1;
          h.vy = -14;
          h.jumps = 1;
          w.score += 50;
          sfx.pow();
          w.shake = reduceMotion ? 0 : 10;
          burst(g.x + 30, gy + 20, theme.red, 16, 6);
          popup(g.x - 10, gy - 30, Math.random() < 0.5 ? 'POW! +50' : 'BAM! +50', theme.red, 54);
        } else {
          hurt('OUCH!');
        }
      }
    }

    // Laughing gas
    for (const c of w.clouds) {
      c.p += k * 0.05;
      c.y = c.baseY + Math.sin(c.p) * 40;
      const nx = clamp(c.x, hx1, hx2);
      const ny = clamp(c.y, hy1, hy2);
      if ((c.x - nx) ** 2 + (c.y - ny) ** 2 < (c.r * 0.75) ** 2) hurt('HA HA HA!');
    }

    // Batarangs
    for (const b of w.rangs) {
      b.x += b.vx * k;
      b.rot += 0.5 * k;
      for (const g of w.goons) {
        const gy = g.roof.y - g.h;
        if (!g.dead && b.x > g.x && b.x < g.x + g.w && b.y > gy && b.y < gy + g.h) {
          g.dead = 1;
          b.hit = true;
          w.score += 30;
          sfx.pow();
          burst(g.x + 30, gy + 30, theme.yellow, 14, 5);
          popup(g.x - 10, gy - 30, 'THWACK! +30', theme.yellow, 46);
        }
      }
    }
    w.rangs = w.rangs.filter((b) => !b.hit && b.x < W + 60);

    for (const p of w.particles) {
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.vy += 0.2 * k;
      p.life -= k;
    }
    w.particles = w.particles.filter((p) => p.life > 0);
    for (const p of w.popups) { p.y -= 1.2 * k; p.life -= k; }
    w.popups = w.popups.filter((p) => p.life > 0);
  }

  // ---------- Drawing ----------

  function drawBat(x, y, width, color, rot = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const s = width / 100;
    ctx.scale(s, s);
    ctx.translate(-50, -25);
    ctx.fillStyle = color;
    ctx.fill(BAT);
    ctx.restore();
  }

  function drawSky() {
    const w = world;
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, theme.deep);
    sky.addColorStop(1, theme.deep2);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    for (const s of w.stars) {
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(w.t * 0.05 + s.p);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // The Bat-Signal stands in for the moon
    ctx.save();
    ctx.shadowColor = theme.yellow;
    ctx.shadowBlur = 70;
    ctx.fillStyle = theme.yellow;
    ctx.beginPath();
    ctx.arc(1170, 230, 92, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawBat(1170, 232, 150, '#0b0614');

    drawSkyline(w.far, 0.12, theme.purple, 0.28, 900, false);
    drawSkyline(w.near, 0.35, theme.deep2, 1, 900, true);
  }

  function drawSkyline(layer, factor, color, alpha, base, windows) {
    const off = (world.bgX * factor) % layer.width;
    ctx.globalAlpha = alpha;
    for (const copy of [0, layer.width]) {
      for (const b of layer.buildings) {
        const x = b.x - off + copy;
        if (x > W || x + b.w < 0) continue;
        const top = base - b.h - 120;
        ctx.fillStyle = color;
        ctx.fillRect(x, top, b.w, b.h + 120);
        if (b.spire) ctx.fillRect(x + b.w / 2 - 4, top - 50, 8, 50);
        if (windows) {
          ctx.fillStyle = theme.yellow;
          ctx.globalAlpha = 0.45;
          for (let wy = top + 20; wy < base - 120; wy += 34) {
            for (let wx = x + 14; wx < x + b.w - 18; wx += 28) {
              if (hash(b.seed + wx * 0.37 + wy * 1.7) < 0.22) ctx.fillRect(wx, wy, 10, 14);
            }
          }
          ctx.globalAlpha = alpha;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawRoofs() {
    for (const r of world.roofs) {
      if (r.x > W || r.x + r.w < 0) continue;
      ctx.fillStyle = theme.deep;
      ctx.fillRect(r.x, r.y, r.w, H - r.y);
      ctx.fillStyle = theme.yellow;
      ctx.globalAlpha = 0.55;
      for (let wy = r.y + 46; wy < H; wy += 74) {
        for (let wx = r.x + 30; wx < r.x + r.w - 40; wx += 62) {
          if (hash(r.seed + wx * 0.11 + wy * 0.93) < 0.3) ctx.fillRect(wx, wy, 24, 34);
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.purple;
      ctx.fillRect(r.x - 8, r.y, r.w + 16, 16);
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 4;
      ctx.strokeRect(r.x - 8, r.y, r.w + 16, 16);
      ctx.strokeRect(r.x, r.y + 16, r.w, H);
      drawDeco(r);
    }
  }

  function drawDeco(r) {
    const x = r.x + r.w * 0.7;
    ctx.fillStyle = theme.deep2;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 3;
    if (r.deco === 'tower') {
      ctx.fillRect(x + 10, r.y - 40, 6, 40);
      ctx.fillRect(x + 64, r.y - 40, 6, 40);
      ctx.beginPath();
      ctx.roundRect(x, r.y - 120, 80, 84, [30, 30, 6, 6]);
      ctx.fill();
      ctx.stroke();
    } else if (r.deco === 'antenna') {
      ctx.fillRect(x, r.y - 150, 6, 150);
      ctx.fillStyle = theme.red;
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(world.t * 0.12);
      ctx.beginPath();
      ctx.arc(x + 3, r.y - 154, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (r.deco === 'sign') {
      ctx.fillRect(x + 10, r.y - 30, 6, 30);
      ctx.fillRect(x + 140, r.y - 30, 6, 30);
      ctx.fillStyle = theme.red;
      ctx.fillRect(x, r.y - 90, 156, 60);
      ctx.strokeRect(x, r.y - 90, 156, 60);
      ctx.fillStyle = '#fff';
      ctx.font = `34px ${theme.head}`;
      ctx.textAlign = 'center';
      ctx.fillText('GOTHAM', x + 78, r.y - 48);
      ctx.textAlign = 'left';
    }
  }

  function drawTokens() {
    for (const t of world.tokens) {
      const y = t.y + Math.sin(world.t * 0.1 + t.bob) * 6;
      ctx.fillStyle = theme.yellow;
      ctx.strokeStyle = '#0b0614';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(t.x, y, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      drawBat(t.x, y + 1, 32, '#0b0614');
    }
  }

  function drawGoon(g) {
    const gy = g.roof.y - g.h;
    ctx.save();
    if (g.dead) {
      ctx.globalAlpha = Math.max(0, 1 - g.dead / 40);
      ctx.translate(g.x + 31, gy + 41 - g.dead * 3);
      ctx.rotate(g.dead * 0.25);
      ctx.translate(-31, -41);
    } else {
      ctx.translate(g.x, gy + Math.abs(Math.sin(g.t * 0.25)) * -4);
    }
    const swing = Math.sin(g.t * 0.25) * 8;
    ctx.fillStyle = '#2a1f3d';
    ctx.fillRect(14 + swing, 62, 12, 20);
    ctx.fillRect(36 - swing, 62, 12, 20);
    ctx.fillStyle = theme.purple;
    ctx.strokeStyle = '#0b0614';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(4, 34, 54, 34, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = theme.green;
    ctx.beginPath();
    ctx.moveTo(24, 40); ctx.lineTo(31, 46); ctx.lineTo(38, 40); ctx.lineTo(38, 52); ctx.lineTo(31, 46); ctx.lineTo(24, 52);
    ctx.fill();
    // Clown face and wild green hair
    ctx.fillStyle = theme.green;
    for (const [hx, hy] of [[14, 10], [24, 4], [36, 4], [47, 10]]) {
      ctx.beginPath();
      ctx.arc(hx, hy + 6, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#fdf6ec';
    ctx.beginPath();
    ctx.arc(31, 22, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0b0614';
    ctx.fillRect(23, 16, 4, 6);
    ctx.fillRect(35, 16, 4, 6);
    ctx.strokeStyle = theme.red;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(31, 24, 9, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = theme.red;
    ctx.beginPath();
    ctx.arc(31, 22, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCloud(c) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = theme.green;
    ctx.strokeStyle = '#0b0614';
    ctx.lineWidth = 3;
    const puffs = [[-0.6, 0.1, 0.55], [0, -0.25, 0.7], [0.6, 0.05, 0.6], [0.05, 0.3, 0.55]];
    for (const [px, py, pr] of puffs) {
      ctx.beginPath();
      ctx.arc(c.x + px * c.r, c.y + py * c.r, pr * c.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0b0614';
    ctx.font = `${Math.round(c.r * 0.5)}px ${theme.head}`;
    ctx.textAlign = 'center';
    ctx.fillText('HA HA', c.x, c.y + c.r * 0.12 + Math.sin(world.t * 0.3) * 3);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  function drawHero() {
    const h = world.hero;
    if (world.invuln > 0 && Math.floor(world.invuln / 5) % 2 === 0) return;
    const cx = h.x + h.w / 2;
    ctx.save();

    // Cape: spread into bat wings while gliding, flowing behind while running
    if (h.gliding) {
      ctx.shadowColor = theme.yellow;
      ctx.shadowBlur = 18;
      drawBat(cx - 4, h.y + 30, 190 + Math.sin(world.t * 0.4) * 8, '#1c1d2e');
      ctx.shadowBlur = 0;
    } else {
      const flap = Math.sin(world.t * 0.35) * 10;
      ctx.fillStyle = '#1c1d2e';
      ctx.beginPath();
      ctx.moveTo(h.x + 14, h.y + 22);
      ctx.lineTo(h.x - 34 + flap, h.y + h.h - 4 + (h.onGround ? 0 : -24));
      ctx.lineTo(h.x - 10, h.y + h.h - 18);
      ctx.lineTo(h.x + 30, h.y + 30);
      ctx.fill();
    }

    // Legs
    const stride = h.onGround ? Math.sin(h.runT) * 12 : 6;
    ctx.fillStyle = '#2b2d42';
    ctx.fillRect(h.x + 14 + stride, h.y + 62, 12, 22);
    ctx.fillRect(h.x + 32 - stride, h.y + 62, 12, 22);
    ctx.fillStyle = '#1c1d2e';
    ctx.fillRect(h.x + 12 + stride, h.y + 78, 16, 7);
    ctx.fillRect(h.x + 30 - stride, h.y + 78, 16, 7);

    // Body, emblem and utility belt
    ctx.fillStyle = '#4a4f6a';
    ctx.strokeStyle = '#0b0614';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(h.x + 8, h.y + 28, 42, 38, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = theme.yellow;
    ctx.beginPath();
    ctx.ellipse(cx + 1, h.y + 42, 13, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    drawBat(cx + 1, h.y + 42, 20, '#0b0614');
    ctx.fillStyle = theme.yellow;
    ctx.fillRect(h.x + 8, h.y + 58, 42, 7);

    // Cowl with pointy ears
    ctx.fillStyle = '#1c1d2e';
    ctx.beginPath();
    ctx.moveTo(h.x + 14, h.y + 8);
    ctx.lineTo(h.x + 16, h.y - 8);
    ctx.lineTo(h.x + 22, h.y + 4);
    ctx.lineTo(h.x + 36, h.y + 4);
    ctx.lineTo(h.x + 42, h.y - 8);
    ctx.lineTo(h.x + 44, h.y + 8);
    ctx.lineTo(h.x + 46, h.y + 30);
    ctx.lineTo(h.x + 12, h.y + 30);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f1c27d';
    ctx.beginPath();
    ctx.roundRect(h.x + 24, h.y + 20, 22, 11, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(h.x + 28, h.y + 13); ctx.lineTo(h.x + 36, h.y + 12); ctx.lineTo(h.x + 35, h.y + 16);
    ctx.moveTo(h.x + 38, h.y + 12); ctx.lineTo(h.x + 45, h.y + 13); ctx.lineTo(h.x + 39, h.y + 16);
    ctx.fill();
    ctx.restore();
  }

  function drawText(text, x, y, size, color, align = 'left') {
    ctx.font = `${size}px ${theme.head}`;
    ctx.textAlign = align;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, size / 8);
    ctx.strokeStyle = '#0b0614';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.textAlign = 'left';
  }

  function drawHud() {
    const w = world;
    drawText(`SCORE ${Math.floor(w.score)}`, 50, 80, 56, theme.yellow);
    drawText(`BEST ${Math.max(best, Math.floor(w.score))}  ·  LV ${w.level}`, 52, 122, 30, '#fff');
    for (let i = 0; i < 3; i++) {
      const x = W - 90 - i * 90;
      ctx.globalAlpha = i < w.lives ? 1 : 0.25;
      ctx.fillStyle = theme.red;
      ctx.beginPath();
      ctx.arc(x, 66, 32, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0b0614';
      ctx.lineWidth = 4;
      ctx.stroke();
      drawBat(x, 68, 52, '#0b0614');
    }
    ctx.globalAlpha = 1;
    if (muted) drawText('🔇 MUTED (M)', W - 330, 140, 26, '#fff');
  }

  function draw() {
    const w = world;
    ctx.save();
    if (w.shake) ctx.translate(rand(-w.shake, w.shake), rand(-w.shake, w.shake));
    drawSky();
    drawRoofs();
    drawTokens();
    w.clouds.forEach(drawCloud);
    w.goons.forEach(drawGoon);
    for (const b of w.rangs) drawBat(b.x, b.y, 46, theme.yellow, b.rot);
    drawHero();
    for (const p of w.particles) {
      ctx.globalAlpha = Math.min(1, p.life / 20);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const p of w.popups) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life / 20);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      drawText(p.text, 0, 0, p.size, p.color);
      ctx.restore();
    }
    ctx.restore();
    if (w.flash) {
      ctx.fillStyle = `rgba(255, 40, 40, ${w.flash / 30})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (state !== 'ready') drawHud();
  }

  // ---------- Game states ----------

  function showCard(html) {
    if (html === null) { overlay.hidden = true; return; }
    card.innerHTML = html;
    overlay.hidden = false;
    card.classList.remove('bump');
    void card.offsetWidth; // restart the pop-in animation
    card.classList.add('bump');
  }

  function start() {
    document.activeElement?.blur?.();
    readTheme();
    newWorld();
    state = 'playing';
    showCard(null);
    keys.jump = keys.down = false;
    run();
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    showCard(`
      <p class="game-kicker">Holy timeout!</p>
      <h2 class="game-title">Paused</h2>
      <p class="game-cta">Press <kbd>P</kbd> or <kbd>Space</kbd> to resume · <kbd>R</kbd> to restart</p>`);
  }

  function resume() {
    state = 'playing';
    showCard(null);
    keys.jump = keys.down = false;
    run();
  }

  function gameOver() {
    state = 'over';
    sfx.over();
    const score = Math.floor(world.score);
    const isBest = score > best;
    if (isBest) {
      best = score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* not remembered */ }
    }
    setTimeout(() => showCard(`
      <p class="game-kicker">${isBest ? '🏆 New high score!' : 'Gotham needs you!'}</p>
      <h2 class="game-title">Game Over</h2>
      <div class="game-score"><span>Score<b>${score}</b></span><span>Best<b>${best}</b></span></div>
      <p class="game-cta">Press <kbd>Space</kbd> or <kbd>R</kbd> to play again</p>`), 500);
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!slide.classList.contains('is-active')) {
      pause();
      stop();
      return;
    }
    const dt = Math.min(50, now - (last || now));
    last = now;
    const k = dt / 16.667;
    if (state === 'playing') update(k);
    else {
      world.t += k;
      if (state === 'ready') world.bgX += 2 * k;
    }
    draw();
  }
  function run() { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  // ---------- Keyboard ----------

  const JUMP_KEYS = [' ', 'ArrowUp', 'w', 'W'];

  addEventListener('keydown', (e) => {
    if (!slide.classList.contains('is-active') || document.body.classList.contains('editing')) return;
    if (e.target.isContentEditable || e.target.matches?.('input, textarea, select')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key;
    let handled = true;

    if (JUMP_KEYS.includes(key) || key === 'Enter') {
      if (state === 'playing') {
        if (key !== 'Enter') {
          if (!e.repeat) jump();
          keys.jump = true;
        }
      } else if (state === 'paused') resume();
      else if (!e.repeat) start();
    } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
      if (state === 'playing') keys.down = true;
      else handled = false;
    } else if ('xXjJ'.includes(key)) {
      if (state === 'playing') throwRang();
      else handled = false;
    } else if (key === 'p' || key === 'P' || key === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused' && key !== 'Escape') resume();
      else handled = false;
    } else if (key === 'r' || key === 'R') {
      if (state === 'over' || state === 'paused') start();
      else handled = false;
    } else if (key === 'm' || key === 'M') {
      muted = !muted;
      if (state !== 'playing') draw();
    } else if (state !== 'playing' || ['ArrowLeft', 'ArrowRight', 'f', 'F'].includes(key)) {
      handled = false; // deck shortcuts still work
    }

    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  addEventListener('keyup', (e) => {
    if (JUMP_KEYS.includes(e.key)) keys.jump = false;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keys.down = false;
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  // Start the attract-mode scenery whenever the slide is shown, and recolour on theme change
  new MutationObserver(() => {
    if (slide.classList.contains('is-active')) {
      readTheme();
      run();
    }
  }).observe(slide, { attributes: true, attributeFilter: ['class'] });

  new MutationObserver(() => {
    readTheme();
    if (!raf) draw();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  readTheme();
  newWorld();
  draw();
  if (slide.classList.contains('is-active')) run();
})();
