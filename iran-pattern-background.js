(() => {
  'use strict';

  const DEFAULT_CONFIG = {
    patternType: 'girih',
    configPreset: 'custom',
    complexity: 'balanced',
    quality: 'balanced',
    fieldLayout: 'diamond',
    gridPhase: 0,
    mainSides: 12,
    fillMode: 'none',
    animationPreset: 'none',
    metaMode: false,
    curve: 100,
    fillOpacity: 0,
    patternOpacity: 100,
    lineWeight: 130,
    tileScale: 120,
    maxTiles: 144,
    overscan: 130,
    ornamentScale: 100,
    haloSpread: 130,
    mandalaDepth: 145,
    connectorTension: 100,
    detailDensity: 100,
    glow: 0,
    backgroundSubtlety: 0.28,
    transitionMs: 900
  };

  const DEFAULT_PALETTE = {
    label: 'Midnight Turquoise Gold',
    bg: '#071a2c',
    line: '#f8eccd',
    accent: '#2fc4b8',
    gold: '#ddab52'
  };

  const CATEGORY_FIELDS = {
    dynasty: 'selectedDynasty',
    goldenAge: 'goldenAge',
    darkAge: 'darkAge',
    religion: 'religion',
    foreignRule: 'foreignRule'
  };

  const OVERLAY_WEIGHTS = {
    religion: 0.25,
    goldenAge: 0.38,
    darkAge: 0.48,
    foreignRule: 0.48
  };

  const paletteAliases = {
    achaemenid: 'achaemenidEmpire',
    sasanian: 'sasanianEmpire',
    safavid: 'safavidEmpire',
    assyrioBabylonian: 'assyroBabylonianControl',
    parthianArsacidEmpire: 'parthianEmpire',
    seleucidEmpireInIran: 'seleucidEmpireInIran',
    abbasidCaliphateDirectControl: 'abbasidCaliphate',
    tahiridEmirateKhorasan: 'tahiridEmirate',
    hotakAfghanOccupation: 'hotakOccupation',
    timuridAndTurkmenRule: 'timuridTurkmenRule',
    twelverShia: 'twelverShiaIslam',
    shiaIslam: 'twelverShiaIslam'
  };

  const layer = document.getElementById('iranPatternBackground');
  const canvas = document.getElementById('iranPatternCanvas');
  if (!layer || !canvas) return;

  const ctx = canvas.getContext('2d');
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = 300;
  tileCanvas.height = 300;
  const tileCtx = tileCanvas.getContext('2d');

  const state = {
    config: { ...DEFAULT_CONFIG },
    initialConfig: { ...DEFAULT_CONFIG },
    paletteMap: {
      dynasty: {},
      goldenAge: {},
      darkAge: {},
      religion: {},
      foreignRule: {}
    },
    appState: {},
    devOverrides: {
      dynasty: '',
      goldenAge: '',
      darkAge: '',
      religion: '',
      foreignRule: ''
    },
    currentPalette: { ...DEFAULT_PALETTE },
    targetPalette: { ...DEFAULT_PALETTE },
    transitionFrom: { ...DEFAULT_PALETTE },
    transitionStart: 0,
    transitionActive: false,
    animationEnabled: false,
    animationFrame: 0,
    resolvedTheme: 'default: midnight',
    subdued: false,
    devUnlocked: false
  };

  let devKeyBuffer = '';
  let devButton = null;
  let devPanel = null;
  let resolvedThemeEl = null;
  let paletteChipsEl = null;
  let renderRequested = false;
  let lastCanvasWidth = 0;
  let lastCanvasHeight = 0;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeKey(label) {
    return String(label || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, 'and')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part, index) => index === 0
        ? part.toLowerCase()
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('');
  }

  function hexToRgb(hex) {
    const safeHex = String(hex || '#000000').replace('#', '');
    const value = parseInt(safeHex.length === 3
      ? safeHex.split('').map((part) => part + part).join('')
      : safeHex, 16);
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255
    };
  }

  function rgbToHex({ r, g, b }) {
    const part = (value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
    return `#${part(r)}${part(g)}${part(b)}`;
  }

  function rgba(hex, alpha) {
    const color = hexToRgb(hex);
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
  }

  function mixHex(from, to, amount) {
    const a = hexToRgb(from);
    const b = hexToRgb(to);
    return rgbToHex({
      r: a.r + (b.r - a.r) * amount,
      g: a.g + (b.g - a.g) * amount,
      b: a.b + (b.b - a.b) * amount
    });
  }

  function mixPalettes(from, to, amount) {
    if (!to) return { ...from };
    return {
      label: to.label || from.label,
      bg: mixHex(from.bg, to.bg, amount),
      line: mixHex(from.line, to.line, amount),
      accent: mixHex(from.accent, to.accent, amount),
      gold: mixHex(from.gold, to.gold, amount)
    };
  }

  function easeOutCubic(amount) {
    return 1 - Math.pow(1 - amount, 3);
  }

  function samePalette(a, b) {
    return ['bg', 'line', 'accent', 'gold'].every((key) => a[key] === b[key]);
  }

  function lookupPalette(category, label) {
    const collection = state.paletteMap[category] || {};
    const normalized = normalizeKey(label);
    if (!normalized) return null;
    const alias = paletteAliases[normalized] || normalized;
    const key = collection[normalized] ? normalized : (collection[alias] ? alias : '');
    if (key) return { key, palette: collection[key] };
    const fuzzyKey = Object.keys(collection).find((candidate) =>
      candidate.includes(normalized) || normalized.includes(candidate)
    );
    return fuzzyKey ? { key: fuzzyKey, palette: collection[fuzzyKey] } : null;
  }

  function resolveActiveHistoryTheme(appState = {}) {
    const resolved = [];
    const selectedDynasty = state.devOverrides.dynasty || appState.selectedDynasty;
    const base = lookupPalette('dynasty', selectedDynasty);
    let target = base ? { ...base.palette } : { ...DEFAULT_PALETTE };
    if (base) resolved.push(`dynasty: ${base.key}`);
    else resolved.push('default: midnight');

    ['religion', 'goldenAge', 'darkAge', 'foreignRule'].forEach((category) => {
      const field = CATEGORY_FIELDS[category];
      const label = state.devOverrides[category] || appState[field];
      const match = lookupPalette(category, label);
      if (!match) return;
      target = mixPalettes(target, match.palette, OVERLAY_WEIGHTS[category]);
      resolved.push(`${category}: ${match.key}`);
    });

    state.subdued = Boolean(
      state.devOverrides.darkAge ||
      state.devOverrides.foreignRule ||
      appState.darkAge ||
      appState.foreignRule
    );
    state.resolvedTheme = resolved.join(' + ');
    return target;
  }

  function transitionToPalette(palette) {
    if (!palette || samePalette(palette, state.targetPalette)) {
      updateDevStatus();
      return;
    }
    state.transitionFrom = { ...state.currentPalette };
    state.targetPalette = { ...palette };
    state.transitionStart = performance.now();
    state.transitionActive = true;
    requestRender();
    updateDevStatus();
  }

  function setFromHistoryState(appState = {}) {
    state.appState = { ...appState };
    transitionToPalette(resolveActiveHistoryTheme(state.appState));
  }

  function setThemeByLabel(label, category = 'dynasty') {
    const match = lookupPalette(category, label);
    if (!match) return false;
    state.devOverrides[category] = match.key;
    transitionToPalette(resolveActiveHistoryTheme(state.appState));
    syncDevInputs();
    return true;
  }

  function setPalette(palette) {
    transitionToPalette({ ...DEFAULT_PALETTE, ...palette });
  }

  function point(cx, cy, radius, angle) {
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  }

  function polygon(cx, cy, radius, sides, rotation = 0) {
    return Array.from({ length: sides }, (_, index) =>
      point(cx, cy, radius, rotation + index * Math.PI * 2 / sides)
    );
  }

  function star(cx, cy, outer, inner, sides, rotation = 0) {
    return Array.from({ length: sides * 2 }, (_, index) =>
      point(cx, cy, index % 2 ? inner : outer, rotation + index * Math.PI / sides)
    );
  }

  function drawShape(points, stroke, width, fill = null, close = true) {
    if (!points.length) return;
    tileCtx.beginPath();
    tileCtx.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(([x, y]) => tileCtx.lineTo(x, y));
    if (close) tileCtx.closePath();
    if (fill && state.config.fillMode !== 'none') {
      tileCtx.fillStyle = fill;
      tileCtx.fill();
    }
    tileCtx.strokeStyle = stroke;
    tileCtx.lineWidth = width * state.config.lineWeight / 100;
    tileCtx.stroke();
  }

  function drawLine(points, stroke, width) {
    drawShape(points, stroke, width, null, false);
  }

  function makeTilePalette(palette) {
    return {
      line: rgba(palette.line, 0.72),
      soft: rgba(palette.line, 0.26),
      faint: rgba(palette.line, 0.14),
      accent: rgba(palette.accent, 0.32),
      gold: rgba(palette.gold, 0.30),
      shadow: 'rgba(0, 0, 0, 0.24)'
    };
  }

  function drawMandala(palette, cx, cy, options = {}) {
    const sides = state.config.mainSides;
    const outer = options.outer || 78;
    const inner = (options.inner || 59) * state.config.mandalaDepth / 100;
    const rotation = options.rotation == null ? -Math.PI / 2 : options.rotation;
    const coreScale = options.coreScale || 0.2;
    const heavy = options.heavy !== false;
    const outerStar = star(cx, cy, outer, inner, sides, rotation);
    const midStar = star(cx, cy, outer * 0.76, inner * 0.76, sides, rotation);
    const innerStar = star(cx, cy, outer * 0.43, inner * 0.43, sides, rotation);
    const ring = polygon(cx, cy, outer * 0.57, sides, rotation + Math.PI / sides);
    if (heavy) drawShape(outerStar, palette.shadow, 2.45);
    drawShape(outerStar, heavy ? palette.accent : palette.gold, 1.3);
    drawShape(midStar, palette.line, 1);
    drawShape(ring, palette.soft, 0.72);
    drawShape(innerStar, palette.gold, 1.14);
    drawShape(star(cx, cy, outer * coreScale, inner * coreScale, sides, rotation), palette.gold, 0.82);
  }

  function localPoint(cx, cy, ux, uy, x, y) {
    return [cx + ux[0] * x + uy[0] * y, cy + ux[1] * x + uy[1] * y];
  }

  function drawSmallHalo(palette, side) {
    const center = 150;
    const spread = Math.pow(state.config.haloSpread / 100, 1.8);
    let ux;
    let uy;
    if (side === 'top') { ux = [1, 0]; uy = [0, -1]; }
    else if (side === 'right') { ux = [0, 1]; uy = [1, 0]; }
    else if (side === 'bottom') { ux = [-1, 0]; uy = [0, 1]; }
    else { ux = [0, -1]; uy = [-1, 0]; }
    const p = (x, y) => localPoint(center, center, ux, uy, x * spread, y * spread);
    drawShape([p(-30, 38), p(0, 72), p(30, 38), p(0, 92)], palette.soft, 0.72);
    drawShape([p(-22, 64), p(0, 96), p(22, 64), p(0, 120)], palette.gold, 1.14);
    drawShape([p(-56, 74), p(-30, 110), p(-6, 78), p(-30, 50)], palette.soft, 0.72);
    drawShape([p(56, 74), p(30, 110), p(6, 78), p(30, 50)], palette.soft, 0.72);
  }

  function drawMediumHalo(palette, sx, sy) {
    const cx = 150 + sx * 75;
    const cy = 150 + sy * 75;
    const spread = Math.pow(state.config.haloSpread / 100, 1.8);
    const inv = Math.SQRT1_2;
    const ux = [sx * inv, sy * inv];
    const uy = [-sy * inv, sx * inv];
    const p = (x, y) => localPoint(cx, cy, ux, uy, x * spread, y * spread);
    drawShape([p(-26, 0), p(0, 26), p(26, 0), p(0, -26)], palette.soft, 0.72);
    drawShape([p(0, 52), p(26, 26), p(52, 0), p(26, -26), p(0, -52), p(-26, -26), p(-52, 0), p(-26, 26)], palette.gold, 1.14);
    drawShape([p(-42, 16), p(-16, 42), p(16, 42), p(42, 16), p(16, -42), p(-16, -42)], palette.soft, 0.72);
  }

  function drawCentralConnector(palette, sx, sy) {
    const center = 150;
    const tension = state.config.connectorTension / 100;
    const node = [center + sx * 74, center + sy * 74];
    const a = [center + sx * 63 * tension, center + sy * 82 * tension];
    const b = [center + sx * 82 * tension, center + sy * 63 * tension];
    const tip = [center + sx * 103 * tension, center + sy * 103 * tension];
    drawShape([a, tip, b], palette.faint, 0.58);
    drawShape([a, node, b], palette.soft, 0.72);
  }

  function drawGirihTile(palette) {
    const center = 150;
    const tile = 300;
    drawShape([[center, 0], [tile, center], [center, tile], [0, center]], palette.accent, 1.3);
    drawShape([[center, 52], [tile - 52, center], [center, tile - 52], [52, center]], palette.soft, 0.72);
    drawMandala(palette, center, center, { outer: 82, inner: 62, heavy: true, coreScale: 0.23 });
    [[0, 0], [tile, 0], [tile, tile], [0, tile]].forEach(([x, y]) =>
      drawMandala(palette, x, y, { outer: 43, inner: 32, heavy: false, coreScale: 0.24 })
    );
    [[center, 0], [tile, center], [center, tile], [0, center]].forEach(([x, y]) =>
      drawMandala(palette, x, y, { outer: 24, inner: 18, heavy: false, coreScale: 0.26, rotation: -Math.PI / 2 + Math.PI / state.config.mainSides })
    );
    [[75, 75], [225, 75], [225, 225], [75, 225]].forEach(([x, y]) =>
      drawMandala(palette, x, y, { outer: 19, inner: 12.5, heavy: false, coreScale: 0.30 })
    );
    [['top'], ['right'], ['bottom'], ['left']].forEach(([side]) => drawSmallHalo(palette, side));
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([x, y]) => {
      drawCentralConnector(palette, x, y);
      drawMediumHalo(palette, x, y);
    });
    drawLine([[39, 0], [75, 75], [0, 39]], palette.gold, 1.14);
    drawLine([[261, 0], [225, 75], [300, 39]], palette.gold, 1.14);
    drawLine([[300, 261], [225, 225], [261, 300]], palette.gold, 1.14);
    drawLine([[39, 300], [75, 225], [0, 261]], palette.gold, 1.14);
  }

  function buildTileBuffer(palette) {
    tileCtx.clearRect(0, 0, 300, 300);
    tileCtx.lineCap = 'round';
    tileCtx.lineJoin = 'round';
    drawGirihTile(makeTilePalette(palette));
  }

  function layoutDiamondTiles(width, height, requestedStep, pad, gridPhaseDeg) {
    const tiles = [];
    const cx = width / 2;
    const cy = height / 2;
    const inv = Math.SQRT1_2;
    const diagonal = Math.hypot(width, height);
    const effectivePad = Math.max(pad, requestedStep * 6, diagonal * 0.35);
    const range = diagonal + effectivePad * 2;
    const maxTiles = 1800;
    const step = Math.max(requestedStep, range / Math.sqrt(maxTiles));
    let row = 0;
    for (let v = -range / 2; v <= range / 2; v += step, row++) {
      let col = 0;
      for (let u = -range / 2; u <= range / 2; u += step, col++) {
        tiles.push({
          x: cx + (u - v) * inv - step / 2,
          y: cy + (u + v) * inv - step / 2,
          rot: 45 + gridPhaseDeg,
          scaleStep: step,
          row,
          col
        });
      }
    }
    return tiles;
  }

  function resizeCanvas() {
    const dprCap = state.config.quality === 'quality' ? 2 : (state.config.quality === 'speed' ? 1 : 1.5);
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const bufferWidth = Math.round(width * dpr);
    const bufferHeight = Math.round(height * dpr);
    if (lastCanvasWidth !== bufferWidth || lastCanvasHeight !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      lastCanvasWidth = bufferWidth;
      lastCanvasHeight = bufferHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height };
  }

  function drawBackground(palette, timestamp) {
    const { width, height } = resizeCanvas();
    const rootIsLight = document.documentElement.dataset.theme === 'light';
    layer.style.backgroundColor = rootIsLight ? rgba(palette.bg, 0.08) : palette.bg;
    ctx.clearRect(0, 0, width, height);

    let gradient = ctx.createRadialGradient(width * 0.18, height * 0.16, 0, width * 0.18, height * 0.16, width * 0.62);
    gradient.addColorStop(0, rgba(palette.accent, rootIsLight ? 0.05 : 0.09));
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    gradient = ctx.createRadialGradient(width * 0.82, height * 0.72, 0, width * 0.82, height * 0.72, width * 0.58);
    gradient.addColorStop(0, rgba(palette.gold, rootIsLight ? 0.035 : 0.07));
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    buildTileBuffer(palette);
    const configuredStep = Math.max(48, Number(state.config.tileScale) || 120);
    const effectiveOverscan = Math.max(Number(state.config.overscan) || 130, 220);
    const pad = Math.min(1600, Math.max(configuredStep * 1.1, configuredStep * effectiveOverscan / 100));
    const tiles = layoutDiamondTiles(width, height, configuredStep, pad, Number(state.config.gridPhase) || 0);
    const pulse = state.animationEnabled ? 0.96 + Math.sin(timestamp / 900) * 0.04 : 1;
    const subtlety = Number(state.config.backgroundSubtlety) || 0.28;
    const subdued = state.subdued ? 0.84 : 1;
    ctx.globalAlpha = clamp((Number(state.config.patternOpacity) || 0) / 100 * subtlety * subdued * pulse, 0, 0.5);

    tiles.forEach((tile) => {
      const step = tile.scaleStep || configuredStep;
      ctx.save();
      ctx.translate(tile.x + step / 2, tile.y + step / 2);
      ctx.rotate(tile.rot * Math.PI / 180);
      ctx.scale(step / 300, step / 300);
      ctx.translate(-150, -150);
      ctx.drawImage(tileCanvas, 0, 0, 300, 300);
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  }

  function render(timestamp = performance.now()) {
    renderRequested = false;
    if (state.transitionActive) {
      const elapsed = timestamp - state.transitionStart;
      const progress = clamp(elapsed / state.config.transitionMs, 0, 1);
      state.currentPalette = mixPalettes(state.transitionFrom, state.targetPalette, easeOutCubic(progress));
      if (progress >= 1) {
        state.currentPalette = { ...state.targetPalette };
        state.transitionActive = false;
      }
    }
    drawBackground(state.currentPalette, timestamp);
    updateDevStatus();
    if (state.transitionActive || state.animationEnabled) requestRender();
  }

  function requestRender() {
    if (renderRequested) return;
    renderRequested = true;
    state.animationFrame = requestAnimationFrame(render);
  }

  function showPatternDevButton() {
    if (devButton) devButton.hidden = !state.devUnlocked;
  }

  function setDevUnlocked(unlocked) {
    state.devUnlocked = unlocked;
    try { localStorage.setItem('iranPatternDevUnlocked', String(unlocked)); } catch (_) {}
    showPatternDevButton();
  }

  function populateSelect(select, category) {
    select.innerHTML = '<option value="">Auto from timeline</option>';
    Object.entries(state.paletteMap[category] || {}).forEach(([key, palette]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = palette.label || key;
      select.appendChild(option);
    });
  }

  function updateDevStatus() {
    if (!resolvedThemeEl || !paletteChipsEl) return;
    resolvedThemeEl.textContent = state.resolvedTheme;
    paletteChipsEl.innerHTML = '';
    ['bg', 'line', 'accent', 'gold'].forEach((key) => {
      const chip = document.createElement('span');
      chip.title = `${key}: ${state.currentPalette[key]}`;
      chip.style.background = state.currentPalette[key];
      paletteChipsEl.appendChild(chip);
    });
  }

  function syncDevInputs() {
    if (!devPanel) return;
    Object.keys(CATEGORY_FIELDS).forEach((category) => {
      const select = devPanel.querySelector(`[data-palette-category="${category}"]`);
      if (select) select.value = state.devOverrides[category];
    });
    devPanel.querySelectorAll('[data-pattern-setting]').forEach((input) => {
      const key = input.dataset.patternSetting;
      input.value = state.config[key];
      const readout = devPanel.querySelector(`[data-pattern-readout="${key}"]`);
      if (readout) readout.textContent = input.value;
    });
    const animation = devPanel.querySelector('[data-pattern-animation]');
    if (animation) animation.checked = state.animationEnabled;
    updateDevStatus();
  }

  function resetConfig() {
    state.config = { ...state.initialConfig };
    state.devOverrides = {
      dynasty: '',
      goldenAge: '',
      darkAge: '',
      religion: '',
      foreignRule: ''
    };
    state.animationEnabled = false;
    syncDevInputs();
    setFromHistoryState(state.appState);
    requestRender();
  }

  async function copyConfig(button) {
    const exportConfig = {
      ...state.config,
      resolvedTheme: state.resolvedTheme,
      activePalette: state.currentPalette,
      paletteOverrides: state.devOverrides,
      exportedAt: new Date().toISOString(),
      app: 'History of Iran Layered',
      version: 'iran-pattern-background-1'
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportConfig, null, 2));
      const original = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = original; }, 1200);
    } catch (error) {
      console.warn('Could not copy pattern config.', error);
    }
  }

  function createDevUi() {
    const style = document.createElement('style');
    style.textContent = `
      #iranPatternDevButton { position:fixed; left:14px; bottom:14px; z-index:82; }
      #iranPatternDevPanel { position:fixed; left:14px; bottom:60px; z-index:83; width:min(360px, calc(100vw - 28px)); max-height:min(76vh, 720px); overflow:auto; padding:14px; color:var(--fg); background:linear-gradient(145deg, color-mix(in srgb, var(--panel) 98%, transparent), color-mix(in srgb, var(--panel2) 96%, transparent)); border:1px solid var(--line); border-radius:9px; box-shadow:0 24px 64px rgba(0,0,0,.42); backdrop-filter:blur(16px) saturate(116%); font-size:12px; }
      #iranPatternDevPanel[hidden], #iranPatternDevButton[hidden] { display:none; }
      #iranPatternDevPanel h2 { margin:0; color:var(--accent2); font-size:13px; letter-spacing:.08em; text-transform:uppercase; }
      #iranPatternDevPanel .pattern-dev-head, #iranPatternDevPanel .pattern-dev-actions { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      #iranPatternDevPanel .pattern-dev-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px; }
      #iranPatternDevPanel label { display:grid; gap:4px; color:var(--muted); font-size:11px; }
      #iranPatternDevPanel select, #iranPatternDevPanel input[type=range] { width:100%; }
      #iranPatternDevPanel select { min-width:0; padding:6px; border:1px solid var(--line); border-radius:5px; color:var(--fg); background:var(--panel); }
      #iranPatternDevPanel .pattern-dev-status { margin-top:10px; color:var(--muted); line-height:1.4; overflow-wrap:anywhere; }
      #iranPatternDevPanel .pattern-dev-chips { display:flex; gap:6px; margin-top:8px; }
      #iranPatternDevPanel .pattern-dev-chips span { width:34px; height:20px; border-radius:4px; border:1px solid rgba(255,255,255,.22); }
      #iranPatternDevPanel .pattern-dev-actions { justify-content:flex-start; flex-wrap:wrap; margin-top:12px; }
      #iranPatternDevPanel .pattern-dev-wide { grid-column:1 / -1; }
      @media (max-width:767px) {
        #iranPatternDevButton { left:10px; bottom:calc(var(--controlBarH) + 10px); }
        #iranPatternDevPanel { left:8px; bottom:calc(var(--controlBarH) + 56px); width:calc(100vw - 16px); max-height:62vh; }
      }
    `;
    document.head.appendChild(style);

    devButton = document.createElement('button');
    devButton.id = 'iranPatternDevButton';
    devButton.className = 'action-btn';
    devButton.type = 'button';
    devButton.hidden = true;
    devButton.textContent = 'Pattern Dev';
    document.body.appendChild(devButton);

    devPanel = document.createElement('section');
    devPanel.id = 'iranPatternDevPanel';
    devPanel.hidden = true;
    devPanel.setAttribute('aria-label', 'Persian pattern development controls');
    devPanel.innerHTML = `
      <div class="pattern-dev-head">
        <h2>Background Dev</h2>
        <button type="button" class="sheet-close" data-pattern-close>Close</button>
      </div>
      <div class="pattern-dev-status">
        <b>Resolved theme</b>
        <div data-pattern-resolved></div>
        <div class="pattern-dev-chips" data-pattern-chips></div>
      </div>
      <div class="pattern-dev-grid">
        <label>Dynasty/entity<select data-palette-category="dynasty"></select></label>
        <label>Golden age<select data-palette-category="goldenAge"></select></label>
        <label>Dark age<select data-palette-category="darkAge"></select></label>
        <label>Religion<select data-palette-category="religion"></select></label>
        <label class="pattern-dev-wide">Foreign rule<select data-palette-category="foreignRule"></select></label>
        <label>Pattern opacity <span data-pattern-readout="patternOpacity"></span><input type="range" min="0" max="100" step="1" data-pattern-setting="patternOpacity"></label>
        <label>Subtlety <span data-pattern-readout="backgroundSubtlety"></span><input type="range" min="0.08" max="0.5" step="0.01" data-pattern-setting="backgroundSubtlety"></label>
        <label>Tile scale <span data-pattern-readout="tileScale"></span><input type="range" min="70" max="260" step="1" data-pattern-setting="tileScale"></label>
        <label>Line weight <span data-pattern-readout="lineWeight"></span><input type="range" min="60" max="220" step="1" data-pattern-setting="lineWeight"></label>
        <label>Overscan <span data-pattern-readout="overscan"></span><input type="range" min="130" max="360" step="1" data-pattern-setting="overscan"></label>
        <label>Halo spread <span data-pattern-readout="haloSpread"></span><input type="range" min="70" max="150" step="1" data-pattern-setting="haloSpread"></label>
        <label>Mandala depth <span data-pattern-readout="mandalaDepth"></span><input type="range" min="70" max="145" step="1" data-pattern-setting="mandalaDepth"></label>
        <label>Connector tension <span data-pattern-readout="connectorTension"></span><input type="range" min="70" max="160" step="1" data-pattern-setting="connectorTension"></label>
        <label class="pattern-dev-wide"><span><input type="checkbox" data-pattern-animation> Animate subtle pulse</span></label>
      </div>
      <div class="pattern-dev-actions">
        <button type="button" class="action-btn" data-pattern-copy>Copy config JSON</button>
        <button type="button" class="action-btn" data-pattern-reset>Reset defaults</button>
        <button type="button" class="action-btn" data-pattern-refresh>Force render</button>
      </div>
    `;
    document.body.appendChild(devPanel);

    resolvedThemeEl = devPanel.querySelector('[data-pattern-resolved]');
    paletteChipsEl = devPanel.querySelector('[data-pattern-chips]');

    devButton.addEventListener('click', () => {
      if (!state.devUnlocked) return;
      devPanel.hidden = !devPanel.hidden;
    });
    devPanel.querySelector('[data-pattern-close]').addEventListener('click', () => { devPanel.hidden = true; });
    devPanel.querySelector('[data-pattern-copy]').addEventListener('click', (event) => copyConfig(event.currentTarget));
    devPanel.querySelector('[data-pattern-reset]').addEventListener('click', resetConfig);
    devPanel.querySelector('[data-pattern-refresh]').addEventListener('click', requestRender);
    devPanel.querySelector('[data-pattern-animation]').addEventListener('change', (event) => {
      state.animationEnabled = event.target.checked;
      requestRender();
    });
    devPanel.querySelectorAll('[data-pattern-setting]').forEach((input) => {
      input.addEventListener('input', (event) => {
        const key = event.target.dataset.patternSetting;
        state.config[key] = Number(event.target.value);
        syncDevInputs();
        requestRender();
      });
    });
    Object.keys(CATEGORY_FIELDS).forEach((category) => {
      const select = devPanel.querySelector(`[data-palette-category="${category}"]`);
      select.addEventListener('change', (event) => {
        state.devOverrides[category] = event.target.value;
        setFromHistoryState(state.appState);
      });
    });
  }

  async function fetchJson(path) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.json();
  }

  async function loadResources() {
    try {
      const [config, paletteData] = await Promise.all([
        fetchJson('persian-pattern-config.json'),
        fetchJson('iran-history-pattern-palettes.json')
      ]);
      state.paletteMap = { ...state.paletteMap, ...(paletteData.palettes || {}) };
      state.config = {
        ...DEFAULT_CONFIG,
        ...(paletteData.basePatternConfig || {}),
        ...config,
        backgroundSubtlety: DEFAULT_CONFIG.backgroundSubtlety,
        transitionMs: DEFAULT_CONFIG.transitionMs,
        fieldLayout: 'diamond',
        animationPreset: 'none',
        metaMode: false
      };
      state.initialConfig = { ...state.config };
    } catch (error) {
      console.warn('Iran pattern palette resources could not be loaded. Using the midnight fallback.', error);
    }

    Object.keys(CATEGORY_FIELDS).forEach((category) => {
      populateSelect(devPanel.querySelector(`[data-palette-category="${category}"]`), category);
    });
    syncDevInputs();
    setFromHistoryState(state.appState);
    requestRender();
  }

  createDevUi();
  try { state.devUnlocked = localStorage.getItem('iranPatternDevUnlocked') === 'true'; } catch (_) {}
  showPatternDevButton();

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
    devKeyBuffer = (devKeyBuffer + event.key.toLowerCase()).slice(-12);
    if (devKeyBuffer.includes('pouya')) setDevUnlocked(true);
  });
  window.addEventListener('resize', requestRender, { passive: true });

  window.IranPatternBackground = {
    normalizeKey,
    resolveActiveHistoryTheme,
    setThemeByLabel,
    setPalette,
    setFromHistoryState,
    showDevPanel() {
      if (state.devUnlocked) devPanel.hidden = false;
    },
    hideDevPanel() {
      devPanel.hidden = true;
    },
    getState() {
      return {
        config: { ...state.config },
        currentPalette: { ...state.currentPalette },
        targetPalette: { ...state.targetPalette },
        resolvedTheme: state.resolvedTheme,
        animationEnabled: state.animationEnabled,
        devUnlocked: state.devUnlocked
      };
    },
    forceRender: requestRender
  };

  requestRender();
  loadResources();
})();
