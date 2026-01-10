/* ============================================================
   MC Aim Trainer - app.js
   - 100% offline (sem libs, sem assets externos)
   - Canvas 2D + Pointer Lock (mira se move)
   - 5 modos: OSU Timing, Flick, Tracking, Target Switch, Micro Ajuste
   - HUD + Resultados (gráficos/histograma/heatmap) + Persistência localStorage
   ============================================================ */

(() => {
  "use strict";

  /* =========================
     Utils
     ========================= */
  const Utils = {
    clamp(v, a, b) { return Math.max(a, Math.min(b, v)); },
    lerp(a, b, t) { return a + (b - a) * t; },
    invLerp(a, b, v) { return (v - a) / (b - a); },
    smoothstep(t) { return t * t * (3 - 2 * t); },
    dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.hypot(dx, dy); },
    now() { return performance.now(); },
    fmtMs(ms) {
      if (!isFinite(ms)) return "—";
      return `${Math.round(ms)}ms`;
    },
    fmtTime(sec) {
      sec = Math.max(0, sec);
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    },
    // Clone seguro (structuredClone quando disponível; fallback JSON para objetos simples)
    clone(obj) {
      if (typeof structuredClone === "function") return structuredClone(obj);
      return JSON.parse(JSON.stringify(obj));
    },
    // RNG determinístico (mulberry32) para repetibilidade por seed
    seedToInt(seedStr) {
      const s = String(seedStr ?? "");
      let h = 2166136261 >>> 0;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }
  };

  class RNG {
    constructor(seedStr) {
      this.state = Utils.seedToInt(seedStr || "seed");
      if (this.state === 0) this.state = 0x12345678;
    }
    next() {
      // mulberry32
      let t = this.state += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(a, b) { return a + (b - a) * this.next(); }
    int(a, b) { return Math.floor(this.range(a, b + 1)); }
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  }

  /* =========================
     MODE INFO (didática)
     ========================= */
  const MODE_INFO = {
    osu: {
      name: "OSU Timing",
      what: "Treina tempo + precisão. Clique quando o anel (approach ring) encostar no alvo.",
      how: "Foque no ritmo: não “adianta” o clique. Priorize consistência antes de velocidade.",
      common: "Erros comuns: clique cedo/tarde demais; mirar no anel em vez do centro; tensão no pulso."
    },
    flick: {
      name: "Flick Shot",
      what: "Treina flick: mover rápido e parar no centro do alvo.",
      how: "Faça o movimento e “trave” no final. Evite corrigir demais (overshoot).",
      common: "Erros comuns: overshoot/undershoot; jitter no final; mirar com o braço e corrigir com o pulso (ou vice-versa) sem consistência."
    },
    tracking: {
      name: "Tracking",
      what: "Treina acompanhamento: manter a mira sobre um alvo em movimento contínuo.",
      how: "Use micro-ajustes suaves. Se treme, reduza velocidade ou ative smoothing leve.",
      common: "Erros comuns: ficar “atrás” do alvo; puxar demais; tremor excessivo (jitter)."
    },
    switch: {
      name: "Target Switch",
      what: "Treina alternância rápida entre alvos (target switching).",
      how: "Planeje o caminho: minimize distância desnecessária. Faça “micro freios”.",
      common: "Erros comuns: perder ordem; caminho de mouse longo; mirar entre alvos sem decidir."
    },
    micro: {
      name: "Micro Ajuste",
      what: "Treina precisão fina: alvos pequenos e próximos da mira.",
      how: "Pulso estável, dedos e micro ajustes. Respire e evite apertar o mouse com força.",
      common: "Erros comuns: tremor; corrigir em zigue-zague; sens muito alta sem controle."
    }
  };

  /* =========================
     Config + Storage
     ========================= */
  const STORAGE_KEY = "mc_aim_trainer_v2";

  const DEFAULT_CONFIG = {
    // Controls
    sens: 2.0,                 // multiplicador livre
    smoothing: 0.0,            // 0..0.95 (filtro exponencial)
    snapPixels: false,         // pixel-perfect crosshair
    useMinecraft: true,
    mcSensPercent: 100,        // 0..200
    fov: 90,                   // 60..120 (escala aproximada)
    dpi: 0,                    // opcional

    // Visual
    crosshairType: "plus",     // plus | cross | dot | circle
    crosshairSize: 14,
    crosshairColor: "#4caf50",
    dayNight: true,
    dayNightSpeed: 1.2,        // multiplicador
    particles: 160,
    volume: 0.18,

    // UX
    difficulty: "normal",
    reduceParticles: false,
    highContrast: false,
    colorblind: false,
    showTips: true,

    // Session
    seed: ""
  };

  class ConfigManager {
    static load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return Utils.clone(DEFAULT_CONFIG);
        const parsed = JSON.parse(raw);
        return { ...Utils.clone(DEFAULT_CONFIG), ...parsed };
      } catch (e) {
        console.warn("Config load failed:", e);
        return Utils.clone(DEFAULT_CONFIG);
      }
    }

    static save(cfg) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      } catch (e) {
        console.warn("Config save failed:", e);
      }
    }

    static applyDocumentFlags(cfg) {
      document.body.classList.toggle("high-contrast", !!cfg.highContrast);
      document.body.classList.toggle("colorblind", !!cfg.colorblind);
    }

    static cfg = ConfigManager.load();
    static draft = null;

    static startDraft() { this.draft = Utils.clone(this.cfg); }
    static cancelDraft() { this.draft = null; }
    static commitDraft() {
      if (!this.draft) return;
      this.cfg = this.draft;
      this.draft = null;
      this.save(this.cfg);
      this.applyDocumentFlags(this.cfg);
    }
  }

  /* =========================
     Audio (WebAudio)
     ========================= */
  class AudioManager {
    static ctx = null;
    static gain = null;

    static ensure() {
      if (this.ctx) return;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new Ctx();
        this.gain = this.ctx.createGain();
        this.gain.gain.value = Utils.clamp(ConfigManager.cfg.volume, 0, 1);
        this.gain.connect(this.ctx.destination);
      } catch (e) {
        console.warn("AudioContext unavailable:", e);
      }
    }

    static setVolume(v01) {
      this.ensure();
      if (!this.gain) return;
      this.gain.gain.value = Utils.clamp(v01, 0, 1);
    }

    static beep(freq, durMs, type = "sine", vol = 0.14) {
      this.ensure();
      if (!this.ctx || !this.gain) return;
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.value = 0.0001;
      osc.connect(g);
      g.connect(this.gain);
      osc.start(t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Utils.clamp(vol, 0.001, 1), t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
      osc.stop(t0 + durMs / 1000 + 0.02);
    }

    static noisePop(durMs = 60, vol = 0.12) {
      this.ensure();
      if (!this.ctx || !this.gain) return;
      const sampleRate = this.ctx.sampleRate;
      const len = Math.max(1, Math.floor(sampleRate * (durMs / 1000)));
      const buf = this.ctx.createBuffer(1, len, sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = Utils.clamp(vol, 0, 1);
      src.connect(g);
      g.connect(this.gain);
      src.start();
    }

    static hit() {
      const v = Utils.clamp(ConfigManager.cfg.volume, 0, 1);
      this.beep(880, 60, "square", 0.10 + v * 0.20);
      this.noisePop(55, 0.08 + v * 0.15);
    }

    static miss() {
      const v = Utils.clamp(ConfigManager.cfg.volume, 0, 1);
      this.beep(220, 90, "sawtooth", 0.08 + v * 0.18);
    }
  }

  /* =========================
     Input + Pointer Lock
     ========================= */
  class Input {
    static canvas = null;

    static aim = { x: 0, y: 0 };        // posição da mira (pixel no canvas)
    static vel = { x: 0, y: 0 };        // velocidade aproximada
    static lastMoveT = 0;
    static locked = false;

    static deltaQueue = [];             // filas de movementX/Y (para smoothing)
    static keys = new Set();
    static mouseDown = false;

    static init(canvas) {
      this.canvas = canvas;
      this.aim.x = canvas.width / 2;
      this.aim.y = canvas.height / 2;
      this.vel.x = 0; this.vel.y = 0;
      this.lastMoveT = Utils.now();

      // Pointer lock change
      document.addEventListener("pointerlockchange", () => {
        this.locked = (document.pointerLockElement === canvas);
        if (!this.locked) {
          // Se perdeu lock durante jogo, pausa automaticamente (corrige “ESC não funciona em alguns casos”)
          if (Game.state === "running") Game.pause("Lost Pointer Lock");
        } else {
          // Retomar (não auto-resume; UI permite)
          AudioManager.ensure();
        }
      });

      // Mouse movement (movementX/Y funciona com pointer lock)
      document.addEventListener("mousemove", (e) => {
        if (!Game.isInteractive()) return;
        const dx = e.movementX || 0;
        const dy = e.movementY || 0;
        const t = Utils.now();
        const dt = Math.max(1, t - this.lastMoveT);
        this.lastMoveT = t;
        // velocidade aproximada (px/ms)
        this.vel.x = Utils.lerp(this.vel.x, dx / dt, 0.4);
        this.vel.y = Utils.lerp(this.vel.y, dy / dt, 0.4);

        // Se não estiver em pointer lock, usamos clientX/Y com clamp
        if (!this.locked) {
          const rect = canvas.getBoundingClientRect();
          const x = (e.clientX - rect.left) * (canvas.width / rect.width);
          const y = (e.clientY - rect.top) * (canvas.height / rect.height);
          this.aim.x = Utils.clamp(x, 0, canvas.width);
          this.aim.y = Utils.clamp(y, 0, canvas.height);
          return;
        }

        // Pointer lock: empilha deltas e aplica no update() com smoothing e sens
        this.deltaQueue.push({ dx, dy });
      });

      document.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        this.mouseDown = true;
        if (Game.state === "running") Game.mode?.onMouseDown?.();
      });

      document.addEventListener("mouseup", (e) => {
        if (e.button !== 0) return;
        this.mouseDown = false;
        if (Game.state === "running") Game.mode?.onMouseUp?.();
      });

      document.addEventListener("keydown", (e) => {
        this.keys.add(e.code);

        // Hotkeys globais
        if (e.code === "Escape") {
          // Sempre funciona: se running -> pause; se paused -> resume (sem capturar)
          e.preventDefault();
          if (Game.state === "running") Game.pause("ESC");
          else if (Game.state === "paused") UI.resumeFromPause();
          return;
        }

        if (e.code === "KeyF") {
          e.preventDefault();
          UI.toggleFullscreen();
          return;
        }

        if (e.code === "KeyR") {
          if (Game.state === "running" || Game.state === "paused") {
            e.preventDefault();
            Game.restartSession();
          }
          return;
        }

        if (e.code === "Tab") {
          if (Game.state === "running" || Game.state === "paused") {
            e.preventDefault();
            UI.toggleLiveOverlay();
          }
          return;
        }

        // 1..5 troca modo (quando no lobby e não rodando)
        const numMap = {
          Digit1: "osu",
          Digit2: "flick",
          Digit3: "tracking",
          Digit4: "switch",
          Digit5: "micro"
        };
        if (numMap[e.code]) {
          if (Game.state === "lobby" || Game.state === "menu") {
            UI.selectMode(numMap[e.code]);
          } else if (Game.state === "running" || Game.state === "paused") {
            // permite trocar rápido se quiser: encerra e inicia novo modo
            e.preventDefault();
            UI.selectMode(numMap[e.code]);
            Game.startSelectedMode();
          }
        }
      });

      document.addEventListener("keyup", (e) => {
        this.keys.delete(e.code);
      });
    }

    static requestPointerLock() {
      const canvas = this.canvas;
      if (!canvas) return;
      if (!canvas.requestPointerLock) {
        UI.toast("Pointer Lock não suportado. Fallback: mira limitada ao cursor.");
        return;
      }
      try { canvas.requestPointerLock(); } catch (e) { /* ignore */ }
    }

    static update(dtMs) {
      const cfg = ConfigManager.cfg;
      // Aplica deltas do pointer lock
      if (this.locked && this.deltaQueue.length) {
        let sumX = 0, sumY = 0;
        for (let i = 0; i < this.deltaQueue.length; i++) {
          sumX += this.deltaQueue[i].dx;
          sumY += this.deltaQueue[i].dy;
        }
        this.deltaQueue.length = 0;

        // Minecraft feel: converte counts -> graus -> pixels (aprox)
        const { degPerPixel } = Scoring.getMinecraftDegreesPerPixel(cfg);
        // fallback se degPerPixel não for finito
        const scale = (cfg.useMinecraft && isFinite(degPerPixel) && degPerPixel > 0)
          ? (1 / degPerPixel) * 0.28 // fator visual: "grau" -> px (aproximação)
          : (cfg.sens * 1.15);

        // smoothing exponencial: aim = lerp(aim, aim + delta*scale, alpha)
        // Onde alpha ~ 1 - smoothing (smoothing=0 => alpha=1)
        const alpha = 1 - Utils.clamp(cfg.smoothing, 0, 0.95);
        const targetX = this.aim.x + sumX * scale;
        const targetY = this.aim.y + sumY * scale;

        this.aim.x = Utils.lerp(this.aim.x, targetX, alpha);
        this.aim.y = Utils.lerp(this.aim.y, targetY, alpha);

        // Snap (pixel-perfect)
        if (cfg.snapPixels) {
          this.aim.x = Math.round(this.aim.x);
          this.aim.y = Math.round(this.aim.y);
        }

        this.aim.x = Utils.clamp(this.aim.x, 0, this.canvas.width);
        this.aim.y = Utils.clamp(this.aim.y, 0, this.canvas.height);
      }
    }
  }

  /* =========================
     Renderer: Background + Target + Particles + Crosshair
     ========================= */

