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
 *
 * Dados ao vivo (decisão do usuário, 2026-08-16): quando embutida num iframe, essa página
 * avisa o pai que terminou de carregar ("mapa-regioes:pronto") e passa a receber, por
 * postMessage, os totais por região já recalculados com os filtros atuais (ver
 * enviarDadosRegioesParaIframe em js/dashboard.js do site principal). dados_regioes.json
 * continua sendo usado pro carregamento inicial (e é a ÚNICA fonte quando a página é aberta
 * sozinha, fora do iframe) — a mensagem do pai só chega DEPOIS, sobrescrevendo os números.
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

  // As 4 regiões comerciais de São Paulo — ocupam uma área geográfica pequena demais pra caber
  // sigla + nome legíveis no mapa nacional sem sobrepor (decisão do usuário, 2026-08-16): em vez
  // de tentar rotular essas 4 no mapa do Brasil, elas ganham um mapa de detalhe dedicado (ver
  // inicializarOuAtualizarDetalheSp) e saem da lista de rótulos do mapa nacional (ver
  // desenharRotulosRegiao) — a cor de cada uma continua aparecendo normalmente lá.
  const CODIGOS_SP = ['RC01', 'RC02', 'RC03', 'RC04'];

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
    let somaPrazoDias = 0, quantidadeComPrazo = 0;
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
      // Pondera pela quantidade de notas que de fato entraram no cálculo de prazo de cada
      // região (quantidade_com_prazo), não pelo total_notas — a maioria das notas de uma região
      // não tem prazo computável (ainda não entregue, ou faltam as datas), então ponderar pelo
      // total_notas sub-estimaria a média nas regiões com mais notas ainda em aberto.
      somaPrazoDias += r.soma_prazo_dias || 0;
      quantidadeComPrazo += r.quantidade_com_prazo || 0;
    }
    base.percentual_entregue = base.total_notas ? (base.entregues / base.total_notas) * 100 : null;
    base.prazo_medio_dias = quantidadeComPrazo ? somaPrazoDias / quantidadeComPrazo : null;
    base.soma_prazo_dias = somaPrazoDias;
    base.quantidade_com_prazo = quantidadeComPrazo;
    return base;
  }

  const Dashboard = (() => {
    let regioes = [];         // lista carregada de dados_regioes.json
    let geojson = null;       // FeatureCollection carregado
    let regiaoSelecionada = null; // codigo (ex.: "RC01") ou null = todas
    let mapaLeaflet = null;
    let camadaGeojson = null;
    let rotulosRegiao = []; // marcadores com o código curto de cada região (ver ROTULO_CURTO)
    let visualizacaoPrincipal = 'brasil'; // 'brasil' (todo o país) | 'sp' (zoom nas 4 regiões de SP)
    let mapaDetalheSp = null;
    // "Chamada" (linha guia + caixa deslocada) no lugar do tooltip em cima da região — decisão
    // do usuário (2026-08-23, com esboço anexado): a caixa cobria a própria região que se
    // queria examinar. `linhaChamada` é a única linha guia visível por vez (some ao trocar de
    // região ou ao tirar o mouse).
    let linhaChamada = null;
    let camadaDetalheSp = null;
    let rotulosDetalheSp = [];
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
      const painelDetalheSp = document.getElementById('painel-detalhe-sp');
      if (painelDetalheSp) painelDetalheSp.hidden = true;
      const botaoVoltar = document.getElementById('btn-voltar-brasil');
      if (botaoVoltar) botaoVoltar.hidden = true;
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
      inicializarOuAtualizarDetalheSp();
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
          // Zoom "livre" (não só níveis inteiros) — sem isso, o fitBounds só podia escolher
          // entre zoom 4, 5, 6..., e como o território não cabia no nível de cima, sobrava um
          // monte de oceano em volta (o mapa parecia pequeno dentro da caixa, mesmo com a caixa
          // grande). Como não existe zoom manual aqui (é só ilustração fixa), não tem problema
          // nenhum usar uma fração — só ajuda a preencher melhor o espaço.
          zoomSnap: 0.05,
        });
      }
      if (camadaGeojson) {
        camadaGeojson.remove();
      }
      // Bounds do país inteiro, só pra decidir de que lado (esquerda/direita) desenhar a
      // "chamada" de cada região — uma região do lado direito do mapa (ex.: Nordeste) chama pra
      // esquerda, e vice-versa, pra caixa não estourar pra fora da área visível.
      const boundsPais = L.geoJSON(geojson).getBounds();
      camadaGeojson = L.geoJSON(geojson, {
        style: estiloRegiao,
        onEachFeature: (feature, layer) => configurarInteracaoRegiao(feature, layer, boundsPais),
      }).addTo(mapaLeaflet);

      ajustarEnquadramentoMapaPrincipal();
      desenharRotulosRegiao();
    }

    /** Recalcula o tamanho real do container (o painel pode ter mudado de tamanho — ex.:
     * primeira renderização antes do layout flex terminar de se ajustar, ou o usuário
     * redimensionando a janela) e reenquadra o território nele, bem justo (ver zoomSnap
     * acima). Respeita a visualização atual: todo o Brasil, ou só as 4 regiões de SP quando o
     * usuário clicou numa delas (ver mostrarSpNoMapaPrincipal). Chamado no carregamento
     * inicial, no resize e sempre que a visualização muda (ver bindEventos). */
    function ajustarEnquadramentoMapaPrincipal() {
      if (!mapaLeaflet || !camadaGeojson) return;
      mapaLeaflet.invalidateSize();
      const todasAsCamadas = camadaGeojson.getLayers();
      const camadas = visualizacaoPrincipal === 'sp'
        ? todasAsCamadas.filter((l) => CODIGOS_SP.includes(l.feature.properties.codigo))
        : todasAsCamadas;
      if (!camadas.length) return;
      const bounds = L.featureGroup(camadas).getBounds();
      if (bounds.isValid()) mapaLeaflet.fitBounds(bounds, { padding: [8, 8] });
    }

    /** Zoom do mapa nacional nas 4 regiões de São Paulo — disparado ao clicar numa delas (ver
     * configurarInteracaoRegiao) enquanto o botão "Voltar ao Brasil" some/aparece junto (ver
     * index.html/bindEventos). Não mexe no mapa de detalhe (que já mostra SP sempre, num
     * zoom fixo e bem mais de perto). */
    function mostrarSpNoMapaPrincipal() {
      visualizacaoPrincipal = 'sp';
      ajustarEnquadramentoMapaPrincipal();
      const botao = document.getElementById('btn-voltar-brasil');
      if (botao) botao.hidden = false;
    }

    function mostrarBrasilNoMapaPrincipal() {
      visualizacaoPrincipal = 'brasil';
      ajustarEnquadramentoMapaPrincipal();
      const botao = document.getElementById('btn-voltar-brasil');
      if (botao) botao.hidden = true;
    }

    /** Um marcador de texto (sigla curta, ver ROTULO_CURTO) no centro de cada região — mesmo
     * estilo do mapa de referência do usuário, que mostra a sigla de cada estado por cima da
     * cor. Usa o centro do retângulo que envolve a forma (getBounds().getCenter()) — não é o
     * centro geométrico exato pra formas muito recortadas/espalhadas (ex.: "Norte", que junta
     * 7 estados), mas é uma aproximação razoável sem precisar de uma lib de geometria no
     * navegador só pra isso. As 4 regiões de SP (CODIGOS_SP) ficam de fora daqui — muito
     * pequenas/próximas pra caber uma sigla legível sem sobrepor; têm o mapa de detalhe
     * dedicado em vez disso (ver inicializarOuAtualizarDetalheSp). */
    function desenharRotulosRegiao() {
      rotulosRegiao.forEach((marcador) => marcador.remove());
      rotulosRegiao = [];
      camadaGeojson.eachLayer((layer) => {
        const codigo = layer.feature.properties.codigo;
        if (CODIGOS_SP.includes(codigo)) return;
        const rotulo = ROTULO_CURTO[codigo];
        if (!rotulo) return;
        const marcador = L.marker(layer.getBounds().getCenter(), {
          interactive: false,
          icon: L.divIcon({ className: 'rotulo-regiao', html: rotulo, iconSize: [40, 16] }),
        }).addTo(mapaLeaflet);
        rotulosRegiao.push(marcador);
      });
    }

    /* ============================================================
     * MAPA DE DETALHE — São Paulo (Capital/Grande SP/Baixada Santista/Interior)
     * ============================================================ */

    /** Mapa pequeno e fixo (mesmas opções do principal) só com as 4 regiões de SP, sempre
     * visível no canto inferior direito da área do mapa (ver dashboard.css/index.html) — a
     * solução escolhida pelo usuário (2026-08-16) pra essas regiões ficarem identificáveis sem
     * depender de rótulo sobreposto no mapa nacional. Reaproveita estiloRegiao/
     * configurarInteracaoRegiao: cores, tooltip e clique (que também filtra os KPIs) idênticos
     * ao mapa principal. */
    function inicializarOuAtualizarDetalheSp() {
      if (!geojson) return;
      const featuresSp = geojson.features.filter((f) => CODIGOS_SP.includes(f.properties.codigo));
      if (!featuresSp.length) return; // geojson sem as 4 regiões de SP: não quebra, só não desenha o detalhe.
      if (!mapaDetalheSp) {
        mapaDetalheSp = L.map('mapa-detalhe-sp', {
          attributionControl: false,
          zoomControl: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          boxZoom: false,
          touchZoom: false,
          dragging: false,
          keyboard: false,
          tap: false,
          zoomSnap: 0.05,
        });
      }
      if (camadaDetalheSp) camadaDetalheSp.remove();
      const boundsSp = L.geoJSON({ type: 'FeatureCollection', features: featuresSp }).getBounds();
      camadaDetalheSp = L.geoJSON({ type: 'FeatureCollection', features: featuresSp }, {
        // Borda um pouco mais grossa que o mapa principal — linhas divisórias bem visíveis
        // entre as 4 regiões, que aqui ficam bem próximas umas das outras.
        style: (feature) => ({ ...estiloRegiao(feature), weight: (estiloRegiao(feature).weight || 1) + 1 }),
        onEachFeature: (feature, layer) => configurarInteracaoRegiao(feature, layer, boundsSp),
      }).addTo(mapaDetalheSp);

      ajustarEnquadramentoDetalheSp();
      desenharRotulosDetalheSp();
    }

    function ajustarEnquadramentoDetalheSp() {
      if (!mapaDetalheSp || !camadaDetalheSp) return;
      mapaDetalheSp.invalidateSize();
      const bounds = camadaDetalheSp.getBounds();
      if (bounds.isValid()) mapaDetalheSp.fitBounds(bounds, { padding: [10, 10] });
    }

    /** Nome completo de cada uma das 4 regiões (não a sigla curta) — no detalhe elas têm
     * espaço de sobra pra isso, já que é só um mapa dedicado a essas 4 formas. */
    function desenharRotulosDetalheSp() {
      rotulosDetalheSp.forEach((marcador) => marcador.remove());
      rotulosDetalheSp = [];
      camadaDetalheSp.eachLayer((layer) => {
        const marcador = L.marker(layer.getBounds().getCenter(), {
          interactive: false,
          icon: L.divIcon({ className: 'rotulo-regiao rotulo-regiao--detalhe', html: layer.feature.properties.regiao, iconSize: [100, 28] }),
        }).addTo(mapaDetalheSp);
        rotulosDetalheSp.push(marcador);
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

    /** Desenha a linha guia (dashed) do centro da região até a caixa de informações, já
     * reposicionada por desenharChamada — chamada de novo a cada abertura, sempre substitui a
     * anterior (só uma chamada visível por vez). */
    function removerChamada() {
      if (linhaChamada) {
        const mapaAtual = linhaChamada._map;
        if (mapaAtual) mapaAtual.removeLayer(linhaChamada);
        linhaChamada = null;
      }
    }

    /** Reposiciona a caixa do tooltip (que o Leaflet por padrão coloca em cima/perto do centro
     * da região, tampando ela) pra um espaço livre ao lado, e desenha uma linha guia entre a
     * região e a caixa — modelo "chamada" pedido pelo usuário (2026-08-23, com esboço). Decide
     * esquerda/direita comparando a longitude do centro da região com a do centro de
     * `boundsReferencia` (país inteiro, ou só as 4 regiões de SP no mapa de detalhe) — região à
     * direita da referência chama pra esquerda, e vice-versa, pra não estourar o mapa. */
    function desenharChamada(layer, boundsReferencia) {
      removerChamada();
      const mapaAtual = layer._map;
      const tooltip = layer.getTooltip && layer.getTooltip();
      if (!mapaAtual || !tooltip) return;
      const el = tooltip.getElement();
      if (!el) return;

      const anchorLatLng = tooltip.getLatLng();
      if (!anchorLatLng) return;
      const anchorPoint = mapaAtual.latLngToContainerPoint(anchorLatLng);
      const containerRect = mapaAtual.getContainer().getBoundingClientRect();

      const referenciaLng = (boundsReferencia && boundsReferencia.isValid()) ? boundsReferencia.getCenter().lng : anchorLatLng.lng;
      const lado = anchorLatLng.lng >= referenciaLng ? 'left' : 'right';
      const largura = el.offsetWidth || 230;
      const altura = el.offsetHeight || 150;
      const tamanhoMapa = mapaAtual.getSize();

      // O mini-mapa "Detalhe de São Paulo" é MENOR que a própria caixa de informações (218x163
      // vs ~190x259) — travar dentro do container (como abaixo) não resolve, ela sempre vai
      // ficar cortada pelo overflow:hidden do Leaflet. Nesse caso a caixa "escapa" do container
      // pro <body> do documento, com position:absolute em coordenadas do DOCUMENTO (não da
      // janela — o mapa fica dentro de um iframe embutido na página principal, então
      // position:fixed aqui seria relativo ao viewport do iframe, não da janela real do
      // usuário, e podia acabar fora da área visível se o iframe for maior que a tela).
      const precisaEscapar = altura > tamanhoMapa.y || largura > tamanhoMapa.x;

      if (precisaEscapar) {
        if (el.parentNode !== document.body) document.body.appendChild(el);
        el.style.position = 'absolute';
        el.style.transform = 'none';
        el.style.margin = '0';
        // Reparentado pro <body>, perde o z-index da leaflet-tooltip-pane (~650) — sem isso
        // ficava por baixo do ".painel-detalhe-sp" (z-index:1000, a moldura "DETALHE DE SÃO
        // PAULO" em volta desse mini-mapa).
        el.style.zIndex = '999999';
        const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
        const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
        let pontoX = lado === 'left'
          ? containerRect.left + scrollX + anchorPoint.x - largura - 20
          : containerRect.left + scrollX + anchorPoint.x + 20;
        let pontoY = containerRect.top + scrollY + anchorPoint.y - altura / 2;
        const docLargura = document.documentElement.scrollWidth;
        const docAltura = document.documentElement.scrollHeight;
        pontoX = Math.min(Math.max(pontoX, 8), docLargura - largura - 8);
        pontoY = Math.min(Math.max(pontoY, 8), docAltura - altura - 8);
        el.style.left = pontoX + 'px';
        el.style.top = pontoY + 'px';
      } else {
        let boxPoint = lado === 'left'
          ? L.point(anchorPoint.x - largura - 55, anchorPoint.y - altura / 2)
          : L.point(anchorPoint.x + 55, anchorPoint.y - altura / 2);

        // O mapa tem overflow:hidden (padrão do Leaflet) — uma caixa alta (a de região tem
        // ~11 linhas) facilmente estoura por cima/baixo do container e fica invisível, cortada,
        // sem erro nenhum no console. Trava dentro da área visível do mapa, margem de 6px.
        const margem = 6;
        boxPoint = L.point(
          Math.min(Math.max(boxPoint.x, margem), Math.max(margem, tamanhoMapa.x - largura - margem)),
          Math.min(Math.max(boxPoint.y, margem), Math.max(margem, tamanhoMapa.y - altura - margem))
        );
        L.DomUtil.setPosition(el, boxPoint);
      }

      // Mede a posição REAL da caixa depois de reposicionada (cobre a margem que as classes
      // leaflet-tooltip-left/right ainda aplicam, e o caso "escapou pro body" acima) pra linha
      // guia encostar bem na borda dela, não num ponto calculado às cegas.
      const boxRect = el.getBoundingClientRect();
      const pontoCaixaX = lado === 'left' ? (boxRect.right - containerRect.left) : (boxRect.left - containerRect.left);
      const pontoCaixaY = (boxRect.top + boxRect.height / 2) - containerRect.top;

      linhaChamada = L.polyline(
        [anchorLatLng, mapaAtual.containerPointToLatLng(L.point(pontoCaixaX, pontoCaixaY))],
        { color: '#f5a623', weight: 2, dashArray: '5,4', interactive: false }
      ).addTo(mapaAtual);
    }

    function configurarInteracaoRegiao(feature, layer, boundsReferencia) {
      layer.bindTooltip(() => montarTooltipHtml(feature), {
        sticky: false, opacity: 0.98, className: 'mapa-tooltip-chamada',
      });
      layer.on('tooltipopen', () => desenharChamada(layer, boundsReferencia));
      layer.on('tooltipclose', removerChamada);
      layer.on('mouseover', () => layer.setStyle({ weight: 2.5 }));
      layer.on('mouseout', () => layer.setStyle(estiloRegiao(feature)));
      layer.on('click', () => {
        const selecionado = selecionarRegiao(feature.properties.codigo);
        // Clicar numa das 4 regiões de SP (no mapa nacional OU no mapa de detalhe) também
        // aproxima o mapa nacional nelas — "Voltar ao Brasil" restaura a visão do país
        // inteiro (pedido do usuário, 2026-08-16). Só quando a região ACABOU de ficar
        // selecionada (não quando o clique desmarcou) — senão, clicar de novo pra desmarcar
        // uma região de SP depois de já ter voltado ao Brasil reacenderia o zoom sozinho.
        if (selecionado && CODIGOS_SP.includes(selecionado) && visualizacaoPrincipal === 'brasil') {
          mostrarSpNoMapaPrincipal();
        }
      });
    }

    /* ============================================================
     * SELEÇÃO DE REGIÃO (mapa/ranking) -> atualiza os cards de KPI
     * ============================================================ */

    /** @returns {string|null} o código que ficou selecionado, ou null se o clique desmarcou. */
    function selecionarRegiao(codigo) {
      regiaoSelecionada = regiaoSelecionada === codigo ? null : codigo; // clicar de novo desmarca
      [camadaGeojson, camadaDetalheSp].forEach((camada) => {
        if (!camada) return;
        camada.eachLayer((layer) => {
          layer.setStyle(estiloRegiao(layer.feature));
          // Pulso rápido na região que acabou de virar a selecionada — feedback visual da troca
          // (pedido do usuário: "relevo... quando muda de região"). Acontece nos dois mapas
          // (nacional e detalhe de SP) ao mesmo tempo, sempre que a região existir neles.
          if (layer.feature.properties.codigo === regiaoSelecionada) {
            const elemento = layer.getElement && layer.getElement();
            if (elemento) {
              elemento.classList.remove('regiao-pulso');
              void elemento.offsetWidth; // força reflow pra reiniciar a animação
              elemento.classList.add('regiao-pulso');
            }
          }
        });
      });
      atualizarKpis(regiaoSelecionada);
      return regiaoSelecionada;
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

    /** Faixas de desempenho do ranking (cor + rótulo) — decisão do usuário (2026-08-23),
     * substitui a cor única de antes. Checagem em ordem decrescente, cada faixa é >= seu
     * limite inferior (sem furo entre as faixas: 94,99% cai em "Regular", 95% já é "Bom"). */
    const FAIXAS_DESEMPENHO = [
      { minimo: 98, cor: '#16A34A', corBrilho: 'rgba(22,163,74,.95)', corTexto: '#ffffff', rotulo: 'Ótimo' },
      { minimo: 95, cor: '#86EFAC', corBrilho: 'rgba(134,239,172,.95)', corTexto: '#1a1a1a', rotulo: 'Bom' },
      { minimo: 90, cor: '#EAB308', corBrilho: 'rgba(234,179,8,.95)', corTexto: '#1a1a1a', rotulo: 'Regular' },
      { minimo: 80, cor: '#F97316', corBrilho: 'rgba(249,115,22,.95)', corTexto: '#ffffff', rotulo: 'Atenção' },
      { minimo: -Infinity, cor: '#DC2626', corBrilho: 'rgba(220,38,38,.95)', corTexto: '#ffffff', rotulo: 'Péssimo' },
    ];
    function faixaDesempenho(percentual) {
      if (percentual === null || percentual === undefined || isNaN(percentual)) {
        return { cor: '#7f8c8d', corBrilho: 'rgba(127,140,141,.95)', corTexto: '#ffffff', rotulo: 'Sem dados' };
      }
      return FAIXAS_DESEMPENHO.find((f) => percentual >= f.minimo);
    }

    /** Escreve "X% · Rótulo" DENTRO da barra, encostado na ponta direita — em vez de deixar
     * o eixo X mostrar uma escala de porcentagem embaixo (removida, ver "scales.x.display"
     * abaixo) e em vez de uma legenda separada (decisão do usuário, 2026-08-16; rótulo da
     * faixa adicionado 2026-08-23). */
    const pluginPercentualNaBarra = {
      id: 'percentualNaBarra',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.font = 'bold 11px Segoe UI, Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        meta.data.forEach((elemento, i) => {
          const valor = chart.data.datasets[0].data[i];
          ctx.fillStyle = faixaDesempenho(valor).corTexto;
          ctx.fillText(`${valor}% · ${faixaDesempenho(valor).rotulo}`, elemento.x - 8, elemento.y);
        });
        ctx.restore();
      },
    };

    /** Brilho (glow) que intensifica na barra sob o mouse — Chart.js já troca a cor pra
     * "hoverBackgroundColor" sozinho; esse plugin só desenha uma sombra difusa atrás da barra
     * ativa ANTES dela ser redesenhada, then Chart.js finishes drawing on top of it. Cor do
     * brilho segue a faixa de CADA barra (2026-08-23), não é mais uma cor única fixa. */
    const pluginBrilhoNoHover = {
      id: 'brilhoNoHover',
      beforeDatasetsDraw(chart) {
        const ativos = chart.getActiveElements();
        if (!ativos.length) return;
        const { ctx } = chart;
        ctx.save();
        ativos.forEach(({ element, index }) => {
          const valor = chart.data.datasets[0].data[index];
          const corBrilho = faixaDesempenho(valor).corBrilho;
          ctx.shadowColor = corBrilho;
          ctx.shadowBlur = 18;
          ctx.fillStyle = corBrilho;
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
        // "Exterior / Não mapeado" não tem geografia própria (nunca aparece no mapa) e a
        // usuária pediu pra também sumir daqui, do ranking lateral (2026-08-23).
        .filter((r) => r.regiao !== 'Exterior / Não mapeado')
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
            backgroundColor: ordenado.map((r) => faixaDesempenho(r.percentual_entregue).cor),
            hoverBackgroundColor: ordenado.map((r) => faixaDesempenho(r.percentual_entregue).corBrilho),
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
      window.addEventListener('resize', () => {
        ajustarEnquadramentoMapaPrincipal();
        ajustarEnquadramentoDetalheSp();
      });
      const botaoVoltar = document.getElementById('btn-voltar-brasil');
      if (botaoVoltar) botaoVoltar.addEventListener('click', mostrarBrasilNoMapaPrincipal);
    }

    /** Recebe os totais por região recalculados ao vivo pelo site principal (filtro de
     * período/vendedor/etc já aplicado) e redesenha tudo com o mesmo `renderizarTudo` usado
     * pro carregamento estático — só troca a fonte dos números, o resto do fluxo é idêntico. */
    function aplicarDadosAoVivo(dadosCompletos) {
      if (!dadosCompletos || !Array.isArray(dadosCompletos.regioes)) return;
      regioes = dadosCompletos.regioes;
      renderizarTudo(dadosCompletos);
    }

    function bindMensagensDoPai() {
      window.addEventListener('message', (e) => {
        if (e.origin !== window.location.origin) return;
        if (e.data && e.data.tipo === 'mapa-regioes:dados') {
          aplicarDadosAoVivo(e.data.dados);
        }
      });
    }

    async function init() {
      bindEventos();
      try {
        await carregarTudo();
      } catch (err) {
        mostrarErroCarregamento(err.message);
      }
      // Só faz o handshake com o pai se estiver de fato embutida num iframe (evita erro/ruído
      // quando a página é aberta sozinha, fora do site principal).
      if (window.parent && window.parent !== window) {
        bindMensagensDoPai();
        window.parent.postMessage({ tipo: 'mapa-regioes:pronto' }, window.location.origin);
      }
    }

    return { init, corPorPercentual, agregarRegioes, aplicarDadosAoVivo };
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
