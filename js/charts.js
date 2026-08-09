/**
 * charts.js
 * Motor de gráficos 100% em Canvas 2D nativo — sem bibliotecas externas.
 * Suporta: bar, hbar (ranking), line, area, pie, donut.
 *
 * Uso:
 *   const chart = new DashChart(containerEl, {
 *     type: 'bar',
 *     labels: ['Jan', 'Fev', 'Mar'],
 *     series: [{ name: 'Valor', data: [10, 20, 30], color: '#FF7A1A' }],
 *     options: { currency: false, showLegend: true }
 *   });
 *   chart.update({ labels, series }); // reanima para os novos dados
 */
'use strict';

const ChartPalette = ['#FF7A1A', '#2563EB', '#16A34A', '#DC2626', '#8B5CF6', '#0EA5E9', '#EAB308', '#64748B'];

class DashChart {
  constructor(container, config) {
    this.container = container;
    this.type = config.type;
    this.labels = config.labels || [];
    this.series = (config.series || []).map((s, i) => ({ color: ChartPalette[i % ChartPalette.length], ...s }));
    this.options = Object.assign({
      showLegend: true,
      currency: false,
      stacked: false,
      emptyMessage: 'Sem dados para os filtros selecionados'
    }, config.options || {});

    this._prevSeries = null;
    this._animFrame = null;
    this._hoverIndex = -1;
    this._resizeObserver = null;

    this._buildDOM();
    this._bindEvents();
    this._resize();
    this.update({ labels: this.labels, series: this.series }, false);
  }

  _buildDOM() {
    this.container.innerHTML = '';
    this.container.classList.add('chart-root');

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'chart-canvas';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'chart-tooltip';
    this.tooltip.setAttribute('role', 'tooltip');
    this.container.appendChild(this.tooltip);

    this.emptyState = document.createElement('div');
    this.emptyState.className = 'chart-empty';
    this.emptyState.textContent = this.options.emptyMessage;
    this.container.appendChild(this.emptyState);

    if (this.options.showLegend) {
      this.legend = document.createElement('div');
      this.legend.className = 'chart-legend' + (this.type === 'pie' || this.type === 'donut' ? ' chart-legend--tiles' : '');
      this.container.appendChild(this.legend);
    }
  }

  _bindEvents() {
    this._onMove = this._onMove.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this.canvas.addEventListener('mousemove', this._onMove);
    this.canvas.addEventListener('mouseleave', this._onLeave);
    this.canvas.addEventListener('touchstart', this._onMove, { passive: true });

    // O callback roda dentro de requestAnimationFrame para evitar o aviso benigno
    // "ResizeObserver loop completed with undelivered notifications" (o resize
    // síncrono dentro do próprio observer pode disparar outro ciclo de resize).
    this._resizeObserver = new ResizeObserver(() => {
      if (this._resizeScheduled) return;
      this._resizeScheduled = true;
      requestAnimationFrame(() => { this._resizeScheduled = false; this._resize(); });
    });
    this._resizeObserver.observe(this.container);
  }

