/**
 * dashboard.js
 * Orquestra a interface do dashboard: KPIs, filtros, gráficos e tabela.
 * Depende de: Utils (utils.js), DataStore (data.js), DashChart (charts.js).
 */
'use strict';

const Dashboard = (() => {
  const charts = {};

  function createTableState() {
    return { sortField: 'dataEntrega', sortDir: 'desc', page: 1, pageSize: 25 };
  }
  let table = createTableState();
  const MAIN_TABLE_IDS = {
    tbody: 'table-body', info: 'table-info', pageLabel: 'table-page-label',
    prev: 'table-prev', next: 'table-next', theadSelector: '#data-table thead th[data-field]'
  };

  // Tela de detalhe (drill-down ao clicar num card de KPI) — reaproveita o mesmo
  // renderizador de tabela da seção "Registros detalhados", só com outro conjunto de
  // ids/estado, pra não duplicar a lógica de ordenação/paginação.
  let detailTable = createTableState();
  let detailRecords = [];
  let detailKey = null;
  // Busca própria da tela de detalhe (drill-down de um card) — separada do "busca" global da
  // tabela principal, porque essa tela some quando o usuário volta (pedido do usuário,
  // 2026-08-17: precisa dar pra pesquisar dentro do recorte do card, ex.: achar uma NF/cliente
  // específico entre as 175 notas de "Aguardando agendamento").
  let detailBusca = '';
  const DETAIL_TABLE_IDS = {
    tbody: 'detail-table-body', info: 'detail-table-info', pageLabel: 'detail-table-page-label',
    prev: 'detail-table-prev', next: 'detail-table-next', theadSelector: '#detail-data-table thead th[data-field]'
  };

  // "Registro Dinâmico" (2026-08-18): consolida as notas filtradas por Data de Faturamento —
  // uma linha por data, com soma de Valor e contagem de notas. Clicar na data abre, embaixo,
  // o detalhe por nota daquele dia (2ª tabela/estado, registroDinamicoDetalheTable).
  let registroDinamicoTable = Object.assign(createTableState(), { sortField: 'dataFaturamento', sortDir: 'asc' });
  const REGISTRO_DINAMICO_TABLE_IDS = {
    tbody: 'registro-dinamico-table-body', info: 'registro-dinamico-table-info',
    pageLabel: 'registro-dinamico-table-page-label', prev: 'registro-dinamico-table-prev',
    next: 'registro-dinamico-table-next', theadSelector: '#registro-dinamico-table thead th[data-field]',
    colspan: 3
  };
  let registroDinamicoDetalheTable = Object.assign(createTableState(), { sortField: 'nf', sortDir: 'asc' });
  const REGISTRO_DINAMICO_DETALHE_IDS = {
    tbody: 'registro-dinamico-detalhe-table-body', info: 'registro-dinamico-detalhe-table-info',
    pageLabel: 'registro-dinamico-detalhe-table-page-label', prev: 'registro-dinamico-detalhe-table-prev',
    next: 'registro-dinamico-detalhe-table-next', theadSelector: '#registro-dinamico-detalhe-table thead th[data-field]',
    colspan: 9
  };
  // Data (meia-noite) atualmente expandida na tabela de dias, ou null se nenhuma — controla
  // a visibilidade/conteúdo da tabela de detalhe por nota e o destaque visual da linha clicada.
  let registroDinamicoDataSelecionada = null;
  // Mês (1º dia, meia-noite) selecionado no card abaixo do gráfico, ou null se nenhum — null
  // mostra TODOS os dias normalmente na tabela de cima; selecionar um mês filtra só pra ele
  // (decisão do usuário, 2026-08-19: clicar de novo no card ativo desmarca e volta a mostrar tudo).
  let registroDinamicoMesSelecionado = null;

  // Precisa ficar em sincronia com os valores dos checkboxes de #filter-status-list no
  // index.html — qualquer r.situacao fora dessa lista cai no botão "Status Diversos".
  const KNOWN_SITUACOES = [
    'Aguardando agendamento', 'Agendado', 'Cancelado', 'Devolução', 'Em aberto',
    'Em rota', 'Entregue', 'Reentrega', 'Recusa', 'Reagendar'
  ];

  // Cada entrada define o que um card de KPI representa, pra abrir a tela de detalhe com
  // exatamente os registros que compõem aquele número (mesmo critério usado em renderKPIs).
  const STATUS_DETAIL_DEFS = {
    'entregue': { title: 'Notas entregues', test: r => r.status === 'ENTREGUE' },
    'em-aberto': { title: 'Notas em aberto', test: r => r.situacao === 'Em aberto' },
    'devolucao': { title: 'Devolução', test: r => r.situacao === 'Devolução' },
    'cancelado': { title: 'Cancelado', test: r => r.situacao === 'Cancelado' },
    'reentrega': { title: 'Reentrega', test: r => r.situacao === 'Reentrega' },
    // "Aguardando agendamento" por decisão do usuário (2026-08-17): conta só quem REALMENTE
    // precisa ser agendado ainda — "Obriga Agendamento" (necessitaAgendamento), situação "Em
    // aberto" e NENHUMA etapa de agendamento já registrada (Agendado/Aguardando Confirmação/
    // Reagendar/Okker — ver AGENDAMENTO_ETAPAS_ESPECIFICAS mais abaixo, mesma lista do gráfico
    // "Situação de agendamento"). Antes contava TUDO que não fosse Entregue/Devolução/Cancelado
    // (incluía Reentrega, notas que nem obrigam agendamento etc.), o que inflava muito esse
    // número (1.442) em relação ao que o card deveria representar de verdade: notas realmente
    // paradas esperando alguém agendar. Esse card agora bate exatamente com a fatia "Sem etapa
    // definida" do gráfico de agendamento (não mais com o TOTAL do gráfico, ver
    // renderAgendamentoChart) — faz sentido: lá ele é literalmente "ainda sem etapa nenhuma".
    'aguardando': {
      title: 'Aguardando agendamento',
      test: r => r.necessitaAgendamento && r.situacao === 'Em aberto' &&
        !AGENDAMENTO_ETAPAS_ESPECIFICAS.includes(r.statusAgendamento)
    },
    'diversos': { title: 'Status Diversos', test: r => !KNOWN_SITUACOES.includes(r.situacao) },
    // Uma entrada por fatia do donut "Situação de agendamento" (pedido do usuário, 2026-08-19,
    // pra editar a data/status/observação de quem já tem etapa — igual já funcionava só pro
    // card "Aguardando agendamento"). Mesma população-base do gráfico (necessitaAgendamento +
    // Em aberto — ver renderAgendamentoChart); "Sem etapa definida" não precisa de entrada
    // própria, é literalmente o mesmo recorte de 'aguardando' acima.
    'agendamento-agendado': {
      title: 'Agendado',
      test: r => r.necessitaAgendamento && r.situacao === 'Em aberto' && r.statusAgendamento === 'Agendado'
    },
    'agendamento-aguardando-confirmacao': {
      title: 'Aguardando Confirmação',
      test: r => r.necessitaAgendamento && r.situacao === 'Em aberto' && r.statusAgendamento === 'Aguardando Confirmação'
    },
    'agendamento-reagendar': {
      title: 'Reagendar',
      test: r => r.necessitaAgendamento && r.situacao === 'Em aberto' && r.statusAgendamento === 'Reagendar'
    },
    'agendamento-okker': {
      title: 'Okker',
      test: r => r.necessitaAgendamento && r.situacao === 'Em aberto' && r.statusAgendamento === 'Okker'
    }
  };

  // Rótulo do tile do donut (ver renderAgendamentoChart/AGENDAMENTO_STATUS_CATEGORIAS) -> chave
  // de STATUS_DETAIL_DEFS a abrir. "Sem etapa definida" aponta pro mesmo 'aguardando' de sempre.
  const AGENDAMENTO_LABEL_PARA_DETAIL_KEY = {
    'Agendado': 'agendamento-agendado',
    'Sem etapa definida': 'aguardando',
    'Aguardando Confirmação': 'agendamento-aguardando-confirmacao',
    'Reagendar': 'agendamento-reagendar',
    'Okker': 'agendamento-okker'
  };

  // Super admin: sempre pode editar a data/status de agendamento manual (Firestore) e é o
  // único que vê o botão "Gerenciar usuários" — por decisão do usuário (2026-08-14). Além
  // dele, qualquer usuário que o super admin habilitar pelo modal "Gerenciar usuários"
  // também pode editar (flag `podeEditarAgendamento` em users/{uid}, ver script.js/
  // firebase-init.js) — os demais veem os mesmos dados, só sem os controles de edição.
  const SUPER_ADMIN_EMAIL_AGENDAMENTO = 'thiago.barbosadaterrinha@gmail.com';
  let podeEditarAgendamentoUsuarioAtual = false;

  function isSuperAdminAgendamento() {
    return window.Firebase?.auth?.currentUser?.email === SUPER_ADMIN_EMAIL_AGENDAMENTO;
  }
  function isSuperAdminEmailAgendamento(email) {
    return email === SUPER_ADMIN_EMAIL_AGENDAMENTO;
  }
  function isAdminAgendamento() {
    return isSuperAdminAgendamento() || podeEditarAgendamentoUsuarioAtual;
  }
  /** Chamado de fora (script.js) assim que a permissão do usuário logado for lida do
   * Firestore — atualiza a tela de detalhe na hora, caso já esteja aberta. */
  function setPermissaoEdicaoAgendamento(pode) {
    podeEditarAgendamentoUsuarioAtual = !!pode;
    renderStatusDetail(); // no-op se a tela de detalhe não estiver aberta
  }
  function formatDateParaInput(date) {
    if (!(date instanceof Date) || isNaN(date)) return '';
    const ano = date.getFullYear();
    const mes = String(date.getMonth() + 1).padStart(2, '0');
    const dia = String(date.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }

  // "Não informado" é um rótulo de ausência, não um vendedor real — por padrão fica fora
  // do filtro pra não poluir a lista com algo que não representa ninguém de fato.
  const VENDEDOR_SEM_CLIENTE_KEY = 'dashboard_ocultar_vendedor_sem_cliente';
  let ocultarVendedorSemCliente = localStorage.getItem(VENDEDOR_SEM_CLIENTE_KEY) !== '0';

  // NF (sem sufixo de viagem/item) -> [url1, url2, ...], carregado de
  // assets/data/canhotos-index.json (gerado por scripts/gerar-indice-canhotos.ps1).
  let canhotosIndex = new Map();

  // Campos das colunas atualmente ocultas na tabela "Registros detalhados" (botões redondos
  // acima da tabela) — nomes batem com data-field do <thead> e com COLUNAS_TABELA_PRINCIPAL.
  let colunasOcultas = new Set();

  /* ============================================================
   * INICIALIZAÇÃO
   * ============================================================ */

  function init() {
    bindFilterInputs();
    bindTableControls();
    bindActionButtons();
    bindStatusDetail();
    bindCanhotoLinks();
    bindAgendamentoEdicao();
    renderColumnToggles();
    bindColumnToggles();
    bindScrollTabela();
    bindAlternarViewMapaRegioes();
    bindRegistroDinamico();
    bindMapaRegioesMensagens();
    createCharts();
    DataStore.onChange(render);
  }

  /** Alterna, na mesma aba, entre "Registros detalhados" (#main-view) e o Dashboard Logístico
   * por Região (#mapa-regioes-embed, um iframe carregado sob demanda) — por decisão do usuário
   * (2026-08-16): preferiu isso a abrir em outra aba, mesmo perdendo os KPIs/gráficos de cima
   * enquanto o mapa está aberto (voltam ao clicar em "Registros detalhados" de novo). Existem
   * duas cópias do par de botões no HTML (uma em cada tela) — todas com o mesmo data-view, pra
   * sempre ter como trocar de tela não importa qual das duas esteja visível no momento. */
  function bindAlternarViewMapaRegioes() {
    const botoes = document.querySelectorAll('[data-view]');
    botoes.forEach((botao) => {
      botao.addEventListener('click', () => mostrarViewMapaRegioes(botao.dataset.view));
    });
  }

  function mostrarViewMapaRegioes(view) {
    const main = document.getElementById('main-view');
    const embed = document.getElementById('mapa-regioes-embed');
    const dinamico = document.getElementById('registro-dinamico-view');

    main.hidden = view !== 'registros';
    embed.hidden = view !== 'mapa';
    dinamico.hidden = view !== 'dinamico';

    document.querySelectorAll('[data-view]').forEach((botao) => {
      const ativo = botao.dataset.view === view;
      botao.classList.toggle('toggle-view-btn--ativo', ativo);
      botao.classList.toggle('toggle-view-btn--inativo', !ativo);
    });

    if (view === 'mapa') {
      // Carrega o iframe só na primeira vez que o usuário abrir o mapa (evita buscar
      // Leaflet/Chart.js/dados_regioes.json sem necessidade em quem nunca clicar nele).
      const iframe = document.getElementById('iframe-mapa-regioes');
      if (!iframe.src) iframe.src = 'mapa-regioes/index.html';
    } else if (view === 'dinamico') {
      renderRegistroDinamico();
      dinamico.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      document.getElementById('registros-detalhados').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /* ============================================================
   * DASHBOARD LOGÍSTICO POR REGIÃO (iframe) — dados ao vivo
   * ============================================================
   * O mapa-regioes/ não tem filtro próprio (removidos em 2026-08-16): ele reflete os mesmos
   * filtros já aplicados aqui (período, vendedor, região comercial etc.) recebendo, via
   * postMessage, os totais por região já recalculados a partir de DataStore.getFilteredRecords().
   * O iframe avisa quando terminou de carregar e está pronto ("mapa-regioes:pronto"); a partir
   * daí, toda vez que os filtros mudam (DataStore.onChange -> render), reenviamos os dados. Se
   * o iframe nunca foi aberto (src vazio) ou ainda não anunciou que carregou, o postMessage é
   * simplesmente descartado (sem handler do outro lado) — nenhum erro, nenhuma trava.
   *
   * "prazo_medio_dias" fica sempre null aqui: não existe, nos dados ao vivo, um campo de data
   * de entrega efetiva equivalente ao que a planilha original usava pra esse cálculo (decisão
   * do usuário, 2026-08-16: preferiu "Sem dados" a um número aproximado/errado).
   */
  const VALOR_REGIAO_NAO_INFORMADO = new Set(['', 'Não informado']);

  function computarDadosRegioesAoVivo(records) {
    const porCodigo = new Map();
    DataStore.getRegioesComerciaisComCodigo().forEach(({ codigo, nome }) => {
      porCodigo.set(codigo, {
        codigo, regiao: nome,
        total_notas: 0, entregues: 0, reentregas: 0, devolucoes: 0, cancelados: 0, em_aberto: 0,
        valor_nf: 0,
        cidades: new Set(), supervisores: new Set(), vendedores: new Set(),
      });
    });

    records.forEach((r) => {
      const codigo = DataStore.getCodigoRegiaoComercial(r.regiaoComercial);
      const bucket = codigo && porCodigo.get(codigo);
      if (!bucket) return; // "Não classificado"/RC13 (sem geografia própria): fora do mapa, mesma regra já documentada.
      bucket.total_notas++;
      if (r.status === 'ENTREGUE') bucket.entregues++;
      if (r.situacao === 'Reentrega') bucket.reentregas++;
      if (r.situacao === 'Devolução') bucket.devolucoes++;
      if (r.situacao === 'Cancelado') bucket.cancelados++;
      if (r.situacao === 'Em aberto') bucket.em_aberto++;
      bucket.valor_nf += r.valorNF || 0;
      if (r.cidade) bucket.cidades.add(r.cidade);
      if (r.supervisor && !VALOR_REGIAO_NAO_INFORMADO.has(r.supervisor)) bucket.supervisores.add(r.supervisor);
      if (r.vendedor && !VALOR_REGIAO_NAO_INFORMADO.has(r.vendedor)) bucket.vendedores.add(r.vendedor);
    });

    const regioes = Array.from(porCodigo.values()).map((b) => ({
      codigo: b.codigo,
      regiao: b.regiao,
      total_notas: b.total_notas,
      entregues: b.entregues,
      reentregas: b.reentregas,
      devolucoes: b.devolucoes,
      cancelados: b.cancelados,
      em_aberto: b.em_aberto,
      percentual_entregue: b.total_notas ? (b.entregues / b.total_notas) * 100 : null,
      valor_nf: b.valor_nf,
      prazo_medio_dias: null,
      quantidade_cidades: b.cidades.size,
      quantidade_supervisores: b.supervisores.size,
      quantidade_vendedores: b.vendedores.size,
    }));

    const filtros = DataStore.getFilters();
    return {
      atualizado_em: new Date().toISOString(),
      periodo_inicio: filtros.dataInicio ? new Date(filtros.dataInicio).toISOString() : null,
      periodo_fim: filtros.dataFim ? new Date(filtros.dataFim).toISOString() : null,
      regioes,
    };
  }

  function enviarDadosRegioesParaIframe(records) {
    const iframe = document.getElementById('iframe-mapa-regioes');
    if (!iframe || !iframe.src || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(
      { tipo: 'mapa-regioes:dados', dados: computarDadosRegioesAoVivo(records) },
      window.location.origin
    );
  }

  function bindMapaRegioesMensagens() {
    window.addEventListener('message', (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data && e.data.tipo === 'mapa-regioes:pronto') {
        enviarDadosRegioesParaIframe(DataStore.getFilteredRecords());
      }
    });
  }

  function bindFilterInputs() {
    const $ = (id) => document.getElementById(id);

    $('filter-data-inicio').addEventListener('change', (e) => {
      DataStore.setFilters({ dataInicio: e.target.value ? Utils.parseDate(e.target.value) : null });
    });
    $('filter-data-fim').addEventListener('change', (e) => {
      DataStore.setFilters({ dataFim: e.target.value ? Utils.parseDate(e.target.value) : null });
    });
    $('filter-mes').addEventListener('change', (e) => DataStore.setFilters({ mes: e.target.value }));
    $('filter-ano').addEventListener('change', (e) => DataStore.setFilters({ ano: e.target.value }));

    bindFilterCheckboxList('filter-status-list', 'situacaoFiltro');
    bindFilterCheckboxList('filter-transportadora-list', 'transportadora');
    bindFilterCheckboxList('filter-motorista-list', 'motorista');
    bindFilterCheckboxList('filter-tipo-transporte-list', 'tipoTransporte');
    bindFilterCheckboxList('filter-vendedor-list', 'vendedor');
    bindFilterCheckboxList('filter-cliente-list', 'cliente');
    bindFilterCheckboxList('filter-cidade-list', 'cidade');
    bindFilterCheckboxList('filter-regiao-comercial-list', 'regiaoComercial');

    const buscaHandler = Utils.debounce((value) => DataStore.setFilters({ busca: value }), 250);
    const buscaInput = $('filter-busca');
    buscaInput.addEventListener('input', (e) => {
      buscaHandler(e.target.value);
      e.target.classList.toggle('is-filled', e.target.value.trim() !== '');
    });
    if (buscaInput.value.trim() !== '') buscaInput.classList.add('is-filled');

    $('btn-reset-filters').addEventListener('click', () => {
      DataStore.resetFilters();
      document.querySelectorAll('.filters-panel select, .filters-panel input').forEach(el => { el.value = ''; });
      document.querySelectorAll('.filters-panel .filter-checkbox-list input[type="checkbox"]').forEach(cb => { cb.checked = false; });
      buscaInput.classList.remove('is-filled');
      Utils.showToast('Filtros limpos.', 'info', 2000);
    });

    const btnToggleVendedor = $('btn-toggle-vendedor-sem-cliente');
    btnToggleVendedor.setAttribute('aria-pressed', String(ocultarVendedorSemCliente));
    btnToggleVendedor.addEventListener('click', () => {
      ocultarVendedorSemCliente = !ocultarVendedorSemCliente;
      localStorage.setItem(VENDEDOR_SEM_CLIENTE_KEY, ocultarVendedorSemCliente ? '1' : '0');
      btnToggleVendedor.setAttribute('aria-pressed', String(ocultarVendedorSemCliente));
      populateFilterOptions();
    });
  }

  /** Amarra UMA lista de checkbox (Status/Transportadora/Cliente/...) ao filtro `filterKey` do
   * DataStore, incluindo o checkbox "Selecionar todos" (marca/desmarca tudo, e reflete se já
   * está tudo marcado). Serve tanto pra lista fixa (Status, HTML hardcoded) quanto pras
   * dinâmicas (populadas por fillCheckboxList) — só depende das classes .filter-checkbox__todos
   * / .filter-checkbox__item já estarem no HTML. */
  function bindFilterCheckboxList(containerId, filterKey) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.addEventListener('change', (e) => {
      const todos = container.querySelector('.filter-checkbox__todos');
      if (e.target === todos) {
        container.querySelectorAll('.filter-checkbox__item').forEach(cb => { cb.checked = todos.checked; });
      }
      const itens = Array.from(container.querySelectorAll('.filter-checkbox__item'));
      if (todos) todos.checked = itens.length > 0 && itens.every(cb => cb.checked);
      const marcados = itens.filter(cb => cb.checked).map(cb => cb.value);
      DataStore.setFilters({ [filterKey]: marcados });
    });
  }

  /** Amarra ordenação/paginação de UMA tabela (estado + ids próprios) a uma fonte de registros.
   * `rowRenderer` é opcional (default rowHtml, a linha de 13 colunas da tabela principal) —
   * o Registro Dinâmico passa o seu próprio, já que as linhas lá não são um registro de NF. */
  function bindTableControlsFor(state, ids, getRecords, rowRenderer = rowHtml) {
    document.querySelectorAll(`${ids.theadSelector}`).forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.field;
        if (state.sortField === field) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortField = field;
          state.sortDir = 'asc';
        }
        state.page = 1;
        renderTableGeneric(getRecords(), state, ids, rowRenderer);
      });
    });

    document.getElementById(ids.prev).addEventListener('click', () => {
      if (state.page > 1) { state.page--; renderTableGeneric(getRecords(), state, ids, rowRenderer); }
    });
    document.getElementById(ids.next).addEventListener('click', () => {
      state.page++; renderTableGeneric(getRecords(), state, ids, rowRenderer);
    });
  }

  function bindTableControls() {
    const searchHandler = Utils.debounce((value) => {
      DataStore.setFilters({ busca: value });
      const buscaInput = document.getElementById('filter-busca');
      buscaInput.value = value;
      buscaInput.classList.toggle('is-filled', value.trim() !== '');
    }, 250);
    document.getElementById('table-search').addEventListener('input', (e) => searchHandler(e.target.value));

    bindTableControlsFor(table, MAIN_TABLE_IDS, () => DataStore.getFilteredRecords());

    document.getElementById('table-page-size').addEventListener('change', (e) => {
      table.pageSize = Number(e.target.value);
      table.page = 1;
      renderTable(DataStore.getFilteredRecords());
    });

    bindTableControlsFor(detailTable, DETAIL_TABLE_IDS, () => detailRecords);

    const detailSearchHandler = Utils.debounce((value) => {
      detailBusca = value;
      detailTable.page = 1;
      renderStatusDetail();
    }, 250);
    document.getElementById('detail-table-search').addEventListener('input', (e) => detailSearchHandler(e.target.value));
  }

  /** Cor da célula "Status" na exportação Excel (ver exportarRegistros) — mesmas cores dos
   * badges já usados na tela (statusBadgeClass), só que como preenchimento sólido + texto
   * branco em negrito, no estilo do print que o usuário mandou (2026-08-16). Só colore a
   * coluna Status; as demais saem sem cor de fundo, igual ao print. */
  function colorirCelulaExportacao(rotuloColuna, valorFormatado) {
    if (rotuloColuna !== 'Status') return null;
    const fundo = { Entregue: 'FF16A34A', 'Em aberto': 'FFDC2626', 'Aguardando agendamento': 'FF64748B' }[valorFormatado];
    return fundo ? { fundo } : null;
  }

  async function exportarRegistros(filename, records) {
    if (!records.length) { Utils.showToast('Não há dados para exportar.', 'warning'); return; }
    await Utils.exportToStyledExcel(filename, 'Entregas', tableColumns(), records, colorirCelulaExportacao);
    Utils.showToast(`${records.length} registros exportados para Excel.`, 'success');
  }

  function bindActionButtons() {
    document.getElementById('btn-export-csv').addEventListener('click', () => {
      exportarRegistros('dashboard-entregas.xlsx', DataStore.getFilteredRecords());
    });

    document.getElementById('btn-export-csv-detail').addEventListener('click', () => {
      exportarRegistros('dashboard-entregas-detalhe.xlsx', detailRecords);
    });

    document.getElementById('btn-print-dashboard').addEventListener('click', () => window.print());
    document.getElementById('btn-export-pdf').addEventListener('click', () => {
      Utils.showToast('Escolha "Salvar como PDF" na janela de impressão.', 'info', 5000);
      window.print();
    });
  }

  /* ============================================================
   * TELA DE DETALHE (drill-down ao clicar num card de KPI)
   * ============================================================ */

  function bindStatusDetail() {
    document.querySelectorAll('.kpi-card[data-detail]').forEach(card => {
      card.addEventListener('click', () => openStatusDetail(card.dataset.detail));
    });
    document.getElementById('btn-status-diversos').addEventListener('click', () => openStatusDetail('diversos'));
    document.getElementById('btn-back-home').addEventListener('click', closeStatusDetail);
  }

  function openStatusDetail(key) {
    const def = STATUS_DETAIL_DEFS[key];
    if (!def) return;
    detailKey = key;
    // Muda os campos no mesmo objeto (em vez de reatribuir `detailTable`) porque os cliques
    // de ordenação/paginação já foram amarrados a essa referência específica em bindTableControls.
    Object.assign(detailTable, createTableState());
    detailBusca = '';
    const buscaDetalhe = document.getElementById('detail-table-search');
    if (buscaDetalhe) buscaDetalhe.value = '';
    renderStatusDetail();
    document.getElementById('main-view').hidden = true;
    document.getElementById('status-detail-view').hidden = false;
  }

  function closeStatusDetail() {
    detailKey = null;
    document.getElementById('status-detail-view').hidden = true;
    document.getElementById('main-view').hidden = false;
  }

  /** Recalcula a lista da tela de detalhe a partir dos filtros atuais — chamado ao abrir e
   * de novo sempre que os dados/filtros mudarem enquanto essa tela estiver aberta. */
  function renderStatusDetail() {
    if (!detailKey) return;
    const def = STATUS_DETAIL_DEFS[detailKey];
    let registros = DataStore.getFilteredRecords().filter(def.test);
    if (detailBusca) {
      const needle = detailBusca.toLowerCase();
      registros = registros.filter(r =>
        `${r.nf} ${r.cliente} ${r.transportadora} ${r.motorista} ${r.vendedor} ${r.cidade} ${r.situacao}`
          .toLowerCase().includes(needle));
    }
    detailRecords = registros;
    document.getElementById('detail-view-title').textContent = `${def.title} (${Utils.formatNumber(detailRecords.length)})`;
    renderTableGeneric(detailRecords, detailTable, DETAIL_TABLE_IDS);
    renderMotivosBreakdown(detailRecords);
    renderAgendamentoEdicao(detailRecords);
  }

  /* ============================================================
   * MOTIVOS — cobertura parcial, vem da coluna OBS (ver data.js). Não é restrito a
   * nenhum status específico: a seção aparece pra qualquer card cujos registros tenham
   * motivo registrado, e fica escondida quando não há nenhum (ex.: Entregue hoje).
   * ============================================================ */

  function renderMotivosBreakdown(records) {
    const section = document.getElementById('detail-motivos-section');
    const comMotivo = records.filter(r => r.motivoCategoria);
    if (comMotivo.length === 0) { section.hidden = true; return; }
    section.hidden = false;

    const counts = new Map();
    comMotivo.forEach(r => counts.set(r.motivoCategoria, (counts.get(r.motivoCategoria) || 0) + 1));
    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const maxCount = entries[0][1];

    const pct = Math.round((comMotivo.length / records.length) * 100);
    document.getElementById('detail-motivos-coverage').textContent =
      `Baseado em ${comMotivo.length} de ${records.length} notas com motivo registrado (~${pct}%) — fonte cobre principalmente dez/2025 a abr/2026, não o período todo.`;

    // A barra nasce em 0% (via CSS) e só recebe a largura real depois de já estar no DOM —
    // é isso que dispara a transição/animação em vez de pintar direto no valor final.
    const list = document.getElementById('detail-motivos-list');
    list.innerHTML = entries.map(([nome, count]) => `
      <div class="motivo-bar-row">
        <span class="motivo-bar-row__label" title="${escapeAttr(nome)}">${escapeAttr(nome)}</span>
        <span class="motivo-bar-row__track"><span class="motivo-bar-row__fill" data-pct="${Math.round(count / maxCount * 100)}"></span></span>
        <span class="motivo-bar-row__count">${count}</span>
      </div>
    `).join('');
    requestAnimationFrame(() => {
      list.querySelectorAll('.motivo-bar-row__fill').forEach(el => { el.style.width = `${el.dataset.pct}%`; });
    });
  }

  /* ============================================================
   * AGENDAMENTO MANUAL — só na tela "Aguardando agendamento". Data/status digitados direto
   * aqui (Firestore), no lugar da planilha de Agendamentos (ver applyAgendamentoManual em
   * data.js). Edição só pro admin (isAdminAgendamento) — os demais veem só leitura.
   * ============================================================ */

  const AGENDAMENTO_EDICAO_LIMITE = 200;

  // Telas onde o painel de edição de agendamento aparece — a original ("Aguardando
  // agendamento") mais as 4 novas fatias clicáveis do donut (2026-08-19). "Sem etapa definida"
  // não precisa de chave própria aqui: ela É 'aguardando', já contemplada.
  const AGENDAMENTO_EDICAO_DETAIL_KEYS = [
    'aguardando', 'agendamento-agendado', 'agendamento-aguardando-confirmacao',
    'agendamento-reagendar', 'agendamento-okker'
  ];

  function renderAgendamentoEdicao(records) {
    const section = document.getElementById('detail-agendamento-section');
    if (!AGENDAMENTO_EDICAO_DETAIL_KEYS.includes(detailKey)) { section.hidden = true; return; }
    section.hidden = false;

    const admin = isAdminAgendamento();
    document.getElementById('detail-agendamento-hint').textContent = admin
      ? 'Preencha ou altere o status e a data de agendamento — salva direto aqui, sem precisar de planilha.'
      : 'Situação de agendamento de cada nota (só o usuário responsável pode editar).';

    const list = document.getElementById('detail-agendamento-list');
    const itens = records.slice(0, AGENDAMENTO_EDICAO_LIMITE);

    list.innerHTML = itens.map(r => {
      const nfBase = r.nf.split('-')[0];
      const statusAtual = r.statusAgendamento || '';
      const dataAtual = formatDateParaInput(r.dataAgendamento);
      const observacaoAtual = r.observacaoAgendamento || '';

      if (!admin) {
        return `
          <div class="agendamento-row">
            <span class="agendamento-row__nf">${escapeAttr(r.nf)}</span>
            <span class="agendamento-row__cliente" title="${escapeAttr(r.cliente)}">${escapeAttr(r.cliente)}</span>
            <span class="agendamento-row__status--somente-leitura">${escapeAttr(statusAtual || 'Sem informação')}</span>
            <span class="agendamento-row__status--somente-leitura">${dataAtual ? Utils.formatDate(r.dataAgendamento) : '—'}</span>
            <span class="agendamento-row__observacao--somente-leitura" title="${escapeAttr(observacaoAtual)}">${escapeAttr(observacaoAtual || '—')}</span>
            <span></span>
          </div>
        `;
      }

      const opcoes = AGENDAMENTO_STATUS_CATEGORIAS.map(cat =>
        `<option value="${escapeAttr(cat)}"${cat === statusAtual ? ' selected' : ''}>${escapeAttr(cat)}</option>`
      ).join('');
      return `
        <div class="agendamento-row" data-nf="${escapeAttr(nfBase)}">
          <span class="agendamento-row__nf">${escapeAttr(r.nf)}</span>
          <span class="agendamento-row__cliente" title="${escapeAttr(r.cliente)}">${escapeAttr(r.cliente)}</span>
          <select class="agendamento-row__status-select">
            <option value=""${statusAtual ? '' : ' selected'}>Sem informação</option>
            ${opcoes}
          </select>
          <input type="date" class="agendamento-row__data-input" value="${dataAtual}">
          <input type="text" class="agendamento-row__observacao-input" placeholder="Observação (opcional)" value="${escapeAttr(observacaoAtual)}">
          <button type="button" class="btn agendamento-row__salvar">Salvar</button>
        </div>
      `;
    }).join('');

    if (records.length > AGENDAMENTO_EDICAO_LIMITE) {
      list.insertAdjacentHTML('beforeend',
        `<p class="chart-card__hint">Mostrando as primeiras ${AGENDAMENTO_EDICAO_LIMITE} de ${Utils.formatNumber(records.length)} notas.</p>`);
    }
  }

  function bindAgendamentoEdicao() {
    document.getElementById('detail-agendamento-list').addEventListener('click', async (e) => {
      const botao = e.target.closest('.agendamento-row__salvar');
      if (!botao) return;
      const linha = botao.closest('.agendamento-row');
      const nf = linha.dataset.nf;
      const status = linha.querySelector('.agendamento-row__status-select').value;
      const data = linha.querySelector('.agendamento-row__data-input').value;
      const observacao = linha.querySelector('.agendamento-row__observacao-input').value.trim();

      botao.disabled = true;
      botao.textContent = 'Salvando...';
      try {
        const fb = await new Promise((resolve) => {
          if (window.Firebase) return resolve(window.Firebase);
          window.addEventListener('firebase-ready', () => resolve(window.Firebase), { once: true });
        });
        await fb.salvarAgendamentoManual(nf, status, data, observacao);
        DataStore.applyAgendamentoManual({ [nf]: { statusAgendamento: status, dataAgendamento: data, observacao } });
        Utils.showToast(`NF ${nf}: agendamento salvo.`, 'success', 2500);
      } catch (err) {
        Utils.showToast(err.message || 'Falha ao salvar o agendamento.', 'error', 5000);
        botao.disabled = false;
        botao.textContent = 'Salvar';
      }
    });
  }

  function tableColumns() {
    return [
      { label: 'NF', value: r => r.nf },
      { label: 'Cliente', value: r => r.cliente },
      { label: 'Transportadora', value: r => r.transportadora },
      { label: 'Motorista', value: r => r.motorista },
      { label: 'Vendedor', value: r => r.vendedor },
      { label: 'Cidade', value: r => r.cidade },
      { label: 'UF', value: r => r.uf },
      { label: 'Status', value: r => statusLabel(r.status) },
      { label: 'Prazo', value: r => prazoLabel(r.prazoStatus) },
      { label: 'Situação', value: r => r.situacao },
      { label: 'Situação Agendamento', value: r => r.statusAgendamento || '—' },
      { label: 'Valor NF', value: r => r.valorNF.toFixed(2).replace('.', ',') },
      { label: 'Data Coleta', value: r => Utils.formatDate(r.dataEntrega) },
      { label: 'Data Agendada', value: r => Utils.formatDate(r.dataAgendamento) }
    ];
  }

  /** As 12 colunas realmente exibidas em #data-table (thead/rowHtml) — usadas pelos botões de
   * mostrar/ocultar coluna e pelo envio de relatório por WhatsApp/E-mail. Separado de
   * tableColumns() porque aquele array serve pro CSV (15 colunas, inclui Motivo/Categoria/UF
   * separado) e não precisa mudar de comportamento por causa dessa funcionalidade nova. */
  function colunasTabelaPrincipal() {
    return [
      { field: 'nf', label: 'NF', value: r => r.nf },
      { field: 'cliente', label: 'Cliente', value: r => r.cliente },
      { field: 'transportadora', label: 'Transportadora', value: r => r.transportadora },
      { field: 'motorista', label: 'Motorista', value: r => r.motorista },
      { field: 'vendedor', label: 'Vendedor', value: r => r.vendedor },
      { field: 'cidade', label: 'Cidade/UF', value: r => `${r.cidade}${r.uf ? '/' + r.uf : ''}` },
      { field: 'status', label: 'Status', value: r => statusLabel(r.status) },
      { field: 'prazoStatus', label: 'Prazo', value: r => prazoLabel(r.prazoStatus) },
      { field: 'situacao', label: 'Situação', value: r => r.situacao },
      { field: 'statusAgendamento', label: 'Situação Agendamento', value: r => r.statusAgendamento || '—' },
      { field: 'valorNF', label: 'Valor NF', value: r => r.valorNF.toFixed(2).replace('.', ',') },
      { field: 'dataEntrega', label: 'Data Coleta', value: r => Utils.formatDate(r.dataEntrega) },
      { field: 'dataAgendamento', label: 'Data Agendada', value: r => Utils.formatDate(r.dataAgendamento) }
    ];
  }

  /** Desenha os botõezinhos redondos (um por coluna) acima da tabela "Registros detalhados" —
   * no lugar da borda laranja que separava o título da tabela. Verde brilhante = coluna
   * visível, vermelho brilhante = oculta (ver .col-toggle* em style.css). */
  function renderColumnToggles() {
    const container = document.getElementById('table-column-toggles');
    if (!container) return;
    container.innerHTML = colunasTabelaPrincipal().map(c => `
      <label class="col-toggle" title="Mostrar/ocultar coluna ${escapeAttr(c.label)}">
        <input type="checkbox" class="col-toggle__checkbox" data-field="${c.field}"${colunasOcultas.has(c.field) ? '' : ' checked'}>
        <span class="col-toggle__track"><span class="col-toggle__thumb"></span></span>
        <span class="col-toggle__label">${escapeAttr(c.label)}</span>
      </label>
    `).join('');
  }

  function bindColumnToggles() {
    const container = document.getElementById('table-column-toggles');
    if (!container) return;
    container.addEventListener('change', (e) => {
      const checkbox = e.target.closest('.col-toggle__checkbox');
      if (!checkbox) return;
      const field = checkbox.dataset.field;
      if (checkbox.checked) colunasOcultas.delete(field); else colunasOcultas.add(field);
      aplicarColunasOcultas();
    });
  }

  function aplicarColunasOcultas() {
    const tabela = document.getElementById('data-table');
    if (tabela) tabela.dataset.hide = Array.from(colunasOcultas).join(' ');
    atualizarBotoesScrollTabela();
  }

  /** Setas de rolar a tabela "Registros detalhados" pros lados — só existem pra essa tabela
   * (a única com os botões de mostrar/ocultar coluna); a tela de detalhe tem seu próprio
   * .table-scroll, mas sem setas. */
  function containerScrollTabelaPrincipal() {
    const tabela = document.getElementById('data-table');
    return tabela ? tabela.closest('.table-scroll') : null;
  }

  function bindScrollTabela() {
    const container = containerScrollTabelaPrincipal();
    const btnEsquerda = document.getElementById('btn-scroll-tabela-esquerda');
    const btnDireita = document.getElementById('btn-scroll-tabela-direita');
    if (!container || !btnEsquerda || !btnDireita) return;
    btnEsquerda.addEventListener('click', () => container.scrollBy({ left: -240, behavior: 'smooth' }));
    btnDireita.addEventListener('click', () => container.scrollBy({ left: 240, behavior: 'smooth' }));
    container.addEventListener('scroll', atualizarBotoesScrollTabela);
    window.addEventListener('resize', atualizarBotoesScrollTabela);
    atualizarBotoesScrollTabela();
  }

  /** Só mostra cada seta quando dá pra rolar mais naquela direção — sem colunas ocultadas ou em
   * telas largas o suficiente pra tabela caber inteira, as duas somem sozinhas. */
  function atualizarBotoesScrollTabela() {
    const container = containerScrollTabelaPrincipal();
    const btnEsquerda = document.getElementById('btn-scroll-tabela-esquerda');
    const btnDireita = document.getElementById('btn-scroll-tabela-direita');
    if (!container || !btnEsquerda || !btnDireita) return;
    const podeRolar = container.scrollWidth > container.clientWidth + 1;
    btnEsquerda.hidden = !podeRolar || container.scrollLeft <= 0;
    btnDireita.hidden = !podeRolar || container.scrollLeft >= container.scrollWidth - container.clientWidth - 1;
  }

  /* ============================================================
   * REGISTRO DINÂMICO — consolida as notas filtradas por Data de Faturamento (2026-08-18)
   * ============================================================ */

  /** Agrupa os registros (já filtrados) por dia de Data de Faturamento. Notas sem essa data
   * (cobertura parcial, ver applyFaturamentoEnrichment em data.js) não entram em nenhum grupo —
   * ficam de fora da tabela, mas contadas no aviso de cobertura acima dela.
   * `mesSelecionado` (opcional, um Date no 1º dia do mês) restringe as linhas a só aquele mês
   * — usado pela tabela de dias, que só mostra algo depois do usuário clicar num card de mês
   * (decisão do usuário, 2026-08-18). totalComData/totalSemData continuam sendo do total GERAL
   * (sem esse recorte), pra sempre refletir a cobertura de dados de todos os filtros ativos. */
  function calcularRegistroDinamico(records, mesSelecionado) {
    const comData = records.filter(r => r.dataFaturamento);
    const doMes = mesSelecionado
      ? comData.filter(r => r.dataFaturamento.getFullYear() === mesSelecionado.getFullYear() && r.dataFaturamento.getMonth() === mesSelecionado.getMonth())
      : comData;
    const grupos = Utils.groupBy(doMes, r => Utils.startOfDay(r.dataFaturamento).getTime());
    const linhas = Array.from(grupos.entries()).map(([timestamp, registros]) => ({
      dataFaturamento: new Date(Number(timestamp)),
      valorTotal: Utils.sum(registros, r => r.valorNF),
      quantidade: registros.length
    }));
    return { linhas, totalComData: comData.length, totalSemData: records.length - comData.length };
  }

  /** Mesma base de calcularRegistroDinamico, só que agrupada por MÊS (não por dia) — usada
   * só pelo gráfico "Evolução mensal", que não teria espaço legível pra 196 pontos diários. */
  function calcularRegistroDinamicoPorMes(records) {
    const comData = records.filter(r => r.dataFaturamento);
    const grupos = Utils.groupBy(comData, r => `${r.dataFaturamento.getFullYear()}-${r.dataFaturamento.getMonth()}`);
    return Array.from(grupos.entries())
      .map(([chave, registros]) => {
        const [ano, mes] = chave.split('-').map(Number);
        return { data: new Date(ano, mes, 1), valorTotal: Utils.sum(registros, r => r.valorNF), quantidade: registros.length };
      })
      .sort((a, b) => a.data - b.data);
  }

  function renderRegistroDinamicoChart(records) {
    const meses = calcularRegistroDinamicoPorMes(records);
    const labels = meses.map(m => `${Utils.MONTH_NAMES[m.data.getMonth()]}/${String(m.data.getFullYear()).slice(2)}`);
    charts.registroDinamico.update({
      labels,
      series: [{ name: 'Valor faturado', data: meses.map(m => m.valorTotal), color: ChartPalette[0] }]
    });
    renderRegistroDinamicoCardsMes(meses);
  }

  /** Um card pequeno por mês com a quantidade de notas — decisão do usuário (2026-08-18):
   * ocupa o espaço que sobrou embaixo do gráfico depois que "Quantidade de notas" saiu de lá
   * (grandeza incompatível com "Valor faturado" no mesmo eixo). Clicável: é o que agora
   * controla o que aparece na tabela de dias, à esquerda (ver registroDinamicoMesSelecionado). */
  function renderRegistroDinamicoCardsMes(meses) {
    const container = document.getElementById('registro-dinamico-cards-mes');
    if (!container) return;
    container.innerHTML = meses.map(m => {
      const ativo = registroDinamicoMesSelecionado && m.data.getTime() === registroDinamicoMesSelecionado.getTime();
      return `
        <button type="button" class="registro-dinamico__card-mes${ativo ? ' registro-dinamico__card-mes--ativo' : ''}" data-mes-fat="${m.data.getTime()}">
          <div class="registro-dinamico__card-mes__mes">${Utils.MONTH_NAMES[m.data.getMonth()]}/${String(m.data.getFullYear()).slice(2)}</div>
          <div class="registro-dinamico__card-mes__valor">${Utils.formatNumber(m.quantidade)}</div>
          <div class="registro-dinamico__card-mes__label">nota${m.quantidade === 1 ? '' : 's'}</div>
        </button>
      `;
    }).join('');
  }

  /** Clicar num card de mês já selecionado desmarca ele de novo (some a tabela de dias);
   * clicar noutro mês troca direto, sem precisar desmarcar antes — mesmo padrão já usado pro
   * clique numa data (abrirRegistroDinamicoDetalhe). */
  function abrirRegistroDinamicoMes(timestamp) {
    const novoMes = new Date(Number(timestamp));
    const jaEstaSelecionado = registroDinamicoMesSelecionado && registroDinamicoMesSelecionado.getTime() === novoMes.getTime();
    registroDinamicoMesSelecionado = jaEstaSelecionado ? null : novoMes;
    // O detalhe por nota (de um dia) pode não pertencer mais ao mês recém-selecionado, ou a
    // tabela de dias pode ter acabado de sumir (mês desmarcado) -- fecha pra não ficar órfão.
    registroDinamicoDataSelecionada = null;
    registroDinamicoTable.page = 1;
    renderRegistroDinamico();
  }

  function registrosDoDiaSelecionado() {
    if (!registroDinamicoDataSelecionada) return [];
    const alvo = registroDinamicoDataSelecionada.getTime();
    return DataStore.getFilteredRecords().filter(r => r.dataFaturamento && Utils.startOfDay(r.dataFaturamento).getTime() === alvo);
  }

  function rowHtmlRegistroDinamico(g) {
    const ativa = registroDinamicoDataSelecionada && g.dataFaturamento.getTime() === registroDinamicoDataSelecionada.getTime();
    return `
      <tr>
        <td><button type="button" class="nf-link${ativa ? ' nf-link--ativo' : ''}" data-data-fat="${g.dataFaturamento.getTime()}" title="Ver notas faturadas nessa data">${Utils.formatDate(g.dataFaturamento)}</button></td>
        <td class="text-right">${Utils.formatCurrency(g.valorTotal)}</td>
        <td class="text-right">${Utils.formatNumber(g.quantidade)}</td>
      </tr>
    `;
  }

  function rowHtmlRegistroDinamicoDetalhe(r) {
    const temCanhoto = canhotosIndex.has(r.nf.split('-')[0]);
    return `
      <tr>
        <td><button type="button" class="nf-link${temCanhoto ? ' nf-link--tem-canhoto' : ''}" data-nf="${escapeAttr(r.nf)}" title="Buscar canhoto de entrega">${escapeAttr(r.nf)}</button></td>
        <td class="text-right">${Utils.formatCurrency(r.valorNF)}</td>
        <td class="truncate" title="${escapeAttr(r.cliente)}">${escapeAttr(r.cliente)}</td>
        <td class="truncate" title="${escapeAttr(r.transportadora)}">${escapeAttr(r.transportadora)}</td>
        <td class="truncate" title="${escapeAttr(r.motorista)}">${escapeAttr(r.motorista)}</td>
        <td>${escapeAttr(r.cidade)}${r.uf ? '/' + escapeAttr(r.uf) : ''}</td>
        <td><span class="badge ${statusBadgeClass(r.status)}">${statusLabel(r.status)}</span></td>
        <td>${escapeAttr(r.statusAgendamento || '—')}</td>
        <td>${Utils.formatDate(r.dataAgendamento)}</td>
      </tr>
    `;
  }

  /** Recalcula e redesenha a tela "Registro Dinâmico" inteira (tabela por data + total geral +
   * detalhe do dia aberto, se houver). Só faz esse trabalho se a tela estiver de fato visível —
   * evita reagrupar a base inteira a cada tecla digitada num filtro enquanto o usuário está
   * olhando "Registros detalhados" ou "Análise por Região". */
  function renderRegistroDinamico() {
    const view = document.getElementById('registro-dinamico-view');
    if (!view || view.hidden) return;

    const registros = DataStore.getFilteredRecords();
    // Sem mês selecionado, mostra TODOS os dias normalmente (decisão do usuário, 2026-08-19:
    // reverteu a versão anterior, que começava vazia). O card de mês só FILTRA pra aquele mês
    // específico; clicar de novo no card ativo desmarca e volta a mostrar tudo.
    const { linhas, totalComData, totalSemData } = calcularRegistroDinamico(registros, registroDinamicoMesSelecionado);

    const coverageEl = document.getElementById('registro-dinamico-coverage');
    coverageEl.textContent = registros.length === 0
      ? 'Nenhuma nota para os filtros atuais.'
      : `${Utils.formatNumber(totalComData)} de ${Utils.formatNumber(registros.length)} notas têm Data de Faturamento registrada` +
        (totalSemData > 0 ? ` — ${Utils.formatNumber(totalSemData)} sem essa informação não aparecem nesta tela.` : '.');

    renderTableGeneric(linhas, registroDinamicoTable, REGISTRO_DINAMICO_TABLE_IDS, rowHtmlRegistroDinamico);

    document.getElementById('registro-dinamico-total-valor').textContent = Utils.formatCurrency(Utils.sum(linhas, l => l.valorTotal));
    document.getElementById('registro-dinamico-total-quantidade').textContent = Utils.formatNumber(linhas.reduce((acc, l) => acc + l.quantidade, 0));

    renderRegistroDinamicoChart(registros);
    renderRegistroDinamicoDetalhe();
  }

  function renderRegistroDinamicoDetalhe() {
    const secao = document.getElementById('registro-dinamico-detalhe');
    if (!registroDinamicoDataSelecionada) { secao.hidden = true; return; }
    secao.hidden = false;

    const registros = registrosDoDiaSelecionado();
    document.getElementById('registro-dinamico-detalhe-titulo').textContent =
      `Notas faturadas em ${Utils.formatDate(registroDinamicoDataSelecionada)} (${Utils.formatNumber(registros.length)})`;
    renderTableGeneric(registros, registroDinamicoDetalheTable, REGISTRO_DINAMICO_DETALHE_IDS, rowHtmlRegistroDinamicoDetalhe);
  }

  /** Clicar numa data já expandida fecha o detalhe de novo (alterna); clicar noutra data troca
   * o detalhe pra ela, sem precisar fechar antes. */
  function abrirRegistroDinamicoDetalhe(timestamp) {
    const novaData = new Date(Number(timestamp));
    const jaEstaAberta = registroDinamicoDataSelecionada && registroDinamicoDataSelecionada.getTime() === novaData.getTime();
    registroDinamicoDataSelecionada = jaEstaAberta ? null : novaData;
    registroDinamicoDetalheTable.page = 1;
    renderRegistroDinamico();
  }

  function bindRegistroDinamico() {
    bindTableControlsFor(registroDinamicoTable, REGISTRO_DINAMICO_TABLE_IDS,
      () => calcularRegistroDinamico(DataStore.getFilteredRecords(), registroDinamicoMesSelecionado).linhas,
      rowHtmlRegistroDinamico);
    bindTableControlsFor(registroDinamicoDetalheTable, REGISTRO_DINAMICO_DETALHE_IDS,
      registrosDoDiaSelecionado, rowHtmlRegistroDinamicoDetalhe);

    // Delegado no body (igual bindCanhotoLinks) porque a tabela/os cards são reconstruídos a
    // cada render. Um só listener cobre os dois tipos de clique (card de mês e data do dia).
    document.body.addEventListener('click', (e) => {
      const btnMes = e.target.closest('[data-mes-fat]');
      if (btnMes) { abrirRegistroDinamicoMes(btnMes.dataset.mesFat); return; }
      const btnData = e.target.closest('[data-data-fat]');
      if (!btnData) return;
      abrirRegistroDinamicoDetalhe(btnData.dataset.dataFat);
    });

    document.getElementById('registro-dinamico-detalhe-fechar').addEventListener('click', () => {
      registroDinamicoDataSelecionada = null;
      renderRegistroDinamico();
    });
  }

  /* ============================================================
   * FILTROS — popula selects com valores distintos dos dados
   * ============================================================ */

  /** Repopula uma lista de checkbox dinâmica (Transportadora/Motorista/.../Cidade) a partir dos
   * valores distintos dos dados carregados — preserva o que já estava marcado (o filtro
   * continua valendo mesmo depois de "Atualizar dados"). */
  /** `filterKey` (opcional) é a chave em DataStore.filters correspondente a essa lista — quando
   * informada, PODA do filtro qualquer valor que não exista mais em `values` antes de redesenhar
   * os checkboxes. Sem essa poda, um valor marcado (ex.: um Cliente) que deixa de aparecer nos
   * dados depois de uma atualização (base mudou, ou uma nota foi removida — ver
   * removerNotasComViagemFinalizadaMasEmAberto) some da LISTA (não tem mais checkbox pra ele),
   * mas continua ativo por dentro em DataStore.filters — o resultado trava em zero pra sempre,
   * sem nenhum checkbox marcado visível que explique por quê. Bug real, 2026-08-19 (descrito
   * como "o filtro usado muitas vezes trava e não busca dados"). */
  function fillCheckboxList(containerId, values, filterKey) {
    const container = document.getElementById(containerId);
    const jaMarcados = new Set(
      Array.from(container.querySelectorAll('.filter-checkbox__item:checked')).map(cb => cb.value)
    );
    if (filterKey) {
      const valoresValidos = new Set(values);
      const atual = DataStore.getFilters()[filterKey] || [];
      const podado = atual.filter(v => valoresValidos.has(v));
      if (podado.length !== atual.length) {
        DataStore.setFilters({ [filterKey]: podado });
        jaMarcados.forEach(v => { if (!valoresValidos.has(v)) jaMarcados.delete(v); });
      }
    }
    container.innerHTML =
      `<label class="filter-checkbox filter-checkbox--todos"><input type="checkbox" class="filter-checkbox__todos"> <strong>Selecionar todos</strong></label>` +
      values.map(v => `<label class="filter-checkbox"><input type="checkbox" class="filter-checkbox__item" value="${escapeAttr(v)}"${jaMarcados.has(v) ? ' checked' : ''}> ${escapeAttr(v)}</label>`).join('');
    const todos = container.querySelector('.filter-checkbox__todos');
    const itens = container.querySelectorAll('.filter-checkbox__item');
    todos.checked = itens.length > 0 && Array.from(itens).every(cb => cb.checked);
  }

  function populateFilterOptions() {
    fillCheckboxList('filter-transportadora-list', DataStore.getDistinctValues('transportadora'), 'transportadora');
    fillCheckboxList('filter-motorista-list', DataStore.getDistinctValues('motorista'), 'motorista');
    fillCheckboxList('filter-tipo-transporte-list', DataStore.getDistinctValues('tipoTransporte'), 'tipoTransporte');
    let vendedores = DataStore.getDistinctValues('vendedor');
    if (ocultarVendedorSemCliente) vendedores = vendedores.filter(v => v !== 'Não informado');
    fillCheckboxList('filter-vendedor-list', vendedores, 'vendedor');
    fillCheckboxList('filter-cliente-list', DataStore.getDistinctValues('cliente'), 'cliente');
    fillCheckboxList('filter-cidade-list', DataStore.getDistinctValues('cidade'), 'cidade');
    fillCheckboxList('filter-regiao-comercial-list', DataStore.getDistinctValues('regiaoComercial'), 'regiaoComercial');

    const anoEl = document.getElementById('filter-ano');
    const currentAno = anoEl.value;
    anoEl.innerHTML = '<option value="">Todos os anos</option>' +
      DataStore.getAvailableYears().map(y => `<option value="${y}">${y}</option>`).join('');
    if (currentAno) anoEl.value = currentAno;
  }

  function escapeAttr(str) {
    return String(str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* ============================================================
   * LABELS / CORES DE STATUS
   * ============================================================ */

  function statusLabel(status) {
    return { ENTREGUE: 'Entregue', EM_ABERTO: 'Em aberto', AGUARDANDO_AGENDAMENTO: 'Aguardando agendamento' }[status] || status;
  }
  function statusBadgeClass(status) {
    return { ENTREGUE: 'badge--success', EM_ABERTO: 'badge--danger', AGUARDANDO_AGENDAMENTO: 'badge--neutral' }[status] || 'badge--neutral';
  }
  function prazoLabel(prazo) {
    return { DENTRO_PRAZO: 'No Prazo', VENCIDO: 'ATRASADO', ENTREGUE: 'Entregue', SEM_INFO: 'Sem informação' }[prazo] || prazo;
  }
  function prazoBadgeClass(prazo) {
    return { DENTRO_PRAZO: 'badge--warning', VENCIDO: 'badge--danger', ENTREGUE: 'badge--success', SEM_INFO: 'badge--neutral' }[prazo] || 'badge--neutral';
  }

  /* ============================================================
   * RENDER PRINCIPAL — chamado sempre que os dados ou filtros mudam
   * ============================================================ */

  function render(records) {
    renderKPIs(records);
    renderCharts(records);
    table.page = 1;
    renderTable(records);
    renderStatusDetail(); // no-op se a tela de detalhe não estiver aberta
    renderRegistroDinamico(); // no-op se a tela "Registro Dinâmico" não estiver visível
    updateLastUpdatedLabel();
    enviarDadosRegioesParaIframe(records);
  }

  function renderAll() {
    populateFilterOptions();
    render(DataStore.getFilteredRecords());
  }

  function updateLastUpdatedLabel() {
    const el = document.getElementById('last-updated');
    const date = DataStore.getLastUpdated();
    if (el) el.textContent = date ? Utils.formatDateTime(date) : '—';
  }

  /* ============================================================
   * KPIs
   * ============================================================ */

  function renderKPIs(records) {
    // Usa exatamente os mesmos critérios do drill-down (STATUS_DETAIL_DEFS) — assim o número
    // do card nunca diverge do que aparece ao clicar nele.
    const entregues = records.filter(STATUS_DETAIL_DEFS['entregue'].test);
    const abertas = records.filter(STATUS_DETAIL_DEFS['em-aberto'].test);
    const devolucao = records.filter(STATUS_DETAIL_DEFS['devolucao'].test);
    const cancelado = records.filter(STATUS_DETAIL_DEFS['cancelado'].test);
    const reentrega = records.filter(STATUS_DETAIL_DEFS['reentrega'].test);
    const aguardando = records.filter(STATUS_DETAIL_DEFS['aguardando'].test);

    const total = records.length || 1;
    const percentual = (entregues.length / total) * 100;

    setKPI('kpi-entregues-count', entregues.length, Utils.formatNumber);
    setKPI('kpi-abertas-count', abertas.length, Utils.formatNumber);
    setKPI('kpi-devolucao-count', devolucao.length, Utils.formatNumber);
    setKPI('kpi-cancelado-count', cancelado.length, Utils.formatNumber);
    setKPI('kpi-reentrega-count', reentrega.length, Utils.formatNumber);
    setKPI('kpi-aguardando-count', aguardando.length, Utils.formatNumber);
    setKPI('kpi-percentual', percentual, v => Utils.formatPercent(v, 1));
    setKPI('kpi-valor-entregues', Utils.sum(entregues, r => r.valorNF), Utils.formatCurrency);
    setKPI('kpi-valor-abertas', Utils.sum(abertas, r => r.valorNF), Utils.formatCurrency);
    setKPI('kpi-valor-devolucao', Utils.sum(devolucao, r => r.valorNF), Utils.formatCurrency);
    setKPI('kpi-valor-cancelado', Utils.sum(cancelado, r => r.valorNF), Utils.formatCurrency);
    setKPI('kpi-valor-reentrega', Utils.sum(reentrega, r => r.valorNF), Utils.formatCurrency);
    setKPI('kpi-valor-aguardando', Utils.sum(aguardando, r => r.valorNF), Utils.formatCurrency);

    // Total geral — independente do status, conta tudo que passou pelos filtros atuais
    // (cada NF já é uma linha só, mesmo com reentregas — dedup acontece em data.js).
    setKPI('kpi-total-notas', records.length, Utils.formatNumber);
    setKPI('kpi-valor-total-notas', Utils.sum(records, r => r.valorNF), Utils.formatCurrency);
  }

  const kpiPrevValues = {};

  function setKPI(elId, targetValue, formatter) {
    const el = document.getElementById(elId);
    if (!el) return;
    const from = kpiPrevValues[elId] || 0;
    Utils.animateValue(el, from, targetValue, formatter, 800);
    kpiPrevValues[elId] = targetValue;

    const card = el.closest('.kpi-card');
    if (card) {
      card.classList.remove('kpi-card--pulse');
      requestAnimationFrame(() => card.classList.add('kpi-card--pulse'));
    }
  }

  /* ============================================================
   * GRÁFICOS
   * ============================================================ */

  function createCharts() {
    // Cores fixas por significado (iguais às usadas nos badges/legenda), não pela posição na paleta:
    // verde = entregue, amarelo = dentro do prazo, vermelho = pendente/vencido, cinza = sem informação.
    charts.status = new DashChart(document.getElementById('chart-status'), {
      type: 'pie', labels: [], series: [{ data: [] }],
      // Entregues, Aguardando agendamento, Devolução, Cancelado, Reentrega, Em aberto — mesma
      // categorização dos cards de KPI (STATUS_DETAIL_DEFS), pra bater 1:1 com o que aparece lá.
      // Não tem categoria "Agendados" própria aqui: isso já é o gráfico "Situação de
      // agendamento" ao lado, que usa a coluna "Status" da planilha de Agendamentos.
      options: { colors: ['#16A34A', '#64748B', '#EAB308', '#8B5CF6', '#0EA5E9', '#DC2626'] }
    });
    charts.prazo = new DashChart(document.getElementById('chart-prazo'), {
      type: 'donut', labels: [], series: [{ data: [] }],
      options: { colors: ['#EAB308', '#DC2626', '#16A34A', '#64748B'] } // No Prazo, Atrasado, Entregue, Sem informação
    });
    charts.agendamento = new DashChart(document.getElementById('chart-agendamento'), {
      type: 'donut', labels: [], series: [{ data: [] }],
      // Agendado, Aguardando agendamento, Aguardando Confirmação, Reagendar, Okker.
      options: {
        colors: ['#2563EB', '#EAB308', '#FF7A1A', '#DC2626', '#8B5CF6'],
        // Clicar num tile abre a mesma tela de detalhe (com edição de data/status) que já
        // existia só pro card "Aguardando agendamento" — pedido do usuário, 2026-08-19.
        onLegendClick: (label) => {
          const key = AGENDAMENTO_LABEL_PARA_DETAIL_KEY[label];
          if (key) openStatusDetail(key);
        }
      }
    });
    charts.transportadora = new DashChart(document.getElementById('chart-transportadora'), {
      type: 'bar', labels: [], series: [{ name: 'Notas', data: [], color: ChartPalette[1] }]
    });
    charts.rankingTransportadorasMelhores = new DashChart(document.getElementById('chart-ranking-transportadoras-melhores'), {
      type: 'hbar', labels: [],
      series: [
        { name: 'Entregues', data: [], color: '#16A34A' },
        { name: 'Devolvidos', data: [], color: '#DC2626' }
      ],
      options: { fullLabels: true, thickBars: true }
    });
    charts.rankingTransportadorasPiores = new DashChart(document.getElementById('chart-ranking-transportadoras-piores'), {
      type: 'hbar', labels: [],
      series: [
        { name: 'Entregues', data: [], color: '#16A34A' },
        { name: 'Devolvidos', data: [], color: '#DC2626' }
      ],
      options: { fullLabels: true, thickBars: true }
    });
    charts.evolucaoMensal = new DashChart(document.getElementById('chart-evolucao-mensal'), {
      type: 'area', labels: [], series: [{ name: 'Valor faturado', data: [], color: ChartPalette[0] }], options: { currency: true }
    });
    // Registro Dinâmico: mesmo visual de "Evolução mensal" (área com gradiente, sobe junto
    // com o valor) — decisão do usuário (2026-08-18): a Quantidade de notas saiu do gráfico
    // (grandeza muito diferente de Valor) e passou a ser um card por mês, abaixo dele.
    charts.registroDinamico = new DashChart(document.getElementById('chart-registro-dinamico'), {
      type: 'area', labels: [], series: [{ name: 'Valor faturado', data: [], color: ChartPalette[0] }], options: { currency: true }
    });
    charts.comparativo = new DashChart(document.getElementById('chart-comparativo'), {
      type: 'line',
      labels: [],
      series: [
        { name: 'Mês atual', data: [], color: ChartPalette[0] },
        { name: 'Mês anterior', data: [], color: ChartPalette[1] }
      ],
      options: { currency: true }
    });
    charts.ranking = new DashChart(document.getElementById('chart-ranking'), {
      type: 'hbar', labels: [], series: [{ name: 'Valor', data: [], color: ChartPalette[4] }], options: { currency: true }
    });

    document.getElementById('ranking-dimension').addEventListener('change', () => renderCharts(DataStore.getFilteredRecords()));
  }

  function renderCharts(records) {
    renderStatusChart(records);
    renderPrazoChart(records);
    renderAgendamentoChart(records);
    renderTransportadoraChart(records);
    renderRankingTransportadoras(records);
    renderEvolucaoMensal(records);
    renderComparativo(records);
    renderRanking(records);
  }

  function renderStatusChart(records) {
    // Usa exatamente os mesmos critérios dos cards de KPI (STATUS_DETAIL_DEFS), pra nunca
    // divergir do que aparece lá. Sem "aguardando": desde 2026-08-16 esse card deixou de ser
    // uma categoria exclusiva (passou a se sobrepor com "em-aberto"/"reentrega" de propósito —
    // ver STATUS_DETAIL_DEFS), e essa pizza só faz sentido com fatias mutuamente exclusivas.
    const keys = ['entregue', 'em-aberto', 'devolucao', 'cancelado', 'reentrega'];
    const counts = keys.map(k => records.filter(STATUS_DETAIL_DEFS[k].test).length);

    charts.status.update({
      labels: keys.map(k => STATUS_DETAIL_DEFS[k].title),
      series: [{ data: counts }]
    });
  }

  function renderPrazoChart(records) {
    const groups = { DENTRO_PRAZO: 0, VENCIDO: 0, ENTREGUE: 0, SEM_INFO: 0 };
    records.forEach(r => { groups[r.prazoStatus] = (groups[r.prazoStatus] || 0) + 1; });
    charts.prazo.update({
      labels: ['No Prazo', 'ATRASADO', 'Entregue', 'Sem informação'],
      series: [{ data: [groups.DENTRO_PRAZO, groups.VENCIDO, groups.ENTREGUE, groups.SEM_INFO] }]
    });
  }

  const AGENDAMENTO_STATUS_CATEGORIAS = [
    'Agendado', 'Sem etapa definida', 'Aguardando Confirmação', 'Reagendar', 'Okker'
  ];
  // As 4 etapas abaixo são as únicas que representam um estágio de agendamento JÁ REGISTRADO
  // (valor bruto da coluna "Status" da planilha de Agendamentos). Qualquer nota da população
  // (ver renderAgendamentoChart) que não tenha uma dessas 4 cai em "Sem etapa definida" por
  // padrão.
  const AGENDAMENTO_ETAPAS_ESPECIFICAS = ['Agendado', 'Aguardando Confirmação', 'Reagendar', 'Okker'];

  /** Situação de agendamento: só entram notas que realmente "Obriga Agendamento" e estão "Em
   * aberto" (mesma população do card "Aguardando agendamento", ver STATUS_DETAIL_DEFS —
   * decisão do usuário, 2026-08-17), quebradas pelas etapas já registradas na planilha de
   * Agendamentos; o que sobra vai pra "Sem etapa definida". Por causa disso, o card não bate
   * mais com o TOTAL desse gráfico (soma das 5 fatias) — bate exatamente com a fatia "Sem etapa
   * definida" sozinha, já que o card é, por definição, quem ainda não tem etapa nenhuma. As
   * outras 4 fatias (Agendado/Aguardando Confirmação/Reagendar/Okker) mostram quem já avançou
   * além do card, mas continua "Em aberto" aguardando a entrega de fato. */
  function renderAgendamentoChart(records) {
    const counts = Object.fromEntries(AGENDAMENTO_STATUS_CATEGORIAS.map(c => [c, 0]));
    records.forEach(r => {
      if (!r.necessitaAgendamento || r.situacao !== 'Em aberto') return;
      if (AGENDAMENTO_ETAPAS_ESPECIFICAS.includes(r.statusAgendamento)) {
        counts[r.statusAgendamento]++;
      } else {
        counts['Sem etapa definida']++;
      }
    });
    charts.agendamento.update({
      labels: AGENDAMENTO_STATUS_CATEGORIAS,
      series: [{ data: AGENDAMENTO_STATUS_CATEGORIAS.map(c => counts[c]) }]
    });
  }

  function renderTransportadoraChart(records) {
    const grouped = Utils.groupBy(records, r => r.transportadora);
    const entries = Array.from(grouped.entries())
      .map(([name, items]) => ({ name, count: items.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    charts.transportadora.update({
      labels: entries.map(e => e.name),
      series: [{ name: 'Notas', data: entries.map(e => e.count), color: ChartPalette[1] }]
    });
  }

  /**
   * Ranking de transportadoras por taxa de entrega (entregues ÷ total), não por volume bruto —
   * senão uma transportadora com poucas notas mas 100% de acerto nunca apareceria, e uma com
   * muito volume dominaria só por tamanho. Exige >=3 notas para entrar no ranking. Sempre
   * mostra as 15 melhores e as 15 piores lado a lado, num gráfico cada.
   */
  function renderRankingTransportadoras(records) {
    const QUANTIDADE = 15;
    const grouped = Utils.groupBy(records, r => r.transportadora);

    // "Devolvidos" agrupa as 3 situações que significam que a nota voltou (por decisão do
    // usuário, 2026-08-16): Devolução, Reentrega e Cancelado — não é mais sobre prazo vencido.
    const entries = Array.from(grouped.entries())
      .map(([name, items]) => {
        const total = items.length;
        const entregues = items.filter(r => r.status === 'ENTREGUE').length;
        const devolvidos = items.filter(r => r.situacao === 'Devolução' || r.situacao === 'Reentrega' || r.situacao === 'Cancelado').length;
        return { name, total, entregues, devolvidos, taxa: entregues / total };
      })
      .filter(e => e.total >= 3)
      .sort((a, b) => b.taxa - a.taxa);

    // A taxa decide quem entra em cada lista — mas taxa não é o que aparece nas barras, então
    // ordenar por ela deixava o gráfico com barras fora de ordem visualmente. Pra exibição,
    // ordena sempre pela quantidade de Entregues (decrescente, igual ao "Ranking top 10").
    const melhores = entries.slice(0, QUANTIDADE).sort((a, b) => b.entregues - a.entregues);
    const piores = entries.slice(-QUANTIDADE).sort((a, b) => b.entregues - a.entregues);

    const toSeries = (list) => ({
      labels: list.map(e => e.name),
      series: [
        { name: 'Entregues', data: list.map(e => e.entregues), color: '#16A34A' },
        { name: 'Devolvidos', data: list.map(e => e.devolvidos), color: '#DC2626' }
      ]
    });
    charts.rankingTransportadorasMelhores.update(toSeries(melhores));
    charts.rankingTransportadorasPiores.update(toSeries(piores));
  }

  function renderEvolucaoMensal(records) {
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
    }
    // Usa dataInicioViagem (mês em que a nota saiu pra entrega), não dataFaturamento — essa
    // fica vazia pra quase todas as notas vindas da Bluesoft (só a planilha "NF Aberta" tem
    // faturamento, ~500 notas de ~58 mil). Sem risco de duplicidade aqui: cada NF já é uma
    // linha só em `records` (a Base Bluesoft é deduplicada por NF em data.js, mantendo o
    // status mais conclusivo quando a mesma nota tem mais de uma tentativa/reentrega).
    const values = months.map(month => Utils.sum(
      records.filter(r => r.dataInicioViagem && Utils.isSameMonth(r.dataInicioViagem, month)),
      r => r.valorNF
    ));

    // Meses sem nenhum valor faturado ficam de fora — não faz sentido mostrar um ponto
    // zerado no meio da linha só porque aquele mês não teve dados.
    const labels = [];
    const filteredValues = [];
    months.forEach((m, i) => {
      if (values[i] === 0) return;
      labels.push(`${Utils.MONTH_NAMES[m.getMonth()]}/${String(m.getFullYear()).slice(2)}`);
      filteredValues.push(values[i]);
    });

    charts.evolucaoMensal.update({
      labels,
      series: [{ name: 'Valor faturado', data: filteredValues, color: ChartPalette[0] }]
    });
  }

  /** Soma o faturamento por dia do mês, comparando o mês atual com o mês anterior lado a lado. */
  function renderComparativo(records) {
    const now = new Date();
    const prevMonthRef = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const daysInCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysInPrevMonth = new Date(prevMonthRef.getFullYear(), prevMonthRef.getMonth() + 1, 0).getDate();
    const maxDays = Math.max(daysInCurrentMonth, daysInPrevMonth);

    const currentMonthData = new Array(maxDays).fill(0);
    const prevMonthData = new Array(maxDays).fill(0);

    // dataInicioViagem em vez de dataFaturamento, pelo mesmo motivo do gráfico de evolução
    // mensal — ver comentário em renderEvolucaoMensal.
    records.forEach(r => {
      const ref = r.dataInicioViagem;
      if (!ref) return;
      const dayIndex = ref.getDate() - 1;
      if (Utils.isSameMonth(ref, now)) currentMonthData[dayIndex] += r.valorNF;
      else if (Utils.isSameMonth(ref, prevMonthRef)) prevMonthData[dayIndex] += r.valorNF;
    });

    // Dias em que nenhum dos dois meses faturou nada ficam de fora do gráfico.
    const labels = [];
    const currentFiltered = [];
    const prevFiltered = [];
    for (let i = 0; i < maxDays; i++) {
      if (currentMonthData[i] === 0 && prevMonthData[i] === 0) continue;
      labels.push(String(i + 1).padStart(2, '0'));
      currentFiltered.push(currentMonthData[i]);
      prevFiltered.push(prevMonthData[i]);
    }

    charts.comparativo.update({
      labels,
      series: [
        { name: 'Mês atual', data: currentFiltered, color: ChartPalette[0] },
        { name: 'Mês anterior', data: prevFiltered, color: ChartPalette[1] }
      ]
    });
  }

  function renderRanking(records) {
    const dimension = document.getElementById('ranking-dimension').value || 'cliente';
    const grouped = Utils.groupBy(records, r => r[dimension]);
    const entries = Array.from(grouped.entries())
      .map(([name, items]) => ({ name, total: Utils.sum(items, r => r.valorNF) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    charts.ranking.update({
      labels: entries.map(e => e.name),
      series: [{ name: 'Valor', data: entries.map(e => e.total), color: ChartPalette[4] }]
    });
  }

  /* ============================================================
   * TABELA
   * ============================================================ */

  function rowHtml(r) {
    // Verde quando a NF já tem canhoto indexado (pasta do SharePoint), laranja quando não tem
    // — só uma consulta O(1) no Map já carregado em memória, sem custo perceptível por linha.
    const temCanhoto = canhotosIndex.has(r.nf.split('-')[0]);
    return `
      <tr>
        <td><button type="button" class="nf-link${temCanhoto ? ' nf-link--tem-canhoto' : ''}" data-nf="${escapeAttr(r.nf)}" title="Buscar canhoto de entrega">${escapeAttr(r.nf)}</button></td>
        <td class="truncate" title="${escapeAttr(r.cliente)}">${escapeAttr(r.cliente)}</td>
        <td class="truncate" title="${escapeAttr(r.transportadora)}">${escapeAttr(r.transportadora)}</td>
        <td class="truncate" title="${escapeAttr(r.motorista)}">${escapeAttr(r.motorista)}</td>
        <td>${escapeAttr(r.vendedor)}</td>
        <td>${escapeAttr(r.cidade)}${r.uf ? '/' + escapeAttr(r.uf) : ''}</td>
        <td><span class="badge ${statusBadgeClass(r.status)}">${statusLabel(r.status)}</span></td>
        <td><span class="badge ${prazoBadgeClass(r.prazoStatus)}">${prazoLabel(r.prazoStatus)}</span></td>
        <td>${r.situacao === 'NF Não encontrada' ? `<span class="badge badge--neutral">${escapeAttr(r.situacao)}</span>` : escapeAttr(r.situacao)}</td>
        <td>${escapeAttr(r.statusAgendamento || '—')}</td>
        <td class="text-right">${Utils.formatCurrency(r.valorNF)}</td>
        <td>${Utils.formatDate(r.dataEntrega)}</td>
        <td>${Utils.formatDate(r.dataAgendamento)}</td>
      </tr>
    `;
  }

  /** Ordena, pagina e desenha uma tabela — usado pela tabela principal, pela tela de detalhe
   * (drill-down de KPI) e pelo Registro Dinâmico, cada uma com seu próprio estado, ids de
   * elementos e (quando as linhas não são um registro de NF puro) renderizador de linha. */
  function renderTableGeneric(records, state, ids, rowRenderer = rowHtml) {
    const sorted = records.slice().sort((a, b) => {
      let va = a[state.sortField];
      let vb = b[state.sortField];
      if (va instanceof Date || vb instanceof Date) { va = va ? va.getTime() : -Infinity; vb = vb ? vb.getTime() : -Infinity; }
      if (typeof va === 'string') return state.sortDir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR');
      const diff = (va || 0) - (vb || 0);
      return state.sortDir === 'asc' ? diff : -diff;
    });

    const totalPages = Math.max(1, Math.ceil(sorted.length / state.pageSize));
    state.page = Math.min(state.page, totalPages);
    const start = (state.page - 1) * state.pageSize;
    const pageItems = sorted.slice(start, start + state.pageSize);

    const tbody = document.getElementById(ids.tbody);

    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${ids.colspan || 14}" class="table-empty">${ids.emptyMessage || 'Nenhum registro encontrado para os filtros atuais.'}</td></tr>`;
    } else {
      tbody.innerHTML = pageItems.map(rowRenderer).join('');
    }

    document.getElementById(ids.info).textContent =
      sorted.length === 0 ? 'Nenhum registro' : `${start + 1}–${Math.min(start + state.pageSize, sorted.length)} de ${sorted.length} registros`;
    document.getElementById(ids.pageLabel).textContent = `Página ${state.page} de ${totalPages}`;
    document.getElementById(ids.prev).disabled = state.page <= 1;
    document.getElementById(ids.next).disabled = state.page >= totalPages;

    document.querySelectorAll(ids.theadSelector).forEach(th => {
      th.classList.remove('is-sorted-asc', 'is-sorted-desc');
      if (th.dataset.field === state.sortField) th.classList.add(state.sortDir === 'asc' ? 'is-sorted-asc' : 'is-sorted-desc');
    });
  }

  function renderTable(records) {
    renderTableGeneric(records, table, MAIN_TABLE_IDS);
    atualizarBotoesScrollTabela();
  }

  /* ============================================================
   * CANHOTOS — busca do comprovante de entrega ao clicar na NF
   * ============================================================ */

  /** Carrega o índice NF -> canhoto(s). Silencioso: sem índice, o clique na NF só mostra
   * "Sem Canhoto" pra tudo, em vez de travar o resto do dashboard. */
  async function loadCanhotosIndex(url) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      canhotosIndex = new Map(Object.entries(data));
    } catch (err) {
      console.warn('Índice de canhotos não carregado:', err.message);
    }
  }

  function bindCanhotoLinks() {
    // Delegado no body (em vez de um listener por linha) porque a tabela é reconstruída a
    // cada render — um listener direto no botão se perderia toda vez.
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('.nf-link');
      if (!btn) return;
      openCanhoto(btn.dataset.nf);
    });
  }

  function openCanhoto(nf) {
    // A Base Bluesoft guarda a NF com sufixo de viagem/item ("138124-1") — os arquivos de
    // canhoto são nomeados só com o número da nota, sem esse sufixo.
    const base = String(nf).split('-')[0];
    const info = canhotosIndex.get(base);
    // Array.isArray() como defesa: o gerador do índice já garante lista, mas se algum dia
    // uma NF tiver 1 único arquivo e o JSON vier com uma string solta em vez de lista de 1
    // posição, isso evita abrir só a 1ª letra da URL.
    const urls = info ? (Array.isArray(info) ? info : [info]) : [];
    if (!urls.length) {
      Utils.showToast(`NF ${nf}: Sem Canhoto`, 'warning');
      return;
    }
    window.open(urls[0], '_blank', 'noopener');
    if (urls.length > 1) {
      Utils.showToast(`NF ${nf}: ${urls.length} arquivos encontrados — abrindo o primeiro.`, 'info', 5000);
    }
  }

  return {
    init, renderAll, loadCanhotosIndex, isSuperAdminAgendamento, isSuperAdminEmailAgendamento, setPermissaoEdicaoAgendamento,
    computarDadosRegioesAoVivo, enviarDadosRegioesParaIframe,
    calcularRegistroDinamico, calcularRegistroDinamicoPorMes,
  };
})();
