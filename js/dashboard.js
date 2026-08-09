/**
 * dashboard.js
 * Orquestra a interface do dashboard: KPIs, filtros, gráficos e tabela.
 * Depende de: Utils (utils.js), DataStore (data.js), DashChart (charts.js).
 */
'use strict';

const Dashboard = (() => {
  const charts = {};
  let table = {
    sortField: 'dataEntrega',
    sortDir: 'desc',
    page: 1,
    pageSize: 25
  };

  // "Não informado" é um rótulo de ausência, não um vendedor real — por padrão fica fora
  // do filtro pra não poluir a lista com algo que não representa ninguém de fato.
  const VENDEDOR_SEM_CLIENTE_KEY = 'dashboard_ocultar_vendedor_sem_cliente';
  let ocultarVendedorSemCliente = localStorage.getItem(VENDEDOR_SEM_CLIENTE_KEY) !== '0';

  /* ============================================================
   * INICIALIZAÇÃO
   * ============================================================ */

  function init() {
    bindFilterInputs();
    bindTableControls();
    bindActionButtons();
    createCharts();
    DataStore.onChange(render);
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
    $('filter-status').addEventListener('change', (e) => DataStore.setFilters({ situacaoFiltro: e.target.value }));
    $('filter-transportadora').addEventListener('change', (e) => DataStore.setFilters({ transportadora: e.target.value }));
    $('filter-motorista').addEventListener('change', (e) => DataStore.setFilters({ motorista: e.target.value }));
    $('filter-vendedor').addEventListener('change', (e) => DataStore.setFilters({ vendedor: e.target.value }));
    $('filter-cliente').addEventListener('change', (e) => DataStore.setFilters({ cliente: e.target.value }));
    $('filter-cidade').addEventListener('change', (e) => DataStore.setFilters({ cidade: e.target.value }));

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

  function bindTableControls() {
    const searchHandler = Utils.debounce((value) => {
      DataStore.setFilters({ busca: value });
      const buscaInput = document.getElementById('filter-busca');
      buscaInput.value = value;
      buscaInput.classList.toggle('is-filled', value.trim() !== '');
    }, 250);
    document.getElementById('table-search').addEventListener('input', (e) => searchHandler(e.target.value));

    document.querySelectorAll('#data-table thead th[data-field]').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.field;
        if (table.sortField === field) {
          table.sortDir = table.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          table.sortField = field;
          table.sortDir = 'asc';
        }
        table.page = 1;
        renderTable(DataStore.getFilteredRecords());
      });
    });

    document.getElementById('table-page-size').addEventListener('change', (e) => {
      table.pageSize = Number(e.target.value);
      table.page = 1;
      renderTable(DataStore.getFilteredRecords());
    });

    document.getElementById('table-prev').addEventListener('click', () => {
      if (table.page > 1) { table.page--; renderTable(DataStore.getFilteredRecords()); }
    });
    document.getElementById('table-next').addEventListener('click', () => {
      table.page++; renderTable(DataStore.getFilteredRecords());
    });
  }

  function bindActionButtons() {
    document.getElementById('btn-export-csv').addEventListener('click', () => {
      const records = DataStore.getFilteredRecords();
      if (!records.length) { Utils.showToast('Não há dados para exportar.', 'warning'); return; }
      Utils.exportToCSV('dashboard-entregas.csv', records, tableColumns());
      Utils.showToast(`${records.length} registros exportados para CSV.`, 'success');
    });

    document.getElementById('btn-print-dashboard').addEventListener('click', () => window.print());
    document.getElementById('btn-export-pdf').addEventListener('click', () => {
      Utils.showToast('Escolha "Salvar como PDF" na janela de impressão.', 'info', 5000);
      window.print();
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
      { label: 'Valor NF', value: r => r.valorNF.toFixed(2).replace('.', ',') },
      { label: 'Data Entrega', value: r => Utils.formatDate(r.dataEntrega) },
      { label: 'Data Agendada', value: r => Utils.formatDate(r.dataAgendamento) }
    ];
  }

  /* ============================================================
   * FILTROS — popula selects com valores distintos dos dados
   * ============================================================ */

  function populateFilterOptions() {
    const fillSelect = (id, values, placeholder) => {
      const el = document.getElementById(id);
      const current = el.value;
      el.innerHTML = `<option value="">${placeholder}</option>` +
        values.map(v => `<option value="${escapeAttr(v)}">${escapeAttr(v)}</option>`).join('');
      if (values.includes(current)) el.value = current;
    };

    fillSelect('filter-status', DataStore.getDistinctValues('situacao'), 'Todos os status');
    fillSelect('filter-transportadora', DataStore.getDistinctValues('transportadora'), 'Todas as transportadoras');
    fillSelect('filter-motorista', DataStore.getDistinctValues('motorista'), 'Todos os motoristas');
    let vendedores = DataStore.getDistinctValues('vendedor');
    if (ocultarVendedorSemCliente) vendedores = vendedores.filter(v => v !== 'Não informado');
    fillSelect('filter-vendedor', vendedores, 'Todos os vendedores');
    fillSelect('filter-cliente', DataStore.getDistinctValues('cliente'), 'Todos os clientes');
    fillSelect('filter-cidade', DataStore.getDistinctValues('cidade'), 'Todas as cidades');

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
    return { DENTRO_PRAZO: 'Dentro do prazo', VENCIDO: 'Vencido', ENTREGUE: 'Entregue', SEM_INFO: 'Sem informação' }[prazo] || prazo;
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
    updateLastUpdatedLabel();
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
    const entregues = records.filter(r => r.status === 'ENTREGUE');
    const abertas = records.filter(r => r.status === 'EM_ABERTO');
    const aguardando = records.filter(r => r.status === 'AGUARDANDO_AGENDAMENTO');

    const total = records.length || 1;
    const percentual = (entregues.length / total) * 100;

    setKPI('kpi-entregues-count', entregues.length, Utils.formatNumber);
    setKPI('kpi-abertas-count', abertas.length, Utils.formatNumber);
    setKPI('kpi-aguardando-count', aguardando.length, Utils.formatNumber);
    setKPI('kpi-percentual', percentual, v => Utils.formatPercent(v, 1));
    setKPI('kpi-valor-entregues', Utils.sum(entregues, r => r.valorNF), Utils.formatCurrency);
    setKPI('kpi-valor-abertas', Utils.sum(abertas, r => r.valorNF), Utils.formatCurrency);
    setKPI('kpi-valor-aguardando', Utils.sum(aguardando, r => r.valorNF), Utils.formatCurrency);

    // Total geral — independente do status, conta tudo que passou pelos filtros atuais.
    setKPI('kpi-total-notas', records.length, Utils.formatNumber);
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
      // Entregues, Agendados, Aguardando agendamento, Em aberto
      options: { colors: ['#16A34A', '#2563EB', '#64748B', '#DC2626'] }
    });
    charts.prazo = new DashChart(document.getElementById('chart-prazo'), {
      type: 'donut', labels: [], series: [{ data: [] }],
      options: { colors: ['#EAB308', '#DC2626', '#16A34A', '#64748B'] } // Dentro do prazo, Vencido, Entregue, Sem informação
    });
    charts.agendamento = new DashChart(document.getElementById('chart-agendamento'), {
      type: 'donut', labels: [], series: [{ data: [] }],
      options: { colors: ['#2563EB', '#EAB308', '#64748B'] } // Agendado, Aguardando data, Não precisa
    });
    charts.transportadora = new DashChart(document.getElementById('chart-transportadora'), {
      type: 'bar', labels: [], series: [{ name: 'Notas', data: [], color: ChartPalette[1] }]
    });
    charts.rankingTransportadoras = new DashChart(document.getElementById('chart-ranking-transportadoras'), {
      type: 'hbar', labels: [],
      series: [
        { name: 'Entregues', data: [], color: '#16A34A' },
        { name: 'Vencidas', data: [], color: '#DC2626' }
      ],
      options: { fullLabels: true }
    });
    charts.evolucaoMensal = new DashChart(document.getElementById('chart-evolucao-mensal'), {
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
    document.getElementById('ranking-transportadoras-filtro').addEventListener('change', () => renderCharts(DataStore.getFilteredRecords()));
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
    // "Agendado" é um valor de situação, não de status — separado aqui do balde genérico
    // "Em aberto" pra dar visibilidade própria, como pedido.
    let entregues = 0, agendados = 0, aguardando = 0, emAberto = 0;
    records.forEach(r => {
      if (r.status === 'ENTREGUE') entregues++;
      else if (r.situacao === 'Agendado') agendados++;
      else if (r.status === 'AGUARDANDO_AGENDAMENTO') aguardando++;
      else emAberto++;
    });
    charts.status.update({
      labels: ['Entregues', 'Agendados', 'Aguardando agendamento', 'Em aberto'],
      series: [{ data: [entregues, agendados, aguardando, emAberto] }]
    });
  }

  function renderPrazoChart(records) {
    const groups = { DENTRO_PRAZO: 0, VENCIDO: 0, ENTREGUE: 0, SEM_INFO: 0 };
    records.forEach(r => { groups[r.prazoStatus] = (groups[r.prazoStatus] || 0) + 1; });
    charts.prazo.update({
      labels: ['Dentro do prazo', 'Vencido', 'Entregue', 'Sem informação'],
      series: [{ data: [groups.DENTRO_PRAZO, groups.VENCIDO, groups.ENTREGUE, groups.SEM_INFO] }]
    });
  }

  /**
   * Situação de agendamento: cruza necessitaAgendamento (planilha de Agendamentos) com a
   * presença de uma data já definida — dá pra ver quantas notas ainda precisam de data.
   */
  function renderAgendamentoChart(records) {
    let agendado = 0, aguardandoData = 0, naoPrecisa = 0;
    records.forEach(r => {
      if (!r.necessitaAgendamento) { naoPrecisa++; return; }
      if (r.dataAgendamento) agendado++;
      else aguardandoData++;
    });
    charts.agendamento.update({
      labels: ['Agendado', 'Aguardando data', 'Não precisa de agendamento'],
      series: [{ data: [agendado, aguardandoData, naoPrecisa] }]
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
   * muito volume dominaria só por tamanho. Exige >=3 notas para entrar no ranking.
   */
  function renderRankingTransportadoras(records) {
    const filtro = document.getElementById('ranking-transportadoras-filtro').value || 'melhores';
    const grouped = Utils.groupBy(records, r => r.transportadora);

    let entries = Array.from(grouped.entries())
      .map(([name, items]) => {
        const total = items.length;
        const entregues = items.filter(r => r.status === 'ENTREGUE').length;
        const vencidas = items.filter(r => r.prazoStatus === 'VENCIDO').length;
        return { name, total, entregues, vencidas, taxa: entregues / total };
      })
      .filter(e => e.total >= 3);

    entries.sort((a, b) => filtro === 'piores' ? a.taxa - b.taxa : b.taxa - a.taxa);
    entries = entries.slice(0, 15);

    charts.rankingTransportadoras.update({
      labels: entries.map(e => e.name),
      series: [
        { name: 'Entregues', data: entries.map(e => e.entregues), color: '#16A34A' },
        { name: 'Vencidas', data: entries.map(e => e.vencidas), color: '#DC2626' }
      ]
    });
  }

  function renderEvolucaoMensal(records) {
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
    }
    const values = months.map(month => Utils.sum(
      records.filter(r => r.dataFaturamento && Utils.isSameMonth(r.dataFaturamento, month)),
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

    records.forEach(r => {
      const ref = r.dataFaturamento;
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

  function renderTable(records) {
    const sorted = records.slice().sort((a, b) => {
      let va = a[table.sortField];
      let vb = b[table.sortField];
      if (va instanceof Date || vb instanceof Date) { va = va ? va.getTime() : -Infinity; vb = vb ? vb.getTime() : -Infinity; }
      if (typeof va === 'string') return table.sortDir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR');
      const diff = (va || 0) - (vb || 0);
      return table.sortDir === 'asc' ? diff : -diff;
    });

    const totalPages = Math.max(1, Math.ceil(sorted.length / table.pageSize));
    table.page = Math.min(table.page, totalPages);
    const start = (table.page - 1) * table.pageSize;
    const pageItems = sorted.slice(start, start + table.pageSize);

    const tbody = document.getElementById('table-body');

    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="13" class="table-empty">Nenhum registro encontrado para os filtros atuais.</td></tr>`;
    } else {
      tbody.innerHTML = pageItems.map(r => `
        <tr>
          <td>${escapeAttr(r.nf)}</td>
          <td class="truncate" title="${escapeAttr(r.cliente)}">${escapeAttr(r.cliente)}</td>
          <td class="truncate" title="${escapeAttr(r.transportadora)}">${escapeAttr(r.transportadora)}</td>
          <td class="truncate" title="${escapeAttr(r.motorista)}">${escapeAttr(r.motorista)}</td>
          <td>${escapeAttr(r.vendedor)}</td>
          <td>${escapeAttr(r.cidade)}${r.uf ? '/' + escapeAttr(r.uf) : ''}</td>
          <td><span class="badge ${statusBadgeClass(r.status)}">${statusLabel(r.status)}</span></td>
          <td><span class="badge ${prazoBadgeClass(r.prazoStatus)}">${prazoLabel(r.prazoStatus)}</span></td>
          <td>${r.situacao === 'NF Não encontrada' ? `<span class="badge badge--neutral">${escapeAttr(r.situacao)}</span>` : escapeAttr(r.situacao)}</td>
          <td class="text-right">${Utils.formatCurrency(r.valorNF)}</td>
          <td>${Utils.formatDate(r.dataEntrega)}</td>
          <td>${Utils.formatDate(r.dataAgendamento)}</td>
        </tr>
      `).join('');
    }

    document.getElementById('table-info').textContent =
      sorted.length === 0 ? 'Nenhum registro' : `${start + 1}–${Math.min(start + table.pageSize, sorted.length)} de ${sorted.length} registros`;
    document.getElementById('table-page-label').textContent = `Página ${table.page} de ${totalPages}`;
    document.getElementById('table-prev').disabled = table.page <= 1;
    document.getElementById('table-next').disabled = table.page >= totalPages;

    document.querySelectorAll('#data-table thead th[data-field]').forEach(th => {
      th.classList.remove('is-sorted-asc', 'is-sorted-desc');
      if (th.dataset.field === table.sortField) th.classList.add(table.sortDir === 'asc' ? 'is-sorted-asc' : 'is-sorted-desc');
    });
  }

  return { init, renderAll };
})();
