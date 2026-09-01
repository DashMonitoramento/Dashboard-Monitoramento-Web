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
  // NFs marcadas na tabela "Registros detalhados" (2026-08-30, "Enviar Ocorrência") — só nessa
  // tabela, não nas telas de detalhe/drill-down. Chave = r.nf (único por linha). Podado sempre
  // que os filtros mudam (ver renderTable) pra nunca ficar com uma NF que saiu do recorte atual.
  let notasSelecionadas = new Set();
  // Bloco(s) da ocorrência aberta no momento — 1 bloco por combinação Cliente+Motorista distinta
  // entre as NFs selecionadas (normalmente só 1). Ver abrirModalOcorrencia/renderBlocosOcorrencia.
  let ocorrenciaBlocos = [];
  let proximoIdBlocoOcorrencia = 0;
  // Guarda os registros selecionados quando há Cliente/Motorista misto, entre mostrar o aviso
  // e o clique em "Criar ocorrências separadas automaticamente" (ver abrirModalOcorrencia).
  let ocorrenciaRegistrosPendentes = [];
  let relatorioCanalSelecionado = 'whatsapp';
  // NF (base, sem sufixo) cuja observação está sendo editada na tabela "Registros detalhados"
  // (2026-08-30) — mesmo padrão de painel único usado em "Registro Dinâmico"
  // (registroDinamicoObservacaoNf), só que pra tabela inicial.
  let registrosDetalhadosObservacaoNf = null;
  // "Ocorrências do Dia" (2026-08-31): tela nova no "Central de Dados" que é a MESMA tabela
  // "Registros detalhados" (mesmo estado `table`, mesma seleção, mesmo Enviar Ocorrência/Enviar
  // Relatório) só que em tela cheia (KPIs/gráficos escondidos, ver mostrarViewMapaRegioes) e com
  // um filtro extra por cima: Data Coleta dentro do período escolhido + a nota já ter uma
  // Observação preenchida (ver aplicarFiltroOcorrenciasDoDia). Não cria tabela/estado duplicado.
  let modoOcorrenciasAtivo = false;
  let ocorrenciasDoDiaPeriodo = 'hoje'; // 'ontem' | 'hoje' | 'semana' | 'mes'
  const MAIN_TABLE_IDS = {
    tbody: 'table-body', info: 'table-info', pageLabel: 'table-page-label',
    prev: 'table-prev', next: 'table-next', theadSelector: '#data-table thead th[data-field]',
    colspan: 24 // coluna de checkbox (2026-08-30) + 15 colunas originais (+ Número do Pedido) + 8 novas (ver colunasTabelaPrincipal)
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
    prev: 'detail-table-prev', next: 'detail-table-next', theadSelector: '#detail-data-table thead th[data-field]',
    colspan: 15
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
  // Submenu por Transportadora dentro da data selecionada (pedido do usuário, 2026-08-27) — uma
  // linha por transportadora daquele dia, com soma de Valor e contagem de notas. Clicar numa
  // transportadora abre, embaixo, o detalhe por nota (3ª tabela/estado, registroDinamicoDetalheTable).
  let registroDinamicoTransportadoraTable = Object.assign(createTableState(), { sortField: 'valorTotal', sortDir: 'desc' });
  const REGISTRO_DINAMICO_TRANSPORTADORA_IDS = {
    tbody: 'registro-dinamico-transportadoras-table-body', info: 'registro-dinamico-transportadoras-table-info',
    pageLabel: 'registro-dinamico-transportadoras-table-page-label', prev: 'registro-dinamico-transportadoras-table-prev',
    next: 'registro-dinamico-transportadoras-table-next', theadSelector: '#registro-dinamico-transportadoras-table thead th[data-field]',
    colspan: 3
  };
  let registroDinamicoDetalheTable = Object.assign(createTableState(), { sortField: 'nf', sortDir: 'asc' });
  const REGISTRO_DINAMICO_DETALHE_IDS = {
    tbody: 'registro-dinamico-detalhe-table-body', info: 'registro-dinamico-detalhe-table-info',
    pageLabel: 'registro-dinamico-detalhe-table-page-label', prev: 'registro-dinamico-detalhe-table-prev',
    next: 'registro-dinamico-detalhe-table-next', theadSelector: '#registro-dinamico-detalhe-table thead th[data-field]',
    colspan: 11
  };
  // "Pedidos Aguardando Faturamento" (2026-08-28) — tela de detalhe própria, aberta ao clicar
  // no card extra dentro de "Situação de agendamento". Não reaproveita status-detail-view
  // (aquela tabela é hardcoded pras colunas de um registro de NF — Transportadora/Status/
  // Situação/etc. — que essa base nem tem, ver pedidosNaoFaturados/getPedidosNaoFaturados em
  // data.js). Mesmo "jeito" visual (cabeçalho com voltar, busca, tabela paginável), só que
  // com colunas próprias (Número do Pedido/Cliente/Grupo Econômico/Data Emissão/Valor/Qtde).
  let pedidosNaoFaturadosTable = Object.assign(createTableState(), { sortField: 'dataEmissao', sortDir: 'asc' });
  const PEDIDOS_NAO_FATURADOS_TABLE_IDS = {
    tbody: 'pedidos-nao-faturados-table-body', info: 'pedidos-nao-faturados-table-info',
    pageLabel: 'pedidos-nao-faturados-table-page-label', prev: 'pedidos-nao-faturados-table-prev',
    next: 'pedidos-nao-faturados-table-next', theadSelector: '#pedidos-nao-faturados-table thead th[data-field]',
    colspan: 7
  };
  let pedidosNaoFaturadosBusca = '';
  // Número do pedido em edição (painel abaixo da tabela), ou null se nenhum — pedido do
  // usuário (2026-08-28): clicar no Número do Pedido abre a edição, igual à de "Aguardando
  // agendamento", só que pra um pedido só por vez (não a lista inteira de uma vez).
  let pedidoSelecionadoParaEdicao = null;
  // Qual dos 2 quadrados de split (dentro de "Situação de agendamento") abriu essa tela — null
  // quando veio do card combinado do topo (mostra tudo). Pedido do usuário (2026-08-29): antes
  // os 3 gatilhos (card combinado + os 2 quadrados) abriam a MESMA lista completa, sem filtro
  // nenhum — "S/ Agendamento" precisa mostrar só quem é "Entrega Direta" de verdade.
  let pedidosNaoFaturadosCategoria = null;

  // "Lead Time de Pedidos e Entregas" (2026-08-23) — painel próprio, com filtros e busca de
  // tabela independentes dos filtros globais da barra lateral (ver comentário em
  // calcularLeadTimePedidos, data.js).
  let leadTimePedidosTable = Object.assign(createTableState(), { sortField: 'situacao', sortDir: 'asc' });
  const LEADTIME_PEDIDOS_TABLE_IDS = {
    tbody: 'ltp-table-body', info: 'ltp-table-info', pageLabel: 'ltp-table-page-label',
    prev: 'ltp-table-prev', next: 'ltp-table-next', theadSelector: '#ltp-table thead th[data-field]',
    colspan: 17, emptyMessage: 'Nenhum pedido encontrado para os filtros atuais.'
  };
  let leadTimePedidosSelectsPopulados = false;
  let leadTimePedidosBusca = '';
  let leadTimePedidosItensFiltrados = []; // pós-filtros do painel, PRÉ busca da tabela
  let leadTimePedidosLinhasTabela = [];   // pós busca da tabela — o que a tabela de fato usa

  // Data (meia-noite) atualmente expandida na tabela de dias, ou null se nenhuma — controla
  // a visibilidade/conteúdo do submenu de Transportadoras (e, por tabela, do detalhe por nota)
  // e o destaque visual da linha clicada.
  let registroDinamicoDataSelecionada = null;
  // Transportadora escolhida dentro do submenu da data aberta, ou null se nenhuma — o detalhe
  // por nota só aparece depois de escolher também uma transportadora (pedido do usuário,
  // 2026-08-27), mesmo padrão de drill-down em 2 níveis já usado por mês -> dia.
  let registroDinamicoTransportadoraSelecionada = null;
  // Mês (1º dia, meia-noite) selecionado no card abaixo do gráfico, ou null se nenhum — null
  // mostra TODOS os dias normalmente na tabela de cima; selecionar um mês filtra só pra ele
  // (decisão do usuário, 2026-08-19: clicar de novo no card ativo desmarca e volta a mostrar tudo).
  let registroDinamicoMesSelecionado = null;
  // NF (base, sem sufixo "-1") em edição no painel de observação abaixo do detalhe por nota, ou
  // null se nenhuma — pedido do usuário (2026-08-29): "ao clicar na coluna Observação, abrir
  // uma tela pra editar e salvar". Mesmo padrão de "1 item por vez" do Número do Pedido em
  // "Pedidos Aguardando Faturamento" (ver abrirEdicaoPedido).
  let registroDinamicoObservacaoNf = null;

  // Precisa ficar em sincronia com os valores dos checkboxes de #filter-status-list no
  // index.html — qualquer r.situacao fora dessa lista cai no botão "Status Diversos".
  const KNOWN_SITUACOES = [
    'Aguardando agendamento', 'Agendado', 'Cancelado', 'Devolução', 'Em aberto',
    'Em rota', 'Entregue', 'Reentrega', 'Recusa', 'Reagendar'
  ];

  // Situação elegível pra entrar em qualquer card/gráfico de agendamento — "Em aberto" (o
  // caso normal) OU "Aguardando agendamento" (um texto de Situação à parte, vindo direto da
  // Base Bluesoft, que descreve a mesma coisa na prática). Antes só "Em aberto" contava:
  // uma nota com Situação="Aguardando agendamento" não aparecia em NENHUM card de agendamento
  // pra ser editada, mesmo precisando (pedido do usuário, 2026-08-26, caso real: NF 172151).
  function situacaoElegivelParaAgendamento(situacao) {
    return situacao === 'Em aberto' || situacao === 'Aguardando agendamento';
  }

  /** Uma nota/pedido "Agendado" cuja Data de Agendamento já passou (antes de hoje) — pedido do
   * usuário (2026-08-29): esses precisam sair do card "Agendado" e formar uma categoria própria
   * "Agendamento Vencido" (ela ainda não foi entregue, mas o dia marcado já passou). Sem data
   * (não deveria acontecer pra quem já é "Agendado", mas por segurança) conta como não vencido. */
  function agendamentoVencido(dataAgendamento) {
    if (!dataAgendamento) return false;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return dataAgendamento.getTime() < hoje.getTime();
  }

  // Cada entrada define o que um card de KPI representa, pra abrir a tela de detalhe com
  // exatamente os registros que compõem aquele número (mesmo critério usado em renderKPIs).
  const STATUS_DETAIL_DEFS = {
    'entregue': { title: 'Notas entregues', test: r => r.status === 'ENTREGUE' },
    'em-aberto': { title: 'Notas em aberto', test: r => r.situacao === 'Em aberto' },
    // Split do card acima em duas frentes (pedido do usuário, 2026-08-26): ela quer comparar
    // quantidade/valor de quem exige agendamento (não depende 100% dela resolver) com quem
    // não exige (tem que sair dentro do Lead Time). 'em-aberto' original continua existindo
    // (usado por renderStatusChart e como base de renderKPIs) — estas são só recortes dele.
    'em-aberto-sem-agendamento': {
      title: 'Em aberto (sem agendamento)',
      test: r => r.situacao === 'Em aberto' && !r.necessitaAgendamento
    },
    'em-aberto-com-agendamento': {
      title: 'Em aberto (exige agendamento)',
      test: r => r.situacao === 'Em aberto' && r.necessitaAgendamento
    },
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
    // paradas esperando alguém agendar. Só NOTAS (já faturadas, com roteiro) — pedidos sem NF
    // ainda NÃO entram aqui (ver 'sem-roteiro' abaixo), justamente pra não confundir "já tem
    // roteiro mas falta status" com "nem tem roteiro ainda" (pedido do usuário, 2026-08-30).
    'aguardando': {
      title: 'Aguardando agendamento',
      test: r => r.necessitaAgendamento && situacaoElegivelParaAgendamento(r.situacao) &&
        !AGENDAMENTO_ETAPAS_ESPECIFICAS.includes(r.statusAgendamento)
    },
    // Fatia "Sem roteiro/ sem agendamento" do gráfico "Situação de agendamento" (pedido do
    // usuário, 2026-08-30): antes ela reaproveitava a MESMA chave 'aguardando' acima, misturando
    // notas já faturadas (que JÁ TÊM roteiro, só falta marcar o status) com pedidos que nem
    // viraram nota ainda. Isso fazia um pedido faturado aparecer como "sem roteiro", o que é
    // errado — se já foi faturado, o roteiro existe. `test` sempre false de propósito: NENHUMA
    // nota pertence aqui (notas faturadas sem status ficam só em 'aguardando'/no card
    // "Aguardando Agendamento" ao lado); só PEDIDOS (Pedidos Aguardando Faturamento, sem NF
    // ainda) entram, via DETAIL_KEYS_COM_PEDIDOS/categoriaAgendamentoParaPedido mais abaixo.
    'sem-roteiro': { title: 'Sem roteiro/ sem agendamento', test: () => false },
    'diversos': { title: 'Status Diversos', test: r => !KNOWN_SITUACOES.includes(r.situacao) },
    // Uma entrada por fatia do donut "Situação de agendamento" (pedido do usuário, 2026-08-19,
    // pra editar a data/status/observação de quem já tem etapa — igual já funcionava só pro
    // card "Aguardando agendamento"). Mesma população-base do gráfico (necessitaAgendamento +
    // situacaoElegivelParaAgendamento — ver renderAgendamentoChart); "Sem etapa definida" não
    // precisa de entrada própria, é literalmente o mesmo recorte de 'aguardando' acima.
    'agendamento-agendado': {
      title: 'Agendado',
      test: r => r.necessitaAgendamento && situacaoElegivelParaAgendamento(r.situacao) && r.statusAgendamento === 'Agendado' && !agendamentoVencido(r.dataAgendamento)
    },
    // Pedido do usuário (2026-08-29): quem tem data marcada mas ela já passou sai de "Agendado"
    // e vira essa categoria própria — mesma população, só separada pela data.
    'agendamento-vencido': {
      title: 'Agendamento Vencido',
      test: r => r.necessitaAgendamento && situacaoElegivelParaAgendamento(r.situacao) && r.statusAgendamento === 'Agendado' && agendamentoVencido(r.dataAgendamento)
    },
    // Fatia "Agendado Não Faturado" (pedido do usuário, 2026-09-01): mesma ideia de 'sem-roteiro'
    // — antes, um Pedido Aguardando Faturamento com data de agendamento já marcada contava
    // junto com 'agendamento-agendado'/'agendamento-vencido' (misturando com NOTAS já
    // faturadas). `test` sempre false de propósito: NENHUMA nota entra aqui (uma nota já
    // faturada e agendada é 'Agendado'/'Agendamento Vencido' de verdade, não "não faturado") —
    // só PEDIDOS com data de agendamento marcada, via DETAIL_KEYS_COM_PEDIDOS/
    // categoriaAgendamentoParaPedido mais abaixo.
    'agendamento-nao-faturado': { title: 'Agendado Não Faturado', test: () => false },
    'agendamento-aguardando-confirmacao': {
      title: 'Aguardando Confirmação',
      test: r => r.necessitaAgendamento && situacaoElegivelParaAgendamento(r.situacao) && r.statusAgendamento === 'Aguardando Confirmação'
    },
    'agendamento-reagendar': {
      title: 'Reagendar',
      test: r => r.necessitaAgendamento && situacaoElegivelParaAgendamento(r.situacao) && r.statusAgendamento === 'Reagendar'
    },
    'agendamento-okker': {
      title: 'Okker',
      test: r => r.necessitaAgendamento && situacaoElegivelParaAgendamento(r.situacao) && r.statusAgendamento === 'Okker'
    },
    'agendamento-devolucao-terrinha': {
      title: 'Devolução para Terrinha',
      test: r => r.necessitaAgendamento && situacaoElegivelParaAgendamento(r.situacao) && r.statusAgendamento === 'Devolução para Terrinha'
    }
  };

  // Rótulo do tile do donut (ver renderAgendamentoChart/AGENDAMENTO_STATUS_CATEGORIAS) -> chave
  // de STATUS_DETAIL_DEFS a abrir. "Sem etapa definida" aponta pra 'sem-roteiro' (só pedidos,
  // 2026-08-30 — ver comentário em STATUS_DETAIL_DEFS['sem-roteiro']), NÃO pra 'aguardando'
  // (que é só notas já faturadas, card "Aguardando Agendamento" à parte).
  const AGENDAMENTO_LABEL_PARA_DETAIL_KEY = {
    'Agendado': 'agendamento-agendado',
    'Agendamento Vencido': 'agendamento-vencido',
    'Agendado Não Faturado': 'agendamento-nao-faturado',
    'Sem etapa definida': 'sem-roteiro',
    'Aguardando Confirmação': 'agendamento-aguardando-confirmacao',
    'Reagendar': 'agendamento-reagendar',
    'Okker': 'agendamento-okker',
    'Devolução para Terrinha': 'agendamento-devolucao-terrinha'
  };

  // Sentido inverso do mapa acima (chave da tela de detalhe -> rótulo da categoria) — usado por
  // renderStatusDetail pra achar quais pedidos (Pedidos Aguardando Faturamento) entram na
  // mesma categoria clicada, ver DETAIL_KEYS_COM_PEDIDOS/pedidoParaRegistroDetalhe.
  const AGENDAMENTO_DETAIL_KEY_PARA_LABEL = Object.fromEntries(
    Object.entries(AGENDAMENTO_LABEL_PARA_DETAIL_KEY).map(([label, key]) => [key, label])
  );

  // Rótulo do gráfico "Situação de agendamento" -> sufixo do id do .kpi-card--mini
  // correspondente ao lado da pizza (ver renderAgendamentoChart/index.html) — mesma ideia do
  // mapa acima, só que pra atualizar o texto do quadrado em vez de abrir o detalhe.
  const AGENDAMENTO_LABEL_PARA_TILE_ID = {
    'Agendado': 'agendado',
    'Agendamento Vencido': 'vencido',
    'Agendado Não Faturado': 'nao-faturado',
    'Sem etapa definida': 'sem-etapa',
    'Aguardando Confirmação': 'aguardando-confirmacao',
    'Reagendar': 'reagendar',
    'Okker': 'okker',
    'Devolução para Terrinha': 'devolucao'
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

  // Colunas que começam OCULTAS por padrão na tabela "Registros detalhados" — decisão do
  // usuário (2026-08-22): campos novos, úteis pra consulta pontual, mas que não deveriam
  // poluir a tabela por padrão (ainda buscáveis mesmo ocultos, ver haystack em data.js).
  const CAMPOS_OCULTOS_POR_PADRAO = [
    'filial', 'codigoCliente', 'telefone', 'dataCriacao', 'dataEntregaNF',
    'numeroPedidoEcommerce', 'dataFaturamento', 'numeroFatura'
  ];

  // Campos das colunas atualmente ocultas na tabela "Registros detalhados" (botões redondos
  // acima da tabela) — nomes batem com data-field do <thead> e com colunasTabelaPrincipal().
  let colunasOcultas = new Set(CAMPOS_OCULTOS_POR_PADRAO);

  /* ============================================================
   * INICIALIZAÇÃO
   * ============================================================ */

  function init() {
    bindFilterInputs();
    bindTableControls();
    bindActionButtons();
    bindSelecaoEOcorrencia();
    bindObservacaoEdicaoPrincipal();
    bindOcorrenciasDoDia();
    bindStatusDetail();
    bindTableScrollArrows();
    bindCanhotoLinks();
    bindAgendamentoEdicao();
    bindObservacaoEdicao();
    renderColumnToggles();
    bindColumnToggles();
    // Aplica o estado inicial de colunasOcultas (CAMPOS_OCULTOS_POR_PADRAO) na tabela — sem
    // isso, o <table data-hide> começa sem esse atributo e as colunas novas apareceriam
    // visíveis no primeiro carregamento, só escondendo depois do 1º clique num toggle.
    aplicarColunasOcultas();
    bindScrollTabela();
    bindAlternarViewMapaRegioes();
    bindBotaoIrInicio();
    atualizarBotaoIrInicio();
    bindBuscaCheckboxList();
    bindRegistroDinamico();
    bindPedidosNaoFaturadosView();
    bindMapaRegioesMensagens();
    bindLeadTimePedidos();
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

  /** Botão "casinha" no cabeçalho (2026-08-23, pedido do usuário) — visível em toda tela que
   * não seja a inicial ("Registros detalhados" sem nenhum drill-down de KPI aberto), pra
   * sempre ter como voltar num clique só. Chamada nos 3 pontos que trocam de tela: troca de
   * view (mostrarViewMapaRegioes) e abrir/fechar o drill-down de KPI (openStatusDetail/
   * closeStatusDetail), que existe só dentro da tela inicial mas cobre o #main-view por cima. */
  function atualizarBotaoIrInicio() {
    const botao = document.getElementById('btn-ir-inicio');
    if (!botao) return;
    const main = document.getElementById('main-view');
    const detalhe = document.getElementById('status-detail-view');
    const pedidosNaoFaturados = document.getElementById('pedidos-nao-faturados-view');
    // "Ocorrências do Dia" reaproveita o #main-view (mesma tabela), mas não é a tela inicial —
    // o botão "casinha" precisa continuar visível nela pra voltar pro Registros detalhados normal.
    const naTelaInicial = !main.hidden && !main.classList.contains('modo-tabela-foco') &&
      detalhe.hidden && (!pedidosNaoFaturados || pedidosNaoFaturados.hidden);
    botao.hidden = naTelaInicial;
  }

  function bindBotaoIrInicio() {
    const botao = document.getElementById('btn-ir-inicio');
    if (!botao) return;
    botao.addEventListener('click', () => {
      closeStatusDetail();
      fecharPedidosNaoFaturadosView();
      mostrarViewMapaRegioes('registros');
    });
  }

  function mostrarViewMapaRegioes(view) {
    const main = document.getElementById('main-view');
    const embed = document.getElementById('mapa-regioes-embed');
    const dinamico = document.getElementById('registro-dinamico-view');
    // 2026-08-23: 4ª tela ("Lead Time de Pedidos e Entregas") — puramente adicional, não muda
    // nenhuma das 3 ramificações originais abaixo.
    const leadtimePedidos = document.getElementById('leadtime-pedidos-view');
    // 2026-08-28: fecha sempre que troca de tela por aqui — evita ficar visível junto com
    // mapa/dinâmico/leadtime ao clicar num botão de navegação enquanto essa tela está aberta.
    const pedidosNaoFaturados = document.getElementById('pedidos-nao-faturados-view');
    // "Ocorrências do Dia" (2026-08-31) reaproveita o MESMO #main-view/tabela "Registros
    // detalhados" — não é uma tela própria, só um modo dele (main.hidden continua false), com
    // KPIs/gráficos escondidos via CSS (.modo-tabela-foco) e o filtro extra de
    // aplicarFiltroOcorrenciasDoDia por cima.
    const barraOcorrencias = document.getElementById('ocorrencias-periodo-bar');

    main.hidden = view !== 'registros' && view !== 'ocorrencias';
    main.classList.toggle('modo-tabela-foco', view === 'ocorrencias');
    modoOcorrenciasAtivo = view === 'ocorrencias';
    if (barraOcorrencias) barraOcorrencias.hidden = view !== 'ocorrencias';
    embed.hidden = view !== 'mapa';
    dinamico.hidden = view !== 'dinamico';
    if (leadtimePedidos) leadtimePedidos.hidden = view !== 'leadtime-pedidos';
    if (pedidosNaoFaturados) pedidosNaoFaturados.hidden = true;
    atualizarBotaoIrInicio();

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
      renderLeadTime(); // painel ficava "—" até o próximo filtro, já que render() roda com embed.hidden ainda true
    } else if (view === 'dinamico') {
      renderRegistroDinamico();
      dinamico.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (view === 'leadtime-pedidos') {
      renderLeadTimePedidos();
      if (leadtimePedidos) leadtimePedidos.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // 'registros' e 'ocorrencias' entram aqui — entrar/sair do modo muda quais registros a
      // tabela mostra (aplicarFiltroOcorrenciasDoDia), então precisa redesenhar mesmo sem
      // nenhum filtro global ter mudado.
      table.page = 1;
      renderTable(DataStore.getFilteredRecords());
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
   * "prazo_medio_dias": até 2026-08-23 ficava sempre null aqui (decisão do usuário, 2026-08-16:
   * preferiu "Sem dados" a um número aproximado/errado, já que não existia então um cálculo de
   * dias de entrega efetiva confiável). Agora usa o mesmo motor de dias ÚTEIS do painel "Lead
   * Time de Pedidos e Entregas" (DataStore.calcularLeadTimePedido, coleta -> entrega) — média
   * simples entre as notas ENTREGUES de cada região que têm esse cálculo disponível (não exige
   * que a Transportadora+Cidade tenha um prazo cadastrado na aba "Lead Time Atualizado"; aqui é
   * só o tempo REALIZADO de trânsito, não uma comparação contra prazo previsto).
   */
  const VALOR_REGIAO_NAO_INFORMADO = new Set(['', 'Não informado']);

  function computarDadosRegioesAoVivo(records) {
    const hoje = new Date();
    const porCodigo = new Map();
    DataStore.getRegioesComerciaisComCodigo().forEach(({ codigo, nome }) => {
      porCodigo.set(codigo, {
        codigo, regiao: nome,
        total_notas: 0, entregues: 0, reentregas: 0, devolucoes: 0, cancelados: 0, em_aberto: 0,
        valor_nf: 0, somaPrazoDias: 0, quantidadeComPrazo: 0,
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
      const calc = DataStore.calcularLeadTimePedido(r, hoje);
      if (calc.diasEntregaEfetiva !== null) {
        bucket.somaPrazoDias += calc.diasEntregaEfetiva;
        bucket.quantidadeComPrazo++;
      }
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
      prazo_medio_dias: b.quantidadeComPrazo ? b.somaPrazoDias / b.quantidadeComPrazo : null,
      soma_prazo_dias: b.somaPrazoDias,
      quantidade_com_prazo: b.quantidadeComPrazo,
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

  // As 4 categorias de transporte filtráveis (pedido do usuário 2026-08-27) — cada uma vira um
  // submenu próprio dentro de "Transporte" (busca + lista de nomes), todos escrevendo no MESMO
  // filtro `transportadora` do DataStore (ver bindFilterCheckboxListGroup/populateFilterOptions).
  // Os slugs batem com o sufixo dos ids no HTML (filter-transportadora-list-<slug>).
  const CATEGORIAS_TRANSPORTE_UI = [
    { label: 'Transportadora', slug: 'transportadora' },
    { label: 'Agregado', slug: 'agregado' },
    { label: 'Próprio Retira', slug: 'proprio-retira' },
    { label: 'Exportação', slug: 'exportacao' }
  ];

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
    bindFilterCheckboxList('filter-agendamento-list', 'agendamento');
    // 4 listas (uma por Categoria) escrevendo no mesmo filtro `transportadora` — precisa da
    // versão "grupo" pra unir a seleção das 4 em vez de cada uma sobrescrever a das outras.
    bindFilterCheckboxListGroup(CATEGORIAS_TRANSPORTE_UI.map(c => `filter-transportadora-list-${c.slug}`), 'transportadora');
    bindFilterCheckboxList('filter-vendedor-list', 'vendedor');
    bindFilterCheckboxList('filter-cliente-list', 'cliente');
    bindFilterCheckboxList('filter-cidade-list', 'cidade');
    bindFilterCheckboxList('filter-regiao-comercial-list', 'regiaoComercial');

    $('btn-reset-filters').addEventListener('click', () => {
      DataStore.resetFilters();
      document.querySelectorAll('.filters-panel select, .filters-panel input').forEach(el => { el.value = ''; });
      document.querySelectorAll('.filters-panel .filter-checkbox-list input[type="checkbox"]').forEach(cb => { cb.checked = false; });
      // Busca rápida da barra lateral foi removida (pedido do usuário, 2026-08-29) — a única
      // busca que sobrou é a da tabela ("Pesquisar na tabela...", ver bindTableControls), que
      // já está coberta por essa mesma limpeza via DataStore.resetFilters() acima.
      const tableSearch = document.getElementById('table-search');
      if (tableSearch) tableSearch.value = '';
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

  /** Como bindFilterCheckboxList, mas pra VÁRIAS listas independentes que escrevem no MESMO
   * filterKey — caso das 4 listas de nomes por Categoria de Transporte (pedido do usuário
   * 2026-08-27): marcar um nome em "Agregado" não pode apagar o que já estava marcado em
   * "Transportadora". Cada mudança em qualquer uma das listas recalcula o filtro somando os
   * marcados de TODAS elas juntas; "Selecionar todos" de cada lista continua marcando só os
   * itens dela própria. */
  function bindFilterCheckboxListGroup(containerIds, filterKey) {
    const containers = containerIds.map(id => document.getElementById(id)).filter(Boolean);
    function recomputarFiltro() {
      const marcados = [];
      containers.forEach(container => {
        container.querySelectorAll('.filter-checkbox__item:checked').forEach(cb => marcados.push(cb.value));
      });
      DataStore.setFilters({ [filterKey]: marcados });
    }
    containers.forEach(container => {
      container.addEventListener('change', (e) => {
        const todos = container.querySelector('.filter-checkbox__todos');
        if (e.target === todos) {
          container.querySelectorAll('.filter-checkbox__item').forEach(cb => { cb.checked = todos.checked; });
        }
        const itens = Array.from(container.querySelectorAll('.filter-checkbox__item'));
        if (todos) todos.checked = itens.length > 0 && itens.every(cb => cb.checked);
        recomputarFiltro();
      });
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
    }, 250);
    document.getElementById('table-search').addEventListener('input', (e) => searchHandler(e.target.value));

    // rowHtmlComSelecao (não o rowHtml padrão) — senão ordenar por coluna ou trocar de página
    // (Próxima/Anterior) desenharia as linhas sem a coluna de checkbox (2026-08-30).
    // aplicarFiltroOcorrenciasDoDia é passthrough fora do modo "Ocorrências do Dia" — sem isso,
    // ordenar/paginar nessa tela voltaria a mostrar TODAS as notas, não só as filtradas.
    bindTableControlsFor(table, MAIN_TABLE_IDS, () => aplicarFiltroOcorrenciasDoDia(DataStore.getFilteredRecords()), rowHtmlComSelecao);

    document.getElementById('table-page-size').addEventListener('change', (e) => {
      table.pageSize = Number(e.target.value);
      table.page = 1;
      renderTable(DataStore.getFilteredRecords());
    });

    bindTableControlsFor(detailTable, DETAIL_TABLE_IDS, () => detailRecords, (r) => rowHtml(r, false));

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
      exportarRegistros(nomeArquivoExportacao(), aplicarFiltroOcorrenciasDoDia(DataStore.getFilteredRecords()));
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

  /** Setas ‹ › nas telas de detalhe (que abrem ao clicar num card) pra rolar a tabela na
   * horizontal sem precisar arrastar a barra de scroll — pedido do usuário (2026-08-29).
   * Genérico: funciona pra qualquer `.table-scroll-wrapper` da página (hoje: status-detail-view
   * e pedidos-nao-faturados-view), não precisa listar cada tela na mão. Os botões ficam
   * desabilitados quando já não há mais o que rolar naquela direção. */
  function bindTableScrollArrows() {
    document.querySelectorAll('.table-scroll-wrapper').forEach(wrapper => {
      const scroll = wrapper.querySelector('.table-scroll');
      const btnLeft = wrapper.querySelector('.table-scroll-arrow--left');
      const btnRight = wrapper.querySelector('.table-scroll-arrow--right');
      if (!scroll || !btnLeft || !btnRight) return;

      const atualizarEstado = () => {
        btnLeft.disabled = scroll.scrollLeft <= 0;
        btnRight.disabled = scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 1;
      };
      btnLeft.addEventListener('click', () => scroll.scrollBy({ left: -300, behavior: 'smooth' }));
      btnRight.addEventListener('click', () => scroll.scrollBy({ left: 300, behavior: 'smooth' }));
      scroll.addEventListener('scroll', atualizarEstado);
      // Reavalia quando a tabela muda de largura (colunas mostradas/ocultadas, dados carregados
      // pela primeira vez, tela reaberta depois de escondida etc.).
      new ResizeObserver(atualizarEstado).observe(scroll);
      atualizarEstado();
    });
  }

  function bindStatusDetail() {
    // [data-detail] em vez de só ".kpi-card[data-detail]": mantido genérico porque, no passado,
    // nem todo elemento com data-detail era um .kpi-card (chegou a ser um .chart-stat-tile) —
    // hoje os quadrados de "Situação de agendamento" também são .kpi-card--mini, mas o seletor
    // continua amplo por segurança.
    document.querySelectorAll('[data-detail]').forEach(card => {
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
    atualizarBotaoIrInicio();
  }

  function closeStatusDetail() {
    detailKey = null;
    document.getElementById('status-detail-view').hidden = true;
    document.getElementById('main-view').hidden = false;
    atualizarBotaoIrInicio();
  }

  /** Recalcula a lista da tela de detalhe a partir dos filtros atuais — chamado ao abrir e
   * de novo sempre que os dados/filtros mudarem enquanto essa tela estiver aberta. */
  // Chaves de STATUS_DETAIL_DEFS que PEDIDOS (Pedidos Aguardando Faturamento, sem NF ainda)
  // podem alimentar — mesmas categorias que categoriaAgendamentoParaPedido consegue devolver
  // (Agendado Não Faturado/Sem etapa definida/Aguardando Confirmação/Okker; um pedido nunca é
  // "Reagendar" nem "Devolução para Terrinha", ver PEDIDOS_NAO_FATURADOS_STATUS_CATEGORIAS).
  // 'sem-roteiro' (não 'aguardando') recebe os pedidos "Sem etapa definida" — pedido do usuário
  // (2026-08-30): notas já faturadas (chave 'aguardando') não são "sem roteiro", só pedidos sem
  // NF ainda são. 'agendamento-nao-faturado' (2026-09-01) é a mesma ideia pro "Agendado": um
  // pedido com data marcada mas ainda sem NF não é a mesma coisa que uma nota já faturada e
  // agendada, por isso NÃO usa 'agendamento-agendado'/'agendamento-vencido' (que ficam só notas).
  const DETAIL_KEYS_COM_PEDIDOS = ['agendamento-agendado', 'agendamento-vencido', 'agendamento-nao-faturado', 'sem-roteiro', 'agendamento-aguardando-confirmacao', 'agendamento-okker'];

  /** Converte um pedido (Pedidos Aguardando Faturamento) num "registro" no mesmo formato de uma
   * nota, pra entrar na MESMA tabela de detalhe via rowHtml() — pedido do usuário (2026-08-29):
   * antes, clicar num card como "Agendado" só mostrava notas (rawRecords) e um aviso à parte
   * dizia que pedidos também contavam mas não apareciam ali, com um botão pra uma tela separada
   * que mostra TODOS os pedidos sem distinguir categoria — na prática misturando "Agendado" com
   * "Aguardando Confirmação" aos olhos dela. Agora os pedidos da categoria certa entram direto
   * na lista, com o Número do Pedido visível; campos que não existem pra um pedido ainda sem NF
   * (Transportadora/Motorista/Status/Prazo/Data coleta) ficam em branco/neutros, sem inventar
   * dado — uma nota em branco na coluna NF já deixa claro que aquela linha é só um pedido. */
  function pedidoParaRegistroDetalhe(p) {
    return {
      nf: '', cliente: p.cliente, transportadora: '', motorista: '', vendedor: '', cidade: '', uf: '',
      status: 'Aguardando Faturamento', prazoStatus: 'Não se aplica', situacao: 'Aguardando Faturamento',
      statusAgendamento: p.statusAgendamento, valorNF: p.valorPedido || 0,
      dataEntrega: null, dataAgendamento: p.dataAgendamento, observacaoAgendamento: p.observacao,
      numeroPedido: p.numeroPedido
    };
  }

  function renderStatusDetail() {
    if (!detailKey) return;
    const def = STATUS_DETAIL_DEFS[detailKey];
    let registros = DataStore.getFilteredRecords().filter(def.test);
    // Pedidos somam nas MESMAS categorias do gráfico "Situação de agendamento"
    // (categoriaAgendamentoParaPedido/renderAgendamentoChart) só quando nenhum filtro da barra
    // lateral está ativo (essa base não tem Transportadora/Status/etc. pra cruzar com eles) —
    // mesma regra dos cards, pra nunca divergir do que o card mostra.
    if (DETAIL_KEYS_COM_PEDIDOS.includes(detailKey) && !algumFiltroAtivo()) {
      const rotulo = AGENDAMENTO_DETAIL_KEY_PARA_LABEL[detailKey];
      const pedidosDaCategoria = DataStore.getPedidosNaoFaturados()
        .filter(p => categoriaAgendamentoParaPedido(p.statusAgendamento, p.dataAgendamento) === rotulo)
        .map(pedidoParaRegistroDetalhe);
      registros = registros.concat(pedidosDaCategoria);
    }
    if (detailBusca) {
      const needle = detailBusca.toLowerCase();
      registros = registros.filter(r =>
        `${r.nf} ${r.cliente} ${r.transportadora} ${r.motorista} ${r.vendedor} ${r.cidade} ${r.situacao} ${r.numeroPedido || ''}`
          .toLowerCase().includes(needle));
    }
    detailRecords = registros;
    document.getElementById('detail-view-title').textContent = `${def.title} (${Utils.formatNumber(detailRecords.length)})`;
    renderTableGeneric(detailRecords, detailTable, DETAIL_TABLE_IDS, (r) => rowHtml(r, false));
    renderMotivosBreakdown(detailRecords);
    renderReentregaHintNoDetalhe(detailKey);
    // Pedido (pseudo-registro com nf === '', ver pedidoParaRegistroDetalhe) NÃO entra aqui —
    // esse painel edita agendamento de NOTAS via r.nf.split('-')[0] como chave; pedidos têm seu
    // PRÓPRIO mecanismo de edição (tela "Pedidos Aguardando Faturamento", chave "pedido-<número>"
    // no Firestore, ver applyAgendamentoManual em data.js). Passar um pedido aqui salvaria
    // agendamento sob uma chave vazia — por isso o filtro por r.nf antes de repassar adiante.
    const apenasNotas = detailRecords.filter(r => r.nf);
    renderAgendamentoEdicao(apenasNotas);
    renderObservacaoEdicao(apenasNotas);
  }

  /** Aviso "o card conta toda tentativa, essa lista mostra só quem está reentrega agora" —
   * pedido do usuário (2026-08-28): o card "Reentrega" passou a somar qtdReentregas (TODA
   * tentativa de reentrega de cada nota, mesmo já resolvida depois — ver
   * applyBluesoftEnrichment em data.js), então pode ser maior que essa lista, que continua
   * mostrando só as notas cuja situação ATUAL é "Reentrega". Só aparece nessa tela específica,
   * e só quando a diferença existir de verdade. */
  function renderReentregaHintNoDetalhe(key) {
    const section = document.getElementById('detail-reentrega-hint-section');
    if (key !== 'reentrega') { section.hidden = true; return; }
    const totalTentativas = Utils.sum(DataStore.getFilteredRecords(), r => r.qtdReentregas || 0);
    const diferenca = totalTentativas - detailRecords.length;
    if (diferenca <= 0) { section.hidden = true; return; }
    section.hidden = false;
    document.getElementById('detail-reentrega-hint-texto').textContent =
      `O card no topo mostra ${Utils.formatNumber(totalTentativas)} — conta TODA tentativa de reentrega, incluindo ${Utils.formatNumber(diferenca)} de notas que já foram resolvidas depois (entregues, devolvidas, etc.) e por isso não aparecem na lista abaixo, que mostra só quem está reentrega agora.`;
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
  // agendamento") mais as 4 novas fatias clicáveis do donut (2026-08-19). 'sem-roteiro' (fatia
  // "Sem roteiro/ sem agendamento", 2026-08-30) fica de fora de propósito: só tem pedidos ali,
  // e pedidos não editam agendamento por esse painel (ver pedidoParaRegistroDetalhe).
  const AGENDAMENTO_EDICAO_DETAIL_KEYS = [
    'aguardando', 'agendamento-agendado', 'agendamento-vencido', 'agendamento-aguardando-confirmacao',
    'agendamento-reagendar', 'agendamento-okker', 'agendamento-devolucao-terrinha'
  ];

  function renderAgendamentoEdicao(records) {
    const section = document.getElementById('detail-agendamento-section');
    if (!AGENDAMENTO_EDICAO_DETAIL_KEYS.includes(detailKey)) { section.hidden = true; return; }
    section.hidden = false;

    const admin = isAdminAgendamento();
    document.getElementById('detail-agendamento-hint').textContent = admin
      ? 'Preencha ou altere o status e a data de agendamento — salva direto aqui, sem precisar de planilha. Ao salvar, a nota já sai dessa lista e vai pra categoria certa (preencher só a data vira "Agendado" automaticamente).'
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
      let status = linha.querySelector('.agendamento-row__status-select').value;
      const data = linha.querySelector('.agendamento-row__data-input').value;
      const observacao = linha.querySelector('.agendamento-row__observacao-input').value.trim();

      // Preencher uma Data de agendamento sem escolher um Status, na prática, já significa
      // que a nota foi agendada — por decisão do usuário (2026-08-19), sobe pra "Agendado"
      // sozinho nesse caso, em vez de ficar presa em "Aguardando agendamento" só porque o
      // dropdown ficou em branco. Só entra quando o usuário não escolheu nada (status !==
      // '' sempre vence, mesmo que seja pra "Sem informação" de propósito).
      if (!status && data) status = 'Agendado';

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

  /* ============================================================
   * OBSERVAÇÃO POR NOTA — só na tela "Notas em aberto" (2026-08-19). Mais simples que o
   * painel de agendamento acima: sem status/data, porque nem toda nota em aberto precisa de
   * agendamento. Grava só a observação (ver salvarObservacaoNota em firebase-init.js), sem
   * mexer em nenhum status/data de agendamento que a nota já tivesse.
   * ============================================================ */

  const OBSERVACAO_EDICAO_LIMITE = 200;

  // 'em-aberto' original + os dois recortes por agendamento (2026-08-26) — mesma nota,
  // três telas diferentes de onde ela pode ser aberta.
  const OBSERVACAO_EDICAO_DETAIL_KEYS = ['em-aberto', 'em-aberto-sem-agendamento', 'em-aberto-com-agendamento'];

  function renderObservacaoEdicao(records) {
    const section = document.getElementById('detail-observacao-section');
    if (!OBSERVACAO_EDICAO_DETAIL_KEYS.includes(detailKey)) { section.hidden = true; return; }
    section.hidden = false;

    const admin = isAdminAgendamento();
    document.getElementById('detail-observacao-hint').textContent = admin
      ? 'Escreva uma observação livre sobre a nota — salva direto aqui, sem precisar de planilha.'
      : 'Observação de cada nota (só o usuário responsável pode editar).';

    const list = document.getElementById('detail-observacao-list');
    const itens = records.slice(0, OBSERVACAO_EDICAO_LIMITE);

    list.innerHTML = itens.map(r => {
      const nfBase = r.nf.split('-')[0];
      const observacaoAtual = r.observacaoAgendamento || '';

      if (!admin) {
        return `
          <div class="observacao-row">
            <span class="observacao-row__nf">${escapeAttr(r.nf)}</span>
            <span class="observacao-row__cliente" title="${escapeAttr(r.cliente)}">${escapeAttr(r.cliente)}</span>
            <span class="observacao-row__somente-leitura" title="${escapeAttr(observacaoAtual)}">${escapeAttr(observacaoAtual || '—')}</span>
            <span></span>
          </div>
        `;
      }

      return `
        <div class="observacao-row" data-nf="${escapeAttr(nfBase)}">
          <span class="observacao-row__nf">${escapeAttr(r.nf)}</span>
          <span class="observacao-row__cliente" title="${escapeAttr(r.cliente)}">${escapeAttr(r.cliente)}</span>
          <input type="text" class="observacao-row__input" placeholder="Observação (opcional)" value="${escapeAttr(observacaoAtual)}">
          <button type="button" class="btn observacao-row__salvar">Salvar</button>
        </div>
      `;
    }).join('');

    if (records.length > OBSERVACAO_EDICAO_LIMITE) {
      list.insertAdjacentHTML('beforeend',
        `<p class="chart-card__hint">Mostrando as primeiras ${OBSERVACAO_EDICAO_LIMITE} de ${Utils.formatNumber(records.length)} notas.</p>`);
    }
  }

  function bindObservacaoEdicao() {
    document.getElementById('detail-observacao-list').addEventListener('click', async (e) => {
      const botao = e.target.closest('.observacao-row__salvar');
      if (!botao) return;
      const linha = botao.closest('.observacao-row');
      const nf = linha.dataset.nf;
      const observacao = linha.querySelector('.observacao-row__input').value.trim();

      botao.disabled = true;
      botao.textContent = 'Salvando...';
      try {
        const fb = await new Promise((resolve) => {
          if (window.Firebase) return resolve(window.Firebase);
          window.addEventListener('firebase-ready', () => resolve(window.Firebase), { once: true });
        });
        await fb.salvarObservacaoNota(nf, observacao);
        DataStore.applyAgendamentoManual({ [nf]: { observacao } });
        Utils.showToast(`NF ${nf}: observação salva.`, 'success', 2500);
      } catch (err) {
        Utils.showToast(err.message || 'Falha ao salvar a observação.', 'error', 5000);
        botao.disabled = false;
        botao.textContent = 'Salvar';
      }
    });
  }

  function tableColumns() {
    return [
      { label: 'NF', value: r => r.nf },
      { label: 'Número do Pedido', value: r => r.numeroPedido || '—' },
      { label: 'Cliente', value: r => r.cliente },
      { label: 'Transportadora', value: r => r.transportadora },
      { label: 'Motorista', value: r => r.motorista },
      { label: 'Vendedor', value: r => r.vendedor },
      { label: 'Cidade', value: r => r.cidade },
      { label: 'UF', value: r => r.uf },
      { label: 'Status', value: r => statusExibicaoLabel(r) },
      { label: 'Prazo', value: r => prazoLabel(r.prazoStatus) },
      { label: 'Situação', value: r => r.situacao },
      { label: 'Situação Agendamento', value: r => r.statusAgendamento || '—' },
      { label: 'Valor NF', value: r => r.valorNF.toFixed(2).replace('.', ',') },
      { label: 'Data Coleta', value: r => Utils.formatDate(r.dataEntrega) },
      { label: 'Data Agendada', value: r => Utils.formatDate(r.dataAgendamento) },
      { label: 'Observação', value: r => r.observacaoAgendamento || '—' }
    ];
  }

  /** As 12 colunas realmente exibidas em #data-table (thead/rowHtml) — usadas pelos botões de
   * mostrar/ocultar coluna e pelo envio de relatório por WhatsApp/E-mail. Separado de
   * tableColumns() porque aquele array serve pro CSV (15 colunas, inclui Motivo/Categoria/UF
   * separado) e não precisa mudar de comportamento por causa dessa funcionalidade nova. */
  function colunasTabelaPrincipal() {
    return [
      { field: 'nf', label: 'NF', value: r => r.nf },
      { field: 'numeroPedido', label: 'Número do Pedido', value: r => r.numeroPedido || '—' },
      { field: 'cliente', label: 'Cliente', value: r => r.cliente },
      { field: 'transportadora', label: 'Transportadora', value: r => r.transportadora },
      { field: 'motorista', label: 'Motorista', value: r => r.motorista },
      { field: 'vendedor', label: 'Vendedor', value: r => r.vendedor },
      { field: 'cidade', label: 'Cidade/UF', value: r => `${r.cidade}${r.uf ? '/' + r.uf : ''}` },
      { field: 'status', label: 'Status', value: r => statusExibicaoLabel(r) },
      { field: 'prazoStatus', label: 'Prazo', value: r => prazoLabel(r.prazoStatus) },
      { field: 'situacao', label: 'Situação', value: r => r.situacao },
      { field: 'statusAgendamento', label: 'Situação Agendamento', value: r => r.statusAgendamento || '—' },
      { field: 'valorNF', label: 'Valor NF', value: r => r.valorNF.toFixed(2).replace('.', ',') },
      { field: 'dataEntrega', label: 'Data Coleta', value: r => Utils.formatDate(r.dataEntrega) },
      { field: 'dataAgendamento', label: 'Data Agendada', value: r => Utils.formatDate(r.dataAgendamento) },
      { field: 'observacaoAgendamento', label: 'Observação', value: r => r.observacaoAgendamento || '—' },
      // Colunas novas 2026-08-22 (Base Bluesoft) — ocultas por padrão (ver colunasOcultasPadrao
      // abaixo), só aparecem se o usuário ligar o botão ou usar a busca (que já cobre esses
      // campos mesmo ocultos, ver getFilteredRecords em data.js).
      { field: 'filial', label: 'Filial', value: r => r.filial || '—' },
      { field: 'codigoCliente', label: 'Código Cliente', value: r => r.codigoCliente || '—' },
      { field: 'telefone', label: 'Telefone', value: r => r.telefone || '—' },
      { field: 'dataCriacao', label: 'Data Criação', value: r => Utils.formatDate(r.dataCriacao) },
      { field: 'dataEntregaNF', label: 'Data Entrega NF', value: r => Utils.formatDate(r.dataEntregaNF) },
      { field: 'numeroPedidoEcommerce', label: 'Número Pedido Ecommerce', value: r => r.numeroPedidoEcommerce || '—' },
      { field: 'dataFaturamento', label: 'Data Faturamento', value: r => Utils.formatDate(r.dataFaturamento) },
      { field: 'numeroFatura', label: 'Número Fatura', value: r => r.numeroFatura || '—' }
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

  /** Data usada pra agrupar o Registro Dinâmico: Data de Faturamento, com Data de Coleta como
   * reserva quando a de Faturamento está em branco na planilha (decisão do usuário,
   * 2026-08-23 — ela vai investigar por que essas notas não têm Faturamento preenchido, mas
   * não quer que elas fiquem de fora desta tela enquanto isso). */
  function dataEfetivaRegistroDinamico(r) {
    return r.dataFaturamento || r.dataEntrega;
  }

  /** Agrupa os registros (já filtrados) por dia de dataEfetivaRegistroDinamico. Notas sem
   * Faturamento NEM Coleta não entram em nenhum grupo — ficam de fora da tabela, mas contadas
   * no aviso de cobertura acima dela. `mesSelecionado` (opcional, um Date no 1º dia do mês)
   * restringe as linhas a só aquele mês — usado pela tabela de dias, que só mostra algo depois
   * do usuário clicar num card de mês (decisão do usuário, 2026-08-18). totalComData/
   * totalSemData continuam sendo do total GERAL (sem esse recorte), pra sempre refletir a
   * cobertura de dados de todos os filtros ativos. */
  function calcularRegistroDinamico(records, mesSelecionado) {
    const comData = records.filter(r => dataEfetivaRegistroDinamico(r));
    const doMes = mesSelecionado
      ? comData.filter(r => { const d = dataEfetivaRegistroDinamico(r); return d.getFullYear() === mesSelecionado.getFullYear() && d.getMonth() === mesSelecionado.getMonth(); })
      : comData;
    const grupos = Utils.groupBy(doMes, r => Utils.startOfDay(dataEfetivaRegistroDinamico(r)).getTime());
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
    const comData = records.filter(r => dataEfetivaRegistroDinamico(r));
    const grupos = Utils.groupBy(comData, r => { const d = dataEfetivaRegistroDinamico(r); return `${d.getFullYear()}-${d.getMonth()}`; });
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
    return DataStore.getFilteredRecords().filter(r => {
      const d = dataEfetivaRegistroDinamico(r);
      return d && Utils.startOfDay(d).getTime() === alvo;
    });
  }

  /** Agrupa as notas de UM dia (já filtradas por registrosDoDiaSelecionado) por Transportadora
   * — o submenu que aparece ao clicar numa data (pedido do usuário, 2026-08-27), antes do
   * detalhe por nota. Sem transportadora informada cai em "Não informado", mesmo texto usado
   * em outras colunas/filtros do dashboard pra esse caso. */
  function calcularRegistroDinamicoPorTransportadora(registrosDoDia) {
    const grupos = Utils.groupBy(registrosDoDia, r => r.transportadora || 'Não informado');
    return Array.from(grupos.entries()).map(([transportadora, registros]) => ({
      transportadora,
      valorTotal: Utils.sum(registros, r => r.valorNF),
      quantidade: registros.length
    }));
  }

  /** Notas do dia selecionado que também batem com a Transportadora escolhida no submenu — a
   * fonte do detalhe por nota (registro-dinamico-detalhe), agora um recorte a mais além do dia. */
  function registrosDoDiaETransportadoraSelecionados() {
    if (!registroDinamicoTransportadoraSelecionada) return [];
    return registrosDoDiaSelecionado().filter(r => (r.transportadora || 'Não informado') === registroDinamicoTransportadoraSelecionada);
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

  function rowHtmlRegistroDinamicoTransportadora(g) {
    const ativa = registroDinamicoTransportadoraSelecionada === g.transportadora;
    return `
      <tr>
        <td><button type="button" class="nf-link${ativa ? ' nf-link--ativo' : ''}" data-transportadora-fat="${escapeAttr(g.transportadora)}" title="Ver notas dessa transportadora nessa data">${escapeAttr(g.transportadora)}</button></td>
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
        <td><span class="badge ${statusExibicaoBadgeClass(r)}">${statusExibicaoLabel(r)}</span></td>
        <td>${r.situacao === 'NF Não encontrada' ? `<span class="badge badge--neutral">${escapeAttr(r.situacao)}</span>` : escapeAttr(r.situacao)}</td>
        <td>${escapeAttr(r.statusAgendamento || '—')}</td>
        <td>${Utils.formatDate(r.dataAgendamento)}</td>
        <td class="truncate" title="Clique para editar a observação">
          <button type="button" class="nf-link${registroDinamicoObservacaoNf === r.nf.split('-')[0] ? ' nf-link--ativo' : ''}" data-observacao-edicao="${escapeAttr(r.nf.split('-')[0])}">${escapeAttr(r.observacaoAgendamento || 'Adicionar observação')}</button>
        </td>
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
      : `${Utils.formatNumber(totalComData)} de ${Utils.formatNumber(registros.length)} notas têm Data de Faturamento ou Data de Coleta registrada` +
        (totalSemData > 0 ? ` — ${Utils.formatNumber(totalSemData)} sem nenhuma das duas não aparecem nesta tela.` : '.');

    renderTableGeneric(linhas, registroDinamicoTable, REGISTRO_DINAMICO_TABLE_IDS, rowHtmlRegistroDinamico);

    const valorTotalFormatado = Utils.formatCurrency(Utils.sum(linhas, l => l.valorTotal));
    document.getElementById('registro-dinamico-total-valor').textContent = valorTotalFormatado;
    document.getElementById('registro-dinamico-total-quantidade').textContent = Utils.formatNumber(linhas.reduce((acc, l) => acc + l.quantidade, 0));
    // Mesmo valor do rodapé da tabela, só que num card visível ao lado do gráfico/cards de mês
    // — reflete o mês clicado (registroDinamicoMesSelecionado) ou o total geral, sem mês nenhum
    // selecionado. Decisão do usuário (2026-08-23).
    const cardValorTotal = document.getElementById('registro-dinamico-card-valor-total');
    if (cardValorTotal) cardValorTotal.textContent = valorTotalFormatado;

    renderRegistroDinamicoChart(registros);
    renderRegistroDinamicoTransportadoras();
    renderRegistroDinamicoDetalhe();
  }

  /** Redesenha o painel de Lead Time (tela "Análise por Região") com as médias já calculadas
   * por DataStore.getLeadTimeStats() sobre os registros filtrados atuais. No-op se o painel não
   * existir no DOM ainda, ou se a tela "Análise por Região" não estiver visível. */
  function renderLeadTime() {
    const secao = document.getElementById('lead-time-panel');
    const view = document.getElementById('mapa-regioes-embed');
    if (!secao || !view || view.hidden) return;

    const stats = DataStore.getLeadTimeStats();

    function preencher(prefixo, etapa) {
      const elDias = document.getElementById(`leadtime-${prefixo}-dias`);
      const elAmostras = document.getElementById(`leadtime-${prefixo}-amostras`);
      if (etapa.mediaDias === null) {
        elDias.textContent = '—';
        elAmostras.textContent = 'Sem dados suficientes no período';
        return;
      }
      elDias.textContent = `${Utils.formatNumber(etapa.mediaDias, 1)} dias`;
      elAmostras.textContent = `${Utils.formatNumber(etapa.amostras)} nota(s) com data completa`;
    }

    preencher('etapa1', stats.etapa1);
    preencher('etapa2', stats.etapa2);
    preencher('total', stats.total);

    const elBenchmarkDias = document.getElementById('leadtime-benchmark-dias');
    const elBenchmarkAmostras = document.getElementById('leadtime-benchmark-amostras');
    const avisoTransportadora = document.getElementById('leadtime-aviso-transportadora');
    if (stats.benchmark.mediaDiasUteis === null) {
      elBenchmarkDias.textContent = '—';
      elBenchmarkAmostras.textContent = 'Sem referência disponível';
      if (avisoTransportadora) avisoTransportadora.hidden = false;
    } else {
      elBenchmarkDias.textContent = `${Utils.formatNumber(stats.benchmark.mediaDiasUteis, 1)} dias úteis`;
      elBenchmarkAmostras.textContent = `${Utils.formatNumber(stats.benchmark.amostras)} nota(s) com referência`;
      if (avisoTransportadora) avisoTransportadora.hidden = true;
    }
  }

  /* ============================================================
   * LEAD TIME DE PEDIDOS E ENTREGAS (painel completo, 2026-08-23)
   * ============================================================ */

  const SITUACAO_LEADTIME_ORDEM = [
    'Aguardando faturamento', 'Aguardando coleta', 'Em trânsito no prazo', 'Em trânsito atrasado',
    'Entregue no prazo', 'Entregue atrasado', 'Sem Lead Time cadastrado', 'Dados incompletos'
  ];
  const SITUACAO_LEADTIME_BADGE = {
    'Entregue no prazo': 'badge--success', 'Entregue atrasado': 'badge--danger',
    'Em trânsito no prazo': 'badge--info', 'Em trânsito atrasado': 'badge--danger',
    'Aguardando faturamento': 'badge--neutral', 'Aguardando coleta': 'badge--neutral',
    'Sem Lead Time cadastrado': 'badge--neutral', 'Dados incompletos': 'badge--neutral'
  };
  const SITUACAO_LEADTIME_ROW_CLASSE = {
    'Entregue no prazo': 'ltp-row--no-prazo', 'Entregue atrasado': 'ltp-row--atrasado',
    'Em trânsito no prazo': 'ltp-row--transito', 'Em trânsito atrasado': 'ltp-row--atrasado',
    'Aguardando faturamento': 'ltp-row--pendente', 'Aguardando coleta': 'ltp-row--pendente',
    'Sem Lead Time cadastrado': 'ltp-row--pendente', 'Dados incompletos': 'ltp-row--pendente'
  };

  /** "Amarelo: próximo do vencimento" (pedido do usuário) — só se aplica a pedidos "Em
   * trânsito no prazo" a 1 dia útil ou menos de virar atrasado; não é uma 5ª categoria de
   * negócio nova, só um alerta visual sobre a categoria "Em trânsito no prazo" já existente. */
  function situacaoVisualLeadTime(calc) {
    if (calc.situacao === 'Em trânsito no prazo' && calc.leadTimePrevisto !== null && calc.diasDecorridosTransito !== null) {
      if (calc.leadTimePrevisto - calc.diasDecorridosTransito <= 1) {
        return { badge: 'badge--warning', row: 'ltp-row--alerta', rotulo: 'Em trânsito (perto do vencimento)' };
      }
    }
    return {
      badge: SITUACAO_LEADTIME_BADGE[calc.situacao] || 'badge--neutral',
      row: SITUACAO_LEADTIME_ROW_CLASSE[calc.situacao] || 'ltp-row--pendente',
      rotulo: calc.situacao
    };
  }

  function mesLabelLeadTime(date) { return `${Utils.MONTH_NAMES[date.getMonth()]}/${String(date.getFullYear()).slice(2)}`; }

  /** Média mensal de um campo calculado (dias úteis) agrupado pelo mês de outro campo de data.
   * excluirMesAtual (opcional): descarta o mês corrente (ainda em andamento) do resultado —
   * usado só em "Dias para faturar por mês" (2026-08-29): o mês corrente sempre tem uma fatia
   * grande de pedidos criados que AINDA não faturaram (excluídos do cálculo, ver `valor === null`
   * abaixo) — a média do mês corrente reflete só quem já faturou rápido, então o número
   * despenca artificialmente conforme o mês avança (confirmado: Ago/26 tinha 49% dos pedidos
   * criados ainda sem faturamento, contra ~5% em meses fechados — viés clássico de "coorte
   * imatura"/censura à direita). Não se aplica a "Dias fat.→coleta": ali a espera típica é de
   * ~1 dia (não semanas), então o mês corrente não sofre o mesmo viés. */
  function agruparMediaPorMes(itens, campoRegistro, campoCalc, excluirMesAtual = false) {
    const porMes = new Map();
    for (const it of itens) {
      const data = it.r[campoRegistro];
      const valor = it.calc[campoCalc];
      if (!data || valor === null || valor < 0) continue;
      const chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
      if (!porMes.has(chave)) porMes.set(chave, { soma: 0, n: 0, label: mesLabelLeadTime(data), ts: new Date(data.getFullYear(), data.getMonth(), 1).getTime() });
      const agg = porMes.get(chave);
      agg.soma += valor; agg.n++;
    }
    if (excluirMesAtual) {
      const hoje = new Date();
      porMes.delete(`${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`);
    }
    const ordenado = [...porMes.values()].sort((a, b) => a.ts - b.ts);
    return { labels: ordenado.map(a => a.label), data: ordenado.map(a => a.n ? +(a.soma / a.n).toFixed(1) : 0) };
  }

  function agruparPercentualPrazoPorMes(itens) {
    const porMes = new Map();
    for (const it of itens) {
      if (!it.r.dataEntregaNF || it.calc.leadTimePrevisto === null) continue;
      const data = it.r.dataEntregaNF;
      const chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
      if (!porMes.has(chave)) porMes.set(chave, { noPrazo: 0, total: 0, label: mesLabelLeadTime(data), ts: new Date(data.getFullYear(), data.getMonth(), 1).getTime() });
      const agg = porMes.get(chave);
      agg.total++;
      if (it.calc.situacao === 'Entregue no prazo') agg.noPrazo++;
    }
    const ordenado = [...porMes.values()].sort((a, b) => a.ts - b.ts);
    return { labels: ordenado.map(a => a.label), data: ordenado.map(a => a.total ? +(a.noPrazo / a.total * 100).toFixed(1) : 0) };
  }

  /** Top N por dimensão (cliente/motorista/cidade), composição em % de todo o volume de
   * pedidos (não só entregues): dentro do prazo (azul), Reentrega/Cancelado/Devolução (vermelho
   * — pode ter sido erro do próprio motorista, ver [[project_dashboard_lead_time_report]]) e o
   * restante (cinza — em trânsito, aguardando faturamento/coleta, sem Lead Time cadastrado
   * etc.). Cada barra soma 100%. Padrão pedido pelo usuário (2026-08-29) pra qualquer gráfico
   * futuro com mais de uma informação por barra (ver options.stacked em charts.js).
   * Sem mínimo de amostra por dimensão (removido 2026-08-23): com filtro de período estreito, um
   * mínimo de 3 pedidos deixava a lista bem menor que 10 mesmo tendo mais motoristas/clientes/
   * cidades disponíveis — usuária pediu pra sempre completar até 10 pela ordem de volume. */
  function composicaoPercentualPorDimensao(itens, campoRegistro, n = 10, excluirValor = null) {
    const porDim = new Map();
    for (const it of itens) {
      const chave = it.r[campoRegistro] || 'Não informado';
      if (excluirValor && excluirValor(chave)) continue;
      if (!porDim.has(chave)) porDim.set(chave, { total: 0, noPrazo: 0, naoEntregue: 0 });
      const agg = porDim.get(chave);
      agg.total++;
      if (it.calc.situacao === 'Entregue no prazo') agg.noPrazo++;
      else if (it.r.situacao === 'Reentrega' || it.r.situacao === 'Cancelado' || it.r.situacao === 'Devolução') agg.naoEntregue++;
    }
    const lista = [...porDim.entries()]
      .map(([nome, a]) => {
        const pctNoPrazo = a.noPrazo / a.total * 100;
        const pctNaoEntregue = a.naoEntregue / a.total * 100;
        return { nome, total: a.total, pctNoPrazo, pctNaoEntregue, pctOutros: 100 - pctNoPrazo - pctNaoEntregue };
      })
      .sort((a, b) => b.total - a.total).slice(0, n)
      .sort((a, b) => b.pctNoPrazo - a.pctNoPrazo);
    return {
      labels: lista.map(l => l.nome),
      noPrazo: lista.map(l => +l.pctNoPrazo.toFixed(1)),
      outros: lista.map(l => +l.pctOutros.toFixed(1)),
      naoEntregue: lista.map(l => +l.pctNaoEntregue.toFixed(1))
    };
  }

  function previstoVsRealizadoPorTransportadora(itens, n = 10) {
    const porTransp = new Map();
    for (const it of itens) {
      if (!it.r.dataEntregaNF || it.calc.leadTimePrevisto === null || it.calc.diasEntregaEfetiva === null) continue;
      const t = it.r.transportadora;
      if (!porTransp.has(t)) porTransp.set(t, { somaPrevisto: 0, somaReal: 0, n: 0 });
      const agg = porTransp.get(t);
      agg.somaPrevisto += it.calc.leadTimePrevisto; agg.somaReal += it.calc.diasEntregaEfetiva; agg.n++;
    }
    const lista = [...porTransp.entries()]
      .map(([nome, a]) => ({ nome, previsto: a.somaPrevisto / a.n, real: a.somaReal / a.n, n: a.n }))
      .sort((a, b) => b.n - a.n).slice(0, n);
    return { labels: lista.map(l => l.nome), previsto: lista.map(l => +l.previsto.toFixed(1)), real: lista.map(l => +l.real.toFixed(1)) };
  }

  function contarPorSituacaoLeadTime(itens) {
    const contagem = new Map(SITUACAO_LEADTIME_ORDEM.map(s => [s, 0]));
    for (const it of itens) contagem.set(it.calc.situacao, (contagem.get(it.calc.situacao) || 0) + 1);
    // Pedidos que ainda nem viraram nota fiscal (aba "Pedidos não Faturados (Emissão)") não
    // aparecem em `itens` (que só cobre registros já com NF, vindos do Bluesoft) — mas na
    // prática também são pedidos "Aguardando faturamento", e esse volume normalmente é bem
    // maior que o de NFs emitidas aguardando faturamento. Pedido do usuário (2026-08-29): esse
    // número precisa contar aqui também, senão o card fica com um total "bem menor" que a
    // realidade.
    contagem.set('Aguardando faturamento', contagem.get('Aguardando faturamento') + DataStore.getPedidosNaoFaturados().length);
    return { labels: SITUACAO_LEADTIME_ORDEM, data: SITUACAO_LEADTIME_ORDEM.map(s => contagem.get(s)) };
  }

  /** Filtro próprio do gráfico "Previsto x realizado" (Transportadora/Agregado) — pedido do
   * usuário (2026-08-29): a mesma categoria já existe no filtro global "Transporte" (tipoTransporte),
   * mas ela quer poder escolher direto nesse gráfico específico sem afetar o resto do painel. */
  function renderLtpPrevistoVsRealizado(itens) {
    const tipo = document.getElementById('ltp-previsto-tipo-transporte')?.value || '';
    const filtrados = tipo ? itens.filter(it => it.r.tipoTransporte === tipo) : itens;
    const pvr = previstoVsRealizadoPorTransportadora(filtrados);
    charts.ltpPrevistoVsRealizado.update({
      labels: pvr.labels,
      series: [{ name: 'Previsto', data: pvr.previsto, color: ChartPalette[7] }, { name: 'Realizado', data: pvr.real, color: ChartPalette[0] }]
    });
  }

  function renderLeadTimePedidosCharts(itens) {
    const fat = agruparMediaPorMes(itens, 'dataCriacao', 'diasFaturar', true);
    charts.ltpFaturamentoMensal.update({ labels: fat.labels, series: [{ name: 'Dias úteis', data: fat.data, color: ChartPalette[0] }] });

    const col = agruparMediaPorMes(itens, 'dataFaturamento', 'diasColeta');
    charts.ltpColetaMensal.update({ labels: col.labels, series: [{ name: 'Dias úteis', data: col.data, color: ChartPalette[1] }] });

    renderLtpPrevistoVsRealizado(itens);

    const entreguesComLT = itens.filter(it => it.r.dataEntregaNF && it.calc.leadTimePrevisto !== null);
    const noPrazo = entreguesComLT.filter(it => it.calc.situacao === 'Entregue no prazo').length;
    charts.ltpPercentualPrazo.update({ labels: ['Dentro do prazo', 'Fora do prazo'], series: [{ data: [noPrazo, entreguesComLT.length - noPrazo] }] });

    const etapas = contarPorSituacaoLeadTime(itens);
    charts.ltpQtdPorEtapa.update({ labels: etapas.labels, series: [{ name: 'Pedidos', data: etapas.data, color: ChartPalette[4] }] });

    // Composição em %: cada barra soma 100% (dentro do prazo / outros / não entregue) — ver
    // composicaoPercentualPorDimensao acima. options.stacked faz o charts.js emendar os 3
    // segmentos numa única barra por linha em vez de sub-barras lado a lado.
    const seriesComposicao = (comp) => [
      { name: 'Dentro do prazo', data: comp.noPrazo, color: ChartPalette[1], format: 'percent' },
      { name: 'Outros', data: comp.outros, color: ChartPalette[7], format: 'percent' },
      { name: 'Não entregue (Reentrega/Cancelado/Devolução)', data: comp.naoEntregue, color: ChartPalette[3], format: 'percent' }
    ];

    const porCliente = composicaoPercentualPorDimensao(itens, 'cliente');
    charts.ltpPorCliente.update({ labels: porCliente.labels, series: seriesComposicao(porCliente), options: { stacked: true } });

    // "ROTEIRO..." (ROTEIRO-CARRETA, ROTEIRO-TOCO etc.) não é motorista de verdade, é um código
    // interno de veículo/rota usado em transferências — usuária pediu pra tirar desse ranking
    // (2026-08-23).
    const porMotorista = composicaoPercentualPorDimensao(itens, 'motorista', 10, (nome) => String(nome).toUpperCase().startsWith('ROTEIRO'));
    charts.ltpPorMotorista.update({ labels: porMotorista.labels, series: seriesComposicao(porMotorista), options: { stacked: true } });

    const porCidade = composicaoPercentualPorDimensao(itens, 'cidade');
    charts.ltpPorCidade.update({ labels: porCidade.labels, series: seriesComposicao(porCidade), options: { stacked: true } });

    const evolucao = agruparPercentualPrazoPorMes(itens);
    charts.ltpEvolucaoCumprimento.update({ labels: evolucao.labels, series: [{ name: '% dentro do Lead Time', data: evolucao.data, color: ChartPalette[2] }] });
  }

  function fmtDiasKpi(media, mediana) {
    if (media === null) return '—';
    return `${Utils.formatNumber(media, 1)} / ${mediana === null ? '—' : Utils.formatNumber(mediana, 1)}`;
  }

  function renderLeadTimePedidosKpis(kpis) {
    const set = (id, texto) => { const el = document.getElementById(id); if (el) el.textContent = texto; };
    set('ltp-kpi-total', Utils.formatNumber(kpis.totalPedidos));
    set('ltp-kpi-faturados', Utils.formatNumber(kpis.faturados));
    set('ltp-kpi-coletados', Utils.formatNumber(kpis.coletados));
    set('ltp-kpi-entregues', Utils.formatNumber(kpis.entregues));
    set('ltp-kpi-transito', Utils.formatNumber(kpis.emTransito));
    set('ltp-kpi-atrasados', Utils.formatNumber(kpis.atrasados));
    set('ltp-kpi-faturar', fmtDiasKpi(kpis.mediaDiasFaturar, kpis.medianaDiasFaturar));
    set('ltp-kpi-coleta', fmtDiasKpi(kpis.mediaDiasColeta, kpis.medianaDiasColeta));
    set('ltp-kpi-entrega', fmtDiasKpi(kpis.mediaDiasEntrega, kpis.medianaDiasEntrega));
    set('ltp-kpi-total-medio', kpis.mediaDiasTotal === null ? '—' : `${Utils.formatNumber(kpis.mediaDiasTotal, 1)} dias`);
    set('ltp-kpi-percentual', kpis.percentualNoPrazo === null ? '—' : `${Utils.formatNumber(kpis.percentualNoPrazo, 1)}%`);
    set('ltp-kpi-media-atraso', kpis.mediaDiasAtraso === null ? '—' : `${Utils.formatNumber(kpis.mediaDiasAtraso, 1)} dias`);
    set('ltp-kpi-sem-leadtime', Utils.formatNumber(kpis.semLeadTimeCadastrado));
  }

  const ROTULO_INCONSISTENCIA_LEADTIME = {
    faturamento_antes_da_criacao: 'Faturamento antes da criação',
    coleta_antes_do_faturamento: 'Coleta antes do faturamento',
    entrega_antes_da_coleta: 'Entrega antes da coleta'
  };

  /** Combinações Transportadora+Cidade que caíram em "Sem Lead Time cadastrado" — pedido do
   * usuário (2026-08-23): deixar visível pra ela saber o que priorizar cadastrar na aba
   * "Lead Time Atualizado", em vez de só saber que existe um problema sem saber onde agir. */
  function listarTransportadoraCidadeSemLeadTime(itens) {
    const porCombo = new Map();
    for (const it of itens) {
      if (it.calc.situacao !== 'Sem Lead Time cadastrado') continue;
      const chave = `${it.r.transportadora}|${it.r.cidade}`;
      if (!porCombo.has(chave)) porCombo.set(chave, { transportadora: it.r.transportadora, cidade: it.r.cidade, uf: it.r.uf, pedidos: 0 });
      porCombo.get(chave).pedidos++;
    }
    return [...porCombo.values()].sort((a, b) => b.pedidos - a.pedidos);
  }

  function renderLeadTimePedidosQualidade(itens) {
    const inconsistentes = itens.filter(it => it.calc.inconsistencias.length > 0);
    const tbodyInc = document.querySelector('#ltp-table-inconsistencias tbody');
    if (tbodyInc) {
      tbodyInc.innerHTML = inconsistentes.length
        ? inconsistentes.map(it => `
            <tr>
              <td>${escapeAttr(it.r.nf)}</td>
              <td class="truncate">${escapeAttr(it.r.cliente)}</td>
              <td>${it.calc.inconsistencias.map(c => ROTULO_INCONSISTENCIA_LEADTIME[c] || c).join(', ')}</td>
              <td>${Utils.formatDate(it.r.dataCriacao)}</td>
              <td>${Utils.formatDate(it.r.dataFaturamento)}</td>
              <td>${Utils.formatDate(it.r.dataEntrega)}</td>
              <td>${Utils.formatDate(it.r.dataEntregaNF)}</td>
            </tr>`).join('')
        : '<tr><td colspan="7" class="table-empty">Nenhuma encontrada</td></tr>';
    }

    const semLeadTime = listarTransportadoraCidadeSemLeadTime(itens);
    const tbodySemLT = document.querySelector('#ltp-table-sem-leadtime tbody');
    const LIMITE_EXIBICAO = 50;
    if (tbodySemLT) {
      tbodySemLT.innerHTML = semLeadTime.length
        ? semLeadTime.slice(0, LIMITE_EXIBICAO).map(c => `
            <tr>
              <td class="truncate">${escapeAttr(c.transportadora)}</td>
              <td>${escapeAttr(c.cidade)}</td>
              <td>${escapeAttr(c.uf)}</td>
              <td class="text-right">${Utils.formatNumber(c.pedidos)}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" class="table-empty">Nenhuma — todos os pedidos com Transportadora/Cidade têm Lead Time cadastrado</td></tr>';
    }
    const avisoTruncado = document.getElementById('ltp-sem-leadtime-truncado');
    if (avisoTruncado) {
      if (semLeadTime.length > LIMITE_EXIBICAO) {
        avisoTruncado.hidden = false;
        avisoTruncado.textContent = `Mostrando as ${LIMITE_EXIBICAO} combinações de maior volume, de ${semLeadTime.length} no total.`;
      } else {
        avisoTruncado.hidden = true;
      }
    }

    const duplicados = DataStore.listarPedidosDuplicadosLeadTime();
    const tbodyDup = document.querySelector('#ltp-table-duplicados tbody');
    if (tbodyDup) {
      tbodyDup.innerHTML = duplicados.length
        ? duplicados.map(d => `<tr><td>${escapeAttr(d.nf)}</td><td>${d.ocorrencias}</td></tr>`).join('')
        : '<tr><td colspan="2" class="table-empty">Nenhum encontrado</td></tr>';
    }

    const invalidos = DataStore.listarLeadTimesInvalidos();
    const tbodyInv = document.querySelector('#ltp-table-leadtime-invalido tbody');
    if (tbodyInv) {
      tbodyInv.innerHTML = invalidos.length
        ? invalidos.map(v => `<tr><td>${escapeAttr(v.transportadora)}</td><td>${escapeAttr(v.cidade)}</td><td>${escapeAttr(v.valorBruto)}</td></tr>`).join('')
        : '<tr><td colspan="3" class="table-empty">Nenhuma encontrada</td></tr>';
    }

    const contagemEl = document.getElementById('ltp-qualidade-contagem');
    if (contagemEl) {
      const total = inconsistentes.length + duplicados.length + invalidos.length;
      contagemEl.textContent = total ? `${total} ponto(s) de atenção` : 'Tudo certo';
      contagemEl.className = 'badge ' + (total ? 'badge--warning' : 'badge--success');
    }
  }

  function itemParaLinhaLeadTime(item) {
    const { r, calc } = item;
    return {
      nf: r.nf, cliente: r.cliente, cnpj: r.cnpj, cidade: r.cidade, uf: r.uf, motorista: r.motorista,
      dataCriacao: r.dataCriacao, dataFaturamento: r.dataFaturamento, diasFaturar: calc.diasFaturar,
      dataEntrega: r.dataEntrega, diasColeta: calc.diasColeta,
      dataEntregaNF: r.dataEntregaNF, diasEntregaEfetiva: calc.diasEntregaEfetiva,
      diasTotal: calc.diasTotal, leadTimePrevisto: calc.leadTimePrevisto, desvio: calc.desvio,
      situacao: calc.situacao, diasAtraso: calc.diasAtraso, _calc: calc
    };
  }

  function fmtDiasCell(v) { return v === null ? '—' : Utils.formatNumber(v); }

  function rowHtmlLeadTimePedidos(linha) {
    const visual = situacaoVisualLeadTime(linha._calc);
    return `
      <tr class="${visual.row}">
        <td>${escapeAttr(linha.nf)}</td>
        <td class="truncate" title="${escapeAttr(linha.cliente)}">${escapeAttr(linha.cliente)}</td>
        <td>${escapeAttr(linha.cnpj || '—')}</td>
        <td>${escapeAttr(linha.cidade)}${linha.uf ? '/' + escapeAttr(linha.uf) : ''}</td>
        <td class="truncate" title="${escapeAttr(linha.motorista)}">${escapeAttr(linha.motorista)}</td>
        <td>${Utils.formatDate(linha.dataCriacao)}</td>
        <td>${Utils.formatDate(linha.dataFaturamento)}</td>
        <td class="text-right">${fmtDiasCell(linha.diasFaturar)}</td>
        <td>${Utils.formatDate(linha.dataEntrega)}</td>
        <td class="text-right">${fmtDiasCell(linha.diasColeta)}</td>
        <td>${Utils.formatDate(linha.dataEntregaNF)}</td>
        <td class="text-right">${fmtDiasCell(linha.diasEntregaEfetiva)}</td>
        <td class="text-right">${fmtDiasCell(linha.diasTotal)}</td>
        <td class="text-right">${linha.leadTimePrevisto === null ? '—' : Utils.formatNumber(linha.leadTimePrevisto)}</td>
        <td class="text-right">${linha.desvio === null ? '—' : (linha.desvio > 0 ? '+' : '') + Utils.formatNumber(linha.desvio)}</td>
        <td><span class="badge ${visual.badge}">${escapeAttr(visual.rotulo)}</span></td>
        <td class="text-right">${linha.diasAtraso === null ? '—' : Utils.formatNumber(linha.diasAtraso)}</td>
      </tr>
    `;
  }

  function atualizarLinhasTabelaLeadTime() {
    let linhas = leadTimePedidosItensFiltrados.map(itemParaLinhaLeadTime);
    if (leadTimePedidosBusca) {
      const needle = leadTimePedidosBusca.toLowerCase();
      linhas = linhas.filter(l => `${l.nf} ${l.cliente} ${l.cnpj} ${l.motorista} ${l.cidade}`.toLowerCase().includes(needle));
    }
    leadTimePedidosLinhasTabela = linhas;
  }

  function popularSelectLeadTime(id, valores) {
    const select = document.getElementById(id);
    if (!select) return;
    const atual = select.value;
    const primeiraOpcao = select.options[0];
    select.innerHTML = '';
    select.appendChild(primeiraOpcao);
    valores.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      select.appendChild(opt);
    });
    if (valores.includes(atual)) select.value = atual;
  }

  function popularSelectsLeadTimePedidos() {
    popularSelectLeadTime('ltp-filtro-cliente', DataStore.getDistinctValues('cliente'));
    popularSelectLeadTime('ltp-filtro-motorista', DataStore.getDistinctValues('motorista'));
    popularSelectLeadTime('ltp-filtro-transportadora', DataStore.getDistinctValues('transportadora'));
    popularSelectLeadTime('ltp-filtro-cidade', DataStore.getDistinctValues('cidade'));
    popularSelectLeadTime('ltp-filtro-uf', DataStore.getDistinctValues('uf'));
    popularSelectLeadTime('ltp-filtro-regiao', DataStore.getDistinctValues('regiaoComercial'));
    popularSelectLeadTime('ltp-filtro-rota', DataStore.getDistinctValues('rota'));
  }

  function lerFiltrosLeadTimePedidos() {
    const val = (id) => document.getElementById(id)?.value || '';
    const dataOuNull = (id) => { const v = val(id); return v ? new Date(v + 'T00:00:00') : null; };
    const soUm = (id) => { const v = val(id); return v ? [v] : null; };
    return {
      campoData: val('ltp-filtro-campo-data') || 'criacao',
      dataInicio: dataOuNull('ltp-filtro-data-inicio'),
      dataFim: dataOuNull('ltp-filtro-data-fim'),
      cliente: soUm('ltp-filtro-cliente'),
      cnpj: val('ltp-filtro-cnpj'),
      numeroPedido: val('ltp-filtro-pedido'),
      motorista: soUm('ltp-filtro-motorista'),
      transportadora: soUm('ltp-filtro-transportadora'),
      cidade: soUm('ltp-filtro-cidade'),
      uf: soUm('ltp-filtro-uf'),
      regiao: soUm('ltp-filtro-regiao'),
      rota: soUm('ltp-filtro-rota'),
      situacao: soUm('ltp-filtro-situacao'),
      prazo: val('ltp-filtro-prazo'),
      leadTime: val('ltp-filtro-leadtime')
    };
  }

  /** Ponto de entrada do painel — recalcula tudo (KPIs, gráficos, qualidade, tabela) a partir
   * dos filtros próprios atuais. No-op se a seção não estiver no DOM ou não estiver visível
   * (mesmo padrão de renderLeadTime/renderRegistroDinamico). */
  function renderLeadTimePedidos() {
    const secao = document.getElementById('leadtime-pedidos-view');
    if (!secao || secao.hidden) return;
    const erroEl = document.getElementById('ltp-erro');
    try {
      if (!leadTimePedidosSelectsPopulados) { popularSelectsLeadTimePedidos(); leadTimePedidosSelectsPopulados = true; }
      const filtros = lerFiltrosLeadTimePedidos();
      const { itens, kpis } = DataStore.calcularLeadTimePedidos(filtros);
      leadTimePedidosItensFiltrados = itens;

      renderLeadTimePedidosKpis(kpis);
      renderLeadTimePedidosCharts(itens);
      renderLeadTimePedidosQualidade(itens);

      atualizarLinhasTabelaLeadTime();
      leadTimePedidosTable.page = 1;
      renderTableGeneric(leadTimePedidosLinhasTabela, leadTimePedidosTable, LEADTIME_PEDIDOS_TABLE_IDS, rowHtmlLeadTimePedidos);

      const dt = DataStore.getLastUpdated();
      const elAtualizado = document.getElementById('ltp-last-updated');
      if (elAtualizado) elAtualizado.textContent = 'Última atualização: ' + (dt ? Utils.formatDateTime(dt) : '—');
      if (erroEl) erroEl.hidden = true;
    } catch (err) {
      console.error('Erro ao calcular o painel Lead Time de Pedidos e Entregas:', err);
      if (erroEl) { erroEl.textContent = 'Não foi possível calcular o painel: ' + err.message; erroEl.hidden = false; }
    }
  }

  function colunasLeadTimePedidosExport() {
    return [
      { label: 'NF/Pedido', value: l => l.nf },
      { label: 'Cliente', value: l => l.cliente },
      { label: 'CNPJ', value: l => l.cnpj || '' },
      { label: 'Cidade/UF', value: l => `${l.cidade}${l.uf ? '/' + l.uf : ''}` },
      { label: 'Motorista', value: l => l.motorista },
      { label: 'Data Criação', value: l => Utils.formatDate(l.dataCriacao) },
      { label: 'Data Faturamento', value: l => Utils.formatDate(l.dataFaturamento) },
      { label: 'Dias p/ faturar', value: l => fmtDiasCell(l.diasFaturar) },
      { label: 'Data Coleta', value: l => Utils.formatDate(l.dataEntrega) },
      { label: 'Dias fat.->coleta', value: l => fmtDiasCell(l.diasColeta) },
      { label: 'Data Entrega', value: l => Utils.formatDate(l.dataEntregaNF) },
      { label: 'Dias coleta->entrega', value: l => fmtDiasCell(l.diasEntregaEfetiva) },
      { label: 'Dias total', value: l => fmtDiasCell(l.diasTotal) },
      { label: 'Lead Time previsto', value: l => l.leadTimePrevisto === null ? '' : l.leadTimePrevisto },
      { label: 'Desvio', value: l => l.desvio === null ? '' : l.desvio },
      { label: 'Situação', value: l => l.situacao },
      { label: 'Dias de atraso', value: l => l.diasAtraso === null ? '' : l.diasAtraso }
    ];
  }

  function colorirSituacaoLeadTimeExportacao(rotuloColuna, valorFormatado) {
    if (rotuloColuna !== 'Situação') return null;
    const fundo = {
      'Entregue no prazo': 'FF16A34A', 'Entregue atrasado': 'FFDC2626',
      'Em trânsito no prazo': 'FF2563EB', 'Em trânsito atrasado': 'FFDC2626',
      'Aguardando faturamento': 'FF64748B', 'Aguardando coleta': 'FF64748B',
      'Sem Lead Time cadastrado': 'FF64748B', 'Dados incompletos': 'FF64748B'
    }[valorFormatado];
    return fundo ? { fundo } : null;
  }

  async function exportarLeadTimePedidosExcel() {
    if (!leadTimePedidosLinhasTabela.length) { Utils.showToast('Não há dados para exportar.', 'warning'); return; }
    await Utils.exportToStyledExcel('lead-time-pedidos-entregas.xlsx', 'Lead Time', colunasLeadTimePedidosExport(), leadTimePedidosLinhasTabela, colorirSituacaoLeadTimeExportacao);
    Utils.showToast(`${leadTimePedidosLinhasTabela.length} pedidos exportados para Excel.`, 'success');
  }

  function bindLeadTimePedidos() {
    const secao = document.getElementById('leadtime-pedidos-view');
    if (!secao) return;

    [
      'ltp-filtro-campo-data', 'ltp-filtro-data-inicio', 'ltp-filtro-data-fim', 'ltp-filtro-cliente',
      'ltp-filtro-motorista', 'ltp-filtro-transportadora', 'ltp-filtro-cidade', 'ltp-filtro-uf',
      'ltp-filtro-regiao', 'ltp-filtro-rota', 'ltp-filtro-situacao', 'ltp-filtro-prazo', 'ltp-filtro-leadtime'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', renderLeadTimePedidos);
    });

    const debouncedFiltro = Utils.debounce(renderLeadTimePedidos, 300);
    ['ltp-filtro-cnpj', 'ltp-filtro-pedido'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', debouncedFiltro);
    });

    document.getElementById('ltp-btn-limpar-filtros').addEventListener('click', () => {
      ['ltp-filtro-data-inicio', 'ltp-filtro-data-fim', 'ltp-filtro-cnpj', 'ltp-filtro-pedido',
        'ltp-filtro-cliente', 'ltp-filtro-motorista', 'ltp-filtro-transportadora', 'ltp-filtro-cidade',
        'ltp-filtro-uf', 'ltp-filtro-regiao', 'ltp-filtro-rota', 'ltp-filtro-situacao', 'ltp-filtro-prazo', 'ltp-filtro-leadtime'
      ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      document.getElementById('ltp-filtro-campo-data').value = 'criacao';
      renderLeadTimePedidos();
    });

    document.getElementById('ltp-previsto-tipo-transporte').addEventListener('change', () => renderLtpPrevistoVsRealizado(leadTimePedidosItensFiltrados));

    const buscaTabelaDebounced = Utils.debounce((valor) => {
      leadTimePedidosBusca = valor;
      atualizarLinhasTabelaLeadTime();
      leadTimePedidosTable.page = 1;
      renderTableGeneric(leadTimePedidosLinhasTabela, leadTimePedidosTable, LEADTIME_PEDIDOS_TABLE_IDS, rowHtmlLeadTimePedidos);
    }, 250);
    document.getElementById('ltp-table-search').addEventListener('input', (e) => buscaTabelaDebounced(e.target.value));

    bindTableControlsFor(leadTimePedidosTable, LEADTIME_PEDIDOS_TABLE_IDS, () => leadTimePedidosLinhasTabela, rowHtmlLeadTimePedidos);

    document.getElementById('ltp-btn-export-excel').addEventListener('click', exportarLeadTimePedidosExcel);
    document.getElementById('ltp-btn-export-pdf').addEventListener('click', () => {
      Utils.showToast('Escolha "Salvar como PDF" na janela de impressão.', 'info', 5000);
      window.print();
    });
  }

  /** Submenu de Transportadoras da data selecionada (pedido do usuário, 2026-08-27) — aparece
   * só depois de clicar numa data na tabela de cima. */
  function renderRegistroDinamicoTransportadoras() {
    const secao = document.getElementById('registro-dinamico-transportadoras');
    if (!registroDinamicoDataSelecionada) { secao.hidden = true; return; }
    secao.hidden = false;

    const linhas = calcularRegistroDinamicoPorTransportadora(registrosDoDiaSelecionado());
    document.getElementById('registro-dinamico-transportadoras-titulo').textContent =
      `Transportadoras em ${Utils.formatDate(registroDinamicoDataSelecionada)}`;
    renderTableGeneric(linhas, registroDinamicoTransportadoraTable, REGISTRO_DINAMICO_TRANSPORTADORA_IDS, rowHtmlRegistroDinamicoTransportadora);
  }

  function renderRegistroDinamicoDetalhe() {
    const secao = document.getElementById('registro-dinamico-detalhe');
    if (!registroDinamicoDataSelecionada || !registroDinamicoTransportadoraSelecionada) { secao.hidden = true; return; }
    secao.hidden = false;

    const registros = registrosDoDiaETransportadoraSelecionados();
    document.getElementById('registro-dinamico-detalhe-titulo').textContent =
      `Notas faturadas em ${Utils.formatDate(registroDinamicoDataSelecionada)} — ${registroDinamicoTransportadoraSelecionada} (${Utils.formatNumber(registros.length)})`;
    renderTableGeneric(registros, registroDinamicoDetalheTable, REGISTRO_DINAMICO_DETALHE_IDS, rowHtmlRegistroDinamicoDetalhe);
    renderRegistroDinamicoObservacaoEdicao();
  }

  /** Painel de edição da observação de UMA nota (clicar no botão da coluna "Observação" na
   * tabela de detalhe acima) — mesmo modelo Firestore de renderObservacaoEdicao (só 1 nota por
   * vez, não a lista inteira: um dia/transportadora pode ter muitas notas). */
  function renderRegistroDinamicoObservacaoEdicao() {
    const section = document.getElementById('registro-dinamico-observacao-edicao-section');
    if (!registroDinamicoObservacaoNf) { section.hidden = true; return; }
    const registro = registrosDoDiaETransportadoraSelecionados().find(r => r.nf.split('-')[0] === registroDinamicoObservacaoNf);
    if (!registro) { section.hidden = true; registroDinamicoObservacaoNf = null; return; }
    section.hidden = false;

    const admin = isAdminAgendamento();
    document.getElementById('registro-dinamico-observacao-edicao-titulo').textContent = `Editar observação — NF ${registro.nf}`;
    document.getElementById('registro-dinamico-observacao-edicao-hint').textContent = admin
      ? 'Escreva uma observação livre sobre a nota — salva direto aqui, sem precisar de planilha.'
      : 'Observação da nota (só o usuário responsável pode editar).';

    const list = document.getElementById('registro-dinamico-observacao-edicao-list');
    const observacaoAtual = registro.observacaoAgendamento || '';

    if (!admin) {
      list.innerHTML = `
        <div class="observacao-row">
          <span class="observacao-row__nf">${escapeAttr(registro.nf)}</span>
          <span class="observacao-row__cliente" title="${escapeAttr(registro.cliente)}">${escapeAttr(registro.cliente)}</span>
          <span class="observacao-row__somente-leitura" title="${escapeAttr(observacaoAtual)}">${escapeAttr(observacaoAtual || '—')}</span>
          <span></span>
        </div>
      `;
      return;
    }

    list.innerHTML = `
      <div class="observacao-row" data-nf="${escapeAttr(registroDinamicoObservacaoNf)}">
        <span class="observacao-row__nf">${escapeAttr(registro.nf)}</span>
        <span class="observacao-row__cliente" title="${escapeAttr(registro.cliente)}">${escapeAttr(registro.cliente)}</span>
        <input type="text" class="observacao-row__input" placeholder="Observação (opcional)" value="${escapeAttr(observacaoAtual)}">
        <button type="button" class="btn observacao-row__salvar">Salvar</button>
      </div>
    `;
  }

  /** Clicar na observação já em edição fecha o painel (alterna); clicar noutra troca direto —
   * mesmo padrão de abrirEdicaoPedido ("Pedidos Aguardando Faturamento"). */
  function abrirEdicaoObservacaoRegistroDinamico(nfBase) {
    const vaiFechar = registroDinamicoObservacaoNf === nfBase;
    registroDinamicoObservacaoNf = vaiFechar ? null : nfBase;
    if (vaiFechar) {
      // Fechar colapsa o painel (hidden) — sem congelar o scroll, o navegador ancora o layout
      // que encolheu abaixo do ponto de scroll atual e a página pula pra cima sozinha (mesmo
      // efeito corrigido no handler de salvar, ver comentário lá).
      const scrollYAntes = window.scrollY;
      renderRegistroDinamicoDetalhe();
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, scrollYAntes)));
    } else {
      renderRegistroDinamicoDetalhe();
      document.getElementById('registro-dinamico-observacao-edicao-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /** Clicar numa data já expandida fecha o submenu de novo (alterna); clicar noutra data troca
   * pra ela, sem precisar fechar antes. Trocar/fechar a data invalida a transportadora
   * escolhida antes dentro do submenu — ela pode nem existir no dia novo. */
  function abrirRegistroDinamicoDetalhe(timestamp) {
    const novaData = new Date(Number(timestamp));
    const jaEstaAberta = registroDinamicoDataSelecionada && registroDinamicoDataSelecionada.getTime() === novaData.getTime();
    registroDinamicoDataSelecionada = jaEstaAberta ? null : novaData;
    registroDinamicoTransportadoraSelecionada = null;
    registroDinamicoObservacaoNf = null;
    registroDinamicoTransportadoraTable.page = 1;
    registroDinamicoDetalheTable.page = 1;
    renderRegistroDinamico();
  }

  /** Mesmo padrão de alternância acima, um nível abaixo: clicar na transportadora já escolhida
   * fecha o detalhe por nota; clicar noutra troca direto. */
  function abrirRegistroDinamicoTransportadora(nome) {
    const jaEstaSelecionada = registroDinamicoTransportadoraSelecionada === nome;
    registroDinamicoTransportadoraSelecionada = jaEstaSelecionada ? null : nome;
    registroDinamicoObservacaoNf = null;
    registroDinamicoDetalheTable.page = 1;
    renderRegistroDinamico();
  }

  function bindRegistroDinamico() {
    bindTableControlsFor(registroDinamicoTable, REGISTRO_DINAMICO_TABLE_IDS,
      () => calcularRegistroDinamico(DataStore.getFilteredRecords(), registroDinamicoMesSelecionado).linhas,
      rowHtmlRegistroDinamico);
    bindTableControlsFor(registroDinamicoTransportadoraTable, REGISTRO_DINAMICO_TRANSPORTADORA_IDS,
      () => calcularRegistroDinamicoPorTransportadora(registrosDoDiaSelecionado()),
      rowHtmlRegistroDinamicoTransportadora);
    bindTableControlsFor(registroDinamicoDetalheTable, REGISTRO_DINAMICO_DETALHE_IDS,
      registrosDoDiaETransportadoraSelecionados, rowHtmlRegistroDinamicoDetalhe);

    // Delegado no body (igual bindCanhotoLinks) porque a tabela/os cards são reconstruídos a
    // cada render. Um só listener cobre os 3 tipos de clique (card de mês, data do dia,
    // transportadora do submenu).
    document.body.addEventListener('click', (e) => {
      const btnMes = e.target.closest('[data-mes-fat]');
      if (btnMes) { abrirRegistroDinamicoMes(btnMes.dataset.mesFat); return; }
      const btnTransportadora = e.target.closest('[data-transportadora-fat]');
      if (btnTransportadora) { abrirRegistroDinamicoTransportadora(btnTransportadora.dataset.transportadoraFat); return; }
      const btnData = e.target.closest('[data-data-fat]');
      if (!btnData) return;
      abrirRegistroDinamicoDetalhe(btnData.dataset.dataFat);
    });

    // Fechar o submenu de Transportadoras volta pra tabela de datas (fecha tudo abaixo também,
    // já que o detalhe por nota depende de uma transportadora escolhida dentro dele).
    document.getElementById('registro-dinamico-transportadoras-fechar').addEventListener('click', () => {
      registroDinamicoDataSelecionada = null;
      registroDinamicoTransportadoraSelecionada = null;
      registroDinamicoObservacaoNf = null;
      renderRegistroDinamico();
    });
    // Fechar o detalhe por nota só desmarca a transportadora — volta pro submenu da mesma data,
    // sem perder a data selecionada.
    // Exporta exatamente o que está na tela (notas da data + transportadora escolhidas) —
    // pedido do usuário (2026-08-27), reaproveita o mesmo exportarRegistros/tableColumns já
    // usado pelos outros botões de exportação Excel do site.
    document.getElementById('registro-dinamico-detalhe-export').addEventListener('click', () => {
      const dataSlug = registroDinamicoDataSelecionada ? Utils.formatDate(registroDinamicoDataSelecionada).replace(/\//g, '-') : 'data';
      const transpSlug = (registroDinamicoTransportadoraSelecionada || 'transportadora')
        .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      exportarRegistros(`registro-dinamico-${dataSlug}-${transpSlug}.xlsx`, registrosDoDiaETransportadoraSelecionados());
    });

    document.getElementById('registro-dinamico-detalhe-fechar').addEventListener('click', () => {
      registroDinamicoTransportadoraSelecionada = null;
      registroDinamicoObservacaoNf = null;
      renderRegistroDinamico();
    });

    // Delegado no body da tabela (reconstruída a cada render) — clicar na Observação
    // abre/fecha o painel de edição dela (pedido do usuário, 2026-08-29).
    document.getElementById('registro-dinamico-detalhe-table-body').addEventListener('click', (e) => {
      const botao = e.target.closest('[data-observacao-edicao]');
      if (botao) abrirEdicaoObservacaoRegistroDinamico(botao.dataset.observacaoEdicao);
    });

    document.getElementById('registro-dinamico-observacao-edicao-list').addEventListener('click', async (e) => {
      const botao = e.target.closest('.observacao-row__salvar');
      if (!botao) return;
      const linha = botao.closest('.observacao-row');
      const nf = linha.dataset.nf;
      const observacao = linha.querySelector('.observacao-row__input').value.trim();

      botao.disabled = true;
      botao.textContent = 'Salvando...';
      try {
        const fb = await new Promise((resolve) => {
          if (window.Firebase) return resolve(window.Firebase);
          window.addEventListener('firebase-ready', () => resolve(window.Firebase), { once: true });
        });
        // DataStore.applyAgendamentoManual chama notify() por baixo, e o callback global
        // render() (DataStore.onChange) zera registroDinamicoMesSelecionado/DataSelecionada/
        // TransportadoraSelecionada incondicionalmente — regra pensada só pro caso "um filtro de
        // verdade mudou" (comentário em render()), mas que também dispara aqui, sem querer,
        // porque ambos passam pelo mesmo notify(). Resultado real reportado pela usuária: salvar
        // a observação "voltava pra tela inicial do Registro Dinâmico". Guarda o que estava
        // selecionado ANTES de chamar applyAgendamentoManual e restaura logo depois, antes do
        // nosso próprio render — não mexe em render()/notify() (usado por outras telas também),
        // só neutraliza o efeito colateral aqui.
        const mesAntes = registroDinamicoMesSelecionado;
        const dataAntes = registroDinamicoDataSelecionada;
        const transportadoraAntes = registroDinamicoTransportadoraSelecionada;
        await fb.salvarObservacaoNota(nf, observacao);
        DataStore.applyAgendamentoManual({ [nf]: { observacao } });
        registroDinamicoMesSelecionado = mesAntes;
        registroDinamicoDataSelecionada = dataAntes;
        registroDinamicoTransportadoraSelecionada = transportadoraAntes;
        Utils.showToast(`NF ${nf}: observação salva.`, 'success', 2500);
        // Fecha o painel de edição depois de salvar (pedido do usuário, 2026-08-29: "continue
        // na mesma tela, apenas suma a opção de editar") — a tabela acima já mostra o texto
        // novo na própria célula, então reabrir a edição não é necessário até ela clicar de novo.
        // O painel some (hidden) e ocupava espaço ABAIXO da tabela — sem o congelamento de
        // scroll abaixo, o navegador "ancora" o layout que encolheu e a página pula pra cima
        // sozinha (confirmado: ela reportou voltar pro topo do Registro Dinâmico ao salvar).
        // rAF duplo garante que a restauração aconteça DEPOIS do reflow/ancoragem do próprio
        // navegador, não antes (senão ele sobrescreve de novo).
        const scrollYAntes = window.scrollY;
        registroDinamicoObservacaoNf = null;
        renderRegistroDinamico();
        requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, scrollYAntes)));
      } catch (err) {
        Utils.showToast(err.message || 'Falha ao salvar a observação.', 'error', 5000);
        botao.disabled = false;
        botao.textContent = 'Salvar';
      }
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
    // A lista é reconstruída (innerHTML) toda vez que os filtros mudam — sem isso, o que a
    // usuária tivesse digitado no campo de busca (Transportadora/Cliente, ver
    // BUSCA_POR_LISTA_CHECKBOX) parava de filtrar assim que ela marcasse um item.
    aplicarBuscaCheckboxList(containerId);
  }

  /** Liga cada lista de checkbox longa (Transportadora×4/Cliente/Cidade/Vendedor) ao seu campo
   * de busca — filtra os itens visíveis por texto, sem mexer no que já está marcado (só
   * escondido/mostrado, "Selecionar todos" continua valendo pra lista inteira). */
  const BUSCA_POR_LISTA_CHECKBOX = Object.assign(
    {
      'filter-cliente-list': 'filter-cliente-busca',
      'filter-cidade-list': 'filter-cidade-busca',
      'filter-vendedor-list': 'filter-vendedor-busca',
    },
    ...CATEGORIAS_TRANSPORTE_UI.map(c => ({
      [`filter-transportadora-list-${c.slug}`]: `filter-transportadora-busca-${c.slug}`
    }))
  );

  function aplicarBuscaCheckboxList(listaId) {
    const buscaId = BUSCA_POR_LISTA_CHECKBOX[listaId];
    if (!buscaId) return;
    const busca = document.getElementById(buscaId);
    const lista = document.getElementById(listaId);
    if (!busca || !lista) return;
    const termo = busca.value.trim().toLowerCase();
    lista.querySelectorAll('.filter-checkbox:not(.filter-checkbox--todos)').forEach((label) => {
      const texto = label.textContent.trim().toLowerCase();
      // .filter-checkbox tem "display:flex" no CSS, que empataria em especificidade com a
      // regra padrão do navegador pro atributo "hidden" (e o navegador perderia) — por isso
      // esconde via style.display direto, não via .hidden.
      label.style.display = (termo !== '' && !texto.includes(termo)) ? 'none' : '';
    });
  }

  function bindBuscaCheckboxList() {
    Object.entries(BUSCA_POR_LISTA_CHECKBOX).forEach(([listaId, buscaId]) => {
      const busca = document.getElementById(buscaId);
      if (!busca) return;
      busca.addEventListener('input', () => aplicarBuscaCheckboxList(listaId));
    });
  }

  /** Popula as 4 listas de nomes de Transportadora, uma por Categoria (pedido do usuário
   * 2026-08-27) — cada uma só com os nomes daquela categoria, evitando a duplicata que existia
   * antes (mesma transportadora aparecendo com grafias diferentes numa lista única). As 4
   * escrevem no MESMO filtro `transportadora` (ver bindFilterCheckboxListGroup), então a poda
   * de valores que sumiram dos dados (ver decisão 2026-08-19) precisa ser feita uma vez só,
   * contra a união das 4 listas — podar list a lista (filterKey de cada fillCheckboxList)
   * removeria por engano os nomes marcados em QUALQUER OUTRA categoria. */
  function populateFilterOptionsTransporte() {
    const nomesPorCategoria = DataStore.getNomesTransportadoraPorCategoria();
    const todosNomesValidos = new Set(Object.values(nomesPorCategoria).flat());
    const atual = DataStore.getFilters().transportadora || [];
    const podado = atual.filter(v => todosNomesValidos.has(v));
    if (podado.length !== atual.length) DataStore.setFilters({ transportadora: podado });

    CATEGORIAS_TRANSPORTE_UI.forEach(cat => {
      fillCheckboxList(`filter-transportadora-list-${cat.slug}`, nomesPorCategoria[cat.label] || [], null);
    });
  }

  function populateFilterOptions() {
    populateFilterOptionsTransporte();
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

  /** "Status" mostrado de fato na tabela — igual a statusLabel/statusBadgeClass pra tudo,
   * exceto notas Em Aberto que já estão dentro do prazo do Lead Time (r.prazoStatus ===
   * 'DENTRO_PRAZO', mesmo cálculo usado no painel "Lead Time de Pedidos e Entregas" e na
   * coluna "Prazo"): essas mostram "Em Trânsito" em vez de "Em aberto" — pedido do usuário
   * (2026-08-26), pra distinguir quem só está a caminho (dentro do prazo) de quem realmente
   * está parado/atrasado sem informação. Usada em todo lugar que hoje usa
   * statusLabel(r.status)/statusBadgeClass(r.status) — tabela principal, drill-down de KPI,
   * detalhe do Registro Dinâmico e exportações — pra não ficar inconsistente entre telas. */
  function statusExibicaoLabel(r) {
    if (r.status === 'EM_ABERTO' && r.prazoStatus === 'DENTRO_PRAZO') return 'Em Trânsito';
    return statusLabel(r.status);
  }
  function statusExibicaoBadgeClass(r) {
    if (r.status === 'EM_ABERTO' && r.prazoStatus === 'DENTRO_PRAZO') return 'badge--info';
    return statusBadgeClass(r.status);
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
    // render() é o callback de DataStore.onChange — só roda quando um filtro global de fato
    // mudou (trocar de aba via mostrarViewMapaRegioes não passa por aqui). O recorte de mês/dia
    // do Registro Dinâmico é de ANTES do filtro mudar e pode não ter mais nenhum registro em
    // comum com o filtro novo (ex.: mês selecionado sem nenhuma nota "Em aberto" nesse mês) —
    // a tabela ficava vazia sem nenhum aviso claro do porquê, lida como "o filtro zerou tudo".
    // Decisão do usuário (2026-08-23): ao mudar um filtro, volta a mostrar todos os meses/dias
    // daquele novo filtro, em vez de manter um recorte que já não faz sentido.
    registroDinamicoMesSelecionado = null;
    registroDinamicoDataSelecionada = null;
    registroDinamicoTransportadoraSelecionada = null;

    renderKPIs(records);
    renderCharts(records);
    table.page = 1;
    renderTable(records);
    renderStatusDetail(); // no-op se a tela de detalhe não estiver aberta
    renderRegistroDinamico(); // no-op se a tela "Registro Dinâmico" não estiver visível
    renderLeadTime(); // no-op se o painel de Lead Time não estiver no DOM
    renderLeadTimePedidos(); // no-op se a tela "Lead Time de Pedidos e Entregas" não estiver visível
    renderPedidosNaoFaturadosView(); // no-op se a tela "Pedidos Aguardando Faturamento" não estiver visível
    updateLastUpdatedLabel();
    enviarDadosRegioesParaIframe(records);
    atualizarBotaoLimparFiltros();
  }

  /** "Limpar filtros" fica cinza neutro em repouso e só acende vermelho/piscante (mesmo efeito
   * do "Atualizar dados") quando existe pelo menos um filtro ativo pra limpar — decisão do
   * usuário (2026-08-23). Reexecuta em toda mudança de filtro (render() é o callback de
   * DataStore.onChange). Não conta "busca" isoladamente? Conta sim — é um filtro como qualquer
   * outro (Busca Rápida e "Pesquisar na tabela" usam o mesmo DataStore.setFilters({busca})). */
  function algumFiltroAtivo() {
    const f = DataStore.getFilters();
    return Boolean(
      f.dataInicio || f.dataFim || f.mes || f.ano || (f.busca && f.busca.trim()) ||
      (f.situacaoFiltro && f.situacaoFiltro.length) ||
      (f.transportadora && f.transportadora.length) ||
      (f.tipoTransporte && f.tipoTransporte.length) ||
      (f.motorista && f.motorista.length) ||
      (f.vendedor && f.vendedor.length) ||
      (f.cliente && f.cliente.length) ||
      (f.cidade && f.cidade.length) ||
      (f.regiaoComercial && f.regiaoComercial.length) ||
      (f.agendamento && f.agendamento.length)
    );
  }

  function atualizarBotaoLimparFiltros() {
    const botao = document.getElementById('btn-reset-filters');
    if (!botao) return;
    botao.classList.toggle('btn--pill-red--ativo', algumFiltroAtivo());
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
    // "Notas em aberto" (2026-08-26): dividido em duas frentes por pedido do usuário — ela
    // quer comparar quantidade/valor de quem exige agendamento (não depende 100% dela) com
    // quem não exige (tem que sair dentro do Lead Time). 'em-aberto' original some do KPI
    // (a soma das duas frentes), mas continua existindo em STATUS_DETAIL_DEFS pro donut.
    const abertasSemAgendamento = records.filter(STATUS_DETAIL_DEFS['em-aberto-sem-agendamento'].test);
    const abertasComAgendamento = records.filter(STATUS_DETAIL_DEFS['em-aberto-com-agendamento'].test);
    const devolucao = records.filter(STATUS_DETAIL_DEFS['devolucao'].test);
    const cancelado = records.filter(STATUS_DETAIL_DEFS['cancelado'].test);
    const reentrega = records.filter(STATUS_DETAIL_DEFS['reentrega'].test);
    // Card "Reentrega": conta TODA VEZ que uma nota passou por reentrega, não só quem está
    // reentrega agora (pedido do usuário, 2026-08-28 — ela vai montar um indicador de
    // reentregas por motorista/transportadora, onde cada tentativa conta). Usa qtdReentregas
    // (todas as tentativas da Bluesoft, ver applyBluesoftEnrichment em data.js), somado sobre
    // TODOS os registros filtrados — não só o recorte `reentrega` acima, já que uma nota que
    // hoje está Entregue pode ter passado por reentrega antes de ser resolvida. O VALOR (R$)
    // continua vindo só do recorte `reentrega` de cima (decisão do usuário: não multiplicar o
    // valor pela quantidade de vezes que repete).
    const totalOcorrenciasReentrega = Utils.sum(records, r => r.qtdReentregas || 0);
    const aguardando = records.filter(STATUS_DETAIL_DEFS['aguardando'].test);
    // Recorte de "Em aberto (sem agendamento)" que já está em trânsito e dentro do prazo do
    // Lead Time — mesmo campo r.prazoStatus usado na coluna "Prazo" e no badge "Em Trânsito"
    // do Status (ver statusExibicaoLabel/statusExibicaoBadgeClass) — pedido do usuário
    // (2026-08-26). Só a frente "sem agendamento" entra aqui: quem exige agendamento tem seu
    // próprio card separado, sem sub-estatística de trânsito.
    const emTransito = abertasSemAgendamento.filter(r => r.prazoStatus === 'DENTRO_PRAZO');

    const total = records.length || 1;
    const percentual = (entregues.length / total) * 100;

    setKPI('kpi-entregues-count', entregues.length, Utils.formatNumber);
    setKPI('kpi-abertas-count', abertasSemAgendamento.length, Utils.formatNumber);
    setKPI('kpi-abertas-agendamento-count', abertasComAgendamento.length, Utils.formatNumber);
    setKPI('kpi-devolucao-count', devolucao.length, Utils.formatNumber);
    setKPI('kpi-cancelado-count', cancelado.length, Utils.formatNumber);
    setKPI('kpi-reentrega-count', totalOcorrenciasReentrega, Utils.formatNumber);
    setKPI('kpi-aguardando-count', aguardando.length, Utils.formatNumber);
    setKPI('kpi-em-transito-count', emTransito.length, Utils.formatNumber);
    setKPI('kpi-percentual', percentual, v => Utils.formatPercent(v, 1));
    setKPI('kpi-valor-entregues', Utils.sum(entregues, r => r.valorNF), Utils.formatCurrency);
    setKPI('kpi-valor-abertas', Utils.sum(abertasSemAgendamento, r => r.valorNF), Utils.formatCurrency);
    setKPI('kpi-valor-abertas-agendamento', Utils.sum(abertasComAgendamento, r => r.valorNF), Utils.formatCurrency);
    setKPI('kpi-valor-devolucao', Utils.sum(devolucao, r => r.valorNF), Utils.formatCurrency);
    setKPI('kpi-valor-cancelado', Utils.sum(cancelado, r => r.valorNF), Utils.formatCurrency);
    setKPI('kpi-valor-reentrega', Utils.sum(reentrega, r => r.valorNF), Utils.formatCurrency);
    setKPI('kpi-valor-aguardando', Utils.sum(aguardando, r => r.valorNF), Utils.formatCurrency);
    setKPI('kpi-valor-em-transito', Utils.sum(emTransito, r => r.valorNF), Utils.formatCurrency);

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
      options: {
        colors: ['#16A34A', '#64748B', '#EAB308', '#8B5CF6', '#0EA5E9', '#DC2626'],
        // Clicar num tile abre a mesma tela de detalhe que o card de KPI equivalente já abre
        // (pedido do usuário, 2026-08-19) — acha a chave comparando pelo título, já que os
        // labels do gráfico SÃO os STATUS_DETAIL_DEFS[k].title (ver renderStatusChart).
        onLegendClick: (label) => {
          const entry = Object.entries(STATUS_DETAIL_DEFS).find(([, def]) => def.title === label);
          if (entry) openStatusDetail(entry[0]);
        }
      }
    });
    charts.prazo = new DashChart(document.getElementById('chart-prazo'), {
      type: 'donut', labels: [], series: [{ data: [] }],
      options: { colors: ['#EAB308', '#DC2626', '#16A34A', '#64748B'] } // No Prazo, Atrasado, Entregue, Sem informação
    });
    charts.agendamento = new DashChart(document.getElementById('chart-agendamento'), {
      type: 'donut', labels: [], series: [{ data: [] }],
      // Agendado, Agendamento Vencido, Agendado Não Faturado, Sem etapa definida, Aguardando
      // Confirmação, Reagendar, Okker, Devolução p/ Terrinha (mesma ordem de
      // AGENDAMENTO_CATEGORIAS_EXIBICAO, cores batendo com os --kpi-accent dos tiles em index.html).
      // showLegend:false (pedido do usuário, 2026-08-28: "deixe só a Pizza") — os quadrados de
      // cada etapa agora são .kpi-card--mini ao lado da pizza (ver index.html), clicáveis via
      // data-detail/bindStatusDetail como qualquer outro KPI, não mais o tile-legend
      // auto-gerado pelo DashChart (por isso não há mais onLegendClick aqui).
      options: {
        colors: ['#2563EB', '#DC2626', '#14B8A6', '#EAB308', '#FF7A1A', '#DC2626', '#8B5CF6', '#0EA5E9'],
        showLegend: false
      }
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

    // ---------- Lead Time de Pedidos e Entregas (2026-08-23) ----------
    charts.ltpFaturamentoMensal = new DashChart(document.getElementById('chart-ltp-faturamento-mensal'), {
      type: 'line', labels: [], series: [{ name: 'Dias úteis', data: [], color: ChartPalette[0] }]
    });
    charts.ltpColetaMensal = new DashChart(document.getElementById('chart-ltp-coleta-mensal'), {
      type: 'line', labels: [], series: [{ name: 'Dias úteis', data: [], color: ChartPalette[1] }]
    });
    charts.ltpPrevistoVsRealizado = new DashChart(document.getElementById('chart-ltp-previsto-vs-realizado'), {
      type: 'hbar', labels: [],
      series: [
        { name: 'Previsto', data: [], color: ChartPalette[7] },
        { name: 'Realizado', data: [], color: ChartPalette[0] }
      ],
      options: { fullLabels: true }
    });
    charts.ltpPercentualPrazo = new DashChart(document.getElementById('chart-ltp-percentual-prazo'), {
      type: 'donut', labels: [], series: [{ data: [] }], options: { colors: ['#16A34A', '#DC2626'] } // dentro do prazo, fora do prazo
    });
    charts.ltpQtdPorEtapa = new DashChart(document.getElementById('chart-ltp-qtd-por-etapa'), {
      type: 'hbar', labels: [], series: [{ name: 'Pedidos', data: [], color: ChartPalette[4] }], options: { fullLabels: true }
    });
    charts.ltpPorCliente = new DashChart(document.getElementById('chart-ltp-por-cliente'), {
      type: 'hbar', labels: [], series: [{ name: '% dentro do prazo', data: [], color: ChartPalette[2] }], options: { fullLabels: true }
    });
    charts.ltpPorMotorista = new DashChart(document.getElementById('chart-ltp-por-motorista'), {
      type: 'hbar', labels: [], series: [{ name: '% dentro do prazo', data: [], color: ChartPalette[2] }], options: { fullLabels: true }
    });
    charts.ltpPorCidade = new DashChart(document.getElementById('chart-ltp-por-cidade'), {
      type: 'hbar', labels: [], series: [{ name: '% dentro do prazo', data: [], color: ChartPalette[2] }], options: { fullLabels: true }
    });
    charts.ltpEvolucaoCumprimento = new DashChart(document.getElementById('chart-ltp-evolucao-cumprimento'), {
      type: 'line', labels: [], series: [{ name: '% dentro do Lead Time', data: [], color: ChartPalette[2] }]
    });
  }

  function renderCharts(records) {
    renderStatusChart(records);
    renderPrazoChart(records);
    renderAgendamentoChart(records);
    renderAguardandoAgendamentoCard(records);
    renderPedidosNaoFaturadosCard();
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

  // "Reagendar" e "Devolução para Terrinha" removidas do gráfico/cards (pedido do usuário,
  const AGENDAMENTO_STATUS_CATEGORIAS = [
    'Agendado', 'Sem etapa definida', 'Aguardando Confirmação', 'Reagendar', 'Okker', 'Devolução para Terrinha'
  ];
  // Categorias de fato EXIBIDAS no gráfico/cards de "Situação de agendamento" — igual à lista
  // acima, só que com "Agendamento Vencido" e "Agendado Não Faturado" inseridas (pedidos do
  // usuário, 2026-08-29 e 2026-09-01). Lista SEPARADA de propósito: AGENDAMENTO_STATUS_CATEGORIAS
  // também alimenta o <select> de edição manual (renderAgendamentoEdicao) — nenhuma das duas é um
  // status que se ESCOLHE lá, são categorias CALCULADAS (Agendado + data já passada / Agendado
  // mas ainda sem NF), então não podem aparecer como opção selecionável nesse dropdown.
  const AGENDAMENTO_CATEGORIAS_EXIBICAO = [
    'Agendado', 'Agendamento Vencido', 'Agendado Não Faturado', 'Sem etapa definida', 'Aguardando Confirmação', 'Reagendar', 'Okker', 'Devolução para Terrinha'
  ];
  // As etapas abaixo são as únicas que representam um estágio de agendamento JÁ REGISTRADO
  // (valor bruto da coluna "Status" da planilha de Agendamentos — precisa bater EXATAMENTE
  // com esse texto, incluindo acento, senão a nota cai em "Sem etapa definida" por engano).
  // Qualquer nota da população (ver renderAgendamentoChart) que não tenha uma dessas cai em
  // "Sem etapa definida" por padrão.
  const AGENDAMENTO_ETAPAS_ESPECIFICAS = ['Agendado', 'Aguardando Confirmação', 'Reagendar', 'Okker', 'Devolução para Terrinha'];

  // Dropdown de Status na edição de "Pedidos Aguardando Faturamento" (pedido do usuário,
  // 2026-08-28) — mesmas etapas do agendamento de notas, MENOS "Reagendar"/"Devolução para
  // Terrinha": um pedido que ainda nem virou nota não pode ser "reagendado" (só agenda uma vez,
  // antes de faturar) nem "devolvido" (nunca chegou a sair). Lista própria, separada de
  // AGENDAMENTO_STATUS_CATEGORIAS de propósito — mesmo conjunto hoje, mas são domínios de
  // negócio diferentes e podem divergir no futuro.
  // "Sem Roteiro" adicionada em 2026-08-28: valor real que já vem da própria planilha (coluna
  // "Data agendamento" da aba "Pedido Não Faturados (Emissão)", ver indexPedidosNaoFaturados
  // em data.js) — sem essa entrada, um pedido com esse status apareceria com o dropdown de
  // edição sem nenhuma opção selecionada.
  const PEDIDOS_NAO_FATURADOS_STATUS_CATEGORIAS = ['Agendado', 'Sem etapa definida', 'Aguardando Confirmação', 'Okker', 'Sem Roteiro'];

  /** Mapeia o statusAgendamento de um PEDIDO (Pedidos Aguardando Faturamento) pra qual fatia
   * do gráfico "Situação de agendamento" ele soma junto (pedido do usuário, 2026-08-28:
   * "Aguardando Confirmação" conta com os demais que já têm esse status; "Sem Roteiro" conta
   * como "Sem etapa definida" — não é uma fatia própria da pizza, só do dropdown de edição de
   * pedidos). Vazio ou qualquer status desconhecido cai em "Sem etapa definida" por padrão,
   * mesma regra já usada pras notas (ver AGENDAMENTO_ETAPAS_ESPECIFICAS acima). */
  function categoriaAgendamentoParaPedido(statusAgendamento, dataAgendamento) {
    // "Entrega Direta" (novo valor na coluna, 2026-08-29) significa que o pedido NÃO precisa
    // de agendamento — sai direto. Por isso não conta em nenhuma fatia da pizza (mesma lógica
    // de necessitaAgendamento:false pras notas normais, que também ficam de fora do gráfico).
    if (statusAgendamento === 'Entrega Direta') return null;
    if (statusAgendamento === 'Sem Roteiro') return 'Sem etapa definida';
    // Pedido do usuário (2026-09-01): pedido com data de agendamento marcada tem sua PRÓPRIA
    // fatia ("Agendado Não Faturado"), separada de 'Agendado'/'Agendamento Vencido' — essas duas
    // agora são só de NOTAS já faturadas (ver renderAgendamentoChart/STATUS_DETAIL_DEFS). Um
    // pedido nunca vira "Agendamento Vencido": ele conta aqui igual, tenha a data passado ou não
    // — ela só pediu "todos os Pedidos que estão com data de agendamento" numa fatia só.
    if (statusAgendamento === 'Agendado') return 'Agendado Não Faturado';
    if (AGENDAMENTO_STATUS_CATEGORIAS.includes(statusAgendamento)) return statusAgendamento;
    return 'Sem etapa definida';
  }

  /** Situação de agendamento: só entram notas que realmente "Obriga Agendamento" e estão "Em
   * aberto" (mesma população do card "Aguardando agendamento", ver STATUS_DETAIL_DEFS —
   * decisão do usuário, 2026-08-17), quebradas pelas etapas já registradas na planilha de
   * Agendamentos. As outras 4 fatias (Agendado/Aguardando Confirmação/Reagendar/Okker) mostram
   * quem já avançou além do card, mas continua "Em aberto" aguardando a entrega de fato.
   * "Sem etapa definida" (fatia "Sem roteiro/ sem agendamento") NÃO leva nota nenhuma (pedido
   * do usuário, 2026-08-30: "o pedido ja foi faturado então ele nao esta SEM ROTEIRO") — uma
   * nota só existe depois de faturada, ou seja, JÁ TEM roteiro; uma nota sem etapa registrada só
   * conta no card "Aguardando Agendamento" à parte (STATUS_DETAIL_DEFS['aguardando']), nunca
   * nessa fatia. Só os Pedidos Aguardando Faturamento sem roteiro de verdade (ver
   * categoriaAgendamentoParaPedido logo abaixo) alimentam "Sem etapa definida" agora. */
  function renderAgendamentoChart(records) {
    const counts = Object.fromEntries(AGENDAMENTO_CATEGORIAS_EXIBICAO.map(c => [c, 0]));
    // Valor NF somado por etapa — os quadrados ao lado da pizza mostram esse total em R$ como
    // subvalor (a % continua só dentro da própria pizza).
    const valores = Object.fromEntries(AGENDAMENTO_CATEGORIAS_EXIBICAO.map(c => [c, 0]));
    records.forEach(r => {
      if (!r.necessitaAgendamento || !situacaoElegivelParaAgendamento(r.situacao)) return;
      // Nota sem nenhuma etapa registrada NÃO entra em "Sem etapa definida" (essa fatia é só
      // pedidos sem roteiro, ver comentário acima) — fica de fora da pizza, só conta no card
      // "Aguardando Agendamento" à parte (renderAguardandoAgendamentoCard).
      if (!AGENDAMENTO_ETAPAS_ESPECIFICAS.includes(r.statusAgendamento)) return;
      let categoria = r.statusAgendamento;
      // "Agendado" cuja data já passou sai dessa categoria e vira "Agendamento Vencido" (pedido
      // do usuário, 2026-08-29).
      if (categoria === 'Agendado' && agendamentoVencido(r.dataAgendamento)) categoria = 'Agendamento Vencido';
      counts[categoria]++;
      valores[categoria] += r.valorNF || 0;
    });
    // Pedidos Aguardando Faturamento somam nas MESMAS fatias (pedido do usuário, 2026-08-28) —
    // só quando não há filtro ativo. Essa base não tem Transportadora/Status/etc. pra cruzar
    // com os filtros da barra lateral (ver getPedidosNaoFaturadosStats) — com um filtro ativo,
    // sempre somar os mesmos 469 pedidos (que não encolhem com o filtro) desvirtuaria a leitura
    // do gráfico pro recorte que a usuária escolheu.
    if (!algumFiltroAtivo()) {
      DataStore.getPedidosNaoFaturados().forEach(p => {
        const categoria = categoriaAgendamentoParaPedido(p.statusAgendamento, p.dataAgendamento);
        // "Entrega Direta" (categoria null) não precisa de agendamento — fica de fora da pizza.
        if (!categoria) return;
        counts[categoria]++;
        valores[categoria] += p.valorPedido || 0;
      });
    }
    // "Sem etapa definida" continua sendo a CHAVE interna da categoria (counts/valores,
    // AGENDAMENTO_LABEL_PARA_TILE_ID, categoriaAgendamentoParaPedido etc. — não é seguro renomear
    // isso tudo), só o texto que a pizza mostra no hover é trocado aqui (pedido do usuário,
    // 2026-08-29: renomear só o rótulo visível do card/fatia, não a lógica).
    const AGENDAMENTO_LABEL_EXIBICAO = { 'Sem etapa definida': 'Sem roteiro/ sem agendamento' };
    charts.agendamento.update({
      labels: AGENDAMENTO_CATEGORIAS_EXIBICAO.map(c => AGENDAMENTO_LABEL_EXIBICAO[c] || c),
      series: [{ data: AGENDAMENTO_CATEGORIAS_EXIBICAO.map(c => counts[c]) }]
    });
    // Pizza fica sozinha (showLegend:false, ver createCharts) — quem mostra os números agora
    // são os .kpi-card--mini ao lado (mesmo modelo dos KPIs do topo: contagem grande, valor em
    // R$ como subvalor), atualizados aqui direto a partir do mesmo counts/valores que alimenta
    // a pizza, pra nunca divergir dela.
    AGENDAMENTO_CATEGORIAS_EXIBICAO.forEach(c => {
      const slug = AGENDAMENTO_LABEL_PARA_TILE_ID[c];
      if (!slug) return;
      const elCount = document.getElementById(`agendamento-tile-${slug}-count`);
      const elValor = document.getElementById(`agendamento-tile-${slug}-valor`);
      if (elCount) elCount.textContent = Utils.formatNumber(counts[c]);
      if (elValor) elValor.textContent = Utils.formatCurrency(valores[c]);
    });
  }

  /** Card extra "Aguardando Agendamento" dentro de "Situação de agendamento" (pedido do
   * usuário, 2026-08-28 — "inclui o Aguardando Agendamento"). Mesmo critério EXATO do card de
   * KPI "Aguardando agendamento" no topo do dashboard (STATUS_DETAIL_DEFS['aguardando']) — só
   * reaproveita esse teste, não inventa um novo, pra nunca divergir do card original. Clicável
   * (data-detail="aguardando" no HTML, ver bindStatusDetail) — abre a MESMA tela de edição que
   * o card de KPI já abre, não uma nova. */
  function renderAguardandoAgendamentoCard(records) {
    const notas = records.filter(STATUS_DETAIL_DEFS['aguardando'].test);
    const elValor = document.getElementById('aguardando-agendamento-valor');
    const elQtd = document.getElementById('aguardando-agendamento-quantidade');
    if (elValor) elValor.textContent = Utils.formatCurrency(Utils.sum(notas, r => r.valorNF));
    // Contagem "pelada" (sem sufixo "notas"), mesmo modelo dos demais .kpi-card--mini ao lado
    // da pizza (pedido do usuário, 2026-08-28) — o rótulo do card já diz o que está contando.
    if (elQtd) elQtd.textContent = Utils.formatNumber(notas.length);
  }

  /** Card "Pedidos Aguardando Faturamento" (pedido do usuário, 2026-08-27) — não é uma fatia
   * do donut "Situação de agendamento" (fonte de dados totalmente separada, sem NF/cruzamento
   * com rawRecords, ver getPedidosNaoFaturadosStats em data.js), só um quadrado extra dentro
   * do mesmo card, no mesmo formato visual dos outros. Valor fixo (não reage aos filtros da
   * barra lateral) — essa base não tem Transportadora/Status/etc. pra cruzar com eles. */
  function renderPedidosNaoFaturadosCard() {
    const stats = DataStore.getPedidosNaoFaturadosStats();
    const elValor = document.getElementById('pedidos-nao-faturados-valor');
    const elQtd = document.getElementById('pedidos-nao-faturados-quantidade');
    if (elValor) elValor.textContent = Utils.formatCurrency(stats.valorTotal);
    // Contagem "pelada" (sem sufixo "pedidos"), mesmo modelo dos demais .kpi-card--mini ao
    // lado da pizza (pedido do usuário, 2026-08-28) — o rótulo do card já diz o que conta.
    if (elQtd) elQtd.textContent = Utils.formatNumber(stats.quantidade);

    // Split "Sem agendamento" (Entrega Direta) vs "Com agendamento" (qualquer outro valor da
    // coluna) — pedido do usuário (2026-08-29), depois que a planilha ganhou o valor "Entrega
    // Direta": esses pedidos saem direto, sem passar pela etapa de agendamento; os demais
    // (data real, Aguardando Confirmação, Sem Roteiro) ainda dependem dela.
    const pedidos = DataStore.getPedidosNaoFaturados();
    const semAgendamento = pedidos.filter(p => p.statusAgendamento === 'Entrega Direta');
    const comAgendamento = pedidos.filter(p => p.statusAgendamento !== 'Entrega Direta');
    const setTile = (prefixo, lista) => {
      const elQtdSplit = document.getElementById(`${prefixo}-quantidade`);
      const elValorSplit = document.getElementById(`${prefixo}-valor`);
      if (elQtdSplit) elQtdSplit.textContent = Utils.formatNumber(lista.length);
      if (elValorSplit) elValorSplit.textContent = Utils.formatCurrency(Utils.sum(lista, p => p.valorPedido));
    };
    setTile('pedidos-nao-faturados-sem-agendamento', semAgendamento);
    setTile('pedidos-nao-faturados-com-agendamento', comAgendamento);
  }

  function rowHtmlPedidosNaoFaturados(p) {
    const ativo = pedidoSelecionadoParaEdicao === p.numeroPedido;
    // Situação de agendamento (coluna "Data Agendamento" da planilha, ver indexPedidosNaoFaturados
    // em data.js): "Agendado" mostra a data; qualquer outro status ("Aguardando Confirmação",
    // "Sem Roteiro", ou o que a usuária editou manualmente no site) mostra o texto direto.
    const situacaoAgendamento = p.statusAgendamento === 'Agendado'
      ? Utils.formatDate(p.dataAgendamento)
      : (p.statusAgendamento || '—');
    return `
      <tr>
        <td><button type="button" class="nf-link${ativo ? ' nf-link--ativo' : ''}" data-pedido-edicao="${escapeAttr(p.numeroPedido)}" title="Editar este pedido">${escapeAttr(p.numeroPedido)}</button></td>
        <td class="truncate" title="${escapeAttr(p.cliente)}">${escapeAttr(p.cliente)}</td>
        <td class="truncate" title="${escapeAttr(p.grupoEconomico)}">${escapeAttr(p.grupoEconomico)}</td>
        <td>${Utils.formatDate(p.dataEmissao)}</td>
        <td class="text-right">${Utils.formatCurrency(p.valorPedido)}</td>
        <td class="text-right">${Utils.formatNumber(p.qtdePedido)}</td>
        <td class="truncate" title="${escapeAttr(situacaoAgendamento)}">${escapeAttr(situacaoAgendamento)}</td>
      </tr>
    `;
  }

  /** Busca própria dessa tela (mesmo padrão da busca do status-detail-view) — não reage aos
   * filtros da barra lateral (ver comentário em getPedidosNaoFaturadosStats, data.js). Aplica
   * primeiro o filtro de categoria (qual quadrado abriu a tela, ver pedidosNaoFaturadosCategoria)
   * — mesmo critério exato do card, pra nunca divergir dele. */
  function pedidosNaoFaturadosFiltrados() {
    let lista = DataStore.getPedidosNaoFaturados();
    if (pedidosNaoFaturadosCategoria === 'sem-agendamento') {
      lista = lista.filter(p => p.statusAgendamento === 'Entrega Direta');
    } else if (pedidosNaoFaturadosCategoria === 'com-agendamento') {
      lista = lista.filter(p => p.statusAgendamento !== 'Entrega Direta');
    }
    if (!pedidosNaoFaturadosBusca) return lista;
    const termo = pedidosNaoFaturadosBusca.toLowerCase();
    return lista.filter(p =>
      p.numeroPedido.toLowerCase().includes(termo) ||
      p.cliente.toLowerCase().includes(termo) ||
      p.grupoEconomico.toLowerCase().includes(termo)
    );
  }

  // Rótulos alinhados aos mini-cards de "Situação de agendamento" (renomeados 2026-09-01, pedido
  // do usuário: "Pedidos Aguard. Fatur. S/C Agendamento" -> "Pedidos Sem/Com Agendamento") — pra
  // não ter um texto no card e outro na tela que abre ao clicar nele.
  const PEDIDOS_NAO_FATURADOS_TITULO_POR_CATEGORIA = {
    'sem-agendamento': 'Pedidos Sem Agendamento (Entrega Direta)',
    'com-agendamento': 'Pedidos Com Agendamento'
  };

  /** No-op se a tela não estiver visível — mesmo padrão de renderRegistroDinamico/renderLeadTime. */
  function renderPedidosNaoFaturadosView() {
    const view = document.getElementById('pedidos-nao-faturados-view');
    if (!view || view.hidden) return;
    const registros = pedidosNaoFaturadosFiltrados();
    const titulo = document.getElementById('pedidos-nao-faturados-titulo');
    if (titulo) {
      const base = PEDIDOS_NAO_FATURADOS_TITULO_POR_CATEGORIA[pedidosNaoFaturadosCategoria] || 'Pedidos Aguardando Faturamento';
      titulo.textContent = `${base} (${Utils.formatNumber(registros.length)})`;
    }
    renderTableGeneric(registros, pedidosNaoFaturadosTable, PEDIDOS_NAO_FATURADOS_TABLE_IDS, rowHtmlPedidosNaoFaturados);
  }

  /** Abre a tela de detalhe (mesmo "jeito" do status-detail-view, pedido do usuário
   * 2026-08-28) — fecha qualquer outra tela alternativa aberta antes, pra nunca ter duas
   * visíveis ao mesmo tempo (mesma exclusividade mútua de mostrarViewMapaRegioes/openStatusDetail).
   * `categoria` (opcional): 'sem-agendamento'/'com-agendamento' quando veio de um dos 2
   * quadrados de split, ou null/undefined quando veio do card combinado do topo (mostra tudo) —
   * ver pedidosNaoFaturadosFiltrados/PEDIDOS_NAO_FATURADOS_TITULO_POR_CATEGORIA. */
  function abrirPedidosNaoFaturadosView(categoria = null) {
    closeStatusDetail();
    mostrarViewMapaRegioes('registros');
    pedidosNaoFaturadosCategoria = categoria;
    pedidosNaoFaturadosTable.page = 1;
    pedidosNaoFaturadosBusca = '';
    pedidoSelecionadoParaEdicao = null;
    const buscaInput = document.getElementById('pedidos-nao-faturados-table-search');
    if (buscaInput) buscaInput.value = '';
    document.getElementById('main-view').hidden = true;
    document.getElementById('pedidos-nao-faturados-view').hidden = false;
    renderPedidosNaoFaturadosView();
    renderPedidosNaoFaturadosEdicao();
    atualizarBotaoIrInicio();
  }

  function fecharPedidosNaoFaturadosView() {
    const view = document.getElementById('pedidos-nao-faturados-view');
    if (view) view.hidden = true;
    pedidoSelecionadoParaEdicao = null;
    document.getElementById('main-view').hidden = false;
    atualizarBotaoIrInicio();
  }

  /** Painel de edição de UM pedido (mesmo modelo Firestore/visual de renderAgendamentoEdicao,
   * ver detail-agendamento-section) — pedido do usuário 2026-08-28. Diferente daquele, mostra
   * só o pedido clicado por vez (não a lista inteira), porque aqui a ação é "clicar no Número
   * do Pedido", não "abrir uma tela já cheia de linhas editáveis". */
  function renderPedidosNaoFaturadosEdicao() {
    const section = document.getElementById('pedidos-nao-faturados-edicao-section');
    if (!pedidoSelecionadoParaEdicao) { section.hidden = true; return; }
    const pedido = DataStore.getPedidosNaoFaturados().find(p => p.numeroPedido === pedidoSelecionadoParaEdicao);
    if (!pedido) { section.hidden = true; pedidoSelecionadoParaEdicao = null; return; }
    section.hidden = false;

    const admin = isAdminAgendamento();
    document.getElementById('pedidos-nao-faturados-edicao-titulo').textContent = `Editar pedido ${pedido.numeroPedido}`;
    document.getElementById('pedidos-nao-faturados-edicao-hint').textContent = admin
      ? 'Preencha ou altere o status e a data de agendamento desse pedido — salva direto aqui, sem precisar de planilha.'
      : 'Situação de agendamento do pedido (só o usuário responsável pode editar).';

    const list = document.getElementById('pedidos-nao-faturados-edicao-list');
    const statusAtual = pedido.statusAgendamento || '';
    const dataAtual = formatDateParaInput(pedido.dataAgendamento);
    const observacaoAtual = pedido.observacao || '';

    if (!admin) {
      list.innerHTML = `
        <div class="agendamento-row">
          <span class="agendamento-row__nf">${escapeAttr(pedido.numeroPedido)}</span>
          <span class="agendamento-row__cliente" title="${escapeAttr(pedido.cliente)}">${escapeAttr(pedido.cliente)}</span>
          <span class="agendamento-row__status--somente-leitura">${escapeAttr(statusAtual || 'Sem informação')}</span>
          <span class="agendamento-row__status--somente-leitura">${dataAtual ? Utils.formatDate(pedido.dataAgendamento) : '—'}</span>
          <span class="agendamento-row__observacao--somente-leitura" title="${escapeAttr(observacaoAtual)}">${escapeAttr(observacaoAtual || '—')}</span>
          <span></span>
        </div>
      `;
      return;
    }

    const opcoes = PEDIDOS_NAO_FATURADOS_STATUS_CATEGORIAS.map(cat =>
      `<option value="${escapeAttr(cat)}"${cat === statusAtual ? ' selected' : ''}>${escapeAttr(cat)}</option>`
    ).join('');
    list.innerHTML = `
      <div class="agendamento-row" data-pedido="${escapeAttr(pedido.numeroPedido)}">
        <span class="agendamento-row__nf">${escapeAttr(pedido.numeroPedido)}</span>
        <span class="agendamento-row__cliente" title="${escapeAttr(pedido.cliente)}">${escapeAttr(pedido.cliente)}</span>
        <select class="agendamento-row__status-select">
          <option value=""${statusAtual ? '' : ' selected'}>Sem informação</option>
          ${opcoes}
        </select>
        <input type="date" class="agendamento-row__data-input" value="${dataAtual}">
        <input type="text" class="agendamento-row__observacao-input" placeholder="Observação (opcional)" value="${escapeAttr(observacaoAtual)}">
        <button type="button" class="btn agendamento-row__salvar">Salvar</button>
      </div>
    `;
  }

  /** Clicar no pedido já selecionado fecha o painel de novo (alterna); clicar noutro troca
   * direto, sem precisar fechar antes — mesmo padrão já usado em vários outros drill-downs. */
  function abrirEdicaoPedido(numeroPedido) {
    pedidoSelecionadoParaEdicao = pedidoSelecionadoParaEdicao === numeroPedido ? null : numeroPedido;
    renderPedidosNaoFaturadosView();
    renderPedidosNaoFaturadosEdicao();
    if (pedidoSelecionadoParaEdicao) {
      document.getElementById('pedidos-nao-faturados-edicao-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function bindPedidosNaoFaturadosView() {
    // KPI de topo (total combinado) abre tudo; os 2 quadrados de split (Sem/Com agendamento,
    // dentro da pizza "Situação de agendamento") agora filtram pra mostrar só a categoria
    // certa — pedido do usuário (2026-08-29): "S/ Agendamento" tem que mostrar só "Entrega
    // Direta", não a lista inteira.
    const gatilhos = {
      'tile-pedidos-nao-faturados': null,
      'tile-pedidos-nao-faturados-sem-agendamento': 'sem-agendamento',
      'tile-pedidos-nao-faturados-com-agendamento': 'com-agendamento'
    };
    Object.entries(gatilhos).forEach(([id, categoria]) => {
      const tile = document.getElementById(id);
      if (tile) tile.addEventListener('click', () => abrirPedidosNaoFaturadosView(categoria));
    });

    const botaoVoltar = document.getElementById('btn-back-pedidos-nao-faturados');
    if (botaoVoltar) botaoVoltar.addEventListener('click', fecharPedidosNaoFaturadosView);

    bindTableControlsFor(pedidosNaoFaturadosTable, PEDIDOS_NAO_FATURADOS_TABLE_IDS,
      pedidosNaoFaturadosFiltrados, rowHtmlPedidosNaoFaturados);

    // Delegado no body (tabela é reconstruída a cada render) — clicar no Número do Pedido
    // abre/fecha o painel de edição dele (pedido do usuário, 2026-08-28).
    document.getElementById('pedidos-nao-faturados-table-body').addEventListener('click', (e) => {
      const botao = e.target.closest('[data-pedido-edicao]');
      if (botao) abrirEdicaoPedido(botao.dataset.pedidoEdicao);
    });

    document.getElementById('pedidos-nao-faturados-edicao-list').addEventListener('click', async (e) => {
      const botao = e.target.closest('.agendamento-row__salvar');
      if (!botao) return;
      const linha = botao.closest('.agendamento-row');
      const numeroPedido = linha.dataset.pedido;
      let status = linha.querySelector('.agendamento-row__status-select').value;
      const data = linha.querySelector('.agendamento-row__data-input').value;
      const observacao = linha.querySelector('.agendamento-row__observacao-input').value.trim();

      // Mesmo comportamento já usado no agendamento de notas (2026-08-19): preencher só a
      // data, sem escolher status, já sobe pra "Agendado" sozinho.
      if (!status && data) status = 'Agendado';

      botao.disabled = true;
      botao.textContent = 'Salvando...';
      try {
        const fb = await new Promise((resolve) => {
          if (window.Firebase) return resolve(window.Firebase);
          window.addEventListener('firebase-ready', () => resolve(window.Firebase), { once: true });
        });
        await fb.salvarAgendamentoManualPedido(numeroPedido, status, data, observacao);
        DataStore.applyAgendamentoManual({ [`pedido-${numeroPedido}`]: { statusAgendamento: status, dataAgendamento: data, observacao } });
        Utils.showToast(`Pedido ${numeroPedido}: agendamento salvo.`, 'success', 2500);
        renderPedidosNaoFaturadosView();
        renderPedidosNaoFaturadosEdicao();
      } catch (err) {
        Utils.showToast(err.message || 'Falha ao salvar o agendamento.', 'error', 5000);
        botao.disabled = false;
        botao.textContent = 'Salvar';
      }
    });

    const buscaHandler = Utils.debounce((value) => {
      pedidosNaoFaturadosBusca = value;
      pedidosNaoFaturadosTable.page = 1;
      renderPedidosNaoFaturadosView();
    }, 250);
    const buscaInput = document.getElementById('pedidos-nao-faturados-table-search');
    if (buscaInput) buscaInput.addEventListener('input', (e) => buscaHandler(e.target.value));
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
    // Usado só pelo ranking "melhores" (Entregues/Devolvidos) — o "piores" agora usa só
    // `reentregas`, ver abaixo.
    const entries = Array.from(grouped.entries())
      .map(([name, items]) => {
        const total = items.length;
        const entregues = items.filter(r => r.status === 'ENTREGUE').length;
        const devolvidos = items.filter(r => r.situacao === 'Devolução' || r.situacao === 'Reentrega' || r.situacao === 'Cancelado').length;
        // Total de VEZES que uma nota dessa transportadora passou por Reentrega (todas as
        // tentativas históricas, não só quem está reentrega agora — ver qtdReentregas em
        // data.js/2026-08-28). Pedido do usuário: "Ranking dos 15 que voltam com entrega" deve
        // contar SÓ reentrega, nunca Devolução/Cancelado — esses dois são problema interno
        // (fiscal, comercial, etc.), não erro do motorista; reentrega é a única situação que
        // pode de fato ser atribuída a quem dirigiu.
        const reentregas = Utils.sum(items, r => r.qtdReentregas || 0);
        return { name, total, entregues, devolvidos, reentregas, taxa: entregues / total };
      })
      .filter(e => e.total >= 3);

    // "Melhores" continua ordenado por taxa de entrega (Entregues/Devolvidos) — não mudou.
    const melhores = entries.slice()
      .sort((a, b) => b.taxa - a.taxa)
      .slice(0, QUANTIDADE)
      .sort((a, b) => b.entregues - a.entregues);

    // "Piores" (Ranking dos 15 que voltam com entrega) agora ordena por total de reentregas,
    // não mais por taxa de entrega — pedido do usuário (2026-08-28).
    const piores = entries.slice()
      .sort((a, b) => b.reentregas - a.reentregas)
      .slice(0, QUANTIDADE);

    // Ao passar o mouse em qualquer uma das barras (Entregues ou Devolvidos), o tooltip mostra
    // também o total de notas que saíram e o % de entrega dessa transportadora — pedido do
    // usuário (2026-08-28), pra ver o quadro completo sem precisar abrir outra tela.
    const extraTooltipMelhores = melhores.map(e => [
      `Saiu para entrega: ${Utils.formatNumber(e.total)}`,
      `Retornou (Devolução/Reentrega/Cancelado): ${Utils.formatNumber(e.devolvidos)}`,
      `% de entrega: ${(e.taxa * 100).toFixed(1)}%`
    ]);
    // Só a barra "Entregues" — pedido do usuário (2026-08-28): "Devolvidos" foi removida
    // porque o título do gráfico já é "sem Devolução" (os 15 melhores por taxa de entrega
    // naturalmente têm 0 ou quase 0 devolvidos, a barra vermelha não aparecia de verdade).
    charts.rankingTransportadorasMelhores.update({
      labels: melhores.map(e => e.name),
      series: [
        { name: 'Entregues', data: melhores.map(e => e.entregues), color: '#16A34A', tooltipExtra: extraTooltipMelhores }
      ]
    });

    // Mesmo aviso de tooltip do gráfico "melhores" acima, mas com "Reentregou" no lugar de
    // "Retornou" (pedido do usuário, 2026-08-28 — ela testou passando o mouse na barra vermelha
    // desse gráfico especificamente esperando essas mesmas informações extras).
    const extraTooltipPiores = piores.map(e => [
      `Saiu para entrega: ${Utils.formatNumber(e.total)}`,
      `Reentregou (todas as tentativas): ${Utils.formatNumber(e.reentregas)}`,
      `% de entrega: ${(e.taxa * 100).toFixed(1)}%`
    ]);
    charts.rankingTransportadorasPiores.update({
      labels: piores.map(e => e.name),
      series: [{ name: 'Reentregas', data: piores.map(e => e.reentregas), color: '#DC2626', tooltipExtra: extraTooltipPiores }]
    });
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

  /** `incluirColunasNovas` fica false só pra tabela de detalhe (drill-down de KPI,
   * #detail-data-table via DETAIL_TABLE_IDS) — ela compartilha esse mesmo renderizador mas não
   * tem o mecanismo de mostrar/ocultar coluna (nem cabeçalho pras 8 colunas novas), então
   * incluir essas células ali sairia sem rótulo e desalinhado. */
  function rowHtml(r, incluirColunasNovas = true, observacaoClicavel = false) {
    // Verde quando a NF já tem canhoto indexado (pasta do SharePoint), laranja quando não tem
    // — só uma consulta O(1) no Map já carregado em memória, sem custo perceptível por linha.
    const temCanhoto = canhotosIndex.has(r.nf.split('-')[0]);
    // Coluna Observação clicável (2026-08-30, pedido do usuário: "mesma opção que tem no
    // Registro Dinâmico") — só na tabela "Registros detalhados" (rowHtmlComSelecao passa true);
    // a tela de detalhe/drill-down continua com o texto simples de sempre (observacaoClicavel
    // fica false por padrão), pra não interferir no painel de edição em massa dela
    // (renderObservacaoEdicao/OBSERVACAO_EDICAO_DETAIL_KEYS).
    const nfBaseObservacao = r.nf ? r.nf.split('-')[0] : '';
    const observacaoHtml = observacaoClicavel
      ? `<button type="button" class="nf-link${registrosDetalhadosObservacaoNf === nfBaseObservacao ? ' nf-link--ativo' : ''}" data-observacao-edicao-principal="${escapeAttr(nfBaseObservacao)}">${escapeAttr(r.observacaoAgendamento || 'Adicionar observação')}</button>`
      : escapeAttr(r.observacaoAgendamento || '—');
    const colunasNovasHtml = !incluirColunasNovas ? '' : `
        <td class="truncate" title="${escapeAttr(r.filial)}">${escapeAttr(r.filial || '—')}</td>
        <td>${escapeAttr(r.codigoCliente || '—')}</td>
        <td>${escapeAttr(r.telefone || '—')}</td>
        <td>${Utils.formatDate(r.dataCriacao)}</td>
        <td>${Utils.formatDate(r.dataEntregaNF)}</td>
        <td>${escapeAttr(r.numeroPedidoEcommerce || '—')}</td>
        <td>${Utils.formatDate(r.dataFaturamento)}</td>
        <td>${escapeAttr(r.numeroFatura || '—')}</td>`;
    // Pedido ainda sem nota (ver pedidoParaRegistroDetalhe) chega aqui com nf === '' — mostra
    // travessão em vez de um botão de canhoto vazio/clicável sem função nenhuma.
    const nfHtml = r.nf
      ? `<button type="button" class="nf-link${temCanhoto ? ' nf-link--tem-canhoto' : ''}" data-nf="${escapeAttr(r.nf)}" title="Buscar canhoto de entrega">${escapeAttr(r.nf)}</button>`
      : '—';
    return `
      <tr>
        <td>${nfHtml}</td>
        <td>${escapeAttr(r.numeroPedido || '—')}</td>
        <td class="truncate" title="${escapeAttr(r.cliente)}">${escapeAttr(r.cliente)}</td>
        <td class="truncate" title="${escapeAttr(r.transportadora)}">${escapeAttr(r.transportadora)}</td>
        <td class="truncate" title="${escapeAttr(r.motorista)}">${escapeAttr(r.motorista)}</td>
        <td>${escapeAttr(r.vendedor)}</td>
        <td>${escapeAttr(r.cidade)}${r.uf ? '/' + escapeAttr(r.uf) : ''}</td>
        <td><span class="badge ${statusExibicaoBadgeClass(r)}">${statusExibicaoLabel(r)}</span></td>
        <td><span class="badge ${prazoBadgeClass(r.prazoStatus)}">${prazoLabel(r.prazoStatus)}</span></td>
        <td>${r.situacao === 'NF Não encontrada' ? `<span class="badge badge--neutral">${escapeAttr(r.situacao)}</span>` : escapeAttr(r.situacao)}</td>
        <td>${escapeAttr(r.statusAgendamento || '—')}</td>
        <td class="text-right">${Utils.formatCurrency(r.valorNF)}</td>
        <td>${Utils.formatDate(r.dataEntrega)}</td>
        <td>${Utils.formatDate(r.dataAgendamento)}</td>
        <td class="truncate" title="${escapeAttr(r.observacaoAgendamento || '')}">${observacaoHtml}</td>${colunasNovasHtml}
      </tr>
    `;
  }

  /** Linha da tabela PRINCIPAL, com a coluna extra de checkbox na frente (2026-08-30, "Enviar
   * Ocorrência") — reaproveita rowHtml() sem alterar ele (a tela de detalhe/drill-down, que
   * também usa rowHtml, continua sem checkbox — esse recurso é só da tabela "Registros
   * detalhados"). Só injeta um <td> a mais logo depois do <tr> de abertura. Observação clicável
   * (3º parâmetro true) também é exclusiva dessa tabela, mesmo motivo. */
  function rowHtmlComSelecao(r) {
    const marcado = notasSelecionadas.has(r.nf) ? ' checked' : '';
    const checkboxHtml = `<td class="col-checkbox"><input type="checkbox" class="row-select-checkbox" data-nf="${escapeAttr(r.nf)}"${marcado}></td>`;
    return rowHtml(r, true, true).replace('<tr>', `<tr>${checkboxHtml}`);
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

  function inicioDoDia(data) {
    const d = new Date(data);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function fimDoDia(data) {
    const d = new Date(data);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  /** Intervalo [início, fim] do período escolhido na barra "Ocorrências do Dia" — Semana/Mês
   * contam "até hoje" (semana atual desde segunda-feira, mês atual desde o dia 1), não uma
   * janela rolante de N dias — mesma convenção de "período até hoje" de relatório de BI. */
  function periodoOcorrenciasDoDia(periodo) {
    const hoje = inicioDoDia(new Date());
    if (periodo === 'ontem') {
      const ontem = new Date(hoje);
      ontem.setDate(ontem.getDate() - 1);
      return [ontem, fimDoDia(ontem)];
    }
    if (periodo === 'semana') {
      const inicioSemana = new Date(hoje);
      const diaSemana = inicioSemana.getDay(); // 0=domingo..6=sábado
      inicioSemana.setDate(inicioSemana.getDate() - (diaSemana === 0 ? 6 : diaSemana - 1));
      return [inicioSemana, fimDoDia(hoje)];
    }
    if (periodo === 'mes') {
      return [new Date(hoje.getFullYear(), hoje.getMonth(), 1), fimDoDia(hoje)];
    }
    return [hoje, fimDoDia(hoje)]; // 'hoje' (padrão)
  }

  function rotuloPeriodoOcorrencias(periodo) {
    return { ontem: 'Ontem', hoje: 'Hoje', semana: 'Semana', mes: 'Mês' }[periodo] || 'Hoje';
  }

  /** Filtro da tela "Ocorrências do Dia" (pedido do usuário, 2026-08-31): Data Coleta
   * (r.dataEntrega) dentro do período escolhido + a nota já ter uma Observação preenchida —
   * reaproveita o mesmo campo já editável na própria coluna Observação da tabela (ver
   * bindObservacaoEdicaoPrincipal), não cria nenhum dado/coleção novo. Passthrough (devolve
   * `records` sem alterar) quando o modo não está ativo, pra poder aplicar incondicionalmente
   * em qualquer lugar que já use DataStore.getFilteredRecords() pra essa tabela. */
  function aplicarFiltroOcorrenciasDoDia(records) {
    if (!modoOcorrenciasAtivo) return records;
    const [inicio, fim] = periodoOcorrenciasDoDia(ocorrenciasDoDiaPeriodo);
    return records.filter(r =>
      (r.observacaoAgendamento || '').trim() &&
      r.dataEntrega && r.dataEntrega.getTime() >= inicio.getTime() && r.dataEntrega.getTime() <= fim.getTime()
    );
  }

  /** Nome do Excel exportado — inclui o período quando "Ocorrências do Dia" está ativo, pra ela
   * já saber o que é o arquivo quando for anexar no relatório da diretoria. */
  function nomeArquivoExportacao() {
    if (!modoOcorrenciasAtivo) return 'dashboard-entregas.xlsx';
    const hoje = new Date();
    const slug = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    return `ocorrencias-${ocorrenciasDoDiaPeriodo}-${slug}.xlsx`;
  }

  /** Liga os 4 botões de período (Ontem/Hoje/Semana/Mês) da barra que só aparece na tela
   * "Ocorrências do Dia" (ver mostrarViewMapaRegioes). */
  function bindOcorrenciasDoDia() {
    const barra = document.getElementById('ocorrencias-periodo-bar');
    if (!barra) return;
    barra.querySelectorAll('.ocorrencias-periodo-btn').forEach(botao => {
      botao.addEventListener('click', () => {
        ocorrenciasDoDiaPeriodo = botao.dataset.periodo;
        barra.querySelectorAll('.ocorrencias-periodo-btn').forEach(b => b.classList.toggle('ocorrencias-periodo-btn--ativo', b === botao));
        table.page = 1;
        renderTable(DataStore.getFilteredRecords());
      });
    });
  }

  function renderTable(records) {
    // Aplica o filtro de "Ocorrências do Dia" por cima do recorte filtrado normal (é passthrough
    // quando o modo não está ativo) — ANTES de podar a seleção, pra "selecionar todas"/seleção
    // continuarem batendo com o que está realmente visível nessa tela.
    const registrosExibidos = aplicarFiltroOcorrenciasDoDia(records);
    // Poda a seleção ANTES de desenhar — se um filtro/busca mudou e alguma NF marcada não bate
    // mais com o recorte atual, ela sai da seleção (pedido do usuário, 2026-08-30: "validar quais
    // registros continuam selecionados pra evitar enviar uma NF incorreta"). Precisa ser sempre
    // contra o conjunto FILTRADO completo (não só a página atual), já que "selecionar todas"
    // também opera sobre o filtrado completo, não só as 25 linhas visíveis.
    const nfsValidos = new Set(registrosExibidos.map(r => r.nf));
    notasSelecionadas.forEach(nf => { if (!nfsValidos.has(nf)) notasSelecionadas.delete(nf); });
    renderTableGeneric(registrosExibidos, table, MAIN_TABLE_IDS, rowHtmlComSelecao);
    atualizarBotoesScrollTabela();
    atualizarSelecaoUI();
    if (modoOcorrenciasAtivo) {
      const contagem = document.getElementById('ocorrencias-periodo-contagem');
      if (contagem) contagem.textContent = `${Utils.formatNumber(registrosExibidos.length)} ocorrência${registrosExibidos.length === 1 ? '' : 's'} encontrada${registrosExibidos.length === 1 ? '' : 's'}`;
    }
    renderRegistrosDetalhadosObservacaoEdicao();
  }

  /** Painel de edição da observação de UMA nota (clicar no botão da coluna "Observação" na
   * tabela "Registros detalhados" acima) — mesmo modelo já usado em "Registro Dinâmico"
   * (renderRegistroDinamicoObservacaoEdicao/abrirEdicaoObservacaoRegistroDinamico), só que pra
   * tabela inicial (pedido do usuário, 2026-08-30: "mesma opção que tem no Registro Dinâmico").
   * Busca a nota em TODO o recorte filtrado (não só a página atual), já que a nota clicada pode
   * não estar mais na página corrente depois de reordenar/paginar/mudar linhas por página. */
  function renderRegistrosDetalhadosObservacaoEdicao() {
    const section = document.getElementById('registros-detalhados-observacao-edicao-section');
    if (!registrosDetalhadosObservacaoNf) { section.hidden = true; return; }
    const registro = DataStore.getFilteredRecords().find(r => r.nf.split('-')[0] === registrosDetalhadosObservacaoNf);
    if (!registro) { section.hidden = true; registrosDetalhadosObservacaoNf = null; return; }
    section.hidden = false;

    const admin = isAdminAgendamento();
    document.getElementById('registros-detalhados-observacao-edicao-titulo').textContent = `Editar observação — NF ${registro.nf}`;
    document.getElementById('registros-detalhados-observacao-edicao-hint').textContent = admin
      ? 'Escreva uma observação livre sobre a nota — salva direto aqui, sem precisar de planilha.'
      : 'Observação da nota (só o usuário responsável pode editar).';

    const list = document.getElementById('registros-detalhados-observacao-edicao-list');
    const observacaoAtual = registro.observacaoAgendamento || '';

    if (!admin) {
      list.innerHTML = `
        <div class="observacao-row">
          <span class="observacao-row__nf">${escapeAttr(registro.nf)}</span>
          <span class="observacao-row__cliente" title="${escapeAttr(registro.cliente)}">${escapeAttr(registro.cliente)}</span>
          <span class="observacao-row__somente-leitura" title="${escapeAttr(observacaoAtual)}">${escapeAttr(observacaoAtual || '—')}</span>
          <span></span>
        </div>
      `;
      return;
    }

    list.innerHTML = `
      <div class="observacao-row" data-nf="${escapeAttr(registrosDetalhadosObservacaoNf)}">
        <span class="observacao-row__nf">${escapeAttr(registro.nf)}</span>
        <span class="observacao-row__cliente" title="${escapeAttr(registro.cliente)}">${escapeAttr(registro.cliente)}</span>
        <input type="text" class="observacao-row__input" placeholder="Observação (opcional)" value="${escapeAttr(observacaoAtual)}">
        <button type="button" class="btn observacao-row__salvar">Salvar</button>
      </div>
    `;
  }

  /** Clicar na observação já em edição fecha o painel (alterna); clicar noutra troca direto —
   * mesmo padrão de abrirEdicaoObservacaoRegistroDinamico. */
  function abrirEdicaoObservacaoRegistrosDetalhados(nfBase) {
    const vaiFechar = registrosDetalhadosObservacaoNf === nfBase;
    registrosDetalhadosObservacaoNf = vaiFechar ? null : nfBase;
    if (vaiFechar) {
      // Fechar colapsa o painel abaixo da tabela — sem congelar o scroll, o navegador ancora o
      // layout que encolheu e a página pula pra cima sozinha (mesmo efeito já visto/corrigido em
      // Registro Dinâmico).
      const scrollYAntes = window.scrollY;
      renderTable(DataStore.getFilteredRecords());
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, scrollYAntes)));
    } else {
      renderTable(DataStore.getFilteredRecords());
      document.getElementById('registros-detalhados-observacao-edicao-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /** Delegado no tbody (reconstruído a cada render) — clicar na Observação abre/fecha o painel;
   * delegado na lista do painel — clicar em Salvar grava no Firestore. */
  function bindObservacaoEdicaoPrincipal() {
    document.getElementById(MAIN_TABLE_IDS.tbody).addEventListener('click', (e) => {
      const botao = e.target.closest('[data-observacao-edicao-principal]');
      if (botao) abrirEdicaoObservacaoRegistrosDetalhados(botao.dataset.observacaoEdicaoPrincipal);
    });

    document.getElementById('registros-detalhados-observacao-edicao-list').addEventListener('click', async (e) => {
      const botao = e.target.closest('.observacao-row__salvar');
      if (!botao) return;
      const linha = botao.closest('.observacao-row');
      const nf = linha.dataset.nf;
      const observacao = linha.querySelector('.observacao-row__input').value.trim();

      botao.disabled = true;
      botao.textContent = 'Salvando...';
      try {
        const fb = await new Promise((resolve) => {
          if (window.Firebase) return resolve(window.Firebase);
          window.addEventListener('firebase-ready', () => resolve(window.Firebase), { once: true });
        });
        // DataStore.applyAgendamentoManual chama notify() por baixo, e o callback global
        // render() (DataStore.onChange) zera table.page incondicionalmente pra 1 — regra pensada
        // só pro caso "um filtro de verdade mudou", mas que também dispara aqui, sem querer, já
        // que ambos passam pelo mesmo notify() (mesma causa raiz já corrigida em Registro
        // Dinâmico, ver comentário equivalente lá). Guarda a página ANTES de chamar
        // applyAgendamentoManual e restaura logo depois, antes do nosso próprio render.
        const paginaAntes = table.page;
        await fb.salvarObservacaoNota(nf, observacao);
        DataStore.applyAgendamentoManual({ [nf]: { observacao } });
        table.page = paginaAntes;
        Utils.showToast(`NF ${nf}: observação salva.`, 'success', 2500);
        // Fecha o painel depois de salvar (mesmo comportamento já estabelecido em Registro
        // Dinâmico) — a tabela acima já mostra o texto novo na própria célula. rAF duplo evita o
        // salto de scroll pro topo quando o painel (abaixo da tabela) encolhe.
        const scrollYAntes = window.scrollY;
        registrosDetalhadosObservacaoNf = null;
        renderTable(DataStore.getFilteredRecords());
        requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, scrollYAntes)));
      } catch (err) {
        Utils.showToast(err.message || 'Falha ao salvar a observação.', 'error', 5000);
        botao.disabled = false;
        botao.textContent = 'Salvar';
      }
    });
  }

  /* ============================================================
   * SELEÇÃO DE NFs, ENVIAR OCORRÊNCIA, ENVIAR RELATÓRIO (2026-08-30)
   * ============================================================ */

  /** Mostra/some a barra flutuante e sincroniza o checkbox "selecionar todos" do cabeçalho —
   * inclusive o estado indeterminate, quando só parte das linhas do recorte filtrado atual está
   * marcada. Chamada sempre que a seleção muda e a cada renderTable (filtro/busca/paginação). */
  function atualizarSelecaoUI() {
    const n = notasSelecionadas.size;
    const barra = document.getElementById('selecao-flutuante');
    if (barra) {
      barra.hidden = n === 0;
      const texto = document.getElementById('selecao-flutuante-texto');
      if (texto) texto.textContent = `${n} nota${n === 1 ? '' : 's'} selecionada${n === 1 ? '' : 's'}`;
    }
    const checkboxTodos = document.getElementById('table-select-all');
    if (checkboxTodos) {
      const registros = aplicarFiltroOcorrenciasDoDia(DataStore.getFilteredRecords());
      const marcados = registros.filter(r => notasSelecionadas.has(r.nf)).length;
      checkboxTodos.checked = registros.length > 0 && marcados === registros.length;
      checkboxTodos.indeterminate = marcados > 0 && marcados < registros.length;
    }
  }

  /** Liga os checkboxes de linha (delegado no tbody, pois a tabela é reconstruída a cada
   * render), o "selecionar todos" do cabeçalho (opera sobre TODO o recorte filtrado, não só a
   * página atual — inclui o filtro de "Ocorrências do Dia" quando esse modo está ativo) e o
   * "Limpar seleção" da barra flutuante. */
  function bindSelecaoTabela() {
    document.getElementById(MAIN_TABLE_IDS.tbody).addEventListener('change', (e) => {
      const checkbox = e.target.closest('.row-select-checkbox');
      if (!checkbox) return;
      if (checkbox.checked) notasSelecionadas.add(checkbox.dataset.nf);
      else notasSelecionadas.delete(checkbox.dataset.nf);
      atualizarSelecaoUI();
    });

    document.getElementById('table-select-all').addEventListener('change', (e) => {
      const registros = aplicarFiltroOcorrenciasDoDia(DataStore.getFilteredRecords());
      if (e.target.checked) registros.forEach(r => notasSelecionadas.add(r.nf));
      else registros.forEach(r => notasSelecionadas.delete(r.nf));
      renderTable(DataStore.getFilteredRecords());
    });

    document.getElementById('btn-selecao-limpar').addEventListener('click', () => {
      notasSelecionadas.clear();
      renderTable(DataStore.getFilteredRecords());
    });
  }

  function chaveClienteMotorista(r) {
    return `${r.cliente}|||${r.motorista}`;
  }

  /** Agrupa os registros selecionados em 1 bloco por combinação Cliente+Motorista distinta —
   * normalmente 1 bloco só (pedido do usuário: "várias notas do mesmo cliente" viram uma única
   * ocorrência). Cada bloco recebe um id estável (proximoIdBlocoOcorrencia) pra sobreviver a
   * re-renders do modal (remoção de chip, digitação na ocorrência). Transportadora é capturada
   * do 1º registro do grupo, mesmo padrão já usado pra cliente/motorista (o agrupamento continua
   * só por Cliente+Motorista, não foi ampliado pra incluir Transportadora na chave). */
  function montarBlocosOcorrencia(registros) {
    const grupos = new Map();
    registros.forEach(r => {
      const chave = chaveClienteMotorista(r);
      if (!grupos.has(chave)) grupos.set(chave, { cliente: r.cliente, motorista: r.motorista, transportadora: r.transportadora, nfs: [] });
      grupos.get(chave).nfs.push(r.nf);
    });
    return Array.from(grupos.values()).map(g => ({
      id: proximoIdBlocoOcorrencia++, cliente: g.cliente, motorista: g.motorista, transportadora: g.transportadora, nfs: g.nfs, ocorrencia: ''
    }));
  }

  /** Monta o texto exato que será copiado/enviado — formato definido pela usuária (2026-08-30,
   * script pronto pra WhatsApp): rótulos em negrito (sintaxe *texto* do WhatsApp — aparece como
   * asterisco literal em e-mail/pré-visualização, inerente a usar o mesmo texto puro nos 3
   * canais) e o campo antes chamado "Observação" agora é "⚠️ Ocorrência". */
  function gerarMensagemOcorrencia(bloco) {
    return `*NF:* ${bloco.nfs.join(' / ')}\n*Cliente:* ${bloco.cliente}\n⚠️ *Ocorrência:* ${bloco.ocorrencia || '(preencher ocorrência)'}\n*Transportadora:* ${bloco.transportadora || '—'}\n*Motorista:* ${bloco.motorista}`;
  }

  function abrirModalOcorrencia() {
    if (notasSelecionadas.size === 0) {
      Utils.showToast('Selecione pelo menos uma NF para gerar a ocorrência.', 'warning');
      return;
    }
    const registros = DataStore.getFilteredRecords().filter(r => notasSelecionadas.has(r.nf));
    const combinacoes = new Set(registros.map(chaveClienteMotorista));
    const avisoMisto = document.getElementById('ocorrencia-aviso-misto');
    const blocosContainer = document.getElementById('ocorrencia-blocos');
    if (combinacoes.size > 1) {
      ocorrenciaRegistrosPendentes = registros;
      ocorrenciaBlocos = [];
      avisoMisto.hidden = false;
      blocosContainer.hidden = true;
      blocosContainer.innerHTML = '';
    } else {
      avisoMisto.hidden = true;
      blocosContainer.hidden = false;
      ocorrenciaBlocos = montarBlocosOcorrencia(registros);
      renderBlocosOcorrencia();
    }
    document.getElementById('modal-ocorrencia').hidden = false;
  }

  function fecharModalOcorrencia() {
    document.getElementById('modal-ocorrencia').hidden = true;
  }

  function renderBlocosOcorrencia() {
    const container = document.getElementById('ocorrencia-blocos');
    container.innerHTML = ocorrenciaBlocos.map(bloco => `
      <div class="ocorrencia-bloco" data-bloco-id="${bloco.id}">
        <div class="ocorrencia-bloco__chips">
          ${bloco.nfs.map(nf => `<span class="nf-chip">NF ${escapeAttr(nf)}<button type="button" class="nf-chip__remover" data-remover-nf="${escapeAttr(nf)}" data-bloco-id="${bloco.id}" aria-label="Remover NF ${escapeAttr(nf)} desta ocorrência">×</button></span>`).join('')}
        </div>
        <div class="modal-field">
          <label>NFs selecionadas</label>
          <input type="text" value="${escapeAttr(bloco.nfs.join(' / '))}" readonly>
        </div>
        <div class="modal-field">
          <label>Cliente</label>
          <input type="text" value="${escapeAttr(bloco.cliente)}" readonly>
        </div>
        <div class="modal-field">
          <label>Transportadora</label>
          <input type="text" value="${escapeAttr(bloco.transportadora || '—')}" readonly>
        </div>
        <div class="modal-field">
          <label>Motorista</label>
          <input type="text" value="${escapeAttr(bloco.motorista)}" readonly>
        </div>
        <div class="modal-field">
          <label>Ocorrência</label>
          <textarea rows="3" data-ocorrencia-bloco="${bloco.id}" placeholder="Descreva a ocorrência...">${escapeAttr(bloco.ocorrencia)}</textarea>
        </div>
        <div class="modal-field">
          <label>Pré-visualização</label>
          <div class="ocorrencia-preview" data-preview-bloco="${bloco.id}">${escapeAttr(gerarMensagemOcorrencia(bloco))}</div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" data-copiar-bloco="${bloco.id}">📋 Copiar mensagem</button>
          <button type="button" class="btn" data-whatsapp-bloco="${bloco.id}">WhatsApp</button>
          <button type="button" class="btn" data-email-bloco="${bloco.id}">E-mail</button>
        </div>
      </div>
    `).join('');
  }

  function bindOcorrencia() {
    document.getElementById('btn-enviar-ocorrencia').addEventListener('click', abrirModalOcorrencia);
    document.getElementById('btn-selecao-enviar-ocorrencia').addEventListener('click', abrirModalOcorrencia);

    const modal = document.getElementById('modal-ocorrencia');
    document.getElementById('btn-fechar-modal-ocorrencia').addEventListener('click', fecharModalOcorrencia);
    document.getElementById('btn-ocorrencia-fechar-rodape').addEventListener('click', fecharModalOcorrencia);
    document.getElementById('btn-ocorrencia-voltar').addEventListener('click', fecharModalOcorrencia);
    modal.addEventListener('click', (e) => { if (e.target === modal) fecharModalOcorrencia(); });

    document.getElementById('btn-ocorrencia-separar').addEventListener('click', () => {
      document.getElementById('ocorrencia-aviso-misto').hidden = true;
      document.getElementById('ocorrencia-blocos').hidden = false;
      ocorrenciaBlocos = montarBlocosOcorrencia(ocorrenciaRegistrosPendentes);
      renderBlocosOcorrencia();
    });

    const container = document.getElementById('ocorrencia-blocos');

    container.addEventListener('input', (e) => {
      const textarea = e.target.closest('[data-ocorrencia-bloco]');
      if (!textarea) return;
      const bloco = ocorrenciaBlocos.find(b => b.id === Number(textarea.dataset.ocorrenciaBloco));
      if (!bloco) return;
      bloco.ocorrencia = textarea.value;
      const preview = container.querySelector(`[data-preview-bloco="${bloco.id}"]`);
      if (preview) preview.textContent = gerarMensagemOcorrencia(bloco);
    });

    container.addEventListener('click', (e) => {
      const removerBtn = e.target.closest('[data-remover-nf]');
      if (removerBtn) {
        const bloco = ocorrenciaBlocos.find(b => b.id === Number(removerBtn.dataset.blocoId));
        if (bloco) {
          const nf = removerBtn.dataset.removerNf;
          bloco.nfs = bloco.nfs.filter(n => n !== nf);
          notasSelecionadas.delete(nf);
          if (bloco.nfs.length === 0) ocorrenciaBlocos = ocorrenciaBlocos.filter(b => b.id !== bloco.id);
          if (ocorrenciaBlocos.length === 0) {
            fecharModalOcorrencia();
            Utils.showToast('Todas as NFs foram removidas da ocorrência.', 'info', 3000);
          } else {
            renderBlocosOcorrencia();
          }
          renderTable(DataStore.getFilteredRecords());
        }
        return;
      }
      const copiarBtn = e.target.closest('[data-copiar-bloco]');
      if (copiarBtn) {
        const bloco = ocorrenciaBlocos.find(b => b.id === Number(copiarBtn.dataset.copiarBloco));
        if (bloco) {
          navigator.clipboard.writeText(gerarMensagemOcorrencia(bloco))
            .then(() => Utils.showToast('Mensagem copiada.', 'success', 2500))
            .catch(() => Utils.showToast('Não foi possível copiar a mensagem.', 'error', 4000));
        }
        return;
      }
      const whatsappBtn = e.target.closest('[data-whatsapp-bloco]');
      if (whatsappBtn) {
        const bloco = ocorrenciaBlocos.find(b => b.id === Number(whatsappBtn.dataset.whatsappBloco));
        if (bloco) {
          window.open(`https://wa.me/?text=${encodeURIComponent(gerarMensagemOcorrencia(bloco))}`, '_blank', 'noopener');
          Utils.showToast('Abrindo WhatsApp com a mensagem pronta.', 'success', 2500);
        }
        return;
      }
      const emailBtn = e.target.closest('[data-email-bloco]');
      if (emailBtn) {
        const bloco = ocorrenciaBlocos.find(b => b.id === Number(emailBtn.dataset.emailBloco));
        if (bloco) {
          window.open(`mailto:?subject=${encodeURIComponent('Ocorrência de entrega')}&body=${encodeURIComponent(gerarMensagemOcorrencia(bloco))}`, '_blank');
          Utils.showToast('Abrindo e-mail com a mensagem pronta.', 'success', 2500);
        }
      }
    });
  }

  /** "Enviar Relatório" reaproveita o MESMO Excel de "Exportar Excel" (exportarRegistros) — só
   * adiciona o WhatsApp/E-mail em cima do arquivo já baixado. Nem WhatsApp Web nem mailto:
   * permitem anexar arquivo via JavaScript (restrição do navegador), por isso o aviso pede pra
   * anexar na mão em vez de tentar contornar essa limitação. */
  function bindEnviarRelatorio() {
    const modal = document.getElementById('modal-enviar-relatorio');

    function selecionarCanal(canal) {
      relatorioCanalSelecionado = canal;
      modal.querySelectorAll('.modal-tab').forEach(tab => tab.classList.toggle('modal-tab--ativa', tab.dataset.canal === canal));
      document.getElementById('campo-relatorio-whatsapp').hidden = canal !== 'whatsapp';
      document.getElementById('campo-relatorio-email').hidden = canal !== 'email';
    }

    document.getElementById('btn-enviar-relatorio').addEventListener('click', () => {
      selecionarCanal('whatsapp');
      // Mensagem padrão troca quando aberta a partir de "Ocorrências do Dia" — mesmo texto de
      // sempre nas outras telas, pra não confundir quem já está acostumada com o padrão atual.
      document.getElementById('relatorio-mensagem').value = modoOcorrenciasAtivo
        ? `Olá, tudo bem?\n\nSegue anexo o relatório de ocorrências do dia (${rotuloPeriodoOcorrencias(ocorrenciasDoDiaPeriodo)}) para acompanhamento.`
        : 'Olá, tudo bem?\n\nSegue anexo o relatório atualizado.';
      modal.hidden = false;
    });

    modal.querySelectorAll('.modal-tab').forEach(tab => {
      tab.addEventListener('click', () => selecionarCanal(tab.dataset.canal));
    });

    document.getElementById('btn-fechar-modal-relatorio').addEventListener('click', () => { modal.hidden = true; });
    document.getElementById('btn-cancelar-relatorio').addEventListener('click', () => { modal.hidden = true; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

    document.getElementById('btn-confirmar-relatorio').addEventListener('click', async () => {
      const mensagem = document.getElementById('relatorio-mensagem').value;
      await exportarRegistros(nomeArquivoExportacao(), aplicarFiltroOcorrenciasDoDia(DataStore.getFilteredRecords()));
      if (relatorioCanalSelecionado === 'whatsapp') {
        const numero = document.getElementById('relatorio-whatsapp-numero').value.replace(/\D/g, '');
        window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`, '_blank', 'noopener');
      } else {
        const destinatario = document.getElementById('relatorio-email-destinatario').value.trim();
        window.open(`mailto:${destinatario}?subject=${encodeURIComponent('Relatório atualizado')}&body=${encodeURIComponent(mensagem)}`, '_blank');
      }
      Utils.showToast('Excel baixado — anexe o arquivo manualmente na conversa/e-mail que abriu.', 'info', 6000);
      modal.hidden = true;
    });
  }

  function bindSelecaoEOcorrencia() {
    bindSelecaoTabela();
    bindOcorrencia();
    bindEnviarRelatorio();
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
    // Precisa do [data-nf] no seletor, não só a classe .nf-link: essa classe também estiliza
    // outros botões que não são NF nenhuma (data/transportadora do Registro Dinâmico, ver
    // rowHtmlRegistroDinamico/rowHtmlRegistroDinamicoTransportadora) — sem essa restrição,
    // clicar neles chamava openCanhoto(undefined) e mostrava "NF undefined: Sem Canhoto" à toa
    // (bug reportado pelo usuário, 2026-08-27).
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('.nf-link[data-nf]');
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
    calcularRegistroDinamico, calcularRegistroDinamicoPorMes, calcularRegistroDinamicoPorTransportadora,
  };
})();