class Renderer {
  static canvas = null;
  static ctx = null;

  static w = 0;
  static h = 0;

  // Patterns procedural
  static groundPattern = null;
  static cloudPattern = null;

  // Day/night
  static dayT = 0; // 0..1

  static particles = [];
  static stars = [];

  static init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.ctx.imageSmoothingEnabled = false;

    this.onResize();

    // Estrelas pre-geradas (determinísticas, estilo Minecraft: pontinhos + alguns "brilhos" fixos)
    // IMPORTANTE: não usar Math.random aqui pra não "trocar" o céu a cada frame/refresh.
    this.stars = [];
    const rng = new RNG("star_seed_v2");
    for (let i = 0; i < 300; i++) {
      const size = rng.next() < 0.88 ? 1 : 2;
      this.stars.push({
        x: rng.next(),               // 0..1
        y: rng.next() * 0.62,        // só no topo do céu
        s: size,                     // 1..2 px
        // twinkle determinístico por estrela
        twSpeed: rng.range(0.6, 1.4),
        twPhase: rng.next() * Math.PI * 2,
        brightness: rng.range(0.55, 1.0),
        // algumas estrelas maiores ganham um "spark" fixo (sem random por frame)
        spark: size > 1 && rng.next() < 0.35
      });
    }
  }

  static onResize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.w = this.canvas.width;
    this.h = this.canvas.height;

    // Recria patterns (cache em pattern; não recalcular por frame)
    this.groundPattern = this.makeGroundPattern();
    this.cloudPattern = this.makeCloudPattern();
  }

  static makeGroundPattern() {
    // Textura "grass block" Minecraft-like em tiles 16x16, repetidos num atlas 64x64.
    // Topo: verde com dithering / tufos.
    // Lateral: terra com speckles, e umas pedrinhas.
    // Tudo determinístico via RNG.
    const c = document.createElement("canvas");
    c.width = 64; c.height = 64;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;

    const cb = !!ConfigManager.cfg.colorblind;

    // Paletas (aproximação Minecraft; sem assets externos)
    // Top grass (vários tons)
    const grass = cb
      ? ["#3b7a57", "#2c5b44", "#4a8f6a", "#2a6b5d"]
      : ["#5aa13f", "#4b8e33", "#6fbb4c", "#3f7b2a"];

    // Dirt (laterais)
    const dirt = cb
      ? ["#5d4037", "#4b322c", "#6a4a3f", "#3b2722"]
      : ["#8b5a2b", "#6f441f", "#a06a34", "#5a361a"];

    // Stone specks (bem sutil)
    const stone = cb
      ? ["#5f6a6a", "#465252"]
      : ["#6b6b6b", "#4b4b4b"];

    // RNG determinístico (um por pattern)
    const rng = new RNG(cb ? "ground_cb_v2" : "ground_v2");

    // Helpers
    const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
    const clampi = (v, a, b) => Math.max(a, Math.min(b, v));

    // Monta 4x4 tiles de 16x16
    for (let ty = 0; ty < 4; ty++) {
      for (let tx = 0; tx < 4; tx++) {
        const x0 = tx * 16, y0 = ty * 16;

        // === base do tile ===
        // Top grass band (0..5)
        g.fillStyle = grass[0];
        g.fillRect(x0, y0, 16, 6);

        // Dirt side (6..15)
        g.fillStyle = dirt[0];
        g.fillRect(x0, y0 + 6, 16, 10);

        // === dithering no topo (grama) ===
        // Em vez de "ruído solto", faz clusters curtinhos (tufts) + dithering leve.
        for (let i = 0; i < 48; i++) {
          const x = x0 + rng.int(0, 15);
          const y = y0 + rng.int(0, 5);
          const r = rng.next();

          // Dither leve
          const col = (r < 0.55) ? grass[1] : (r < 0.85 ? grass[2] : grass[3]);
          px(x, y, col);

          // Mini cluster (tufinho)
          if (rng.next() < 0.22) {
            const cx = clampi(x + rng.int(-1, 1), x0, x0 + 15);
            const cy = clampi(y + rng.int(-1, 1), y0, y0 + 5);
            px(cx, cy, col);
            if (rng.next() < 0.35) {
              const cx2 = clampi(cx + rng.int(-1, 1), x0, x0 + 15);
              const cy2 = clampi(cy + rng.int(-1, 1), y0, y0 + 5);
              px(cx2, cy2, col);
            }
          }
        }

        // === "franja" na borda grass->dirt (y=5..7) ===
        // Dá o efeito de "capim" caindo pra lateral.
        for (let x = 0; x < 16; x++) {
          if (rng.next() < 0.55) px(x0 + x, y0 + 6, grass[rng.next() < 0.6 ? 1 : 2]);
          if (rng.next() < 0.25) px(x0 + x, y0 + 7, grass[rng.next() < 0.7 ? 1 : 3]);
        }

        // === speckles na terra ===
        for (let i = 0; i < 80; i++) {
          const x = x0 + rng.int(0, 15);
          const y = y0 + 6 + rng.int(0, 9);
          const r = rng.next();

          // maioria: variação de terra; raros: pedrinhas
          if (r < 0.80) px(x, y, dirt[rng.next() < 0.6 ? 1 : 2]);
          else if (r < 0.92) px(x, y, dirt[3]);
          else px(x, y, stone[rng.next() < 0.6 ? 0 : 1]);
        }

        // === sombreamento sutil (Minecraft vibe) ===
        // sombra na parte inferior da faixa de grama e ao longo da lateral esquerda
        g.fillStyle = "rgba(0,0,0,.18)";
        g.fillRect(x0, y0 + 5, 16, 1); // separação grass/dirt
        g.fillRect(x0, y0, 1, 16);

        // highlight na borda superior/direita
        g.fillStyle = "rgba(255,255,255,.10)";
        g.fillRect(x0, y0, 16, 1);
        g.fillRect(x0 + 15, y0, 1, 16);

        // escurece um pouco o rodapé do tile
        g.fillStyle = "rgba(0,0,0,.10)";
        g.fillRect(x0, y0 + 15, 16, 1);
      }
    }

    return this.ctx.createPattern(c, "repeat");
  }

  static makeCloudPattern() {
    // Nuvens Minecraft-like:
    // - grandes, blocadas, com sombra embaixo e highlight em cima
    // - determinísticas via RNG
    // - desenhadas em grid de 4px pra ficar "chunky"
    const c = document.createElement("canvas");
    c.width = 256; c.height = 128;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);

    const rng = new RNG("cloud_v2");

    const CELL = 4; // grid block
    const cloudFill = "rgba(255,255,255,0.95)";
    const cloudMid = "rgba(235,235,235,0.92)";
    const cloudShadow = "rgba(200,200,200,0.85)";

    // helper: desenha retângulo alinhado no grid
    const rectGrid = (x, y, w, h, col) => {
      const gx = Math.floor(x / CELL) * CELL;
      const gy = Math.floor(y / CELL) * CELL;
      const gw = Math.max(CELL, Math.floor(w / CELL) * CELL);
      const gh = Math.max(CELL, Math.floor(h / CELL) * CELL);
      g.fillStyle = col;
      g.fillRect(gx, gy, gw, gh);
    };

    // Gera ~6 nuvens grandes
    const CLOUDS = 6;
    for (let n = 0; n < CLOUDS; n++) {
      const cx = rng.int(0, c.width - 96);
      const cy = rng.int(6, c.height - 48);
      const baseW = rng.int(64, 112);
      const baseH = rng.int(16, 28);

      // Base (sombra)
      // 3 a 6 blocos retangulares pra formar silhueta
      const blocks = rng.int(4, 7);
      for (let i = 0; i < blocks; i++) {
        const bx = cx + rng.int(-8, baseW - 24);
        const by = cy + rng.int(0, baseH - 12);
        const bw = rng.int(20, 44);
        const bh = rng.int(8, 16);
        rectGrid(bx, by + 4, bw, bh, cloudShadow);
      }

      // Corpo (mid)
      for (let i = 0; i < blocks + 1; i++) {
        const bx = cx + rng.int(0, baseW - 28);
        const by = cy + rng.int(0, baseH - 12);
        const bw = rng.int(24, 52);
        const bh = rng.int(8, 16);
        rectGrid(bx, by + 2, bw, bh, cloudMid);
      }

      // Highlight (topo)
      for (let i = 0; i < blocks; i++) {
        const bx = cx + rng.int(6, baseW - 30);
        const by = cy + rng.int(0, Math.max(2, baseH - 16));
        const bw = rng.int(20, 44);
        const bh = rng.int(6, 12);
        rectGrid(bx, by, bw, bh, cloudFill);
      }

      // Recortes (pra quebrar bloco perfeito demais)
      // pequenos "buracos" no corpo da nuvem, mas poucos.
      const cuts = rng.int(2, 5);
      for (let i = 0; i < cuts; i++) {
        const bx = cx + rng.int(8, baseW - 20);
        const by = cy + rng.int(4, baseH - 10);
        const bw = rng.int(8, 16);
        const bh = rng.int(4, 8);
        rectGrid(bx, by + 4, bw, bh, "rgba(0,0,0,0)");
        // limpar de verdade
        const gx = Math.floor(bx / CELL) * CELL;
        const gy = Math.floor((by + 4) / CELL) * CELL;
        const gw = Math.max(CELL, Math.floor(bw / CELL) * CELL);
        const gh = Math.max(CELL, Math.floor(bh / CELL) * CELL);
        g.clearRect(gx, gy, gw, gh);
      }
    }

    return this.ctx.createPattern(c, "repeat");
  }

  static lerpRGB(a, b, t) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    const r = Math.round(Utils.lerp(ar, br, t));
    const g = Math.round(Utils.lerp(ag, bg, t));
    const bl = Math.round(Utils.lerp(ab, bb, t));
    return `rgb(${r},${g},${bl})`;
  }

  static drawBackground(dt) {
    const ctx = this.ctx;
    const cfg = ConfigManager.cfg;

    // Ciclo dia/noite tipo “dino”: dia->noite rápido com estrelas visíveis
    if (cfg.dayNight) {
      this.dayT += (dt / 1000) * 0.02 * cfg.dayNightSpeed;
      this.dayT = this.dayT % 1;
    } else {
      this.dayT = 0.1;
    }

    // Mapeia dayT em fator noite (0 dia, 1 noite)
    // Deixa noite “segurar” um pouco
    const phase = this.dayT;
    let night = 0;
    if (phase < 0.40) night = 0; // dia
    else if (phase < 0.55) night = Utils.smoothstep(Utils.invLerp(0.40, 0.55, phase)); // transição
    else if (phase < 0.85) night = 1; // noite
    else night = 1 - Utils.smoothstep(Utils.invLerp(0.85, 1.0, phase)); // amanhecer

    // Céu mais “Minecraft-ish” (dia mais vivo, noite profunda)
    const skyTopDay = 0x6DB7FF, skyBotDay = 0xBFEAFF;
    const skyTopNight = 0x050710, skyBotNight = 0x0C1022;

    // Gradiente do céu
    const skyGrad = ctx.createLinearGradient(0, 0, 0, this.h);
    skyGrad.addColorStop(0, this.lerpRGB(skyTopDay, skyTopNight, night));
    skyGrad.addColorStop(0.70, this.lerpRGB(skyBotDay, skyBotNight, night));
    skyGrad.addColorStop(1, "#0a0a0a");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, this.w, this.h);

    // Estrelas à noite (sem Math.random no render; tudo determinístico por estrela)
    if (night > 0.05) {
      const alpha = Utils.clamp((night - 0.05) / 0.95, 0, 1);
      ctx.globalAlpha = 0.85 * alpha;

      // "twinkle" bem suave, estilo Minecraft (quase estático, só varia alpha)
      const t = this.dayT * 12; // tempo lento o suficiente
      for (let i = 0; i < this.stars.length; i++) {
        const s = this.stars[i];
        const tw = 0.75 + 0.25 * Math.sin(t * s.twSpeed + s.twPhase);
        const x = Math.floor(s.x * this.w);
        const y = Math.floor(s.y * this.h);
        const a = Utils.clamp(s.brightness * tw, 0, 1);

        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.fillRect(x, y, s.s, s.s);

        // “spark” fixo (só pra estrelas grandes)
        if (s.spark) {
          ctx.fillStyle = `rgba(255,255,255,${a * 0.65})`;
          ctx.fillRect(x + 1, y, 1, 1);
        }
      }
      ctx.globalAlpha = 1;
    }

    // Nuvens de dia (movem levemente para dar vida)
    if (night < 0.85) {
      const a = Utils.clamp(1 - night / 0.85, 0, 1);

      // Offset determinístico (não afeta gameplay)
      // Dica: manter baixo pra não distrair demais
      const cloudOffset = (this.dayT * 520) % 256;

      ctx.globalAlpha = 0.55 * a;
      ctx.fillStyle = this.cloudPattern;
      ctx.save();
      ctx.translate(-cloudOffset, 18);
      ctx.fillRect(0, 0, this.w + 256, Math.floor(this.h * 0.45));
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Chão: padrão de blocos (scroll leve só pra “vida”; não mexe em input/mira)
    const groundY = Math.floor(this.h * 0.70);
    ctx.fillStyle = this.groundPattern;

    // Mantém movimento bem sutil
    const gx = Math.floor((this.dayT * 90) % 64);

    ctx.save();
    ctx.translate(-gx, 0);
    ctx.fillRect(0, groundY, this.w + 64, this.h - groundY);
    ctx.restore();

    // Horizonte (linha)
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.fillRect(0, groundY, this.w, 2);
  }

  static spawnHitParticles(x, y, color = "#ffffff", count = 22) {
    const cfg = ConfigManager.cfg;
    const maxP = cfg.reduceParticles || cfg.reduceParticles ? Math.floor(cfg.particles * 0.5) : cfg.particles;
    if (this.particles.length > maxP) this.particles.splice(0, this.particles.length - maxP);

    const n = Math.floor(Utils.clamp(count, 0, 80));
    for (let i = 0; i < n; i++) {
      const vx = (Math.random() * 2 - 1) * 1.6;
      const vy = -Math.random() * 2.4 - 0.6;
      this.particles.push({
        x, y,
        vx, vy,
        life: 350 + Math.random() * 380,
        t: 0,
        size: Math.random() < 0.8 ? 2 : 3,
        color
      });
    }
  }

  static updateParticles(dt) {
    const ctx = this.ctx;
    const groundY = Math.floor(this.h * 0.70);
    const g = 0.008 * dt; // gravidade em px/ms^2

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt;
      if (p.t >= p.life) { this.particles.splice(i, 1); continue; }
      p.vy += g;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // bounce suave no chão
      if (p.y > groundY - 2) {
        p.y = groundY - 2;
        p.vy *= -0.35;
        p.vx *= 0.65;
      }

      const a = 1 - (p.t / p.life);
      ctx.globalAlpha = 0.85 * a;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      ctx.globalAlpha = 1;
    }
  }

  static drawTarget(target, now) {
    const ctx = this.ctx;
    if (!target) return;

    const x = Math.round(target.x);
    const y = Math.round(target.y);
    const r = target.r;
    const alive = now < target.expireAt;

    // Pixel circle (approx by squares)
    const step = 2;
    for (let yy = -r; yy <= r; yy += step) {
      for (let xx = -r; xx <= r; xx += step) {
        if (xx * xx + yy * yy <= r * r) {
          ctx.fillStyle = target.colorFill;
          ctx.fillRect(x + xx, y + yy, step, step);
        }
      }
    }

    // center dot
    ctx.fillStyle = target.colorCore;
    ctx.fillRect(x - 1, y - 1, 2, 2);

    // Outline
    ctx.strokeStyle = target.colorEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - r - 1, y - r - 1, (r * 2) + 2, (r * 2) + 2);

    // Approach ring (OSU-like)
    if (target.approach) {
      const t = Utils.clamp((target.approach.startAt - now) / target.approach.duration, 0, 1);
      const rr = r + 22 * t;
      ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - t) + 0.2})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Expire indicator
    if (!alive) {
      ctx.strokeStyle = "rgba(255,80,80,.8)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.stroke();
    }
  }

  static drawCrosshair() {
    const ctx = this.ctx;
    const cfg = ConfigManager.cfg;
    const x = Math.round(Input.aim.x);
    const y = Math.round(Input.aim.y);
    const s = Utils.clamp(cfg.crosshairSize, 6, 30);

    // colorblind: muda um pouco
    const color = cfg.colorblind ? "#ffd54f" : cfg.crosshairColor;

    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.strokeStyle = "rgba(0,0,0,.45)";
    ctx.lineWidth = 2;

    // sombra leve
    const shadow = () => {
      if (cfg.crosshairType === "dot") ctx.fillRect(-2, -2, 4, 4);
    };

    // crosshair
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    const gap = Math.floor(s * 0.28);
    const len = Math.floor(s * 0.8);
    const thick = 2;

    if (cfg.crosshairType === "plus") {
      // +
      ctx.fillRect(-thick, -gap - len, thick * 2, len);
      ctx.fillRect(-thick, gap, thick * 2, len);
      ctx.fillRect(-gap - len, -thick, len, thick * 2);
      ctx.fillRect(gap, -thick, len, thick * 2);
    } else if (cfg.crosshairType === "cross") {
      // X
      ctx.save();
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-thick, -gap - len, thick * 2, len);
      ctx.fillRect(-thick, gap, thick * 2, len);
      ctx.restore();

      ctx.save();
      ctx.rotate(-Math.PI / 4);
      ctx.fillRect(-thick, -gap - len, thick * 2, len);
      ctx.fillRect(-thick, gap, thick * 2, len);
      ctx.restore();
    } else if (cfg.crosshairType === "dot") {
      ctx.fillRect(-2, -2, 4, 4);
    } else if (cfg.crosshairType === "circle") {
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(3, Math.floor(s * 0.55)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillRect(-2, -2, 4, 4);
    }

    ctx.restore();
  }
}