  _resize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const legendHeight = this.legend ? this.legend.offsetHeight : 0;
    const width = Math.max(rect.width, 100);
    const height = Math.max(rect.height - legendHeight, 120);

    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.width = width;
    this.height = height;
    this._draw(1);
  }

  /** Atualiza os dados do gráfico, animando a transição do valor antigo para o novo. */
  update(data, animate = true) {
    this.labels = data.labels || this.labels;
    const newSeries = (data.series || []).map((s, i) => ({ color: ChartPalette[i % ChartPalette.length], ...s }));

    const hasData = newSeries.some(s => (s.data || []).some(v => v !== 0 && v !== null && v !== undefined))
      && this.labels.length > 0;
    this.emptyState.style.display = hasData ? 'none' : 'flex';
    this.canvas.style.visibility = hasData ? 'visible' : 'hidden';

    if (this._animFrame) cancelAnimationFrame(this._animFrame);

    const from = this._currentSeries || newSeries.map(s => ({ ...s, data: s.data.map(() => 0) }));
    this._prevSeries = from;
    this._targetSeries = newSeries;
    this._renderLegend(newSeries);

    if (!animate) {
      this._currentSeries = newSeries;
      this._draw(1);
      return;
    }

    const duration = 700;
    const start = performance.now();
    const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = easeOutCubic(progress);
      this._currentSeries = newSeries.map((s, si) => ({
        ...s,
        data: s.data.map((v, di) => {
          const fromVal = (from[si] && from[si].data[di]) || 0;
          return fromVal + (v - fromVal) * eased;
        })
      }));
      this._draw(1);
      if (progress < 1) this._animFrame = requestAnimationFrame(step);
    };
    this._animFrame = requestAnimationFrame(step);
  }

  _renderLegend(series) {
    if (!this.legend) return;

    // Pizza/rosca: em vez de uma legenda de texto corrido, mostra um "quadrado" por
    // categoria com cor, porcentagem E a contagem de notas — pedido do usuário porque só
    // a % não deixava claro o volume real de cada fatia.
    if (this.type === 'pie' || this.type === 'donut') {
      const values = series[0] ? series[0].data : [];
      const total = values.reduce((a, b) => a + b, 0) || 1;
      const tiles = this.labels.map((l, i) => {
        const v = values[i] || 0;
        const pct = v / total * 100;
        return { label: l, color: this._sliceColor(i), pct: pct.toFixed(pct < 10 ? 1 : 0), count: Utils.formatNumber(Math.round(v)) };
      });
      this.legend.innerHTML = tiles.map(t => `
        <div class="chart-stat-tile" style="border-color:${t.color}">
          <span class="chart-stat-tile__dot" style="background:${t.color}"></span>
          <div class="chart-stat-tile__text">
            <span class="chart-stat-tile__label">${this._escape(t.label)}</span>
            <span class="chart-stat-tile__value">${t.pct}% <span class="chart-stat-tile__count">· ${t.count} notas</span></span>
          </div>
        </div>
      `).join('');
      return;
    }

    if (series.length <= 1) {
      this.legend.innerHTML = '';
      return;
    }
    const items = series.map(s => ({ label: s.name, color: s.color }));
    this.legend.innerHTML = items.map(it => `
      <span class="chart-legend__item">
        <span class="chart-legend__dot" style="background:${it.color}"></span>${this._escape(it.label)}
      </span>
    `).join('');
  }

  /** Cor de uma fatia de pizza/rosca: usa options.colors[i] (cores semânticas fixas) se informado,
   *  senão cai na paleta genérica por posição. */
  _sliceColor(i) {
    if (Array.isArray(this.options.colors) && this.options.colors[i]) return this.options.colors[i];
    return ChartPalette[i % ChartPalette.length];
  }

  _escape(str) {
    return String(str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  _draw(alpha) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this._currentSeries || this._currentSeries.length === 0) return;

    switch (this.type) {
      case 'bar': this._drawBars(false); break;
      case 'hbar': this._drawBars(true); break;
      case 'line': this._drawLineArea(false); break;
      case 'area': this._drawLineArea(true); break;
      case 'pie': this._drawCircular(false); break;
      case 'donut': this._drawCircular(true); break;
    }
  }

  _getColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
      text: styles.getPropertyValue('--chart-text').trim() || '#64748B',
      grid: styles.getPropertyValue('--chart-grid').trim() || 'rgba(100,116,139,0.15)'
    };
  }

  /* ---------- Barras (verticais e horizontais) ---------- */

  _drawBars(horizontal) {
    const ctx = this.ctx;
    const { text } = this._getColors();
    const series = this._currentSeries;
    const n = this.labels.length;
    if (n === 0) return;

    const fullLabels = !!this.options.fullLabels;
    const labelMax = fullLabels ? 200 : 22;
    ctx.font = '11px Inter, system-ui, sans-serif';

    // Sem eixo de valores na lateral — o valor vai dentro da própria barra — então o
    // espaço à esquerda só precisa caber o rótulo da categoria (nome da transportadora etc.).
    let leftPadding = 46;
    if (horizontal) {
      const maxLabelWidth = Math.max(...this.labels.map(l => ctx.measureText(this._truncate(l, labelMax)).width));
      leftPadding = Math.min(Math.max(maxLabelWidth + 22, 90), this.width * 0.45);
    }

    const padding = { top: 20, right: 20, bottom: horizontal ? 16 : 36, left: horizontal ? leftPadding : 46 };
    const plotW = this.width - padding.left - padding.right;
    const plotH = this.height - padding.top - padding.bottom;

    const allValues = series.flatMap(s => s.data);
    const maxValue = Math.max(...allValues, 1) * 1.15;

    const groupSize = horizontal ? plotH / n : plotW / n;
    const barGap = groupSize * 0.28;
    const barSlot = groupSize - barGap;
    const barWidth = barSlot / series.length;

    this._hitboxes = [];

    this.labels.forEach((label, i) => {
      series.forEach((s, si) => {
        const value = s.data[i] || 0;
        const ratio = value / maxValue;
        const color = s.color;

        if (horizontal) {
          const y = padding.top + i * groupSize + barGap / 2 + si * barWidth;
          const w = plotW * ratio;
          const x = padding.left;
          const h = barWidth * 0.86;
          this._roundRect(ctx, x, y, w, h, 4, color);
          this._hitboxes.push({ x, y, w, h, label, value, color, series: s.name });
          this._drawValueInsideBar(ctx, x, y, w, h, value, true);
        } else {
          const x = padding.left + i * groupSize + barGap / 2 + si * barWidth;
          const h = plotH * ratio;
          const y = padding.top + plotH - h;
          const w = barWidth * 0.86;
          this._roundRect(ctx, x, y, w, h, 4, color);
          this._hitboxes.push({ x, y, w, h, label, value, color, series: s.name });
          this._drawValueInsideBar(ctx, x, y, w, h, value, false);
        }
      });
    });

    // Rótulo de cada grupo (categoria), desenhado uma única vez — independente de quantas séries existam.
    ctx.fillStyle = text;
    ctx.font = '11px Inter, system-ui, sans-serif';
    this.labels.forEach((label, i) => {
      if (horizontal) {
        const y = padding.top + i * groupSize + groupSize / 2;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(this._truncate(label, labelMax), padding.left - 10, y);
      } else {
        const x = padding.left + i * groupSize + groupSize / 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(this._truncate(label, 10), x, this.height - padding.bottom + 16);
      }
    });
  }

  /** Desenha o valor dentro da própria barra (fundo claro dentro, ou ao lado se a barra for curta demais). */
  _drawValueInsideBar(ctx, x, y, w, h, value, horizontal) {
    if (w < 1 || h < 1) return;
    const valueText = this._fmt(value);
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    const textWidth = ctx.measureText(valueText).width;
    ctx.textBaseline = 'middle';

    if (horizontal) {
      const fits = w > textWidth + 16;
      ctx.textAlign = fits ? 'right' : 'left';
      ctx.fillStyle = fits ? '#fff' : this._getColors().text;
      ctx.fillText(valueText, fits ? x + w - 8 : x + w + 6, y + h / 2);
    } else {
      const fits = h > 18 && w > textWidth + 6;
      ctx.textAlign = 'center';
      if (fits) {
        ctx.fillStyle = '#fff';
        ctx.fillText(valueText, x + w / 2, y + 12);
      } else {
        ctx.fillStyle = this._getColors().text;
        ctx.fillText(valueText, x + w / 2, y - 8);
      }
    }
  }

  _roundRect(ctx, x, y, w, h, r, color) {
    if (w <= 0 || h <= 0) return;
    this._roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = color;
    ctx.fill();
  }

  _roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- Linha / Área ---------- */

  /**
   * Linha/área "bonita": sem eixo de valores na lateral — cada ponto mostra seu próprio
   * valor numa etiqueta arredondada (estilo "pill"), curva suavizada e, quando preenchida,
   * gradiente roxo por baixo (visual pedido pelo usuário, independente da cor da série).
   */
  _drawLineArea(filled) {
    const ctx = this.ctx;
    const { text } = this._getColors();
    const series = this._currentSeries;
    const n = this.labels.length;
    if (n === 0) return;

    const padding = { top: 34, right: 16, bottom: 30, left: 16 };
    const plotW = this.width - padding.left - padding.right;
    const plotH = this.height - padding.top - padding.bottom;

    const allValues = series.flatMap(s => s.data);
    const maxValue = Math.max(...allValues, 1) * 1.25;
    const stepX = n > 1 ? plotW / (n - 1) : 0;
    const minLabelGapPx = 80; // distância mínima entre etiquetas — evita "pills" sobrepostas

    this._points = [];

    series.forEach((s, si) => {
      const pts = s.data.map((v, i) => ({
        x: padding.left + i * stepX,
        y: padding.top + plotH * (1 - v / maxValue),
        value: v
      }));

      if (filled) {
        const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotH);
        grad.addColorStop(0, 'rgba(139,92,246,.55)');
        grad.addColorStop(1, 'rgba(139,92,246,.04)');
        ctx.beginPath();
        ctx.moveTo(pts[0].x, padding.top + plotH);
        ctx.lineTo(pts[0].x, pts[0].y);
        this._tracePath(ctx, pts);
        ctx.lineTo(pts[pts.length - 1].x, padding.top + plotH);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.moveTo(pts[0].x, pts[0].y);
      this._tracePath(ctx, pts);
      ctx.stroke();

      let lastLabelX = -Infinity;
      pts.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = s.color;
        ctx.stroke();
        this._points.push({ ...p, color: s.color, series: s.name });

        // "R$ 0,00" repetido em cada ponto sem movimento só poluiria o gráfico, e um espaço
        // mínimo entre etiquetas (em vez de um passo fixo) evita "pills" se sobrepondo quando
        // os pontos com valor não estão espaçados uniformemente.
        const isLast = i === pts.length - 1;
        if (p.value !== 0 && (p.x - lastLabelX >= minLabelGapPx || isLast)) {
          this._drawValuePill(ctx, p.x, p.y, this._fmt(p.value), s.color, si === 0);
          lastLabelX = p.x;
        }
      });
    });

    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillStyle = text;
    ctx.textAlign = 'center';
    const axisLabelStep = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(plotW / 60))));
    this.labels.forEach((label, i) => {
      if (i % axisLabelStep !== 0 && i !== n - 1) return;
      const x = padding.left + i * stepX;
      ctx.fillText(this._truncate(label, 8), x, this.height - 8);
    });
  }

  /** Traça uma curva suave passando pelos pontos médios entre cada par — evita "cotovelos". */
  _tracePath(ctx, pts) {
    if (pts.length < 2) return;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      const midX = (p0.x + p1.x) / 2, midY = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  /** Etiqueta arredondada com o valor, flutuando acima (série principal) ou abaixo do ponto. */
  _drawValuePill(ctx, x, y, valueText, color, above) {
    ctx.font = '700 11px Inter, system-ui, sans-serif';
    const boxW = ctx.measureText(valueText).width + 14;
    const boxH = 19;
    // Trava a etiqueta dentro do canvas — senão a do primeiro/último ponto fica cortada.
    const boxX = Math.max(2, Math.min(x - boxW / 2, this.width - boxW - 2));
    const boxY = above ? y - 14 - boxH : y + 14;

    ctx.save();
    ctx.shadowColor = 'rgba(16,24,40,.18)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    this._roundRectPath(ctx, boxX, boxY, boxW, boxH, boxH / 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(valueText, boxX + boxW / 2, boxY + boxH / 2);
  }

  _withAlpha(hex, alpha) {
    const c = hex.replace('#', '');
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /* ---------- Pizza / Rosca ---------- */

  /**
   * Pizza/rosca com efeito 3D: elipse achatada (perspectiva) + parede lateral na metade de
   * baixo, na cor da fatia só que mais escura — o mesmo truque usado em gráficos 3D de
   * Excel/PowerPoint, só que desenhado à mão em canvas.
   */
  _drawCircular(donut) {
    const ctx = this.ctx;
    const values = this._currentSeries[0] ? this._currentSeries[0].data : [];
    const total = values.reduce((a, b) => a + b, 0);
    if (total <= 0) return;

    // Fatias muito finas (ex.: 0,05%) recebem um rótulo por fora com linha guia — decide isso
    // antes de fixar o raio, porque essas fatias precisam de margem extra na lateral pra não
    // ficarem escondidas atrás de "Entregue"/"Em aberto" como antes.
    let hasThinSlice = false;
    values.forEach(v => {
      const slice = (v / total) * Math.PI * 2;
      if (slice > 0 && slice <= 0.18) hasThinSlice = true;
    });

    const depth = 22;
    const margin = hasThinSlice ? 74 : 16;
    const cx = this.width / 2;
    const cy = this.height / 2 - depth / 2;
    const rx = Math.min(this.width / 2 - margin, (this.height - depth - 22) / 2 / 0.55);
    const ry = rx * 0.55;
    const innerRx = donut ? rx * 0.6 : 0;
    const innerRy = donut ? ry * 0.6 : 0;

    let angle = -Math.PI / 2;
    const sliceDefs = values.map((v, i) => {
      const sw = (v / total) * Math.PI * 2;
      const def = { start: angle, end: angle + sw, color: this._sliceColor(i), value: v, label: this.labels[i] };
      angle += sw;
      return def;
    });

    // 1) paredes laterais primeiro (ficam por baixo do topo).
    sliceDefs.forEach(s => this._drawPieSideWall(ctx, cx, cy, rx, ry, depth, s.start, s.end, s.color));

    // 2) topo de cada fatia (elipse achatada).
    this._slices = [];
    const bigSlices = [];
    const thinSlices = [];
    sliceDefs.forEach(s => {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.ellipse(cx, cy, rx, ry, 0, s.start, s.end);
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      const sw = s.end - s.start;
      const mid = s.start + sw / 2;
      const pct = (s.value / total) * 100;
      this._slices.push({ start: s.start, end: s.end, color: s.color, label: s.label, value: s.value, cx, cy, rx, ry });
      if (sw > 0.18) bigSlices.push({ mid, pct });
      else if (s.value > 0) thinSlices.push({ mid, pct, color: s.color });
    });

    // 3) porcentagem escrita dentro de cada fatia grande.
    ctx.font = '700 12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    bigSlices.forEach(({ mid, pct }) => {
      const lr = donut ? 0.8 : 0.62;
      ctx.fillStyle = '#fff';
      ctx.fillText(`${pct.toFixed(pct < 10 ? 1 : 0)}%`, cx + Math.cos(mid) * rx * lr, cy + Math.sin(mid) * ry * lr);
    });

    // Fatias finas: rótulo por fora com linha guia, pra não ficarem invisíveis.
    this._drawThinSliceCallouts(ctx, thinSlices, cx, cy, rx, ry);

    if (donut) {
      const styles = getComputedStyle(document.documentElement);
      ctx.beginPath();
      ctx.ellipse(cx, cy, innerRx, innerRy, 0, 0, Math.PI * 2);
      ctx.fillStyle = styles.getPropertyValue('--surface').trim() || '#fff';
      ctx.fill();

      ctx.fillStyle = styles.getPropertyValue('--text-primary').trim() || '#111';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 18px Inter, system-ui, sans-serif';
      ctx.fillText(this._fmt(total), cx, cy - 7);
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.fillStyle = styles.getPropertyValue('--text-secondary').trim() || '#666';
      ctx.fillText('Total', cx, cy + 9);
    }
  }

  /** Parede lateral (mais escura) da metade "de frente" (baixo) da elipse — dá o volume 3D. */
  _drawPieSideWall(ctx, cx, cy, rx, ry, depth, start, end, color) {
    const a = Math.max(start, 0);
    const b = Math.min(end, Math.PI);
    if (a >= b) return;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, a, b, false);
    ctx.ellipse(cx, cy + depth, rx, ry, 0, b, a, true);
    ctx.closePath();
    ctx.fillStyle = this._darken(color, 0.3);
    ctx.fill();
  }

  _darken(hex, amount) {
    const c = hex.replace('#', '');
    const r = Math.round(parseInt(c.substring(0, 2), 16) * (1 - amount));
    const g = Math.round(parseInt(c.substring(2, 4), 16) * (1 - amount));
    const b = Math.round(parseInt(c.substring(4, 6), 16) * (1 - amount));
    return `rgb(${r},${g},${b})`;
  }

  /** Rótulo + linha guia por fora da elipse para fatias finas demais pra escrever a % dentro. */
  _drawThinSliceCallouts(ctx, thinSlices, cx, cy, rx, ry) {
    if (thinSlices.length === 0) return;
    const rightSide = thinSlices.filter(s => Math.cos(s.mid) >= 0).sort((a, b) => a.mid - b.mid);
    const leftSide = thinSlices.filter(s => Math.cos(s.mid) < 0).sort((a, b) => a.mid - b.mid);

    const placeSide = (list, isRight) => {
      let lastY = -Infinity;
      const minGap = 15;
      list.forEach(s => {
        const startX = cx + Math.cos(s.mid) * rx;
        const startY = cy + Math.sin(s.mid) * ry;
        const elbowX = cx + Math.cos(s.mid) * (rx + 10);
        const elbowY = cy + Math.sin(s.mid) * (ry + 10);
        const labelY = Math.max(elbowY, lastY + minGap);
        lastY = labelY;
        const labelX = cx + (isRight ? rx + 44 : -(rx + 44));

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(elbowX, elbowY);
        ctx.lineTo(labelX + (isRight ? -8 : 8), labelY);
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.font = '700 11px Inter, system-ui, sans-serif';
        ctx.textAlign = isRight ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = s.color;
        ctx.fillText(`${s.pct.toFixed(2)}%`, labelX, labelY);
      });
    };
    placeSide(rightSide, true);
    placeSide(leftSide, false);
  }

  /* ---------- Interatividade (tooltip) ---------- */

  _onMove(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const point = evt.touches ? evt.touches[0] : evt;
    const x = point.clientX - rect.left;
    const y = point.clientY - rect.top;
    let found = null;

    if (this.type === 'bar' || this.type === 'hbar') {
      found = (this._hitboxes || []).find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      if (found) found = { label: found.label, lines: [`${found.series}: ${this._fmt(found.value)}`], color: found.color };
    } else if (this.type === 'line' || this.type === 'area') {
      const near = (this._points || []).find(p => Math.hypot(p.x - x, p.y - y) < 10);
      if (near) found = { label: near.label, lines: [`${near.series}: ${this._fmt(near.value)}`], color: near.color };
    } else if (this.type === 'pie' || this.type === 'donut') {
      const slices = this._slices || [];
      if (slices.length) {
        const { cx, cy, rx, ry } = slices[0];
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const dist = Math.hypot(dx, dy);
        let ang = Math.atan2(dy, dx);
        if (ang < -Math.PI / 2) ang += Math.PI * 2;
        const slice = slices.find(s => dist <= 1 && ang >= s.start && ang <= s.end);
        if (slice) found = { label: slice.label, lines: [this._fmt(slice.value)], color: slice.color };
      }
    }

    if (found) {
      this.tooltip.innerHTML = `
        <strong>${this._escape(found.label)}</strong>
        ${found.lines.map(l => `<div><span class="chart-tooltip__dot" style="background:${found.color}"></span>${this._escape(l)}</div>`).join('')}
      `;
      this.tooltip.style.left = `${Math.min(x + 12, this.width - 140)}px`;
      this.tooltip.style.top = `${Math.max(y - 10, 0)}px`;
      this.tooltip.classList.add('chart-tooltip--visible');
    } else {
      this.tooltip.classList.remove('chart-tooltip--visible');
    }
  }

  _onLeave() { this.tooltip.classList.remove('chart-tooltip--visible'); }

  _fmt(value) {
    return this.options.currency ? Utils.formatCurrency(value) : Utils.formatNumber(Math.round(value));
  }

  _truncate(str, max) {
    str = String(str);
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  destroy() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this.canvas.removeEventListener('mousemove', this._onMove);
    this.canvas.removeEventListener('mouseleave', this._onLeave);
  }
}
