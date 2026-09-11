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
      // Cada série ganha seu próprio máximo (0 a 1.25x o maior valor DELA), em vez de todas
      // dividirem o mesmo eixo — necessário quando as séries têm grandezas muito diferentes
      // (ex.: "Valor faturado" em R$ x "Quantidade de notas" em unidades), senão a de menor
      // grandeza vira uma linha reta quase no fundo do gráfico. Só usado quando pedido
      // explicitamente (Registro Dinâmico) — as demais telas continuam comparando as séries
      // no mesmo eixo, que é o que faz sentido pra elas (ex.: "Mês atual" x "Mês anterior").
      perSeriesScale: false,
      emptyMessage: 'Sem dados para os filtros selecionados',
      // Fatia fina normalmente ganha rótulo + linha-guia por fora (ver _drawThinSliceCallouts) —
      // opção pra desligar isso num gráfico específico (pedido da usuária, 2026-09-09, pizza do
      // Indicador de Frete: "não precisa deixar a linha que indica a porcentagem"), sem afetar
      // os outros gráficos de pizza/rosca que dependem dela pra fatia fina não ficar invisível.
      hideThinSliceLabels: false
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

    // O canvas fica isolado num wrapper próprio, position:absolute, pra NUNCA participar do
    // cálculo de altura automática do .chart-root (ver _resize/CSS .chart-plot-area).
    this.plotArea = document.createElement('div');
    this.plotArea.className = 'chart-plot-area';
    this.container.appendChild(this.plotArea);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'chart-canvas';
    this.plotArea.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'chart-tooltip';
    this.tooltip.setAttribute('role', 'tooltip');
    this.plotArea.appendChild(this.tooltip);

    this.emptyState = document.createElement('div');
    this.emptyState.className = 'chart-empty';
    this.emptyState.textContent = this.options.emptyMessage;
    this.plotArea.appendChild(this.emptyState);

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
    // Observa o .chart-plot-area (não o .chart-root inteiro) — sua altura já exclui a
    // legenda, então não é preciso subtrair offsetHeight do legend aqui.
    this._resizeObserver.observe(this.plotArea);

    // Delegado no próprio elemento de legenda (persiste entre updates — só o innerHTML é
    // trocado a cada _renderLegend) — só chama options.onLegendClick quando ela existe, então
    // pizza/rosca sem essa option (a maioria) não ganham nenhum comportamento novo.
    if (this.legend) {
      this.legend.addEventListener('click', (e) => {
        if (typeof this.options.onLegendClick !== 'function') return;
        const tile = e.target.closest('.chart-stat-tile[data-label]');
        if (!tile) return;
        this.options.onLegendClick(tile.dataset.label);
      });

      // Hover sincronizado pizza <-> quadrado da legenda (pedido da usuária, 2026-09-09:
      // "quero que brilhe a parte da pizza junto com o card ao passar o mouse em cima") — passar
      // o mouse no QUADRADO também acende a fatia correspondente no canvas (o caminho inverso,
      // fatia -> quadrado, está em _onMove). Só tiles de pizza/rosca têm data-index, então isso
      // não faz nada nos demais tipos de gráfico (legenda de barra/linha não usa .chart-stat-tile).
      this.legend.addEventListener('mouseover', (e) => {
        const tile = e.target.closest('.chart-stat-tile[data-index]');
        if (!tile) return;
        const idx = Number(tile.dataset.index);
        if (idx === this._hoverIndex) return;
        this._hoverIndex = idx;
        this._setLegendHover(idx);
        this._draw(1);
      });
      this.legend.addEventListener('mouseout', (e) => {
        const tile = e.target.closest('.chart-stat-tile[data-index]');
        if (!tile || (e.relatedTarget && tile.contains(e.relatedTarget))) return;
        this._hoverIndex = -1;
        this._setLegendHover(-1);
        this._draw(1);
      });
    }
  }

  /** Acende (classe --active) só o quadrado da legenda no índice `idx` (-1 = nenhum) — usado
   * pelos dois sentidos do hover sincronizado com a pizza/rosca (ver _bindEvents e _onMove). */
  _setLegendHover(idx) {
    if (!this.legend) return;
    this.legend.querySelectorAll('.chart-stat-tile').forEach(el => {
      el.classList.toggle('chart-stat-tile--active', Number(el.dataset.index) === idx);
    });
  }

  _resize() {
    // Container escondido (ex.: dentro de #main-view com [hidden] enquanto a tela de detalhe
    // de um card está aberta) faz o ResizeObserver disparar com o box zerado. Sem essa guarda,
    // o resto do método segue com width/height no piso mínimo (100x120), o que pode gerar raio
    // negativo em _drawCircular — e ctx.ellipse() lança IndexSizeError com raio negativo.
    if (this.plotArea.offsetParent === null) return;

    const rect = this.plotArea.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(rect.width, 100);
    const height = Math.max(rect.height, 120);

    // Guarda contra ciclos redundantes do ResizeObserver (ex.: mudanças de subpixel entre
    // medições) — sem isso, o canvas fica sendo limpo (width/height resetam o bitmap)
    // repetidas vezes e às vezes some visualmente.
    const pxW = Math.round(width * dpr);
    const pxH = Math.round(height * dpr);
    if (pxW === this._lastPxW && pxH === this._lastPxH) return;
    this._lastPxW = pxW;
    this._lastPxH = pxH;

    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.width = width;
    this.height = height;
    this._draw(1);
  }

  /** Atualiza os dados do gráfico, animando a transição do valor antigo para o novo. */
  update(data, animate = true) {
    this.labels = data.labels || this.labels;
    // Permite ajustar opções junto de um update() normal (ex.: legendValores do gráfico de
    // Situação de agendamento, que muda a cada filtro) sem precisar recriar o DashChart inteiro.
    if (data.options) Object.assign(this.options, data.options);
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
      // legendValores (opcional, array paralelo a labels/data em R$): quando informado, o tile
      // mostra o valor total da categoria em vez da porcentagem — pedido do usuário (2026-08-26)
      // pro gráfico "Situação de agendamento", pra ver o R$ de cada etapa direto no quadrado.
      // A % continua aparecendo normalmente dentro da própria pizza/rosca (ver _drawCircular);
      // os demais gráficos de pizza/rosca não passam essa option e continuam mostrando %.
      const legendValores = this.options.legendValores;
      // legendSecundarioValores (opcional, array paralelo a labels/data, em R$ — 2026-09-10,
      // pedido da usuária no Indicador de Frete: "cidade, percentual de participação, valor
      // total de frete da cidade") — troca a 3ª linha do tile (por padrão "N notas") pelo valor
      // em R$ daquela categoria, mantendo a % na 2ª linha (independente de legendValores acima,
      // que troca a 2ª linha). Os demais gráficos de pizza/rosca não passam essa option e
      // continuam mostrando a contagem de notas.
      const legendSecundarioValores = this.options.legendSecundarioValores;
      const tiles = this.labels.map((l, i) => {
        const v = values[i] || 0;
        const pct = v / total * 100;
        const textoPrincipal = legendValores ? Utils.formatCurrency(legendValores[i] || 0) : `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
        const textoSecundario = legendSecundarioValores
          ? Utils.formatCurrency(legendSecundarioValores[i] || 0)
          : `${Utils.formatNumber(Math.round(v))} notas`;
        return { label: l, color: this._sliceColor(i), textoPrincipal, textoSecundario };
      });
      // onLegendClick (opcional): só quando informado nas options, os tiles ficam clicáveis
      // (cursor, hover, data-label pro delegado em _bindEvents) — os demais gráficos de
      // pizza/rosca do dashboard não usam essa option e continuam com o tile só informativo.
      const clicavel = typeof this.options.onLegendClick === 'function';
      // Rótulo/valor/quantidade cada um na sua própria linha — antes a quantidade ficava
      // dentro da mesma linha do valor (só separada por "·"), então quebrava de forma
      // inconsistente conforme o tamanho do valor (às vezes o número da quantidade ficava
      // "grudado" no valor, às vezes sozinho numa linha) — pedido do usuário (2026-08-26)
      // pra padronizar todos os quadrados no mesmo formato de 3 linhas.
      this.legend.innerHTML = tiles.map((t, i) => `
        <div class="chart-stat-tile${clicavel ? ' chart-stat-tile--clickable' : ''}" style="border-color:${t.color}" data-index="${i}"${clicavel ? ` data-label="${this._escape(t.label)}"` : ''}>
          <span class="chart-stat-tile__dot" style="background:${t.color}"></span>
          <div class="chart-stat-tile__text">
            <span class="chart-stat-tile__label">${this._escape(t.label)}</span>
            <span class="chart-stat-tile__value">${t.textoPrincipal}</span>
            <span class="chart-stat-tile__count">${t.textoSecundario}</span>
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
    // Construído (ou reconstruído, ex.: Registro Dinâmico) enquanto o container ainda estava
    // escondido/sem layout — this.width/height nunca chegaram a ser definidos por _resize()
    // (mesma guarda de offsetParent === null, ver _resize()), e desenhar com undefined/NaN
    // aqui é o que gerava "createLinearGradient ... non-finite" ao trocar de view e voltar.
    // O ResizeObserver chama _resize() -> _draw() de novo assim que o container ganhar tamanho real.
    if (!this.width || !this.height) return;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this._currentSeries || this._currentSeries.length === 0) return;

    switch (this.type) {
      case 'bar': this._drawBars(false); break;
      case 'hbar': this._drawBars(true); break;
      case 'line': this._drawLineArea(false); break;
      case 'area': this._drawLineArea(true); break;
      case 'pie': this._drawCircular(false); break;
      case 'donut': this._drawCircular(true); break;
      case 'combo': this._drawCombo(); break;
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

    // options.stacked (só faz sentido horizontal): em vez de sub-barras lado a lado, cada
    // série é desenhada emendada dentro de UMA única barra por rótulo — usado no padrão
    // "composição em %" (Desempenho por cliente/motorista/cidade: dentro do prazo / outros /
    // não entregue), onde as partes de cada barra somam o total daquele rótulo (~100%).
    const stacked = horizontal && !!this.options.stacked;

    const allValues = series.flatMap(s => s.data);
    const totalsPorLabel = this.labels.map((_, i) => series.reduce((soma, s) => soma + (s.data[i] || 0), 0));
    const maxValue = stacked ? Math.max(...totalsPorLabel, 1) : Math.max(...allValues, 1) * 1.15;

    // options.thickBars: pedido do usuário pros rankings de transportadoras (entregues vs.
    // vencidas) — barras mais grossas, com menos espaço vazio entre elas.
    const thick = !!this.options.thickBars;
    // options.barThicknessRatio/rowGapRatio (opcionais, 2026-09-11): override explícito dos 2
    // números abaixo, pra ajustar a densidade de UM hbar específico sem afetar os outros — ao
    // contrário de thickBars (mais grosso E menos vão), aqui às vezes se quer MAIS vão ENTRE as
    // barras E barra mais grossa ao mesmo tempo (ex.: "Cidades com maior custo por Kg", pedido
    // da usuária: "muito pequeno, espaço vazio grande embaixo"). Sem essas options, comportamento
    // idêntico a antes (thickBars continua funcionando igual pros gráficos que já o usavam).
    const innerBarRatio = this.options.barThicknessRatio ?? (thick ? 0.94 : 0.86);
    const gapRatio = this.options.rowGapRatio ?? (thick ? 0.14 : 0.28);
    const groupSize = horizontal ? plotH / n : plotW / n;
    const barGap = groupSize * gapRatio;
    const barSlot = groupSize - barGap;
    const barWidth = barSlot / series.length;

    this._hitboxes = [];

    this.labels.forEach((label, i) => {
      let offsetAcumulado = 0; // só usado em modo empilhado (stacked)
      series.forEach((s, si) => {
        const value = s.data[i] || 0;
        const ratio = value / maxValue;
        const color = s.color;
        // Linhas extras opcionais no tooltip (ex.: "Ranking de entregas sem Devolução" mostra
        // total saído + % de entrega, além do valor da própria barra) — série que não define
        // tooltipExtra fica com o tooltip simples de sempre (só "série: valor").
        const extra = s.tooltipExtra ? s.tooltipExtra[i] : null;

        if (horizontal) {
          const w = plotW * ratio;
          if (stacked) {
            const y = padding.top + i * groupSize + barGap / 2;
            const x = padding.left + offsetAcumulado;
            const h = barSlot * innerBarRatio;
            this._roundRect(ctx, x, y, w, h, 3, color);
            this._hitboxes.push({ x, y, w, h, label, value, color, series: s.name, extra, format: s.format });
            // Sem o fallback "desenha pro lado" que _drawValueInsideBar usa nas barras
            // agrupadas: aqui os segmentos ficam colados um no outro, então um rótulo vazando
            // pra fora invadiria visualmente o próximo pedaço — melhor só omitir.
            if (value > 0) {
              const valueText = `${Math.round(value)}%`;
              ctx.font = '600 11px Inter, system-ui, sans-serif';
              if (w > ctx.measureText(valueText).width + 10) {
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#fff';
                ctx.fillText(valueText, x + w / 2, y + h / 2);
              }
            }
            offsetAcumulado += w;
          } else {
            const y = padding.top + i * groupSize + barGap / 2 + si * barWidth;
            const x = padding.left;
            const h = barWidth * innerBarRatio;
            this._roundRect(ctx, x, y, w, h, 4, color);
            this._hitboxes.push({ x, y, w, h, label, value, color, series: s.name, extra, format: s.format });
            this._drawValueInsideBar(ctx, x, y, w, h, value, true);
          }
        } else {
          const x = padding.left + i * groupSize + barGap / 2 + si * barWidth;
          const h = plotH * ratio;
          const y = padding.top + plotH - h;
          const w = barWidth * innerBarRatio;
          this._roundRect(ctx, x, y, w, h, 4, color);
          this._hitboxes.push({ x, y, w, h, label, value, color, series: s.name, extra, format: s.format });
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
    const labelFont = '700 11px Inter, system-ui, sans-serif';

    this._points = [];

    series.forEach((s, si) => {
      // perSeriesScale: cada série usa o PRÓPRIO máximo pra posicionar os pontos no eixo Y —
      // o valor real (não normalizado) continua saindo certo na etiqueta/tooltip (this._fmt
      // usa s.format, não a posição no eixo).
      const serieMax = this.options.perSeriesScale ? Math.max(...s.data, 1) * 1.25 : maxValue;
      const pts = s.data.map((v, i) => ({
        x: padding.left + i * stepX,
        y: padding.top + plotH * (1 - v / serieMax),
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
      let lastLabelHalfWidth = 0;
      pts.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = s.color;
        ctx.stroke();
        this._points.push({ ...p, color: s.color, series: s.name, format: s.format, label: this.labels[i] });

        // "R$ 0,00" repetido em cada ponto sem movimento só poluiria o gráfico. O espaço
        // mínimo entre etiquetas é calculado pela LARGURA REAL de cada valor (não um passo
        // fixo) — um valor grande como "R$ 860.355,48" é bem mais largo que "R$ 1,00", e um
        // gap fixo deixava as "pills" grandes se sobrepondo mesmo com os pontos espaçados.
        const isLast = i === pts.length - 1;
        if (p.value !== 0) {
          const text = this._fmt(p.value, s.format);
          ctx.font = labelFont;
          const halfWidth = ctx.measureText(text).width / 2 + 7;
          const gapNeeded = lastLabelHalfWidth + halfWidth + 6;
          if (p.x - lastLabelX >= gapNeeded || isLast) {
            this._drawValuePill(ctx, p.x, p.y, text, s.color, si === 0);
            lastLabelX = p.x;
            lastLabelHalfWidth = halfWidth;
          }
        }
      });
    });

    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillStyle = text;
    const axisLabelStep = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(plotW / 60))));
    this.labels.forEach((label, i) => {
      if (i % axisLabelStep !== 0 && i !== n - 1) return;
      const x = padding.left + i * stepX;
      // Rótulo das pontas (primeiro/último mês) alinhado PRA DENTRO do gráfico, não
      // centralizado no ponto — com textAlign:'center' sempre, a etiqueta do último mês
      // (ex.: "Ago/26") tinha metade da própria largura projetada pra FORA do padding direito
      // (só 16px), cortada pela borda do canvas (pedido do usuário, 2026-08-29: "está cortado
      // a data agosto no final"). Os rótulos do meio continuam centralizados — lá sobra
      // espaço de sobra dos dois lados, sem risco de corte.
      if (i === 0) ctx.textAlign = 'left';
      else if (i === n - 1) ctx.textAlign = 'right';
      else ctx.textAlign = 'center';
      ctx.fillText(this._truncate(label, 8), x, this.height - 8);
    });
  }

  /* ---------- Combo (barra + linha, 2026-09-10) ----------
   * "Evolução do Frete": 1 série de BARRA (ex.: Valor do Frete) + N séries de LINHA (ex.: R$/kg,
   * % Frete) no mesmo gráfico, cada uma com sua PRÓPRIA escala vertical — nenhuma é forçada a
   * caber na escala da outra. Isso é seguro aqui porque este motor NUNCA desenha um eixo de
   * valores de verdade (ver _drawBars/_drawLineArea: sem régua lateral, cada barra/ponto mostra
   * o PRÓPRIO número certo) — diferente de um gráfico com eixo Y compartilhado (onde misturar
   * escalas pode enganar visualmente), aqui não existe régua nenhuma pra comparar visualmente
   * contra, só formas/tendência lado a lado + o valor real escrito em cada marca. Série com
   * `tipo: 'bar'` vira barra; qualquer outra (default) vira linha. */
  _drawCombo() {
    const ctx = this.ctx;
    const { text } = this._getColors();
    const series = this._currentSeries;
    const n = this.labels.length;
    if (n === 0) return;

    const seriesBarra = series.filter(s => s.tipo === 'bar');
    const seriesLinha = series.filter(s => s.tipo !== 'bar');

    // Padding maior que o padrão de _drawLineArea (2026-09-11, pedido da usuária: rótulos
    // colados/cortados na borda) — topo/base dão espaço pras "pills" das linhas nascerem sem
    // baterem no rótulo do eixo X nem na borda de cima; laterais dão folga pra pill do 1º/último
    // ponto não ficar espremida bem na quina do canvas.
    const padding = { top: 44, right: 28, bottom: 34, left: 28 };
    const plotW = this.width - padding.left - padding.right;
    const plotH = this.height - padding.top - padding.bottom;
    const stepX = n > 1 ? plotW / (n - 1) : 0;

    // Barras posicionadas pelo ÍNDICE no tempo (mesmo stepX das linhas, não o "groupSize" de
    // _drawBars, que é pra categorias discretas sem meio-caminho no eixo).
    //
    // Suporta valor NEGATIVO na barra (2026-09-10, "Evolução da Diferença de Frete" — uma
    // diferença de frete pode ser negativa num bucket, positiva noutro) — zeroY é calculado a
    // partir do maior valor positivo E do maior valor absoluto negativo juntos, cada lado
    // ganhando sua fatia proporcional da altura do gráfico. Quando TODOS os valores da série são
    // ≥0 (caso de sempre, "Evolução do Frete"), lowerRange fica 0 e a fórmula abaixo se reduz
    // EXATAMENTE à conta antiga (zeroY = base do gráfico, mesmo resultado de antes) — não muda
    // nada visualmente pros ~15 outros gráficos que já usam barra, só habilita bidirecional pra
    // quem precisar. `s.colors` (array paralelo a `s.data`, opcional) permite cor por barra —
    // sem isso, usa `s.color` fixo pra série inteira, igual sempre foi.
    this._hitboxes = [];
    if (seriesBarra.length) {
      const todosValores = seriesBarra.flatMap(s => s.data);
      const maiorPositivo = Math.max(0, ...todosValores) * 1.15 || 1;
      const maiorNegativoAbs = Math.abs(Math.min(0, ...todosValores)) * 1.15;
      const alcanceTotal = maiorPositivo + maiorNegativoAbs;
      const zeroY = padding.top + plotH * (maiorPositivo / alcanceTotal);
      const barWidth = Math.min(stepX * 0.5, 34);
      seriesBarra.forEach(s => {
        s.data.forEach((v, i) => {
          const cx = padding.left + i * stepX;
          const h = plotH * (Math.abs(v) / alcanceTotal);
          const x = cx - barWidth / 2;
          const y = v >= 0 ? zeroY - h : zeroY;
          const cor = (Array.isArray(s.colors) && s.colors[i]) ? s.colors[i] : s.color;
          this._roundRect(ctx, x, y, barWidth, h, 3, cor);
          this._hitboxes.push({ x, y, w: barWidth, h, label: this.labels[i], value: v, color: cor, series: s.name, format: s.format });
        });
      });
    }

    // Linhas: perSeriesScale sempre ligado aqui (não é opção — faz sentido universal pro combo,
    // já que barra e linha(s) nunca deveriam dividir a mesma régua mesmo). Pill alternando
    // acima/abaixo do ponto pra não sobrepor quando há 2+ linhas (mesmo truque de _drawLineArea) —
    // com anti-colisão de verdade (2026-09-11, pedido da usuária: "labels não podem ficar em cima
    // de barras/outros labels"): `occupied` começa com as barras já desenhadas (this._hitboxes é
    // {x,y,w,h} igual ao formato que _drawValuePillEsquivando espera) e cada pill nova testa
    // contra tudo que já foi colocado antes de decidir onde nascer.
    const occupied = this._hitboxes.slice();
    this._points = [];
    seriesLinha.forEach((s, si) => {
      const serieMax = Math.max(...s.data, 1) * 1.25;
      const pts = s.data.map((v, i) => ({
        x: padding.left + i * stepX,
        y: padding.top + plotH * (1 - v / serieMax),
        value: v
      }));

      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.moveTo(pts[0].x, pts[0].y);
      this._tracePath(ctx, pts);
      ctx.stroke();

      let lastLabelX = -Infinity;
      let lastLabelHalfWidth = 0;
      pts.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = s.color;
        ctx.stroke();
        this._points.push({ ...p, color: s.color, series: s.name, format: s.format, label: this.labels[i] });

        const isLast = i === pts.length - 1;
        if (p.value !== 0) {
          const valueText = this._fmt(p.value, s.format);
          ctx.font = '700 11px Inter, system-ui, sans-serif';
          const halfWidth = ctx.measureText(valueText).width / 2 + 7;
          const gapNeeded = lastLabelHalfWidth + halfWidth + 6;
          if (p.x - lastLabelX >= gapNeeded || isLast) {
            this._drawValuePillEsquivando(ctx, p.x, p.y, valueText, s.color, si % 2 === 0, occupied, padding.top, padding.top + plotH);
            lastLabelX = p.x;
            lastLabelHalfWidth = halfWidth;
          }
        }
      });
    });

    // Eixo X (categorias/tempo) — mesmo desenho de _drawLineArea.
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillStyle = text;
    const axisLabelStep = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(plotW / 60))));
    this.labels.forEach((label, i) => {
      if (i % axisLabelStep !== 0 && i !== n - 1) return;
      const x = padding.left + i * stepX;
      if (i === 0) ctx.textAlign = 'left';
      else if (i === n - 1) ctx.textAlign = 'right';
      else ctx.textAlign = 'center';
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

  /** Desenha o retângulo arredondado + texto de uma "pill" já posicionada — miolo visual
   * compartilhado por _drawValuePill (posição fixa) e _drawValuePillEsquivando (com
   * anti-colisão), pra não duplicar sombra/arredondamento/texto em 2 lugares. */
  _paintPillBox(ctx, boxX, boxY, boxW, boxH, valueText, color) {
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

  /** Etiqueta arredondada com o valor, flutuando acima (série principal) ou abaixo do ponto. */
  _drawValuePill(ctx, x, y, valueText, color, above) {
    ctx.font = '700 11px Inter, system-ui, sans-serif';
    const boxW = ctx.measureText(valueText).width + 14;
    const boxH = 19;
    // Trava a etiqueta dentro do canvas — senão a do primeiro/último ponto fica cortada.
    const boxX = Math.max(2, Math.min(x - boxW / 2, this.width - boxW - 2));
    const boxY = above ? y - 14 - boxH : y + 14;
    this._paintPillBox(ctx, boxX, boxY, boxW, boxH, valueText, color);
  }

  /** Como _drawValuePill, mas com anti-colisão de verdade (2026-09-11, pedido da usuária no
   * gráfico "Evolução do Frete"/"Evolução da Diferença de Frete": labels não podem ficar em
   * cima de barra nem de outro label, e nenhum pode ser cortado pelo canvas). `occupied` é a
   * lista de retângulos {x,y,w,h} já desenhados neste frame (barras + pills anteriores) — testa
   * 4 posições candidatas em ordem de preferência (lado preferido perto/longe, lado oposto
   * perto/longe) e usa a primeira que não colide com nada E cabe dentro do canvas; se nenhuma
   * limpar (caso raro), cai pra a preferida só travada dentro da tela — nunca omite o valor
   * (o pedido é "não sobrepor", não "esconder"). Sempre registra a box escolhida em `occupied`
   * antes de sair, pra a próxima pill já saber que ali está ocupado. */
  _drawValuePillEsquivando(ctx, x, y, valueText, color, preferAbove, occupied, boundTop, boundBottom) {
    ctx.font = '700 11px Inter, system-ui, sans-serif';
    const boxW = ctx.measureText(valueText).width + 14;
    const boxH = 19;
    const boxX = Math.max(2, Math.min(x - boxW / 2, this.width - boxW - 2));
    // Limites = a ÁREA DE PLOTAGEM (padding.top até padding.top+plotH), não o canvas inteiro —
    // usar this.height aqui deixava a pill "abaixo" invadir a faixa do rótulo do eixo X (bug
    // real, achado testando: "Mar/26" colidindo com o pill "2%" da % Frete quando o ponto fica
    // perto do fundo do gráfico).
    const margem = 4;

    const perto = [y - 14 - boxH, y + 14];
    const longe = [y - 14 - (boxH * 2 + 6), y + 14 + (boxH + 6)];
    const candidatos = preferAbove ? [perto[0], perto[1], longe[0], longe[1]] : [perto[1], perto[0], longe[1], longe[0]];

    const colide = (by) => occupied.some(o =>
      boxX < o.x + o.w && boxX + boxW > o.x && by < o.y + o.h && by + boxH > o.y
    );
    const dentroDosLimites = (by) => by >= boundTop + margem && by + boxH <= boundBottom - margem;

    let boxY = candidatos.find(by => dentroDosLimites(by) && !colide(by));
    if (boxY === undefined) boxY = Math.max(boundTop + margem, Math.min(candidatos[0], boundBottom - margem - boxH));

    this._paintPillBox(ctx, boxX, boxY, boxW, boxH, valueText, color);
    occupied.push({ x: boxX, y: boxY, w: boxW, h: boxH });
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
    if (!this.options.hideThinSliceLabels) {
      values.forEach(v => {
        const slice = (v / total) * Math.PI * 2;
        if (slice > 0 && slice <= 0.18) hasThinSlice = true;
      });
    }

    const depth = 22;
    const margin = hasThinSlice ? 74 : 16;
    // Fatia fina desenha o rótulo por fora, perto da borda de cima/baixo da elipse — sem
    // reservar espaço vertical extra pra isso, um card largo o bastante deixa a elipse tão
    // "gorda" (ry grande) que o rótulo de cima nasce colado (ou além) do topo do canvas e
    // corta, mesmo com o .chart-root--donut mais alto. Espelha o "margin" horizontal, só que
    // no eixo vertical, e limita ry (não só rx) independente da largura do card.
    const verticalMargin = hasThinSlice ? 70 : 22;
    const cx = this.width / 2;
    const cy = this.height / 2 - depth / 2;
    // Trava em 0: com o card pequeno demais (ou escondido), essa conta pode dar negativa, e
    // ctx.ellipse() lança IndexSizeError com raio negativo — sem nada pra desenhar, só sai.
    const rx = Math.max(0, Math.min(this.width / 2 - margin, (this.height - depth - verticalMargin) / 2 / 0.55));
    if (rx === 0) return;
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
    sliceDefs.forEach((s, i) => {
      // Fatia em hover (mouse na própria fatia OU no quadrado correspondente da legenda, ver
      // _onMove/_setLegendHover) ganha um brilho (shadowBlur) e borda branca — pedido da
      // usuária, 2026-09-09: "quero que brilhe a parte da pizza junto com o card".
      const hover = i === this._hoverIndex;
      ctx.save();
      if (hover) { ctx.shadowColor = s.color; ctx.shadowBlur = 18; }
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.ellipse(cx, cy, rx, ry, 0, s.start, s.end);
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = hover ? '#fff' : 'rgba(0,0,0,.1)';
      ctx.lineWidth = hover ? 2 : 1;
      ctx.stroke();

      const sw = s.end - s.start;
      const mid = s.start + sw / 2;
      const pct = (s.value / total) * 100;
      this._slices.push({ start: s.start, end: s.end, color: s.color, label: s.label, value: s.value, cx, cy, rx, ry, index: i });
      if (sw > 0.18) bigSlices.push({ mid, pct });
      else if (s.value > 0 && !this.options.hideThinSliceLabels) thinSlices.push({ mid, pct, color: s.color });
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
      if (found) {
        found = {
          label: found.label,
          lines: [`${found.series}: ${this._fmt(found.value, found.format)}`, ...(found.extra || [])],
          color: found.color
        };
      }
    } else if (this.type === 'line' || this.type === 'area') {
      const near = (this._points || []).find(p => Math.hypot(p.x - x, p.y - y) < 10);
      if (near) found = { label: near.label, lines: [`${near.series}: ${this._fmt(near.value, near.format)}`], color: near.color };
    } else if (this.type === 'combo') {
      // Barra primeiro (área retangular, mais fácil de acertar), linha como fallback (raio de
      // 10px em torno do ponto) — mesmos critérios já usados separadamente pra 'bar' e 'line'.
      found = (this._hitboxes || []).find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      if (found) {
        found = { label: found.label, lines: [`${found.series}: ${this._fmt(found.value, found.format)}`], color: found.color };
      } else {
        const near = (this._points || []).find(p => Math.hypot(p.x - x, p.y - y) < 10);
        if (near) found = { label: near.label, lines: [`${near.series}: ${this._fmt(near.value, near.format)}`], color: near.color };
      }
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

        // Sentido fatia -> quadrado do hover sincronizado (ver _bindEvents pro sentido inverso).
        const hoverIdx = slice ? slice.index : -1;
        if (hoverIdx !== this._hoverIndex) {
          this._hoverIndex = hoverIdx;
          this._setLegendHover(hoverIdx);
          this._draw(1);
        }
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

  _onLeave() {
    this.tooltip.classList.remove('chart-tooltip--visible');
    if (this._hoverIndex !== -1) {
      this._hoverIndex = -1;
      this._setLegendHover(-1);
      this._draw(1);
    }
  }

  /** `format` (opcional, por série: "currency" ou "number") sobrepõe options.currency —
   * usado quando duas séries no MESMO gráfico representam grandezas diferentes (ver
   * perSeriesScale), então cada uma precisa do seu próprio formato de etiqueta. */
  _fmt(value, format) {
    if (format === 'currency') return Utils.formatCurrency(value);
    if (format === 'number') return Utils.formatNumber(Math.round(value));
    if (format === 'percent') return `${Math.round(value)}%`;
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