/* =========================
     Scoring + Metrics
     ========================= */
  class Scoring {
    // Aproximação do “feel” MC:
    // factor = (sens*0.6 + 0.2)^3 * 8  (base comum de MC)
    // degreesPerCount (yaw) ~ factor * 0.15
    // degreesPerPixel: ajustado por FOV e largura (aprox)
    static getMinecraftDegreesPerPixel(cfg) {
      const sens01 = Utils.clamp((cfg.mcSensPercent ?? 100) / 200, 0, 1);
      const f = Math.pow(sens01 * 0.6 + 0.2, 3) * 8;
      const degPerCount = f * 0.15;

      // Em MC, counts -> yaw; aqui convertimos “yaw” em deslocamento na tela:
      // Quanto maior o FOV, mais “espaço” por grau.
      // Aproximação: pixelsPerDegree ~ (w / FOV) * k
      const w = Renderer.w || 1280;
      const fov = Utils.clamp(cfg.fov ?? 90, 60, 120);
      const pixelsPerDegree = (w / fov) * 0.52;
      const degPerPixel = 1 / Math.max(1e-6, pixelsPerDegree);

      let cmPer360 = NaN;
      let eDpi = NaN;
      if (cfg.dpi && cfg.dpi > 0) {
        // cm per 360 estimado:
        // counts para 360 = 360/degPerCount
        // inches = counts / dpi ; cm = inches * 2.54
        const counts360 = 360 / Math.max(1e-6, degPerCount);
        cmPer360 = (counts360 / cfg.dpi) * 2.54;
        // eDPI estimado (MC não é FPS tradicional, mas serve como referência)
        eDpi = cfg.dpi * sens01;
      }

      return { degPerCount, degPerPixel, cmPer360, eDpi };
    }

    static timingScore(deltaMs, windowMs) {
      // score 0..1: 1 no centro, cai suavemente até 0 fora da janela
      const t = Math.abs(deltaMs) / Math.max(1, windowMs);
      return Utils.clamp(1 - t * t, 0, 1);
    }

    static radialScore(distPx, radiusPx) {
      // score 0..1: 1 no centro, 0 na borda (ou fora)
      const t = distPx / Math.max(1, radiusPx);
      return Utils.clamp(1 - t, 0, 1);
    }
  }

  /* =========================
     Modes base
     ========================= */
  class BaseMode {
    constructor(id) {
      this.id = id;
      this.name = MODE_INFO[id].name;
      this.rng = new RNG(ConfigManager.cfg.seed || "seed");
      this.targets = [];
      this.activeTargets = [];
      this.stats = {
        hits: 0,
        misses: 0,
        score: 0,
        combo: 0,
        bestCombo: 0,
        accSamples: [],  // 0..1 over time
        rtSamples: [],   // ms
        radialErrors: [],// px
        heat: new Uint16Array(40 * 22),
        heatW: 40, heatH: 22,
        onTargetSamples: [], // tracking only (0..1)
        overshoot: 0,
        undershoot: 0,
        bias: { x: 0, y: 0 }, // signed mean error
        jitter: 0,
        pathDistance: 0,
        idealDistance: 0
      };

      // Para heurísticas
      this._lastAim = { x: 0, y: 0 };
      this._jitterAcc = 0;
      this._jitterN = 0;

      // Timing session
      this.sessionStart = 0;
      this.durationMs = 30000;
    }

    reset() {
      this.rng = new RNG(ConfigManager.cfg.seed || "seed");
      this.targets.length = 0;
      this.activeTargets.length = 0;
      this.sessionStart = Game.t;
      this._lastAim.x = Input.aim.x; this._lastAim.y = Input.aim.y;
      this._jitterAcc = 0; this._jitterN = 0;

      // Reseta stats
      const st = this.stats;
      st.hits = 0; st.misses = 0; st.score = 0; st.combo = 0; st.bestCombo = 0;
      st.accSamples = []; st.rtSamples = []; st.radialErrors = [];
      st.heat.fill(0);
      st.onTargetSamples = [];
      st.overshoot = 0; st.undershoot = 0;
      st.bias = { x: 0, y: 0 };
      st.jitter = 0;
      st.pathDistance = 0;
      st.idealDistance = 0;
    }

    difficultyScale() {
      // Presets globais
      const d = ConfigManager.cfg.difficulty || "normal";
      if (d === "easy") return { size: 1.15, speed: 0.85, timing: 1.25 };
      if (d === "hard") return { size: 0.88, speed: 1.15, timing: 0.9 };
      if (d === "insane") return { size: 0.78, speed: 1.35, timing: 0.78 };
      return { size: 1.0, speed: 1.0, timing: 1.0 };
    }

    addHeat(x, y) {
      const st = this.stats;
      const gx = Math.floor(Utils.clamp(x / Renderer.w, 0, 0.999) * st.heatW);
      const gy = Math.floor(Utils.clamp(y / Renderer.h, 0, 0.999) * st.heatH);
      const idx = gy * st.heatW + gx;
      st.heat[idx] = Math.min(65535, st.heat[idx] + 1);
    }

    updateCommon(dt) {
      // Jitter: mede a variação do movimento da mira.
      // Aproximação: soma do módulo da diferença entre deltas consecutivos
      const ax = Input.aim.x, ay = Input.aim.y;
      const dx = ax - this._lastAim.x;
      const dy = ay - this._lastAim.y;
      const d = Math.hypot(dx, dy);
      this.stats.pathDistance += d;
      const dvx = dx - (this._lastAim.dx || 0);
      const dvy = dy - (this._lastAim.dy || 0);
      const jitter = Math.hypot(dvx, dvy);
      this._jitterAcc += jitter;
      this._jitterN++;

      this._lastAim.dx = dx;
      this._lastAim.dy = dy;
      this._lastAim.x = ax;
      this._lastAim.y = ay;
    }

    update(dt) {
      this.updateCommon(dt);

      // Expiração de alvos (miss)
      const now = Game.t;
      for (let i = this.activeTargets.length - 1; i >= 0; i--) {
        const t = this.activeTargets[i];
        if (now >= t.expireAt) {
          // conta como miss apenas se não foi marcado
          if (!t.hit) this.registerMiss(t);
          this.activeTargets.splice(i, 1);
        }
      }

      // Sessão termina por tempo
      if (Game.t - this.sessionStart >= this.durationMs) {
        Game.endSession();
      }
    }

    render() {
      // background
      Renderer.drawBackground(Game.dt);
      // targets
      for (let i = 0; i < this.activeTargets.length; i++) {
        Renderer.drawTarget(this.activeTargets[i], Game.t);
      }
      // particles
      Renderer.updateParticles(Game.dt);
      // crosshair
      Renderer.drawCrosshair();
    }

    registerHit(target, radialErrPx, timingDeltaMs, timingWindowMs) {
      const st = this.stats;
      st.hits++;
      st.combo++;
      st.bestCombo = Math.max(st.bestCombo, st.combo);

      // score normalizado 0..1
      const rs = Scoring.radialScore(radialErrPx, target.r);
      const ts = timingWindowMs ? Scoring.timingScore(timingDeltaMs, timingWindowMs) : 1;
      const sample = Utils.clamp(rs * 0.65 + ts * 0.35, 0, 1);

      // pontuação absoluta (escala)
      const add = 50 + Math.round(sample * 150);
      st.score += add + st.combo * 0.4;

      st.accSamples.push(sample);
      if (isFinite(timingDeltaMs)) st.rtSamples.push(Math.max(0, timingDeltaMs));
      st.radialErrors.push(radialErrPx);

      // bias: erro assinado (média)
      st.bias.x += target.x - Input.aim.x;
      st.bias.y += target.y - Input.aim.y;

      // heatmap
      this.addHeat(Input.aim.x, Input.aim.y);

      Renderer.spawnHitParticles(target.x, target.y, target.colorFill, 18 + sample * 18);
      AudioManager.hit();
    }

    registerMiss(target) {
      const st = this.stats;
      st.misses++;
      st.combo = 0;
      st.accSamples.push(0);
      this.addHeat(Input.aim.x, Input.aim.y);
      AudioManager.miss();
    }

    onClick() {/* override */}
    onMouseDown() {/* optional */}
    onMouseUp() {/* optional */}

    finalize() {
      // jitter médio
      if (this._jitterN > 0) this.stats.jitter = this._jitterAcc / this._jitterN;

      // bias médio (em px)
      const n = Math.max(1, this.stats.hits + this.stats.misses);
      this.stats.bias.x /= n;
      this.stats.bias.y /= n;
    }

    diagnose() {
      const st = this.stats;
      const n = Math.max(1, st.hits + st.misses);
      const acc = st.hits / n;

      const avgErr = st.radialErrors.length ? (st.radialErrors.reduce((a,b)=>a+b,0) / st.radialErrors.length) : NaN;
      const avgRt = st.rtSamples.length ? (st.rtSamples.reduce((a,b)=>a+b,0) / st.rtSamples.length) : NaN;

      const biasX = st.bias.x, biasY = st.bias.y;
      const biasMag = Math.hypot(biasX, biasY);

      let diag = [];
      diag.push(`<b>Modo:</b> ${MODE_INFO[this.id].name}`);
      diag.push(`<b>Hits/Misses:</b> ${st.hits}/${st.misses} — <b>Acc:</b> ${(acc*100).toFixed(1)}%`);
      diag.push(`<b>Score:</b> ${Math.round(st.score)} — <b>Best combo:</b> ${st.bestCombo}`);
      diag.push(`<b>RT médio:</b> ${Utils.fmtMs(avgRt)} — <b>Erro radial médio:</b> ${isFinite(avgErr)?avgErr.toFixed(1)+"px":"—"}`);
      if (this.id === "tracking") {
        const on = st.onTargetSamples.length ? (st.onTargetSamples.reduce((a,b)=>a+b,0)/st.onTargetSamples.length) : 0;
        diag.push(`<b>On-target:</b> ${(on*100).toFixed(1)}%`);
      }
      diag.push(`<b>Bias:</b> (${biasX.toFixed(1)}px, ${biasY.toFixed(1)}px) — mag ${biasMag.toFixed(1)}px`);
      diag.push(`<b>Jitter:</b> ${st.jitter.toFixed(2)} (quanto menor, mais suave)`);

      return diag.join("<br/>");
    }

    suggestions() {
      const cfg = ConfigManager.cfg;
      const st = this.stats;
      const n = Math.max(1, st.hits + st.misses);
      const acc = st.hits / n;
      const avgRt = st.rtSamples.length ? (st.rtSamples.reduce((a,b)=>a+b,0) / st.rtSamples.length) : NaN;
      const jitter = st.jitter;

      const out = [];

      // dicas por modo
      out.push(MODE_INFO[this.id].how);

      // heurísticas simples
      if (acc < 0.60) out.push("Acurácia baixa: diminua a dificuldade (Easy/Normal) e aumente o tamanho do crosshair.");
      if (isFinite(avgRt) && avgRt > 420) out.push("Reação alta: aumente spawn/ritmo gradualmente e treine ritmo (OSU) por 5–10 min.");
      if (jitter > 2.6 && cfg.smoothing < 0.15) out.push("Tremor detectado: experimente smoothing leve (0.10–0.20) e reduza um pouco a sens.");
      if (Math.hypot(st.bias.x, st.bias.y) > 12) out.push("Bias perceptível: você tende a parar fora do centro. Faça pausas e foque em “travar” o fim do movimento.");
      if (this.id === "flick" && (st.overshoot + st.undershoot) > 6) {
        if (st.overshoot > st.undershoot) out.push("Overshoot frequente: sens pode estar alta, ou você está “passando do ponto” e voltando. Tente reduzir 5–10%.");
        else out.push("Undershoot frequente: você para antes e corrige. Tente um flick um pouco mais decidido e finalize com micro-ajuste.");
      }
      if (this.id === "switch") out.push("Target Switch: tente reduzir o caminho do mouse. Procure trajetórias mais diretas entre alvos.");
      if (this.id === "micro") out.push("Micro: evite apertar o mouse. Use dedos para micro-ajustes e mantenha o pulso relaxado.");

      // recomendações de treino
      out.push("Rotina rápida: 10 min Tracking, 10 min Flick, 5 min Micro. Repita 2x por dia se possível.");

      return out;
    }
  }

  /* =========================
     Mode: OSU Timing
     ========================= */
  class ModeOSU extends BaseMode {
    constructor() {
      super("osu");
      this.durationMs = 35000;
      this.cfg = {
        bpm: 160,
        ar: 8.5,
        radius: 22,
        density: 1.0
      };
    }

    reset() {
      super.reset();
      const sc = this.difficultyScale();
      this.cfg.bpm = Math.round(140 * sc.speed);
      this.cfg.ar = 8.5 * sc.timing;
      this.cfg.radius = Math.round(22 * sc.size);
      this.cfg.density = sc.speed;
      this.nextSpawnAt = Game.t + 250;
    }

    spawn() {
      const r = this.cfg.radius;
      const pad = r + 22;
      const x = this.rng.range(pad, Renderer.w - pad);
      const y = this.rng.range(pad, Renderer.h * 0.62);
      const now = Game.t;

      // AR: approach duration em ms (aprox)
      const ar = Utils.clamp(this.cfg.ar, 2, 10);
      const approach = Utils.lerp(1200, 340, Utils.invLerp(2, 10, ar));
      const life = approach + 420;

      const t = {
        x, y, r,
        hit: false,
        spawnAt: now,
        expireAt: now + life,
        colorFill: "#ff5252",
        colorCore: "#ffffff",
        colorEdge: "rgba(0,0,0,.6)",
        approach: { startAt: now + approach, duration: approach }
      };
      this.activeTargets.push(t);
    }

    update(dt) {
      super.update(dt);

      const interval = (60000 / Math.max(60, this.cfg.bpm)) / Utils.clamp(this.cfg.density, 0.6, 2.2);
      if (Game.t >= this.nextSpawnAt) {
        // mantém no máximo 2 alvos
        if (this.activeTargets.length < 2) this.spawn();
        this.nextSpawnAt = Game.t + interval;
      }
    }

    onClick() {
      const now = Game.t;
      if (!this.activeTargets.length) return;

      // pega alvo mais “recente”
      let best = null, bestScore = -1;
      for (const t of this.activeTargets) {
        if (t.hit) continue;
        const d = Utils.dist(Input.aim.x, Input.aim.y, t.x, t.y);
        const radialOk = d <= t.r;
        if (!radialOk) continue;

        // timing: ideal é quando ring chega no alvo: startAt
        const delta = now - t.approach.startAt;
        const window = 140 * this.difficultyScale().timing; // janela base
        const ts = Scoring.timingScore(delta, window);
        const rs = Scoring.radialScore(d, t.r);
        const s = rs * 0.6 + ts * 0.4;
        if (s > bestScore) { bestScore = s; best = { t, d, delta, window }; }
      }

      if (best) {
        best.t.hit = true;
        this.registerHit(best.t, best.d, best.delta, best.window);
        // remove após hit
        this.activeTargets = this.activeTargets.filter(x => x !== best.t);
      } else {
        // miss clique
        this.stats.misses++;
        this.stats.combo = 0;
        this.stats.accSamples.push(0);
        this.addHeat(Input.aim.x, Input.aim.y);
        AudioManager.miss();
      }
    }
  }

  /* =========================
     Mode: Flick
     ========================= */
  class ModeFlick extends BaseMode {
    constructor() {
      super("flick");
      this.durationMs = 30000;
      this.cfg = {
        radius: 18,
        spawnRate: 2.4, // alvos por segundo
        maxLife: 1100,
        minDist: 140
      };
      this._lastTarget = null;
    }

    reset() {
      super.reset();
      const sc = this.difficultyScale();
      this.cfg.radius = Math.round(18 * sc.size);
      this.cfg.spawnRate = 2.4 * sc.speed;
      this.cfg.maxLife = 1100 / sc.speed;
      this.cfg.minDist = 140 * sc.size;
      this._lastTarget = null;
      this.nextSpawnAt = Game.t + 180;
    }

    spawn() {
      const r = this.cfg.radius;
      const pad = r + 20;
      let x = 0, y = 0;
      const tries = 10;
      for (let i = 0; i < tries; i++) {
        x = this.rng.range(pad, Renderer.w - pad);
        y = this.rng.range(pad, Renderer.h * 0.62);
        if (!this._lastTarget) break;
        const d = Utils.dist(x, y, this._lastTarget.x, this._lastTarget.y);
        if (d >= this.cfg.minDist) break;
      }
      const now = Game.t;
      const t = {
        x, y, r,
        hit: false,
        spawnAt: now,
        expireAt: now + this.cfg.maxLife,
        colorFill: "#29b6f6",
        colorCore: "#ffffff",
        colorEdge: "rgba(0,0,0,.6)",
        approach: null
      };
      this.activeTargets = [t]; // flick sempre 1 alvo ativo
      this._lastTarget = t;
    }

    update(dt) {
      super.update(dt);
      if (Game.t >= this.nextSpawnAt) {
        this.spawn();
        this.nextSpawnAt = Game.t + (1000 / Math.max(0.8, this.cfg.spawnRate));
      }
    }

    onClick() {
      const now = Game.t;
      const t = this.activeTargets[0];
      if (!t || t.hit) return;

      const d = Utils.dist(Input.aim.x, Input.aim.y, t.x, t.y);
      if (d <= t.r) {
        t.hit = true;

        // overshoot/undershoot heurística: se cruzou centro (mudança de sinal do erro projetado)
        // Aproximação: compara direção do último delta com vetor para o alvo.
        const vx = Input.aim.x - (this._lastAimPrevX ?? Input.aim.x);
        const vy = Input.aim.y - (this._lastAimPrevY ?? Input.aim.y);
        this._lastAimPrevX = Input.aim.x;
        this._lastAimPrevY = Input.aim.y;
        const tx = t.x - Input.aim.x;
        const ty = t.y - Input.aim.y;
        const dot = vx * tx + vy * ty;
        if (dot < 0) this.stats.overshoot++; else this.stats.undershoot++;

        const rt = now - t.spawnAt;
        this.registerHit(t, d, rt, 0);

        this.activeTargets.length = 0;
      } else {
        // miss clique
        this.stats.misses++;
        this.stats.combo = 0;
        this.stats.accSamples.push(0);
        this.addHeat(Input.aim.x, Input.aim.y);
        AudioManager.miss();
      }
    }
  }

  /* =========================
     Mode: Tracking
     ========================= */
  class ModeTracking extends BaseMode {
    constructor() {
      super("tracking");
      this.durationMs = 32000;
      this.cfg = {
        radius: 18,
        speed: 0.42,      // px/ms
        pattern: "strafe" // line | circle | zigzag | strafe
      };
      this.target = null;
      this.holding = false;
    }

    reset() {
      super.reset();
      const sc = this.difficultyScale();
      this.cfg.radius = Math.round(18 * sc.size);
      this.cfg.speed = 0.42 * sc.speed;
      this.cfg.pattern = this.rng.pick(["line", "circle", "zigzag", "strafe"]);
      this.spawn();
    }

    spawn() {
      const r = this.cfg.radius;
      const pad = r + 26;
      const x = this.rng.range(pad, Renderer.w - pad);
      const y = this.rng.range(pad, Renderer.h * 0.55);
      const now = Game.t;
      this.target = {
        x, y, r,
        hit: false,
        spawnAt: now,
        expireAt: now + this.durationMs, // fica até fim
        colorFill: "#ffd54f",
        colorCore: "#ffffff",
        colorEdge: "rgba(0,0,0,.6)",
        approach: null,
        vx: this.rng.range(-1, 1) * this.cfg.speed,
        vy: this.rng.range(-0.5, 0.5) * this.cfg.speed
      };
      this.activeTargets = [this.target];
    }

    onMouseDown() { this.holding = true; }
    onMouseUp() { this.holding = false; }

    update(dt) {
      super.update(dt);
      const t = this.target;
      if (!t) return;

      // movimento com padrões
      const speed = this.cfg.speed;
      const pad = t.r + 20;
      const minX = pad, maxX = Renderer.w - pad;
      const minY = pad, maxY = Renderer.h * 0.62;

      if (this.cfg.pattern === "line") {
        t.x += t.vx * dt;
        if (t.x < minX || t.x > maxX) t.vx *= -1;
      } else if (this.cfg.pattern === "circle") {
        const time = (Game.t - this.sessionStart) / 1000;
        const cx = Renderer.w * 0.5;
        const cy = Renderer.h * 0.34;
        const rad = Math.min(Renderer.w, Renderer.h) * 0.18;
        t.x = cx + Math.cos(time * 1.6) * rad;
        t.y = cy + Math.sin(time * 1.6) * rad * 0.7;
      } else if (this.cfg.pattern === "zigzag") {
        t.x += t.vx * dt;
        t.y += Math.sin(Game.t / 220) * speed * 0.8;
        if (t.x < minX || t.x > maxX) t.vx *= -1;
      } else { // strafe humano: acelerações curtas
        if (this.rng.next() < 0.02) t.vx = (this.rng.next() < 0.5 ? -1 : 1) * speed * this.rng.range(0.7, 1.35);
        if (this.rng.next() < 0.01) t.vy = (this.rng.next() < 0.5 ? -1 : 1) * speed * this.rng.range(0.3, 0.9);
        t.x += t.vx * dt;
        t.y += t.vy * dt;
        if (t.x < minX || t.x > maxX) t.vx *= -1;
        if (t.y < minY || t.y > maxY) t.vy *= -1;
      }

      t.x = Utils.clamp(t.x, minX, maxX);
      t.y = Utils.clamp(t.y, minY, maxY);

      // Métrica: on-target (crosshair dentro do raio)
      const d = Utils.dist(Input.aim.x, Input.aim.y, t.x, t.y);
      const on = d <= t.r ? 1 : 0;
      this.stats.onTargetSamples.push(on);

      // opcional: segurar clique para “dano”
      if (this.holding && on) {
        // cada tick em alvo conta como micro-score
        this.stats.score += 0.15 * dt;
        if (this.rng.next() < 0.03) Renderer.spawnHitParticles(t.x, t.y, t.colorFill, 3);
      }

      // amostra de acc: usamos on-target como “acc”
      if ((Game.t - this.sessionStart) % 200 < dt) this.stats.accSamples.push(on);
    }

    onClick() {
      // tracking: clique dá feedback se estiver on target
      const t = this.target;
      if (!t) return;
      const d = Utils.dist(Input.aim.x, Input.aim.y, t.x, t.y);
      if (d <= t.r) {
        this.stats.hits++;
        this.stats.combo++;
        this.stats.bestCombo = Math.max(this.stats.bestCombo, this.stats.combo);
        this.stats.score += 35;
        Renderer.spawnHitParticles(t.x, t.y, t.colorFill, 10);
        AudioManager.hit();
      } else {
        this.stats.misses++;
        this.stats.combo = 0;
        AudioManager.miss();
      }
    }
  }

  /* =========================
     Mode: Target Switch
     ========================= */
  class ModeSwitch extends BaseMode {
    constructor() {
      super("switch");
      this.durationMs = 30000;
      this.cfg = {
        radiusMin: 14,
        radiusMax: 22,
        count: 3,
        ordered: true,
        cooldown: 140
      };
      this.orderIndex = 0;
      this.wave = [];
      this.nextWaveAt = 0;
      this.prevKillPos = null;
    }

    reset() {
      super.reset();
      const sc = this.difficultyScale();
      this.cfg.radiusMin = Math.round(14 * sc.size);
      this.cfg.radiusMax = Math.round(22 * sc.size);
      this.cfg.count = sc.speed > 1.2 ? 4 : 3;
      this.cfg.ordered = true;
      this.cfg.cooldown = 140 / sc.speed;
      this.orderIndex = 0;
      this.prevKillPos = { x: Input.aim.x, y: Input.aim.y };
      this.spawnWave();
    }

    spawnWave() {
      this.wave = [];
      const pad = 28;
      for (let i = 0; i < this.cfg.count; i++) {
        const r = this.rng.int(this.cfg.radiusMin, this.cfg.radiusMax);
        const x = this.rng.range(pad + r, Renderer.w - pad - r);
        const y = this.rng.range(pad + r, Renderer.h * 0.62);
        this.wave.push({
          x, y, r,
          hit: false,
          spawnAt: Game.t,
          expireAt: Game.t + 2400,
          colorFill: i === 0 ? "#ab47bc" : "#7e57c2",
          colorCore: "#ffffff",
          colorEdge: "rgba(0,0,0,.6)",
          approach: null,
          order: i
        });
      }
      this.activeTargets = this.wave;
      this.orderIndex = 0;
    }

    update(dt) {
      super.update(dt);
      if (this.activeTargets.length === 0 && Game.t >= this.nextWaveAt) {
        this.spawnWave();
      }
    }

    onClick() {
      const st = this.stats;
      const targets = this.activeTargets;
      if (!targets.length) return;

      // seleciona alvo sob mira
      let hitTarget = null;
      for (const t of targets) {
        if (t.hit) continue;
        const d = Utils.dist(Input.aim.x, Input.aim.y, t.x, t.y);
        if (d <= t.r) { hitTarget = { t, d }; break; }
      }
      if (!hitTarget) {
        st.misses++;
        st.combo = 0;
        st.accSamples.push(0);
        this.addHeat(Input.aim.x, Input.aim.y);
        AudioManager.miss();
        return;
      }

      const t = hitTarget.t;
      if (this.cfg.ordered && t.order !== this.orderIndex) {
        // errou ordem
        st.misses++;
        st.combo = 0;
        st.accSamples.push(0);
        AudioManager.miss();
        return;
      }

      // tempo entre kills (reaction/transition)
      const rt = Game.t - t.spawnAt;
      this.registerHit(t, hitTarget.d, rt, 0);

      // eficiência de caminho: distância real do mouse vs ideal (entre kills)
      if (this.prevKillPos) {
        const ideal = Utils.dist(this.prevKillPos.x, this.prevKillPos.y, t.x, t.y);
        st.idealDistance += ideal;
      }
      this.prevKillPos = { x: t.x, y: t.y };

      t.hit = true;
      this.activeTargets = this.activeTargets.filter(x => x !== t);
      this.orderIndex++;

      if (this.activeTargets.length === 0) {
        this.nextWaveAt = Game.t + this.cfg.cooldown;
      }
    }
  }

  /* =========================
     Mode: Micro Ajuste
     ========================= */
  class ModeMicro extends BaseMode {
    constructor() {
      super("micro");
      this.durationMs = 28000;
      this.cfg = {
        radius: 10,
        spawnMin: 10,
        spawnMax: 70,
        life: 650
      };
      this.current = null;
    }

    reset() {
      super.reset();
      const sc = this.difficultyScale();
      this.cfg.radius = Math.round(10 * sc.size);
      this.cfg.spawnMin = 10;
      this.cfg.spawnMax = Math.round(70 * sc.size);
      this.cfg.life = 650 / sc.speed;
      this.spawn();
    }

    spawn() {
      const now = Game.t;
      const r = this.cfg.radius;
      const angle = this.rng.range(0, Math.PI * 2);
      const rr = this.rng.range(this.cfg.spawnMin, this.cfg.spawnMax);
      const x = Utils.clamp(Input.aim.x + Math.cos(angle) * rr, r + 20, Renderer.w - r - 20);
      const y = Utils.clamp(Input.aim.y + Math.sin(angle) * rr, r + 20, Renderer.h * 0.62);

      const t = {
        x, y, r,
        hit: false,
        spawnAt: now,
        expireAt: now + this.cfg.life,
        colorFill: "#4caf50",
        colorCore: "#ffffff",
        colorEdge: "rgba(0,0,0,.6)",
        approach: { startAt: now + this.cfg.life * 0.55, duration: this.cfg.life * 0.55 }
      };
      this.current = t;
      this.activeTargets = [t];
    }

    update(dt) {
      super.update(dt);
      // se não tem alvo, cria novo rápido
      if (this.activeTargets.length === 0) this.spawn();
    }

    onClick() {
      const t = this.current;
      if (!t || t.hit) return;

      const d = Utils.dist(Input.aim.x, Input.aim.y, t.x, t.y);
      if (d <= t.r) {
        t.hit = true;
        const rt = Game.t - t.spawnAt;
        this.registerHit(t, d, rt, 0);
        this.activeTargets.length = 0;
      } else {
        this.stats.misses++;
        this.stats.combo = 0;
        this.stats.accSamples.push(0);
        this.addHeat(Input.aim.x, Input.aim.y);
        AudioManager.miss();
      }
    }
  }

  /* =========================
     Game State Machine
     ========================= */
  class Game {
    static state = "menu"; // menu | lobby | running | paused | results | settings | stats
    static modeId = "osu";
    static mode = null;

    static t = 0;      // time in ms (perf.now)
    static dt = 16.6;  // ms
    static lastFrame = 0;

    static fps = 60;
    static _fpsAcc = 0;
    static _fpsN = 0;
    static _fpsLast = 0;

    static init() {
      const canvas = document.getElementById("gameCanvas");
      Renderer.init(canvas);
      Input.init(canvas);

      window.addEventListener("resize", () => {
        Renderer.onResize();
        // mantém mira dentro do canvas
        Input.aim.x = Utils.clamp(Input.aim.x, 0, Renderer.w);
        Input.aim.y = Utils.clamp(Input.aim.y, 0, Renderer.h);
      });

      // Canvas click: capturar lock e disparar clique
      canvas.addEventListener("click", (e) => {
        // evita click em UI
        if (!Game.isInteractive()) return;

        // capturar pointer lock se rodando/pausado
        if ((Game.state === "running" || Game.state === "paused") && !Input.locked) {
          Input.requestPointerLock();
        }

        // clique dispara nos modos apenas se running
        if (Game.state === "running") {
          Game.mode?.onClick?.();
        }
      });

      // inicializa mode
      this.setMode("osu");

      // UI
      UI.init();

      // loop
      this.lastFrame = Utils.now();
      this._fpsLast = this.lastFrame;
      requestAnimationFrame(this.loop);
    }

    static isInteractive() {
      // Interação via canvas só em running/paused (lobby/menu é UI)
      return Game.state === "running" || Game.state === "paused";
    }

    static setState(st) {
      this.state = st;
      UI.syncScreens();
    }

    static setMode(id) {
      this.modeId = id;
      if (id === "osu") this.mode = new ModeOSU();
      else if (id === "flick") this.mode = new ModeFlick();
      else if (id === "tracking") this.mode = new ModeTracking();
      else if (id === "switch") this.mode = new ModeSwitch();
      else this.mode = new ModeMicro();

      UI.updateLobbyHelp();
    }

    static startSelectedMode() {
      this.start(this.modeId);
    }

    static start(id) {
      this.setMode(id);
      this.mode.reset();
      this.setState("running");
      UI.toast("Clique no canvas para capturar o mouse.");
      UI.showHintCapture(true);
      AudioManager.ensure();
      UI.updateHUD(true);
      // tenta capturar lock imediatamente
      setTimeout(() => Input.requestPointerLock(), 50);
    }

    static pause(reason = "") {
      if (this.state !== "running") return;
      this.setState("paused");
      UI.showHintCapture(false);
      UI.updateHUD(false);
      if (reason) UI.toast(`Pausado: ${reason}`);
      // libera pointer lock (se possível)
      if (document.exitPointerLock) {
        try { document.exitPointerLock(); } catch (e) {}
      }
    }

    static resume() {
      if (this.state !== "paused") return;
      this.setState("running");
      UI.updateHUD(true);
      UI.showHintCapture(true);
      Input.requestPointerLock();
    }

    static restartSession() {
      if (!this.mode) return;
      if (this.state !== "running" && this.state !== "paused") return;
      this.mode.reset();
      this.setState("running");
      UI.updateHUD(true);
      UI.showHintCapture(true);
      UI.toast("Sessão reiniciada.");
      Input.requestPointerLock();
    }

    static endSession() {
      if (!this.mode) return;
      this.mode.finalize();
      Stats.recordRun(this.modeId, this.mode.stats, this.mode.durationMs);
      this.setState("results");
      UI.showHintCapture(false);
      UI.updateHUD(false);
      UI.renderResults();
      // libera lock
      if (document.exitPointerLock) {
        try { document.exitPointerLock(); } catch (e) {}
      }
    }

    static quitToLobby() {
      this.setState("lobby");
      UI.showHintCapture(false);
      UI.updateHUD(false);
      if (document.exitPointerLock) {
        try { document.exitPointerLock(); } catch (e) {}
      }
    }

    static quitToMenu() {
      this.setState("menu");
      UI.showHintCapture(false);
      UI.updateHUD(false);
      if (document.exitPointerLock) {
        try { document.exitPointerLock(); } catch (e) {}
      }
    }

    static loop = (tNow) => {
      const now = tNow;
      this.dt = Math.min(50, now - this.lastFrame);
      this.lastFrame = now;
      this.t = now;

      // fps
      this._fpsAcc += this.dt;
      this._fpsN++;
      if (now - this._fpsLast >= 500) {
        const avgDt = this._fpsAcc / Math.max(1, this._fpsN);
        this.fps = Math.round(1000 / Math.max(1, avgDt));
        this._fpsAcc = 0;
        this._fpsN = 0;
        this._fpsLast = now;
      }

      // update
      if (this.state === "running") {
        Input.update(this.dt);
        this.mode?.update?.(this.dt);
      } else if (this.state === "paused") {
        // ainda desenha fundo/partículas/crosshair
        Input.update(this.dt);
      } else {
        // menus: atualiza fundo animado para dar vida
        // (fundo move com day/night)
      }

      // render: sempre desenha background para ficar bonito mesmo em menus
      if (this.state === "running" || this.state === "paused") {
        this.mode?.render?.();
      } else {
        Renderer.drawBackground(this.dt);
        Renderer.updateParticles(this.dt);
        Renderer.drawCrosshair();
      }

      // HUD
      UI.tick();

      requestAnimationFrame(this.loop);
    };
  }

  /* =========================
     Stats persistence (Top10 + last 20)
     ========================= */
  class Stats {
    static KEY = "mc_aim_stats_v2";
    static data = Stats.load();

    static load() {
      try {
        const raw = localStorage.getItem(this.KEY);
        if (!raw) return { top: { osu: [], flick: [], tracking: [], switch: [], micro: [] }, sessions: [] };
        const p = JSON.parse(raw);
        return {
          top: { osu: p.top?.osu || [], flick: p.top?.flick || [], tracking: p.top?.tracking || [], switch: p.top?.switch || [], micro: p.top?.micro || [] },
          sessions: Array.isArray(p.sessions) ? p.sessions : []
        };
      } catch (e) {
        console.warn("Stats load failed:", e);
        return { top: { osu: [], flick: [], tracking: [], switch: [], micro: [] }, sessions: [] };
      }
    }

    static save() {
      try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) {}
    }

    static recordRun(modeId, stats, durationMs) {
      const n = Math.max(1, stats.hits + stats.misses);
      const acc = stats.hits / n;

      const avgRt = stats.rtSamples.length ? (stats.rtSamples.reduce((a,b)=>a+b,0)/stats.rtSamples.length) : NaN;
      const avgErr = stats.radialErrors.length ? (stats.radialErrors.reduce((a,b)=>a+b,0)/stats.radialErrors.length) : NaN;
      const on = stats.onTargetSamples.length ? (stats.onTargetSamples.reduce((a,b)=>a+b,0)/stats.onTargetSamples.length) : NaN;

      const entry = {
        modeId,
        t: Date.now(),
        score: Math.round(stats.score),
        acc,
        bestCombo: stats.bestCombo,
        avgRt,
        avgErr,
        onTarget: on,
        durationMs
      };

      // Top 10 por modo
      const arr = this.data.top[modeId] || [];
      arr.push(entry);
      arr.sort((a,b)=>b.score - a.score);
      this.data.top[modeId] = arr.slice(0, 10);

      // Last sessions
      this.data.sessions.unshift(entry);
      this.data.sessions = this.data.sessions.slice(0, 20);

      this.save();
    }

    static clearTop(modeId) {
      this.data.top[modeId] = [];
      this.save();
    }
  }

  /* =========================
     UI / DOM
     ========================= */
  class UI {
    static els = {};
    static toastEl = null;
    static toastTimer = 0;

    static init() {
      // cache elements
      const q = (id) => document.getElementById(id);
      this.els = {
        // screens
        menu: q("screen-menu"),
        lobby: q("screen-lobby"),
        settings: q("screen-settings"),
        stats: q("screen-stats"),
        pause: q("screen-pause"),
        results: q("screen-results"),
        hud: q("hud"),
        hint: q("hintCapture"),
        liveOverlay: q("liveOverlay"),

        // menu buttons
        btnPlay: q("btn-play"),
        btnSettings: q("btn-settings"),
        btnTrainings: q("btn-trainings"),
        btnStats: q("btn-stats"),

        // lobby
        btnLobbyBack: q("btn-lobby-back"),
        modeButtons: Array.from(document.querySelectorAll("[data-mode]")),
        modeHelp: q("mode-help"),
        modeCommon: q("mode-common"),
        seedInput: q("seed-input"),
        seedPreview: q("seed-preview"),
        btnSeedRandom: q("btn-seed-random"),
        diffPreview: q("difficulty-preview"),

        // settings buttons
        btnSettingsSave: q("btn-settings-save"),
        btnSettingsCancel: q("btn-settings-cancel"),
        btnSettingsReset: q("btn-settings-reset"),

        // settings inputs
        sensSlider: q("sens-slider"),
        sensValue: q("sens-value"),
        mcMode: q("mc-mode"),
        mcModeBox: q("mc-mode-box"),
        mcSensSlider: q("mc-sens-slider"),
        mcSensValue: q("mc-sens-value"),
        fovSlider: q("fov-slider"),
        fovValue: q("fov-value"),
        dpiInput: q("dpi-input"),
        degPerPx: q("deg-per-px"),
        degPerCount: q("deg-per-count"),
        cmPer360: q("cm-per-360"),
        edpi: q("edpi"),
        smoothSlider: q("smooth-slider"),
        smoothValue: q("smooth-value"),
        snapToggle: q("snap-toggle"),

        crossType: q("crosshair-type"),
        crossSize: q("crosshair-size"),
        crossSizeValue: q("crosshair-size-value"),
        crossColor: q("crosshair-color"),
        dayNightToggle: q("daynight-toggle"),
        dayNightSpeed: q("daynight-speed"),
        dayNightSpeedValue: q("daynight-speed-value"),
        particlesSlider: q("particles-slider"),
        particlesValue: q("particles-value"),
        volumeSlider: q("volume-slider"),
        volumeValue: q("volume-value"),
        difficultySelect: q("difficulty-select"),
        contrastToggle: q("contrast-toggle"),
        reduceParticlesToggle: q("reduce-particles-toggle"),
        colorblindToggle: q("colorblind-toggle"),
        tipsToggle: q("tips-toggle"),

        // stats
        statsModeSelect: q("stats-mode-select"),
        statsTop10: q("stats-top10"),
        statsSessions: q("stats-sessions"),
        btnStatsBack: q("btn-stats-back"),
        btnStatsClear: q("btn-stats-clear"),

        // pause
        btnResume: q("btn-resume"),
        btnCapture: q("btn-capture"),
        btnRestart: q("btn-restart"),
        btnQuit: q("btn-quit"),

        // live overlay
        btnLiveClose: q("btn-live-close"),
        liveMetrics: q("live-metrics"),
        liveTips: q("live-tips"),

        // results
        resScore: q("res-score"),
        resAcc: q("res-acc"),
        resCombo: q("res-combo"),
        resRt: q("res-rt"),
        resDiagnosis: q("res-diagnosis"),
        resSuggestions: q("res-suggestions"),
        btnResultsRetry: q("btn-results-retry"),
        btnResultsLobby: q("btn-results-lobby"),
        btnResultsBack: q("btn-results-back"),
        chartAcc: q("chart-acc"),
        chartRt: q("chart-rt"),
        chartHist: q("chart-hist"),
        chartHeat: q("chart-heat"),

        // hud values
        hudFps: q("hud-fps"),
        hudTime: q("hud-time"),
        hudMode: q("hud-mode"),
        hudScore: q("hud-score"),
        hudCombo: q("hud-combo"),
        hudAcc: q("hud-acc"),
        hudHM: q("hud-hm"),
        hudRT: q("hud-rt"),
      };

      // toast small element (on hint area)
      this.toastEl = document.createElement("div");
      this.toastEl.style.position = "absolute";
      this.toastEl.style.left = "50%";
      this.toastEl.style.top = "14px";
      this.toastEl.style.transform = "translateX(-50%)";
      this.toastEl.style.background = "rgba(0,0,0,.55)";
      this.toastEl.style.border = "1px solid rgba(255,255,255,.12)";
      this.toastEl.style.padding = "8px 12px";
      this.toastEl.style.borderRadius = "10px";
      this.toastEl.style.fontSize = "12px";
      this.toastEl.style.pointerEvents = "none";
      this.toastEl.style.opacity = "0";
      this.toastEl.style.transition = "opacity .15s ease";
      document.getElementById("uiLayer").appendChild(this.toastEl);

      // Bind UI actions
      this.els.btnPlay.addEventListener("click", () => { Game.setState("lobby"); });
      this.els.btnTrainings.addEventListener("click", () => { Game.setState("lobby"); });
      this.els.btnSettings.addEventListener("click", () => { this.openSettings(); });
      this.els.btnStats.addEventListener("click", () => { this.openStats(); });

      this.els.btnLobbyBack.addEventListener("click", () => { Game.quitToMenu(); });

      for (const b of this.els.modeButtons) {
        b.addEventListener("click", () => {
          const id = b.getAttribute("data-mode");
          this.selectMode(id);
          Game.startSelectedMode();
        });
      }

      this.els.seedInput.addEventListener("input", () => {
        ConfigManager.cfg.seed = this.els.seedInput.value.trim();
        ConfigManager.save(ConfigManager.cfg);
        this.updateSeedPreview();
      });
      this.els.btnSeedRandom.addEventListener("click", () => {
        const seed = `seed-${Math.floor(Math.random() * 1e9).toString(16)}`;
        this.els.seedInput.value = seed;
        ConfigManager.cfg.seed = seed;
        ConfigManager.save(ConfigManager.cfg);
        this.updateSeedPreview();
        this.toast("Seed gerada.");
      });

      // pause
      this.els.btnResume.addEventListener("click", () => this.resumeFromPause());
      this.els.btnCapture.addEventListener("click", () => Input.requestPointerLock());
      this.els.btnRestart.addEventListener("click", () => Game.restartSession());
      this.els.btnQuit.addEventListener("click", () => Game.quitToLobby());

      // live overlay
      this.els.btnLiveClose.addEventListener("click", () => this.toggleLiveOverlay(false));

      // results
      this.els.btnResultsRetry.addEventListener("click", () => { Game.startSelectedMode(); });
      this.els.btnResultsLobby.addEventListener("click", () => { Game.quitToLobby(); });
      this.els.btnResultsBack.addEventListener("click", () => { Game.quitToMenu(); });

      // stats
      this.els.btnStatsBack.addEventListener("click", () => { Game.quitToMenu(); });
      this.els.btnStatsClear.addEventListener("click", () => {
        const modeId = this.els.statsModeSelect.value;
        Stats.clearTop(modeId);
        this.renderStats();
        this.toast("Top 10 limpo.");
      });
      this.els.statsModeSelect.addEventListener("change", () => this.renderStats());

      // apply initial cfg
      ConfigManager.applyDocumentFlags(ConfigManager.cfg);

      this.wireSettings();
      this.updateSeedPreview();
      this.updateDifficultyPreview();
      this.updateLobbyHelp();
      this.syncScreens();

      // pointer lock supported warning
      if (!document.body.requestPointerLock && !document.documentElement.requestPointerLock) {
        this.toast("Aviso: Pointer Lock pode não estar disponível neste navegador.");
      }
    }

    static toast(msg, ms = 1300) {
      this.toastEl.textContent = msg;
      this.toastEl.style.opacity = "1";
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.toastEl.style.opacity = "0";
      }, ms);
    }

    static showHintCapture(show) {
      this.els.hint.classList.toggle("hidden", !show);
    }

    static syncScreens() {
      const st = Game.state;
      const show = (el, ok) => el.classList.toggle("hidden", !ok);

      show(this.els.menu, st === "menu");
      show(this.els.lobby, st === "lobby");
      show(this.els.settings, st === "settings");
      show(this.els.stats, st === "stats");
      show(this.els.pause, st === "paused");
      show(this.els.results, st === "results");
      show(this.els.hud, st === "running");

      // overlay live: só mostra se ativo
      // (mantém estado no atributo)
      if (st !== "running" && st !== "paused") {
        this.toggleLiveOverlay(false);
      }

      if (st === "lobby") {
        this.updateLobbyHelp();
        this.updateSeedPreview();
        this.updateDifficultyPreview();
      }
      if (st === "stats") this.renderStats();
    }

    static updateHUD(show) {
      // show handled by syncScreens
      if (!show) return;
      this.els.hudMode.textContent = MODE_INFO[Game.modeId].name;
    }

    static tick() {
      // HUD update at ~10Hz
      if ((Game.t % 100) < Game.dt) {
        if (Game.state === "running") {
          const m = Game.mode;
          const st = m?.stats;
          if (!st) return;
          const total = Math.max(1, st.hits + st.misses);
          const acc = st.hits / total;
          this.els.hudFps.textContent = String(Game.fps);
          this.els.hudTime.textContent = Utils.fmtTime((Game.t - m.sessionStart) / 1000);
          this.els.hudScore.textContent = String(Math.round(st.score));
          this.els.hudCombo.textContent = String(st.combo);
          this.els.hudAcc.textContent = `${(acc * 100).toFixed(1)}%`;
          this.els.hudHM.textContent = `${st.hits}/${st.misses}`;
          const avgRt = st.rtSamples.length ? (st.rtSamples.reduce((a,b)=>a+b,0)/st.rtSamples.length) : NaN;
          this.els.hudRT.textContent = Utils.fmtMs(avgRt);

          // Live overlay (TAB)
          if (!this.els.liveOverlay.classList.contains("hidden")) {
            this.renderLiveOverlay();
          }
        } else if (Game.state === "paused") {
          if (!this.els.liveOverlay.classList.contains("hidden")) {
            this.renderLiveOverlay();
          }
        }
      }
    }

    static renderLiveOverlay() {
      const m = Game.mode;
      if (!m) return;
      const st = m.stats;
      const total = Math.max(1, st.hits + st.misses);
      const acc = st.hits / total;
      const avgRt = st.rtSamples.length ? (st.rtSamples.reduce((a,b)=>a+b,0)/st.rtSamples.length) : NaN;
      const avgErr = st.radialErrors.length ? (st.radialErrors.reduce((a,b)=>a+b,0)/st.radialErrors.length) : NaN;
      const biasMag = Math.hypot(st.bias.x, st.bias.y);
      const on = st.onTargetSamples.length ? (st.onTargetSamples.reduce((a,b)=>a+b,0)/st.onTargetSamples.length) : NaN;

      this.els.liveMetrics.innerHTML = [
        `<b>Score:</b> ${Math.round(st.score)}`,
        `<b>Acc:</b> ${(acc*100).toFixed(1)}%`,
        `<b>Hits/Misses:</b> ${st.hits}/${st.misses}`,
        `<b>Combo:</b> ${st.combo} (best ${st.bestCombo})`,
        `<b>RT médio:</b> ${Utils.fmtMs(avgRt)}`,
        `<b>Erro médio:</b> ${isFinite(avgErr)?avgErr.toFixed(1)+"px":"—"}`,
        m.id === "tracking" ? `<b>On-target:</b> ${(on*100).toFixed(1)}%` : `<b>On-target:</b> —`,
        `<b>Bias mag:</b> ${biasMag.toFixed(1)}px`,
        `<b>Jitter:</b> ${st.jitter.toFixed(2)}`
      ].join("<br/>");

      if (!ConfigManager.cfg.showTips) {
        this.els.liveTips.innerHTML = `<span class="mc-dim">Dicas desativadas nas configurações.</span>`;
        return;
      }

      const tips = [];
      if (acc < 0.60) tips.push("Acurácia baixa: reduza dificuldade e faça movimentos mais curtos/decididos.");
      if (isFinite(avgRt) && avgRt > 420) tips.push("RT alto: aumente ritmo gradualmente; treine OSU timing 5–10 min.");
      if (st.jitter > 2.6) tips.push("Jitter alto: tente smoothing 0.10–0.20 e relaxe a mão.");
      if (biasMag > 12) tips.push("Bias: você para fora do centro. Tente focar no “freio” final do flick.");
      if (m.id === "flick" && (st.overshoot + st.undershoot) > 4) tips.push(`Flick: overshoot=${st.overshoot}, undershoot=${st.undershoot}. Ajuste sens conforme padrão.`);

      if (!tips.length) tips.push("Sem alerta forte — continue e aumente a dificuldade quando estiver consistente.");

      this.els.liveTips.innerHTML = tips.map(t => `• ${t}`).join("<br/>");
    }

    static toggleLiveOverlay(force) {
      const el = this.els.liveOverlay;
      const isHidden = el.classList.contains("hidden");
      const want = (typeof force === "boolean") ? force : isHidden;
      el.classList.toggle("hidden", !want);
    }

    static resumeFromPause() {
      // Não auto-captura se usuário quiser só fechar pause; aqui retomamos o jogo.
      Game.resume();
    }

    static toggleFullscreen() {
      const doc = document;
      const el = document.documentElement;
      const isFull = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
      if (!isFull) {
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) req.call(el);
        else this.toast("Fullscreen não suportado.");
      } else {
        const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
        if (exit) exit.call(doc);
      }
    }

    static selectMode(id) {
      Game.setMode(id);
      this.updateLobbyHelp();
    }

    static updateLobbyHelp() {
      const el = this.els || {};
      if (!el.modeHelp || !el.modeCommon) return;
      const info = MODE_INFO[Game.modeId] || MODE_INFO.osu;
      el.modeHelp.innerHTML = `<b>${info.name}:</b> ${info.what}<br/><span class="mc-dim">${info.how}</span>`;
      el.modeCommon.textContent = info.common || "";
    }

    static updateSeedPreview() {
      const s = (ConfigManager.cfg.seed || "").trim();
      this.els.seedPreview.textContent = s ? s : "auto";
    }

    static updateDifficultyPreview() {
      this.els.diffPreview.textContent = (ConfigManager.cfg.difficulty || "normal");
    }

    static openSettings() {
      ConfigManager.startDraft();
      this.fillSettingsFromDraft();
      Game.setState("settings");
    }

    static fillSettingsFromDraft() {
      const cfg = ConfigManager.draft || ConfigManager.cfg;

      // sliders/toggles
      this.els.sensSlider.value = cfg.sens;
      this.els.sensValue.textContent = Number(cfg.sens).toFixed(1);

      this.els.mcMode.checked = !!cfg.useMinecraft;
      this.els.mcModeBox.style.display = cfg.useMinecraft ? "block" : "none";

      this.els.mcSensSlider.value = cfg.mcSensPercent;
      this.els.mcSensValue.textContent = `${cfg.mcSensPercent}%`;

      this.els.fovSlider.value = cfg.fov;
      this.els.fovValue.textContent = `${cfg.fov}`;

      this.els.dpiInput.value = cfg.dpi || "";

      this.els.smoothSlider.value = cfg.smoothing;
      this.els.smoothValue.textContent = Number(cfg.smoothing).toFixed(2);

      this.els.snapToggle.checked = !!cfg.snapPixels;

      this.els.crossType.value = cfg.crosshairType;
      this.els.crossSize.value = cfg.crosshairSize;
      this.els.crossSizeValue.textContent = String(cfg.crosshairSize);
      this.els.crossColor.value = cfg.crosshairColor;

      this.els.dayNightToggle.checked = !!cfg.dayNight;
      this.els.dayNightSpeed.value = cfg.dayNightSpeed;
      this.els.dayNightSpeedValue.textContent = Number(cfg.dayNightSpeed).toFixed(1);

      this.els.particlesSlider.value = cfg.particles;
      this.els.particlesValue.textContent = String(cfg.particles);

      this.els.volumeSlider.value = Math.round(cfg.volume * 100);
      this.els.volumeValue.textContent = `${Math.round(cfg.volume * 100)}%`;

      this.els.difficultySelect.value = cfg.difficulty;

      this.els.contrastToggle.checked = !!cfg.highContrast;
      this.els.reduceParticlesToggle.checked = !!cfg.reduceParticles;
      this.els.colorblindToggle.checked = !!cfg.colorblind;
      this.els.tipsToggle.checked = !!cfg.showTips;

      this.renderDerivedMinecraft(cfg);
    }

    static wireSettings() {
      const el = this.els;
      const setDraft = (patch) => {
        if (!ConfigManager.draft) ConfigManager.startDraft();
        Object.assign(ConfigManager.draft, patch);
      };

      // generic binding helpers
      el.sensSlider.addEventListener("input", () => {
        const v = Number(el.sensSlider.value);
        el.sensValue.textContent = v.toFixed(1);
        setDraft({ sens: v });
      });

      el.mcMode.addEventListener("change", () => {
        const v = !!el.mcMode.checked;
        el.mcModeBox.style.display = v ? "block" : "none";
        setDraft({ useMinecraft: v });
        this.renderDerivedMinecraft(ConfigManager.draft);
      });

      el.mcSensSlider.addEventListener("input", () => {
        const v = Number(el.mcSensSlider.value);
        el.mcSensValue.textContent = `${v}%`;
        setDraft({ mcSensPercent: v });
        this.renderDerivedMinecraft(ConfigManager.draft);
      });

      el.fovSlider.addEventListener("input", () => {
        const v = Number(el.fovSlider.value);
        el.fovValue.textContent = `${v}`;
        setDraft({ fov: v });
        this.renderDerivedMinecraft(ConfigManager.draft);
      });

      el.dpiInput.addEventListener("input", () => {
        const v = Number(el.dpiInput.value || 0);
        setDraft({ dpi: v });
        this.renderDerivedMinecraft(ConfigManager.draft);
      });

      el.smoothSlider.addEventListener("input", () => {
        const v = Number(el.smoothSlider.value);
        el.smoothValue.textContent = v.toFixed(2);
        setDraft({ smoothing: v });
      });

      el.snapToggle.addEventListener("change", () => {
        setDraft({ snapPixels: !!el.snapToggle.checked });
      });

      el.crossType.addEventListener("change", () => setDraft({ crosshairType: el.crossType.value }));
      el.crossSize.addEventListener("input", () => {
        const v = Number(el.crossSize.value);
        el.crossSizeValue.textContent = String(v);
        setDraft({ crosshairSize: v });
      });
      el.crossColor.addEventListener("input", () => setDraft({ crosshairColor: el.crossColor.value }));

      el.dayNightToggle.addEventListener("change", () => setDraft({ dayNight: !!el.dayNightToggle.checked }));
      el.dayNightSpeed.addEventListener("input", () => {
        const v = Number(el.dayNightSpeed.value);
        el.dayNightSpeedValue.textContent = v.toFixed(1);
        setDraft({ dayNightSpeed: v });
      });

      el.particlesSlider.addEventListener("input", () => {
        const v = Number(el.particlesSlider.value);
        el.particlesValue.textContent = String(v);
        setDraft({ particles: v });
      });

      el.volumeSlider.addEventListener("input", () => {
        const v = Number(el.volumeSlider.value) / 100;
        el.volumeValue.textContent = `${Math.round(v * 100)}%`;
        setDraft({ volume: v });
        AudioManager.setVolume(v); // preview
      });

      el.difficultySelect.addEventListener("change", () => {
        setDraft({ difficulty: el.difficultySelect.value });
      });

      el.contrastToggle.addEventListener("change", () => setDraft({ highContrast: !!el.contrastToggle.checked }));
      el.reduceParticlesToggle.addEventListener("change", () => setDraft({ reduceParticles: !!el.reduceParticlesToggle.checked }));
      el.colorblindToggle.addEventListener("change", () => setDraft({ colorblind: !!el.colorblindToggle.checked }));
      el.tipsToggle.addEventListener("change", () => setDraft({ showTips: !!el.tipsToggle.checked }));

      // Save/Cancel/Reset
      el.btnSettingsSave.addEventListener("click", () => {
        ConfigManager.commitDraft();
        AudioManager.setVolume(ConfigManager.cfg.volume);
        this.updateDifficultyPreview();
        this.toast("Configurações salvas.");
        Game.quitToMenu();
      });

      el.btnSettingsCancel.addEventListener("click", () => {
        ConfigManager.cancelDraft();
        AudioManager.setVolume(ConfigManager.cfg.volume);
        this.toast("Alterações canceladas.");
        Game.quitToMenu();
      });

      el.btnSettingsReset.addEventListener("click", () => {
        ConfigManager.draft = Utils.clone(DEFAULT_CONFIG);
        this.fillSettingsFromDraft();
        this.toast("Reset aplicado (ainda não salvo).");
      });
    }

    static renderDerivedMinecraft(cfg) {
      if (!cfg) cfg = ConfigManager.cfg;
      const d = Scoring.getMinecraftDegreesPerPixel(cfg);
      this.els.degPerPx.textContent = isFinite(d.degPerPixel) ? d.degPerPixel.toFixed(4) : "—";
      this.els.degPerCount.textContent = isFinite(d.degPerCount) ? d.degPerCount.toFixed(4) : "—";
      this.els.cmPer360.textContent = isFinite(d.cmPer360) ? d.cmPer360.toFixed(1) : "—";
      this.els.edpi.textContent = isFinite(d.eDpi) ? d.eDpi.toFixed(0) : "—";
    }

    static openStats() {
      Game.setState("stats");
      this.renderStats();
    }

    static renderStats() {
      const modeId = this.els.statsModeSelect.value;
      const top = Stats.data.top[modeId] || [];
      const sessions = Stats.data.sessions || [];

      this.els.statsTop10.innerHTML = top.map((e) => {
        const dt = new Date(e.t);
        const date = `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}`;
        const extra = e.modeId === "tracking"
          ? `on ${(e.onTarget*100).toFixed(1)}%`
          : `rt ${Utils.fmtMs(e.avgRt)} err ${isFinite(e.avgErr)?e.avgErr.toFixed(1)+"px":"—"}`;
        return `<li><b>${e.score}</b> — acc ${(e.acc*100).toFixed(1)}% • combo ${e.bestCombo} • ${extra}<br/><span class="mc-dim">${date}</span></li>`;
      }).join("") || `<li class="mc-dim">Sem runs ainda. Jogue um pouco :)</li>`;

      this.els.statsSessions.innerHTML = sessions.map((e) => {
        const dt = new Date(e.t);
        const date = `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}`;
        return `<div class="mc-panel-inset">
          <div class="mc-row mc-row--between">
            <b>${MODE_INFO[e.modeId].name}</b>
            <span class="mc-badge">${e.score}</span>
          </div>
          <div class="mc-dim">acc ${(e.acc*100).toFixed(1)}% • combo ${e.bestCombo} • ${date}</div>
        </div>`;
      }).join("") || `<div class="mc-dim">Sem sessões ainda.</div>`;
    }

    static renderResults() {
      const m = Game.mode;
      if (!m) return;
      const st = m.stats;
      const n = Math.max(1, st.hits + st.misses);
      const acc = st.hits / n;
      const avgRt = st.rtSamples.length ? (st.rtSamples.reduce((a,b)=>a+b,0)/st.rtSamples.length) : NaN;

      this.els.resScore.textContent = String(Math.round(st.score));
      this.els.resAcc.textContent = `${(acc*100).toFixed(1)}%`;
      this.els.resCombo.textContent = String(st.bestCombo);
      this.els.resRt.textContent = Utils.fmtMs(avgRt);

      this.els.resDiagnosis.innerHTML = m.diagnose();

      const sug = m.suggestions();
      this.els.resSuggestions.innerHTML = sug.map(s => `<li>${s}</li>`).join("");

      // Gráficos
      Charts.drawLine(this.els.chartAcc, st.accSamples, 0, 1, "acc");
      Charts.drawLine(this.els.chartRt, st.rtSamples, 0, Math.max(200, Math.max(...st.rtSamples, 300)), "rt");
      Charts.drawHistogram(this.els.chartHist, st.radialErrors, 14);
      Charts.drawHeatmap(this.els.chartHeat, st.heat, st.heatW, st.heatH);
    }
  }

  /* =========================
     Charts (Canvas 2D)
     ========================= */
  class Charts {
    static setupCanvas(c) {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const rect = c.getBoundingClientRect();
      c.width = Math.floor(rect.width * dpr);
      c.height = Math.floor(rect.height * dpr);
      const ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      return ctx;
    }

    static drawLine(canvas, samples, yMin, yMax, kind = "acc") {
      const ctx = this.setupCanvas(canvas);
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0,0,w,h);

      // background grid
      ctx.fillStyle = "rgba(0,0,0,.18)";
      ctx.fillRect(0,0,w,h);
      ctx.strokeStyle = "rgba(255,255,255,.08)";
      for (let i=1;i<5;i++){
        const y = Math.floor(h * (i/5));
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
      }

      if (!samples || samples.length < 2) return;

      const pad = 10;
      const sx = (w - pad*2) / Math.max(1, samples.length-1);
      ctx.strokeStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = 2;

      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const v = samples[i];
        const t = Utils.clamp((v - yMin) / Math.max(1e-6, (yMax - yMin)), 0, 1);
        const x = pad + i * sx;
        const y = pad + (1 - t) * (h - pad*2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // last value text
      const last = samples[samples.length - 1];
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.font = `${Math.floor(h*0.16)}px ui-monospace, monospace`;
      const label = kind === "acc" ? `${Math.round(last*100)}%` : `${Math.round(last)}ms`;
      ctx.fillText(label, 10, Math.floor(h*0.22));
    }

    static drawHistogram(canvas, values, bins = 12) {
      const ctx = this.setupCanvas(canvas);
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0,0,w,h);
      ctx.fillStyle = "rgba(0,0,0,.18)";
      ctx.fillRect(0,0,w,h);

      if (!values || values.length === 0) return;

      const maxV = Math.max(...values, 1);
      const hist = new Array(bins).fill(0);
      for (const v of values) {
        const t = Utils.clamp(v / maxV, 0, 0.9999);
        const i = Math.floor(t * bins);
        hist[i]++;
      }
      const maxC = Math.max(...hist, 1);

      const pad = 10;
      const barW = (w - pad*2) / bins;
      for (let i = 0; i < bins; i++) {
        const x = pad + i * barW;
        const bh = (hist[i] / maxC) * (h - pad*2);
        ctx.fillStyle = "rgba(255,255,255,.82)";
        ctx.fillRect(Math.floor(x), Math.floor(h - pad - bh), Math.max(1, Math.floor(barW - 2)), Math.floor(bh));
      }

      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.font = `${Math.floor(h*0.14)}px ui-monospace, monospace`;
      ctx.fillText(`max ${maxV.toFixed(1)}px`, 10, Math.floor(h*0.22));
    }

    static drawHeatmap(canvas, heat, gw, gh) {
      const ctx = this.setupCanvas(canvas);
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0,0,w,h);
      ctx.fillStyle = "rgba(0,0,0,.18)";
      ctx.fillRect(0,0,w,h);

      if (!heat || heat.length === 0) return;
      let max = 0;
      for (let i = 0; i < heat.length; i++) max = Math.max(max, heat[i]);
      if (max <= 0) return;

      const cellW = w / gw;
      const cellH = h / gh;

      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const v = heat[y * gw + x] / max;
          if (v <= 0) continue;
          // cor: branco -> amarelo -> vermelho (sem usar libs)
          const r = Math.round(255 * Utils.clamp(v * 1.2, 0, 1));
          const g = Math.round(200 * Utils.clamp(v * 0.9, 0, 1));
          const b = Math.round(90 * Utils.clamp(1 - v, 0, 1));
          ctx.fillStyle = `rgba(${r},${g},${b},${0.75 * v})`;
          ctx.fillRect(Math.floor(x * cellW), Math.floor(y * cellH), Math.ceil(cellW), Math.ceil(cellH));
        }
      }

      // grid
      ctx.strokeStyle = "rgba(255,255,255,.08)";
      for (let x = 1; x < gw; x++) {
        const xx = Math.floor(x * cellW);
        ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, h); ctx.stroke();
      }
      for (let y = 1; y < gh; y++) {
        const yy = Math.floor(y * cellH);
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
      }

      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.font = `${Math.floor(h*0.14)}px ui-monospace, monospace`;
      ctx.fillText("heat", 10, Math.floor(h*0.22));
    }
  }

  /* =========================
     Boot
     ========================= */
  window.addEventListener("DOMContentLoaded", () => {
    Game.init();

    // Estado inicial
    Game.setState("menu");

    // Botão "Jogar" leva ao lobby (não inicia automaticamente)
    // Início da sessão: clique em um modo no lobby
  });

  /* ============================================================
     Manual Test Checklist (verificar ao abrir index.html offline)
     ============================================================

  1) Abrir index.html (offline) e ver menu e fundo animado (dia/noite).
  2) Clicar "Jogar" -> entrar no Lobby.
  3) No Lobby, clicar em um modo -> inicia sessão e tenta Pointer Lock.
  4) Se Pointer Lock disponível: mouse não sai da tela; mira se move pelo delta do mouse.
  5) Pressionar ESC durante jogo -> pausa e libera mouse (sempre; e pausa também ao perder lock).
  6) No Pause: clicar "Continuar" -> volta e recaptura Pointer Lock.
  7) Pressionar F -> alternar fullscreen.
  8) Pressionar TAB -> abrir/fechar overlay de métricas ao vivo.
  9) Pressionar R -> reiniciar sessão.
 10) Terminar sessão por tempo -> tela de Resultados aparece com diagnóstico + 4 gráficos.
 11) Em Configurações: alterar sens/smoothing/crosshair/dificuldade -> Salvar; voltar ao menu sem bug.
 12) Cancelar em Configurações -> descarta alterações (não muda sens).
 13) Estatísticas: abrir e ver Top 10/Últimas sessões; limpar Top 10 do modo.
 14) Reduzir partículas/alto contraste/daltonismo -> efeito visível; FPS não cai drasticamente.
 15) Resize da janela (ou F fullscreen) -> HUD e canvas continuam consistentes.
 16) Sem Pointer Lock: aviso e fallback (mira segue cursor dentro do canvas).

  ============================================================ */
})();