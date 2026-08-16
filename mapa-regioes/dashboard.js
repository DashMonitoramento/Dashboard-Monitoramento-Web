/**
 * Dashboard Logístico por Região — Da Terrinha Alimentos
 *
 * Fontes de dados (ambas locais, sem chave de API):
 *  - dados_regioes.json: indicadores agregados por região comercial (RC01..RC13).
 *  - regioes_comerciais.geojson: geometria das 12 regiões com território real (RC13,
 *    "Exterior / Não mapeado", não tem geografia própria e por isso não aparece no mapa).
 *
 * Observação sobre os filtros de Supervisor/Vendedor/Categoria de transporte: a fonte de
 * dados atual (dados_regioes.json) só traz totais agregados por região — não tem essas
 * dimensões por nota. Os campos continuam na tela (desabilitados, com um título explicando o
 * motivo) para não fugir do layout pedido, mas não inventam opções/valores que não existem
 * nos dados reais.
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
    let chartEntregas = null;
    let chartRanking = null;

    function regiaoPorCodigo(codigo) {
      return regioes.find((r) => r.codigo === codigo) || null;
    }

    /* ============================================================
     * CARREGAMENTO
     * ============================================================ */

    async function carregarTudo(cacheBust) {
      const sufixo = cacheBust ? `?t=${Date.now()}` : '';
      const [respDados, respGeo] = await Promise.all([
        fetch(JSON_URL + sufixo),
        fetch(GEOJSON_URL + sufixo),
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

      popularFiltroRegiao();
      inicializarOuAtualizarMapa();
      atualizarKpis(regiaoSelecionada);
      renderizarGraficoEntregas();
      renderizarRanking();
    }

    function popularFiltroRegiao() {
      const select = document.getElementById('filtro-regiao');
      const valorAtual = select.value;
      select.innerHTML = '<option value="">Todas as regiões</option>' +
        regioes.map((r) => `<option value="${r.codigo}">${escapeHtml(r.regiao)}</option>`).join('');
      if (regioes.some((r) => r.codigo === valorAtual)) select.value = valorAtual;
    }

    function escapeHtml(str) {
      return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    /* ============================================================
     * MAPA (Leaflet)
     * ============================================================ */

    function inicializarOuAtualizarMapa() {
      if (!geojson) return;
      if (!mapaLeaflet) {
        mapaLeaflet = L.map('mapa', { attributionControl: false, zoomControl: true });
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
    }

    function estiloRegiao(feature) {
      const dados = regiaoPorCodigo(feature.properties.codigo);
      const cor = dados ? corPorPercentual(dados.percentual_entregue) : '#7f8c8d';
      const selecionada = regiaoSelecionada === feature.properties.codigo;
      return {
        fillColor: cor,
        fillOpacity: selecionada ? 0.9 : 0.7,
        color: selecionada ? '#ffffff' : '#222222',
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
      if (camadaGeojson) camadaGeojson.eachLayer((layer) => layer.setStyle(estiloRegiao(layer.feature)));
      document.getElementById('filtro-regiao').value = regiaoSelecionada || '';
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
     * uma lib externa (chartjs-plugin-datalabels) só pra isso. */
    const pluginValoresAcimaDaBarra = {
      id: 'valoresAcimaDaBarra',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.font = '10px Segoe UI, Arial, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        chart.data.datasets.forEach((dataset, di) => {
          const meta = chart.getDatasetMeta(di);
          if (meta.hidden) return;
          meta.data.forEach((elemento, i) => {
            const valor = dataset.data[i];
            if (!valor) return;
            ctx.fillText(String(valor), elemento.x, elemento.y - 4);
          });
        });
        ctx.restore();
      },
    };

    function regioesParaGrafico() {
      const filtroRegiao = document.getElementById('filtro-regiao').value;
      return filtroRegiao ? regioes.filter((r) => r.codigo === filtroRegiao) : regioes;
    }

    function renderizarGraficoEntregas() {
      const canvas = document.getElementById('grafico-entregas');
      if (!canvas || typeof Chart === 'undefined') return;
      const filtroStatus = document.getElementById('filtro-status').value;
      const lista = regioesParaGrafico();

      const chaves = filtroStatus ? [filtroStatus] : ['entregues', 'reentregas', 'devolucoes', 'em_aberto'];
      const datasets = chaves.map((chave) => ({
        label: LABELS_STATUS[chave],
        backgroundColor: CORES_STATUS[chave],
        data: lista.map((r) => r[chave] || 0),
      }));

      if (chartEntregas) chartEntregas.destroy();
      chartEntregas = new Chart(canvas, {
        type: 'bar',
        data: { labels: lista.map((r) => r.regiao), datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#ffffff' } },
            tooltip: { mode: 'index', intersect: false },
          },
          scales: {
            x: { ticks: { color: '#dddddd', maxRotation: 45, minRotation: 0 }, grid: { color: '#4d4d4d' } },
            y: { beginAtZero: true, ticks: { color: '#dddddd' }, grid: { color: '#4d4d4d' } },
          },
        },
        plugins: [pluginValoresAcimaDaBarra],
      });
    }

    /* ============================================================
     * RANKING LATERAL — Desempenho das regiões
     * ============================================================ */

    function renderizarRanking() {
      const canvas = document.getElementById('grafico-ranking');
      if (!canvas || typeof Chart === 'undefined') return;

      const ordenado = regioes
        .filter((r) => r.percentual_entregue !== null && r.percentual_entregue !== undefined)
        .slice()
        .sort((a, b) => b.percentual_entregue - a.percentual_entregue);

      const n = ordenado.length || 1;
      const tonsAzul = ordenado.map((_, i) => {
        // Do azul claro (topo do ranking) ao azul escuro (fim) — mesma família de cor da
        // imagem de referência, variando só a luminosidade por posição.
        const t = n > 1 ? i / (n - 1) : 0;
        const claro = [93, 173, 226];   // #5DADE2
        const escuro = [21, 67, 96];    // #154360
        const rgb = claro.map((c, idx) => Math.round(c + (escuro[idx] - c) * t));
        return `rgb(${rgb.join(',')})`;
      });

      if (chartRanking) chartRanking.destroy();
      chartRanking = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: ordenado.map((r) => r.regiao),
          datasets: [{
            label: '% Entregue',
            data: ordenado.map((r) => Number(r.percentual_entregue.toFixed(1))),
            backgroundColor: tonsAzul,
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
            x: { beginAtZero: true, max: 100, ticks: { color: '#dddddd', callback: (v) => `${v}%` }, grid: { color: '#4d4d4d' } },
            y: { ticks: { color: '#ffffff' }, grid: { color: '#4d4d4d' } },
          },
        },
      });
    }

    /* ============================================================
     * FILTROS
     * ============================================================ */

    function aplicarFiltros() {
      const codigo = document.getElementById('filtro-regiao').value;
      regiaoSelecionada = codigo || null;
      if (camadaGeojson) camadaGeojson.eachLayer((layer) => layer.setStyle(estiloRegiao(layer.feature)));
      atualizarKpis(regiaoSelecionada);
      renderizarGraficoEntregas();
    }

    function limparFiltros() {
      document.getElementById('filtro-data-inicio').value = '';
      document.getElementById('filtro-data-fim').value = '';
      document.getElementById('filtro-regiao').value = '';
      document.getElementById('filtro-status').value = '';
      regiaoSelecionada = null;
      if (camadaGeojson) camadaGeojson.eachLayer((layer) => layer.setStyle(estiloRegiao(layer.feature)));
      atualizarKpis(null);
      renderizarGraficoEntregas();
    }

    async function atualizarDados() {
      const botao = document.getElementById('btn-atualizar-dados');
      const textoOriginal = botao.textContent;
      botao.textContent = 'Atualizando...';
      botao.disabled = true;
      try {
        await carregarTudo(true);
      } catch (err) {
        mostrarErroCarregamento(err.message);
      } finally {
        botao.textContent = textoOriginal;
        botao.disabled = false;
      }
    }

    function bindEventos() {
      document.getElementById('btn-aplicar-filtros').addEventListener('click', aplicarFiltros);
      document.getElementById('btn-limpar-filtros').addEventListener('click', limparFiltros);
      document.getElementById('btn-atualizar-dados').addEventListener('click', atualizarDados);
      window.addEventListener('resize', () => { if (mapaLeaflet) mapaLeaflet.invalidateSize(); });
    }

    async function init() {
      bindEventos();
      try {
        await carregarTudo(false);
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
