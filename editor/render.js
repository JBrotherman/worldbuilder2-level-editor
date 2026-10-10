// Draws a level the way the game does: an oblique grid of block tiles where
// each row is shifted left by SHEAR pixels, painted back (top-left) to front.
(function () {
  'use strict';

  const SX = 51;      // tile top-face width
  const SY = 53;      // tile top-face height
  const SHEAR = 24;   // leftward shift of each row
  const FACE_CX = 13; // centre of the top face, relative to the tile anchor
  const FACE_CY = 26;
  const LOWER = 12;   // water surfaces sit 12px below land
  const MARGIN_TOP = 80, MARGIN = 24;

  const LOWERED = new Set(['water', 'water_undiggable', 'water_reefs', 'water_whirlpool', 'hole']);
  const FALLBACK_COLORS = {
    normal: '#3d9b35', water: '#2f8fd8', mountain: '#8a7a66', hole: '#1a1a1a', swamp: '#4f6b2a',
    volcano: '#7a3020', billboard: '#ddd', goal: '#d9c64a', cement: '#aaa',
  };

  class MapView {
    constructor(canvas, catalog) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.catalog = catalog;
      this.terrainByChar = Object.fromEntries(catalog.terrain.map((t) => [t.char, t.name]));
      this.images = new Map();
      this.zoom = 1;
      this.showGrid = true;
      this.hover = null;
      this.selected = null;
      this.level = null;
      this.pending = false;
    }

    setLevel(level) { this.level = level; this.layout(); this.requestDraw(); }
    setZoom(z) { this.zoom = z; this.layout(); this.requestDraw(); }

    has(name) { return !!(name && this.catalog.sprites[name]); }
    first(...names) { return names.find((n) => this.has(n)) || null; }

    image(name) {
      let img = this.images.get(name);
      if (!img) {
        img = new Image();
        img.onload = () => this.requestDraw();
        img.src = `/sprite/${encodeURIComponent(name)}.png`;
        this.images.set(name, img);
      }
      return img.complete && img.naturalWidth ? img : null;
    }

    // --- sprite selection -------------------------------------------------
    terrainName(ch) {
      if (ch === 'whirlpool') return 'water_whirlpool';
      return this.terrainByChar[ch] || 'normal';
    }
    terrainSprite(name) { return this.first(`terrain.${name}`); }

    itemSprites(item) {
      switch (item.kind) {
        case 'unit': return [MapView.unitSprite(this, item.cat, item.type, item.water)];
        case 'pile': {
          const main = item.contents.find(([c]) => c !== 'energy');
          const out = [];
          if (main) out.push(main[0] === 'wheel' ? 'resource.wheel' : this.first(`resource.${main[0]}.4`));
          if (item.contents.some(([c]) => c === 'energy')) out.push('resource.energy');
          return out;
        }
        case 'plan': return [MapView.planSprite(this, item.type)];
        case 'goal': return [item.bonus ? 'goal.bonus' : 'goal.goal'];
        case 'whirlpool': return ['whirlpool.generic'];
        default: return [];
      }
    }

    static unitSprite(view, cat, type, water) {
      const alias = { repairbot: 'repairBot', defender2: 'defender', defender3: 'defender' }[type] || type;
      if (cat === 'building') return view.first(`building.${type}`, `building.${type}.1`, `building.${type}.down`);
      return view.first(
        water ? `${cat}.${alias}.water.down` : null,
        `${cat}.${alias}.down`, `${cat}.${alias}`, `${cat}.${alias}.frozen`, `${cat}.${alias}.down.stand`,
        `${cat}.${alias}.water.down`, `${cat}.${alias}.right`,
      );
    }
    static planSprite(view, type) {
      const alias = { repairbot: 'repairBot', defender2: 'defender', defender3: 'defender' }[type] || type;
      return view.first(`vehicle.${alias}.plan`, `building.${type}.plan`, `monster.${type}.plan`, 'icon.plan_noshadow');
    }

    // --- geometry -----------------------------------------------------------
    layout() {
      const lv = this.level;
      if (!lv) return;
      this.ox = MARGIN + Math.max(0, lv.height - 1) * SHEAR + SHEAR;
      this.oy = MARGIN_TOP;
      this.w = this.ox + lv.width * SX + SX + MARGIN;
      this.h = this.oy + lv.height * SY + 40 + MARGIN;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.ceil(this.w * this.zoom * dpr);
      this.canvas.height = Math.ceil(this.h * this.zoom * dpr);
      this.canvas.style.width = `${Math.ceil(this.w * this.zoom)}px`;
      this.canvas.style.height = `${Math.ceil(this.h * this.zoom)}px`;
    }

    anchor(x, y) { return { x: this.ox + x * SX - y * SHEAR, y: this.oy + y * SY }; }

    // Canvas CSS pixel -> tile, or null.
    cellAt(px, py) {
      const mx = px / this.zoom, my = py / this.zoom;
      const y = Math.floor((my - this.oy) / SY);
      if (y < 0 || y >= this.level.height) return null;
      const yy = my - this.oy - y * SY;
      const x = Math.floor((mx - (this.ox - y * SHEAR) + yy * SHEAR / SY) / SX);
      if (x < 0 || x >= this.level.width) return null;
      return { x, y };
    }

    facePath(ctx, x, y, inset = 0) {
      const a = this.anchor(x, y);
      const drop = LOWERED.has(this.terrainName(this.level.terrain[y][x])) ? LOWER : 0;
      const top = a.y + drop + inset, bot = a.y + drop + SY - inset;
      const sh = SHEAR * (SY - 2 * inset) / SY;
      ctx.beginPath();
      ctx.moveTo(a.x + inset, top);
      ctx.lineTo(a.x + SX - inset, top);
      ctx.lineTo(a.x + SX - inset - sh, bot);
      ctx.lineTo(a.x + inset - sh, bot);
      ctx.closePath();
    }

    // Screen rectangle (in map pixels) covering a tile, for scrolling into view.
    tileRect(x, y) {
      const a = this.anchor(x, y);
      return { x: (a.x - SHEAR) * this.zoom, y: (a.y - 40) * this.zoom, w: (SX + SHEAR) * this.zoom, h: (SY + 60) * this.zoom };
    }

    // --- drawing --------------------------------------------------------------
    requestDraw() {
      if (this.pending) return;
      this.pending = true;
      requestAnimationFrame(() => { this.pending = false; this.draw(); });
    }

    drawSprite(name, x, y) {
      const meta = this.catalog.sprites[name];
      const img = meta && this.image(name);
      if (!img) return false;
      this.ctx.drawImage(img, Math.round(x - meta.regX), Math.round(y - meta.regY));
      return true;
    }

    draw() {
      const lv = this.level;
      if (!lv) return;
      const ctx = this.ctx;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(this.zoom * dpr, 0, 0, this.zoom * dpr, 0, 0);
      ctx.imageSmoothingEnabled = this.zoom < 1;
      ctx.fillStyle = '#10131a';
      ctx.fillRect(0, 0, this.w, this.h);

      for (let y = 0; y < lv.height; y++) {
        for (let x = 0; x < lv.width; x++) this.drawTerrain(x, y);
        for (let x = 0; x < lv.width; x++) if (lv.items[y][x]) this.drawItem(x, y, lv.items[y][x]);
      }

      if (this.showGrid) {
        ctx.lineWidth = 1 / this.zoom;
        ctx.strokeStyle = 'rgba(0,0,0,0.28)';
        for (let y = 0; y < lv.height; y++) for (let x = 0; x < lv.width; x++) { this.facePath(ctx, x, y); ctx.stroke(); }
      }
      if (lv.center) this.drawCenter(lv.center.x, lv.center.y);
      if (this.hover) this.outline(this.hover.x, this.hover.y, 'rgba(255,255,255,0.9)', 2);
      if (this.selected) this.outline(this.selected.x, this.selected.y, '#ffcf1a', 3);
      if (this.marks) for (const m of this.marks) this.outline(m.x, m.y, '#ff5a4f', 2);
    }

    drawTerrain(x, y) {
      const name = this.terrainName(this.level.terrain[y][x]);
      const a = this.anchor(x, y);
      if (name === 'hole') return; // holes are just a gap in the ground
      const sprite = this.terrainSprite(name);
      if (sprite && this.drawSprite(sprite, a.x, a.y)) return;
      this.facePath(this.ctx, x, y);
      this.ctx.fillStyle = FALLBACK_COLORS[name] || '#3d9b35';
      this.ctx.fill();
    }

    itemCenter(x, y) {
      const a = this.anchor(x, y);
      const drop = LOWERED.has(this.terrainName(this.level.terrain[y][x])) ? LOWER : 0;
      return { x: a.x + FACE_CX, y: a.y + FACE_CY + drop };
    }

    drawItem(x, y, item) {
      const c = this.itemCenter(x, y);
      const ctx = this.ctx;
      const sprites = this.itemSprites(item).filter(Boolean);
      if (item.kind === 'plan') {
        // A blueprint badge so plans read differently from built units.
        ctx.fillStyle = 'rgba(40,110,220,0.85)';
        ctx.strokeStyle = '#cfe3ff';
        ctx.lineWidth = 1.5;
        roundRect(ctx, c.x - 17, c.y - 14, 34, 28, 5);
        ctx.fill(); ctx.stroke();
      }
      let drew = false;
      sprites.forEach((s, i) => { if (this.drawSprite(s, c.x + i * 10, c.y + i * 6)) drew = true; });
      if (item.kind === 'goal' && item.target && item.target !== 'anything') {
        const target = /^collect\s+\d+\s+(\w+)/.exec(item.target);
        const icon = target ? MapView.unitSprite(this, 'monster', target[1], false) : MapView.planSprite(this, item.target);
        if (icon) {
          ctx.save();
          ctx.globalAlpha = 0.95;
          const meta = this.catalog.sprites[icon];
          const img = this.image(icon);
          if (img) {
            const s = Math.min(1, 26 / Math.max(meta.w, meta.h));
            ctx.drawImage(img, c.x + 10, c.y - 4, meta.w * s, meta.h * s);
          }
          ctx.restore();
        }
      }
      if (item.kind === 'whirlpool') badge(ctx, c.x + 14, c.y - 12, String(item.n), '#1c5fa8');
      if (item.kind === 'plan' && item.count) badge(ctx, c.x + 15, c.y + 10, '×' + item.count, '#1c4f9c');
      if (!drew) {
        ctx.fillStyle = '#e34';
        ctx.beginPath(); ctx.arc(c.x, c.y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', c.x, c.y + 0.5);
      }
    }

    drawCenter(x, y) {
      const c = this.itemCenter(x, y);
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(c.x, c.y, 20, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(c.x - 26, c.y); ctx.lineTo(c.x - 12, c.y);
      ctx.moveTo(c.x + 12, c.y); ctx.lineTo(c.x + 26, c.y);
      ctx.moveTo(c.x, c.y - 26); ctx.lineTo(c.x, c.y - 12);
      ctx.moveTo(c.x, c.y + 12); ctx.lineTo(c.x, c.y + 26);
      ctx.stroke();
      ctx.restore();
    }

    outline(x, y, color, width) {
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width / this.zoom;
      this.facePath(ctx, x, y, 1);
      ctx.stroke();
      ctx.restore();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function badge(ctx, x, y, text, color) {
    ctx.save();
    ctx.font = 'bold 10px system-ui, sans-serif';
    const w = Math.max(14, ctx.measureText(text).width + 8);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x - w / 2, y - 7, w, 14, 7);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  window.MapView = MapView;
})();
