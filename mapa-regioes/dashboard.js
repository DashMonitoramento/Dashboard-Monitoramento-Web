/**
 * Dashboard Logístico por Região — Da Terrinha Alimentos
 *
 * Fontes de dados (ambas locais, sem chave de API):
 *  - dados_regioes.json: indicadores agregados por região comercial (RC01..RC13).
 *  - regioes_comerciais.geojson: geometria das 12 regiões com território real (RC13,
 *    "Exterior / Não mapeado", não tem geografia própria e por isso não aparece no mapa).
 *
 * Sem filtros próprios (decisão do usuário, 2026-08-16) — essa tela usa os filtros já
 * existentes na barra lateral do Dashboard de Entregas (que embute essa página num iframe),
 * incluindo o filtro "Região Comercial" adicionado lá.
 */

(() => {
  'use strict';

  const JSON_URL = './dados_regioes.json';
  const GEOJSON_URL = './regioes_comerciais.geojson';

  const CORES_STATUS = {
    entregues: '#f1c40f',   // amarelo
    reentregas: '#e67e22',  // laranja
    devolucoes: '#e74c3c',  // vermelho
    em_aberto: '#3498db',   // azul
  };
  const LABELS_STATUS = {
    entregues: 'Entregues',
    reentregas: 'Reentregas',
    devolucoes: 'Devoluções',
    em_aberto: 'Em aberto',
  };

  const Utils = {
    numero(v) { return new Intl.NumberFormat('pt-BR').format(v || 0); },
    moeda(v) { return (v || v === 0) ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Sem dados'; },
    percentual(v) { return (v || v === 0) ? `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : 'Sem dados'; },
    dias(v) { return (v || v === 0) ? `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} dias` : 'Sem dados'; },
    dataHora(iso) {
      if (!iso) return 'Sem dados';
      const d = new Date(iso);
      if (isNaN(d)) return 'Sem dados';
      return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    },
    data(iso) {
      if (!iso) return 'Sem dados';
      const d = new Date(iso);
      if (isNaN(d)) return 'Sem dados';
      return d.toLocaleDateString('pt-BR');
    },
  };

  /** Rótulo curto pra escrever dentro/perto de cada região no mapa (estilo "sigla de UF" do
   * mapa de referência) — como 5 das 12 regiões juntam vários estados numa forma só (Sul,
   * Centro-Oeste, Nordeste, Norte) ou são pedaços de um único estado (as 4 de SP), usei um
   * código curto próprio em vez da sigla de UF literal, que não existe 1:1 pra essas. */
  const ROTULO_CURTO = {
    RC01: 'Cap', RC02: 'GSP', RC03: 'BS', RC04: 'Int',
    RC05: 'RJ', RC06: 'MG', RC07: 'ES', RC08: 'PR',
    RC09: 'Sul', RC10: 'CO', RC11: 'NE', RC12: 'N',
  };

  /** Verde >=98% / Amarelo 95-97,99% / Laranja 90-94,99% / Vermelho <90% / Cinza sem dado. */
  function corPorPercentual(percentual) {
    if (percentual === null || percentual === undefined || isNaN(percentual)) return '#7f8c8d';
    if (percentual >= 98) return '#2ecc71';
    if (percentual >= 95) return '#f1c40f';
    if (percentual >= 90) return '#e67e22';
    return '#e74c3c';
  }

  /** Soma os campos numéricos de uma lista de regiões — usado pro KPI "Todas as regiões" e
   * pra recalcular o % entregue/prazo médio ponderado corretamente (não é a média simples dos
   * percentuais de cada região, e sim entregues/total do conjunto). */
  function agregarRegioes(regioes) {
    const base = {
      total_notas: 0, entregues: 0, reentregas: 0, devolucoes: 0, cancelados: 0, em_aberto: 0,
      valor_nf: 0, quantidade_cidades: 0, quantidade_supervisores: 0, quantidade_vendedores: 0,
    };
    let somaPrazoPonderada = 0;
    for (const r of regioes) {
      base.total_notas += r.total_notas || 0;
      base.entregues += r.entregues || 0;
      base.reentregas += r.reentregas || 0;
      base.devolucoes += r.devolucoes || 0;
      base.cancelados += r.cancelados || 0;
      base.em_aberto += r.em_aberto || 0;
      base.valor_nf += r.valor_nf || 0;
      base.quantidade_cidades += r.quantidade_cidades || 0;
      base.quantidade_supervisores += r.quantidade_supervisores || 0;
      base.quantidade_vendedores += r.quantidade_vendedores || 0;
      somaPrazoPonderada += (r.prazo_medio_dias || 0) * (r.total_notas || 0);
    }
    base.percentual_entregue = base.total_notas ? (base.entregues / base.total_notas) * 100 : null;
    base.prazo_medio_dias = base.total_notas ? somaPrazoPonderada / base.total_notas : null;
    return base;
  }

  const Dashboard = (() => {
    let regioes = [];         // lista carregada de dados_regioes.json
    let geojson = null;       // FeatureCollection carregado
    let regiaoSelecionada = null; // codigo (ex.: "RC01") ou null = todas
    let mapaLeaflet = null;
    let camadaGeojson = null;
    let rotulosRegiao = []; // marcadores com o código curto de cada região (ver ROTULO_CURTO)
    let chartEntregas = null;
    let chartRanking = null;

    function regiaoPorCodigo(codigo) {
      return regioes.find((r) => r.codigo === codigo) || null;
    }

    /* ============================================================
     * CARREGAMENTO
     * ============================================================ */

    async function carregarTudo() {
      const [respDados, respGeo] = await Promise.all([
        fetch(JSON_URL),
        fetch(GEOJSON_URL),
      ]);
      if (!respDados.ok) throw new Error('Não foi possível carregar dados_regioes.json.');
      if (!respGeo.ok) throw new Error('Não foi possível carregar regioes_comerciais.geojson.');
      const dados = await respDados.json();
      const geo = await respGeo.json();
      regioes = Array.isArray(dados.regioes) ? dados.regioes : [];
      geojson = geo;
      renderizarTudo(dados);
    }

    function mostrarErroCarregamento(mensagem) {
      const mapaEl = document.getElementById('mapa');
      if (mapaEl) {
        mapaEl.outerHTML = `<div class="mapa-mensagem-erro" id="mapa">⚠️ ${mensagem}<br>Confira se os arquivos "dados_regioes.json" e "regioes_comerciais.geojson" estão na mesma pasta do site.</div>`;
      }
      document.getElementById('texto-atualizado').textContent = 'Sem dados — falha ao carregar.';
      atualizarKpis(null, 'Sem dados');
    }

    /* ============================================================
     * RENDER GERAL
     * ============================================================ */

    function renderizarTudo(dadosCompletos) {
      const textoAtualizado = document.getElementById('texto-atualizado');
      textoAtualizado.textContent =
        `Período: ${Utils.data(dadosCompletos.periodo_inicio)} até ${Utils.data(dadosCompletos.periodo_fim)} ` +
        `· Atualizado em ${Utils.dataHora(dadosCompletos.atualizado_em)}`;

      inicializarOuAtualizarMapa();
      atualizarKpis(regiaoSelecionada);
      renderizarGraficoEntregas();
      renderizarRanking();
    }

    function escapeHtml(str) {
      return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    /* ============================================================
     * MAPA (Leaflet)
     * ============================================================ */

    /** Mapa fixo, sem zoom nem arrasto (decisão do usuário, 2026-08-16) — é só uma ilustração
     * territorial pra olhar/passar o mouse/clicar, não uma ferramenta de navegação. Desliga
     * TODOS os controles de zoom/pan do Leaflet; só a interação com as regiões (hover/clique)
     * continua funcionando, via os listeners de cada camada (ver configurarInteracaoRegiao). */
    function inicializarOuAtualizarMapa() {
      if (!geojson) return;
      if (!mapaLeaflet) {
        mapaLeaflet = L.map('mapa', {
          attributionControl: false,
          zoomControl: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          boxZoom: false,
          touchZoom: false,
          dragging: false,
          keyboard: false,
          tap: false,
        });
      }
      if (camadaGeojson) {
        camadaGeojson.remove();
      }
      camadaGeojson = L.geoJSON(geojson, {
        style: estiloRegiao,
        onEachFeature: configurarInteracaoRegiao,
      }).addTo(mapaLeaflet);

      const bounds = camadaGeojson.getBounds();
      if (bounds.isValid()) mapaLeaflet.fitBounds(bounds, { padding: [12, 12] });

      desenharRotulosRegiao();
    }

    /** Um marcador de texto (sigla curta, ver ROTULO_CURTO) no centro de cada região — mesmo
     * estilo do mapa de referência do usuário, que mostra a sigla de cada estado por cima da
     * cor. Usa o centro do retângulo que envolve a forma (getBounds().getCenter()) — não é o
     * centro geométrico exato pra formas muito recortadas/espalhadas (ex.: "Norte", que junta
     * 7 estados), mas é uma aproximação razoável sem precisar de uma lib de geometria no
     * navegador só pra isso. */
    function desenharRotulosRegiao() {
      rotulosRegiao.forEach((marcador) => marcador.remove());
      rotulosRegiao = [];
      camadaGeojson.eachLayer((layer) => {
        const codigo = layer.feature.properties.codigo;
        const rotulo = ROTULO_CURTO[codigo];
        if (!rotulo) return;
        const marcador = L.marker(layer.getBounds().getCenter(), {
          interactive: false,
          icon: L.divIcon({ className: 'rotulo-regiao', html: rotulo, iconSize: [40, 16] }),
        }).addTo(mapaLeaflet);
        rotulosRegiao.push(marcador);
      });
    }

    /** className "regiao-relevo" dá um leve efeito de relevo (sombra suave por CSS, ver
     * dashboard.css) pedido pelo usuário ("se der, no mesmo modelo com relevo") — sem precisar
     * de textura/imagem de terreno, só uma sombra sutil por cima do preenchimento flat. */
    function estiloRegiao(feature) {
      const dados = regiaoPorCodigo(feature.properties.codigo);
      const cor = dados ? corPorPercentual(dados.percentual_entregue) : '#7f8c8d';
      const selecionada = regiaoSelecionada === feature.properties.codigo;
      return {
        className: 'regiao-relevo',
        fillColor: cor,
        fillOpacity: selecionada ? 0.9 : 0.75,
        color: selecionada ? '#ffffff' : '#1a1a1a',
        weight: selecionada ? 2.5 : 1,
      };
    }

    function montarTooltipHtml(feature) {
      const dados = regiaoPorCodigo(feature.properties.codigo);
      const nome = feature.properties.regiao;
      if (!dados) {
        return `<div class="mapa-tooltip"><strong>${escapeHtml(nome)}</strong><br>Sem dados</div>`;
      }
      return `
        <div class="mapa-tooltip">
          <strong>${escapeHtml(nome)}</strong>
          <div class="linha"><span>Total de notas</span><span>${Utils.numero(dados.total_notas)}</span></div>
          <div class="linha"><span>Entregue</span><span>${Utils.numero(dados.entregues)}</span></div>
          <div class="linha"><span>% Entregue</span><span>${Utils.percentual(dados.percentual_entregue)}</span></div>
          <div class="linha"><span>Reentregas</span><span>${Utils.numero(dados.reentregas)}</span></div>
          <div class="linha"><span>Devoluções</span><span>${Utils.numero(dados.devolucoes)}</span></div>
          <div class="linha"><span>Cancelamentos</span><span>${Utils.numero(dados.cancelados)}</span></div>
          <div class="linha"><span>Em aberto</span><span>${Utils.numero(dados.em_aberto)}</span></div>
          <div class="linha"><span>Valor total</span><span>${Utils.moeda(dados.valor_nf)}</span></div>
          <div class="linha"><span>Prazo médio</span><span>${Utils.dias(dados.prazo_medio_dias)}</span></div>
          <div class="linha"><span>Cidades</span><span>${Utils.numero(dados.quantidade_cidades)}</span></div>
          <div class="linha"><span>Vendedores</span><span>${Utils.numero(dados.quantidade_vendedores)}</span></div>
          <div class="linha"><span>Supervisores</span><span>${Utils.numero(dados.quantidade_supervisores)}</span></div>
        </div>`;
    }

    function configurarInteracaoRegiao(feature, layer) {
      layer.bindTooltip(() => montarTooltipHtml(feature), { sticky: true });
      layer.on('mouseover', () => layer.setStyle({ weight: 2.5 }));
      layer.on('mouseout', () => layer.setStyle(estiloRegiao(feature)));
      layer.on('click', () => selecionarRegiao(feature.properties.codigo));
    }

    /* ============================================================
     * SELEÇÃO DE REGIÃO (mapa/ranking) -> atualiza os cards de KPI
     * ============================================================ */

    function selecionarRegiao(codigo) {
      regiaoSelecionada = regiaoSelecionada === codigo ? null : codigo; // clicar de novo desmarca
      if (camadaGeojson) {
        camadaGeojson.eachLayer((layer) => {
          layer.setStyle(estiloRegiao(layer.feature));
          // Pulso rápido na região que acabou de virar a selecionada — feedback visual da troca
          // (pedido do usuário: "relevo... quando muda de região").
          if (layer.feature.properties.codigo === regiaoSelecionada) {
            const elemento = layer.getElement && layer.getElement();
            if (elemento) {
              elemento.classList.remove('regiao-pulso');
              void elemento.offsetWidth; // força reflow pra reiniciar a animação
              elemento.classList.add('regiao-pulso');
            }
          }
        });
      }
      atualizarKpis(regiaoSelecionada);
    }

    function atualizarKpis(codigo, mensagemSemDados) {
      const titulo = document.getElementById('kpis-titulo');
      let dados;
      if (mensagemSemDados) {
        titulo.textContent = `Indicadores — ${mensagemSemDados}`;
        dados = null;
      } else if (codigo) {
        const regiao = regiaoPorCodigo(codigo);
        titulo.textContent = `Indicadores — ${regiao ? regiao.regiao : codigo}`;
        dados = regiao;
      } else {
        titulo.textContent = 'Indicadores — Todas as regiões';
        dados = regioes.length ? agregarRegioes(regioes) : null;
      }

      const $ = (id) => document.getElementById(id);
      $('kpi-total-notas').textContent = dados ? Utils.numero(dados.total_notas) : '0';
      $('kpi-entregues').textContent = dados ? Utils.numero(dados.entregues) : '0';
      $('kpi-percentual').textContent = dados ? Utils.percentual(dados.percentual_entregue) : 'Sem dados';
      $('kpi-reentregas').textContent = dados ? Utils.numero(dados.reentregas) : '0';
      $('kpi-devolucoes').textContent = dados ? Utils.numero(dados.devolucoes) : '0';
      $('kpi-valor').textContent = dados ? Utils.moeda(dados.valor_nf) : 'Sem dados';
      $('kpi-prazo').textContent = dados ? Utils.dias(dados.prazo_medio_dias) : 'Sem dados';
    }

    /* ============================================================
     * GRÁFICO CENTRAL — Entregas e ocorrências por região
     * ============================================================ */

    /** Plugin mínimo do Chart.js pra escrever o valor acima de cada barra — evita depender de
     * uma lib externa (chartjs-plugin-datalabels) só pra isso.
     *
     * Contorno escuro atrás do texto branco (stroke antes do fill) — sem isso, valores baixos
     * (barra bem curta, o número praticamente colado no eixo/nas barras vizinhas do grupo)
     * ficavam difíceis de ler contra o fundo escuro do painel; o contorno garante contraste
     * não importa o que esteja atrás (decisão do usuário, 2026-08-16). */
    const pluginValoresAcimaDaBarra = {
      id: 'valoresAcimaDaBarra',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.font = 'bold 10px Segoe UI, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(15,23,42,.9)';
        ctx.fillStyle = '#ffffff';
        chart.data.datasets.forEach((dataset, di) => {
          const meta = chart.getDatasetMeta(di);
          if (meta.hidden) return;
          meta.data.forEach((elemento, i) => {
            const valor = dataset.data[i];
            if (!valor) return;
            const texto = String(valor);
            ctx.strokeText(texto, elemento.x, elemento.y - 4);
            ctx.fillText(texto, elemento.x, elemento.y - 4);
          });
        });
        ctx.restore();
      },
    };

    function renderizarGraficoEntregas() {
      const canvas = document.getElementById('grafico-entregas');
      if (!canvas || typeof Chart === 'undefined') return;
      const lista = regioes;

      const chaves = ['entregues', 'reentregas', 'devolucoes', 'em_aberto'];
      const datasets = chaves.map((chave) => ({
        label: LABELS_STATUS[chave],
        backgroundColor: CORES_STATUS[chave],
        data: lista.map((r) => r[chave] || 0),
      }));

      // Legenda e grades removidas de propósito (decisão do usuário, 2026-08-16) — passar o
      // mouse já mostra Entregues/Reentregas/Devoluções/Em aberto no tooltip; os quadradinhos
      // coloridos da legenda só duplicavam essa informação ocupando espaço.
      if (chartEntregas) chartEntregas.destroy();
      chartEntregas = new Chart(canvas, {
        type: 'bar',
        data: { labels: lista.map((r) => r.regiao), datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { mode: 'index', intersect: false },
          },
          scales: {
            x: { ticks: { color: '#dddddd', maxRotation: 45, minRotation: 0 }, grid: { display: false } },
            y: { beginAtZero: true, ticks: { color: '#dddddd' }, grid: { display: false } },
          },
        },
        plugins: [pluginValoresAcimaDaBarra],
      });
    }

    /* ============================================================
     * RANKING LATERAL — Desempenho das regiões
     * ============================================================ */

    const COR_RANKING = '#2563EB';        // mesma cor pra todas as barras (decisão do usuário)
    const COR_RANKING_BRILHO = 'rgba(37,99,235,.95)';

    /** Escreve o "% Entregue" DENTRO da barra, encostado na ponta direita — em vez de deixar
     * o eixo X mostrar uma escala de porcentagem embaixo (removida, ver "scales.x.display"
     * abaixo) e em vez de uma legenda separada (decisão do usuário, 2026-08-16). */
    const pluginPercentualNaBarra = {
      id: 'percentualNaBarra',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.font = 'bold 11px Segoe UI, Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        meta.data.forEach((elemento, i) => {
          const valor = chart.data.datasets[0].data[i];
          ctx.fillText(`${valor}%`, elemento.x - 8, elemento.y);
        });
        ctx.restore();
      },
    };

    /** Brilho (glow) que intensifica na barra sob o mouse — Chart.js já troca a cor pra
     * "hoverBackgroundColor" sozinho; esse plugin só desenha uma sombra difusa atrás da barra
     * ativa ANTES dela ser redesenhada, then Chart.js finishes drawing on top of it. */
    const pluginBrilhoNoHover = {
      id: 'brilhoNoHover',
      beforeDatasetsDraw(chart) {
        const ativos = chart.getActiveElements();
        if (!ativos.length) return;
        const { ctx } = chart;
        ctx.save();
        ctx.shadowColor = COR_RANKING_BRILHO;
        ctx.shadowBlur = 18;
        ativos.forEach(({ element }) => {
          ctx.fillStyle = COR_RANKING_BRILHO;
          ctx.fillRect(element.base, element.y - element.height / 2, element.x - element.base, element.height);
        });
        ctx.restore();
      },
    };

    function renderizarRanking() {
      const canvas = document.getElementById('grafico-ranking');
      if (!canvas || typeof Chart === 'undefined') return;

      const ordenado = regioes
        .filter((r) => r.percentual_entregue !== null && r.percentual_entregue !== undefined)
        .slice()
        .sort((a, b) => b.percentual_entregue - a.percentual_entregue);

      if (chartRanking) chartRanking.destroy();
      chartRanking = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: ordenado.map((r) => r.regiao),
          datasets: [{
            label: '% Entregue',
            data: ordenado.map((r) => Number(r.percentual_entregue.toFixed(1))),
            backgroundColor: COR_RANKING,
            hoverBackgroundColor: COR_RANKING_BRILHO,
          }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          onClick: (evt, elementos) => {
            if (!elementos.length) return;
            const regiao = ordenado[elementos[0].index];
            selecionarRegiao(regiao.codigo);
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label(contexto) {
                  const regiao = ordenado[contexto.dataIndex];
                  return [
                    `% Entregue: ${Utils.percentual(regiao.percentual_entregue)}`,
                    `Valor total: ${Utils.moeda(regiao.valor_nf)}`,
                  ];
                },
              },
            },
          },
          scales: {
            // Sem eixo/grade — o valor já aparece dentro da própria barra (pluginPercentualNaBarra).
            x: { display: false, beginAtZero: true, max: 100 },
            y: { ticks: { color: '#ffffff' }, grid: { display: false } },
          },
        },
        plugins: [pluginBrilhoNoHover, pluginPercentualNaBarra],
      });
    }

    function bindEventos() {
      window.addEventListener('resize', () => { if (mapaLeaflet) mapaLeaflet.invalidateSize(); });
    }

    async function init() {
      bindEventos();
      try {
        await carregarTudo();
      } catch (err) {
        mostrarErroCarregamento(err.message);
      }
    }

    return { init, corPorPercentual, agregarRegioes };
  })();

  if (typeof window !== 'undefined') {
    window.Dashboard = Dashboard;
    window.Utils = Utils;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', Dashboard.init);
    } else {
      Dashboard.init();
    }
  }
  if (typeof module !== 'undefined') module.exports = { corPorPercentual, agregarRegioes };
})();
