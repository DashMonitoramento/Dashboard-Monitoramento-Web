/**
 * data.js
 * Camada de dados do dashboard.
 *
 * Responsabilidades:
 *  - Ler arquivos CSV/JSON (upload manual ou fetch de um caminho padrão).
 *  - Normalizar os registros brutos da planilha para um esquema canônico único,
 *    usado por todo o resto da aplicação (dashboard.js, charts.js).
 *  - Expor filtros e agregações sobre os dados carregados.
 *
 * Arquitetura de expansão:
 *  Toda origem de dados implementa a interface simples { load() => Promise<Array<Object>> }.
 *  Hoje existem adapters de CSV e JSON. No futuro, basta criar um novo adapter
 *  (ex.: ApiAdapter, GoogleSheetsAdapter, DatabaseAdapter via backend) e registrá-lo
 *  em DataStore.ADAPTERS — nenhum outro módulo da aplicação precisa mudar,
 *  pois todos consomem apenas DataStore.getRecords()/getFilteredRecords().
 */
'use strict';

/* ============================================================
 * 1. PARSERS (formato bruto -> array de objetos com headers originais)
 * ============================================================ */

/** Parser de CSV tolerante a aspas, ; ou , como separador, e quebras de linha dentro de campos. */
function parseCSV(text) {
  if (!text) return [];
  // remove BOM
  text = text.replace(/^﻿/, '');

  // Detecta o separador mais provável olhando a primeira linha não vazia
  const firstLine = text.split(/\r?\n/).find(l => l.trim() !== '') || '';
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const delimiter = semicolons >= commas ? ';' : ',';

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') { field += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
      continue;
    }

    if (char === '"') { inQuotes = true; continue; }
    if (char === delimiter) { row.push(field); field = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const nonEmptyRows = rows.filter(r => r.some(c => String(c).trim() !== ''));
  if (nonEmptyRows.length === 0) return [];

  // Nem toda planilha tem o cabeçalho na primeira linha (ex.: a aba "NF ABERTA" da
  // Wagner tem um título mesclado na linha 1 e os cabeçalhos reais só na linha 2).
  // Em vez de assumir sempre a primeira linha, escolhemos entre as primeiras a que
  // tiver mais células preenchidas — é a candidata mais provável a ser o cabeçalho real.
  const candidateCount = Math.min(10, nonEmptyRows.length);
  let headerRowIndex = 0;
  let maxFilled = -1;
  for (let i = 0; i < candidateCount; i++) {
    const filled = nonEmptyRows[i].filter(c => String(c).trim() !== '').length;
    if (filled > maxFilled) { maxFilled = filled; headerRowIndex = i; }
  }

  const headers = nonEmptyRows[headerRowIndex].map(h => h.trim());
  return nonEmptyRows.slice(headerRowIndex + 1).map(cols => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx] !== undefined ? cols[idx].trim() : ''; });
    return obj;
  });
}

function parseJSONData(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.data)) return parsed.data;
  if (parsed && Array.isArray(parsed.records)) return parsed.records;
  throw new Error('Formato JSON inesperado: esperado um array de registros (ou {data:[...]}).');
}

/* ============================================================
 * 2. ADAPTERS (origem -> texto bruto -> linhas)
 * ============================================================ */

const DataAdapters = {
  csv: {
    async loadFromText(text) { return parseCSV(text); },
    async loadFromUrl(url) {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Não foi possível carregar "${url}" (HTTP ${res.status}).`);
      return parseCSV(await res.text());
    },
    async loadFromFile(file) { return parseCSV(await file.text()); }
  },
  json: {
    async loadFromText(text) { return parseJSONData(text); },
    async loadFromUrl(url) {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Não foi possível carregar "${url}" (HTTP ${res.status}).`);
      return parseJSONData(await res.text());
    },
    async loadFromFile(file) { return parseJSONData(await file.text()); }
  },
  /**
   * Placeholder para integração futura com API REST / backend próprio.
   * Basta implementar loadFromUrl fazendo fetch(url) e devolvendo os registros já
   * em formato de array de objetos — o restante da aplicação não muda.
   */
  api: {
    async loadFromUrl(url, options = {}) {
      const res = await fetch(url, { cache: 'no-store', ...options });
      if (!res.ok) throw new Error(`Falha ao consultar API "${url}" (HTTP ${res.status}).`);
      return parseJSONData(JSON.stringify(await res.json()));
    }
  },
  /**
   * Placeholder para integração futura com Google Sheets publicado como CSV.
   * Basta usar a URL de exportação CSV da planilha (Arquivo > Compartilhar > Publicar na Web).
   */
  googleSheets: {
    async loadFromUrl(csvExportUrl) { return DataAdapters.csv.loadFromUrl(csvExportUrl); }
  }
};

/* ============================================================
 * 3. NORMALIZAÇÃO (headers originais da planilha -> esquema canônico)
 * ============================================================ */

// Mapeia possíveis nomes de coluna (planilha) para o campo canônico usado no dashboard.
const FIELD_ALIASES = {
  nf: ['nf', 'nota fiscal', 'numero nf', 'n° nf', 'n nf/cf', 'n° nf/cf'],
  cliente: ['cliente', 'destinatario', 'destinatário'],
  grupoEconomico: ['grupo economico', 'grupo econômico'],
  transportadora: ['transportadora', 'transportador'],
  motorista: ['motorista'],
  vendedor: ['vendedor', 'nome_vendedor', 'nome vendedor'],
  supervisor: ['supervisor', 'nome_supervisor', 'nome supervisor'],
  cidade: ['cidade'],
  uf: ['uf'],
  status: ['status entregas', 'status', 'status da entrega'],
  prazoStatus: ['prazo', 'situacao do prazo', 'situação do prazo'],
  valorNF: ['valor nf', 'valor da nf', 'valor pedido', 'valor nf/cf'],
  dataEmissao: ['data emissao pedido', 'data emissão pedido', 'data emissao'],
  dataAgendamento: [
    'data agendamento logistica', 'data agendamento logística', 'dt agendamento', 'data agendamento',
    'data de agendamento', 'data do agendamento'
  ],
  dataFaturamento: ['data faturamento'],
  dataEntrega: ['data entrega', 'dt. entrega nf'],
  // Coluna M da aba "NF ABERTA (BI STATUS ENTREGAS)" — ocorrência/status detalhado da nota.
  situacao: ['ocorrencias consolidada2', 'situacao', 'situação', 'status detalhado'],
  // Coluna "AGENDAMENTOS" (ou "Agendado" na planilha de agendamentos) — indica se a nota
  // obriga ou não uma etapa de agendamento.
  necessitaAgendamento: ['agendamentos', 'agendado']
};

function normalizeHeaderKey(header) {
  return String(header)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mesma normalização de normalizeHeaderKey, usada para casar nomes de cliente entre planilhas diferentes. */
function normalizeClienteKey(value) {
  return normalizeHeaderKey(value || '').replace(/[^a-z0-9 ]/g, '');
}

// Correções manuais de cliente -> vendedor, confirmadas com o usuário quando o cruzamento
// automático (nome exato ou matriz/filial por substring) não encontra o vendedor correto.
const CLIENTE_VENDEDOR_OVERRIDES = {
  [normalizeClienteKey('J E COMERCIO E REPRESENTACOES LTDA')]: 'EXPORTAÇÃO',
  // Mesma rede (GPA) do Pão de Açúcar cadastrado só na filial DF — tratado como o mesmo vendedor.
  [normalizeClienteKey('PAO DE ACUCAR - COMPANHIA BRASILEIRA DE DISTRIBUICAO - SP')]: 'EDMILSON NUNES'
};

function buildHeaderIndex(rawRow) {
  const index = {};
  for (const originalHeader of Object.keys(rawRow)) {
    index[normalizeHeaderKey(originalHeader)] = originalHeader;
  }
  return index;
}

function pickField(rawRow, headerIndex, canonicalField) {
  const aliases = FIELD_ALIASES[canonicalField] || [canonicalField];
  for (const alias of aliases) {
    const originalHeader = headerIndex[alias];
    if (originalHeader !== undefined) return rawRow[originalHeader];
  }
  return undefined;
}

function parseMoney(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  let str = String(value).trim().replace(/^R\$\s*/i, '');

  const hasComma = str.includes(',');
  const hasDot = str.includes('.');

  if (hasComma && hasDot) {
    // O separador decimal é o que aparece mais à direita; o outro é separador de milhar.
    if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
      str = str.replace(/\./g, '').replace(',', '.'); // 1.234,56 -> 1234.56
    } else {
      str = str.replace(/,/g, ''); // 1,234.56 -> 1234.56
    }
  } else if (hasComma) {
    // Só vírgula: é o separador decimal brasileiro, independente de quantos dígitos a seguem
    // (planilhas exportadas de Excel podem trazer resíduo de ponto flutuante, ex.: "1584,5999999999997").
    str = str.replace(',', '.');
  }
  // Só ponto (ou nenhum separador): já está em formato numérico válido, não precisa de ajuste.

  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

/** Verdadeiro para célula vazia ou com erro de fórmula (#N/A / #N/D — mesmo erro, grafia PT-BR ou EN-US). */
function isBlankOrNA(value) {
  if (value === null || value === undefined) return true;
  const s = String(value).trim();
  if (s === '') return true;
  return /^#N\/[AD]$/i.test(s);
}

/** true = obriga agendamento, false = não obriga, null = não informado. */
function parseNecessitaAgendamento(rawValue) {
  const s = normalizeHeaderKey(rawValue || '');
  if (!s) return null;
  if (s.includes('nao necessita') || s.includes('nao agenda')) return false;
  if (s.includes('necessita')) return true;
  return null;
}

// Ocorrências raras (1-2 notas cada) que, por decisão do usuário, são tratadas como Devolução
// mesmo sem a palavra "devolução" no texto — normalmente indicam um problema que resulta no
// retorno da mercadoria (pedido divergente, duplicado, retido, problema fiscal etc.).
const SITUACOES_RARAS_COMO_DEVOLUCAO = [
  'mercadoria em desacordo com o pedido compra',
  'quantidade de produto em desacordo',
  'pedido de compras em duplicidade',
  'mercadoria retida ate segunda ordem',
  'mercadoria embarcada sem conhecimento',
  'conhecimento nao embarcado',
  'nf com problema',
  'transportadora verificando',
  'data de entrega diferente do pedido',
  'problemas fiscais',
  'cliente fechado para balanco'
];

/**
 * Classifica a coluna M ("OCORRÊNCIAS CONSOLIDADA2") num conjunto pequeno e consistente de
 * categorias de negócio, definidas junto com o usuário. Quando o texto não se encaixa em
 * nenhuma regra conhecida, mantém o texto original (ex.: "Cliente Retira Mercadoria na
 * Transportadora") como ponto de atenção, em vez de forçar numa categoria errada.
 */
function normalizeSituacao(rawSituacao, rawNecessitaAgendamento) {
  if (isBlankOrNA(rawSituacao)) return 'NF Não encontrada';

  const original = String(rawSituacao).trim();
  const s = normalizeHeaderKey(original);
  const necessitaAgendamento = parseNecessitaAgendamento(rawNecessitaAgendamento);

  if (s === 'entregue' || s.includes('mercadoria entregue') || s.includes('entrega confirmada') ||
      s.includes('reentregue ao cliente destino')) return 'Entregue';

  if (s.includes('entrega programada') || s === 'agendado') return 'Agendado';

  // "Excesso de Veículos": se a nota obriga agendamento, precisa reagendar; senão, é só reentrega.
  if (s.includes('excesso de veiculos')) return necessitaAgendamento ? 'Reagendar' : 'Reentrega';

  if (s.includes('reentrega')) return 'Reentrega';

  if (s.includes('aguardando agendamento')) return 'Aguardando agendamento';

  // Ex.: "OKKER - NÃO NECESSITA DE AGENDAMENTO" — entrega direta, fora do fluxo de agendamento.
  if (s.includes('nao necessita') && s.includes('agendamento')) return 'Não obriga agendamento';

  if (s.includes('devol')) return 'Devolução'; // cobre "devolução", "devolvida", "devolver" etc.
  if (SITUACOES_RARAS_COMO_DEVOLUCAO.some(f => s.includes(f))) return 'Devolução';

  if (s.includes('recusa')) return 'Recusa';

  if (s.includes('em rota') || s.includes('chegada na cidade') || s.includes('processo de transporte') ||
      s.includes('nao foi embarcada')) return 'Em rota';

  if (s === 'em aberto') return 'Em aberto';

  // Texto não mapeado: mantém como está, para servir de ponto de atenção (ex.: retirada pelo cliente).
  return original;
}

function normalizeStatus(rawStatus, dataEntrega, situacao) {
  const s = normalizeHeaderKey(rawStatus || '');
  if (dataEntrega || situacao === 'Entregue' || s.includes('entreg')) return 'ENTREGUE';
  if (situacao === 'Aguardando agendamento' || s.includes('aguard') || s.includes('agend')) return 'AGUARDANDO_AGENDAMENTO';
  if (s.includes('abert')) return 'EM_ABERTO';
  return 'EM_ABERTO';
}

function normalizePrazo(rawPrazo, status) {
  const s = normalizeHeaderKey(rawPrazo || '');
  if (status === 'ENTREGUE') return 'ENTREGUE';
  if (s.includes('fora') || s.includes('venc') || s.includes('atras')) return 'VENCIDO';
  if (s.includes('dentro')) return 'DENTRO_PRAZO';
  return 'SEM_INFO';
}

/** Converte uma linha "crua" (headers originais da planilha) para o registro canônico do dashboard. */
function normalizeRecord(rawRow) {
  const headerIndex = buildHeaderIndex(rawRow);
  const get = (field) => pickField(rawRow, headerIndex, field);

  const dataEntrega = Utils.parseDate(get('dataEntrega'));
  const dataAgendamento = Utils.parseDate(get('dataAgendamento'));
  const situacao = normalizeSituacao(get('situacao'), get('necessitaAgendamento'));
  const status = normalizeStatus(get('status'), dataEntrega, situacao);

  return {
    nf: String(get('nf') || '').trim(),
    cliente: String(get('cliente') || 'Não informado').trim(),
    grupoEconomico: String(get('grupoEconomico') || '').trim(),
    transportadora: String(get('transportadora') || 'Não informado').trim(),
    motorista: String(get('motorista') || 'Não informado').trim(),
    vendedor: String(get('vendedor') || 'Não informado').trim(),
    supervisor: String(get('supervisor') || '').trim(),
    cidade: String(get('cidade') || 'Não informado').trim(),
    uf: String(get('uf') || '').trim().toUpperCase(),
    status,
    prazoStatus: normalizePrazo(get('prazoStatus'), status),
    valorNF: parseMoney(get('valorNF')),
    dataEmissao: Utils.parseDate(get('dataEmissao')),
    dataAgendamento,
    dataFaturamento: Utils.parseDate(get('dataFaturamento')),
    dataEntrega,
    situacao,
    // Preenchidos pela planilha de Agendamentos (cruzada por NF) — ficam nulos/vazios até
    // essa base ser carregada, já que nenhuma outra fonte hoje traz esses três campos.
    necessitaAgendamento: null,
    statusAgendamento: '',
    reagendar: ''
  };
}

/* ============================================================
 * 4. DATASTORE — estado central de dados + filtros (padrão Observable simples)
 * ============================================================ */

// Ordem de prioridade quando a mesma NF aparece mais de uma vez na Base Bluesoft
// (viagens/tentativas repetidas) — o resultado mais conclusivo vence.
const BLUESOFT_PRIORITY = ['Entregue', 'Devolução', 'Cancelado', 'Reentrega', 'Em aberto'];

function mapBluesoftStatus(raw) {
  const s = normalizeHeaderKey(raw || '');
  if (s === 'entregue') return 'Entregue';
  if (s === 'devolucao') return 'Devolução';
  if (s === 'cancelado') return 'Cancelado';
  if (s === 'reentrega') return 'Reentrega';
  if (s === 'em aberto') return 'Em aberto';
  return null;
}

const DataStore = (() => {
  let rawRecords = [];      // registros normalizados, sem filtro
  let filters = emptyFilters();
  let lastUpdated = null;
  let bluesoftStatusByNF = new Map(); // NF -> status consolidado ('Entregue'|'Reentrega'|'Devolução'|'Cancelado'|'Em aberto')
  let clienteInfoByName = new Map(); // nome do cliente (normalizado) -> { vendedor, grupoEconomico }
  let clienteEntriesList = []; // todas as linhas da Planilha1 (mesmo nomes repetidos), para o fallback por substring
  let agendamentoByNF = new Map(); // NF -> { dataAgendamento, necessitaAgendamento, statusAgendamento, reagendar }
  const listeners = new Set();

  function emptyFilters() {
    return {
      dataInicio: null,
      dataFim: null,
      mes: '',       // '1'..'12'
      ano: '',       // 'YYYY'
      situacaoFiltro: '', // valor de r.situacao (Entregue, Em aberto, Agendado, Devolução, etc.)
      transportadora: '',
      motorista: '',
      vendedor: '',
      cliente: '',
      cidade: '',
      busca: ''
    };
  }

  function notify() {
    listeners.forEach(fn => fn(getFilteredRecords()));
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  async function loadFromUrl(url, format = 'csv') {
    const adapter = DataAdapters[format];
    if (!adapter || !adapter.loadFromUrl) throw new Error(`Adapter "${format}" não suporta carregamento por URL.`);
    const rawRows = await adapter.loadFromUrl(url);
    setRawRows(rawRows);
  }

  async function loadFromFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    let format = 'csv';
    if (ext === 'json') format = 'json';
    else if (ext === 'csv' || ext === 'txt') format = 'csv';
    else if (ext === 'xlsx' || ext === 'xls') {
      throw new Error(
        'Arquivos .xlsx não podem ser lidos diretamente pelo navegador sem uma biblioteca externa. ' +
        'No Excel, use "Salvar como" e escolha o formato CSV (UTF-8) — o dashboard lê o CSV automaticamente.'
      );
    }
    const adapter = DataAdapters[format];
    const rawRows = await adapter.loadFromFile(file);
    setRawRows(rawRows);
  }

  function setRawRows(rawRows) {
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      throw new Error('O arquivo foi lido, mas nenhum registro foi encontrado.');
    }
    rawRecords = rawRows.map(normalizeRecord);
    lastUpdated = new Date();
    applyBluesoftEnrichment();
    applyClienteEnrichment();
    applyAgendamentoEnrichment();
    notify();
  }

  /**
   * Carrega a "Base Bluesoft Entregas" (coluna NF + coluna Z "STATUS") como fonte
   * complementar: quando a coluna M (Situação/Lincros) não encontra a nota, usamos aqui
   * o status real de entrega (Entregue/Reentrega/Devolução/Cancelado/Em aberto).
   */
  async function loadBluesoftFromUrl(url, format = 'csv') {
    const adapter = DataAdapters[format];
    const rawRows = await adapter.loadFromUrl(url);
    indexBluesoftRows(rawRows);
    applyBluesoftEnrichment();
    applyClienteEnrichment();
    applyAgendamentoEnrichment();
    notify();
  }

  async function loadBluesoftFromFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const format = ext === 'json' ? 'json' : 'csv';
    const rawRows = await DataAdapters[format].loadFromFile(file);
    indexBluesoftRows(rawRows);
    applyBluesoftEnrichment();
    applyClienteEnrichment();
    applyAgendamentoEnrichment();
    notify();
  }

  function indexBluesoftRows(rawRows) {
    const map = new Map();
    for (const row of rawRows) {
      const headerIndex = buildHeaderIndex(row);
      // Aceita tanto o CSV enxuto (NF; Status Bluesoft) quanto uma exportação bruta
      // da aba "Base Bluesoft Entregas" (cabeçalhos reais: "N° NF/CF" e "STATUS").
      const nfHeader = FIELD_ALIASES.nf.map(a => headerIndex[a]).find(h => h !== undefined);
      const statusHeader = ['status bluesoft', 'status'].map(a => headerIndex[a]).find(h => h !== undefined);
      const nf = String((nfHeader !== undefined ? row[nfHeader] : '') || '').trim();
      const status = mapBluesoftStatus(statusHeader !== undefined ? row[statusHeader] : '');
      if (!nf || !status) continue;

      // Uma NF pode aparecer em várias viagens/tentativas — fica a linha com o status
      // mais conclusivo (ex.: "Entregue" vence "Em aberto" da mesma nota).
      const existing = map.get(nf);
      if (existing && BLUESOFT_PRIORITY.indexOf(existing.status) <= BLUESOFT_PRIORITY.indexOf(status)) continue;

      map.set(nf, {
        status,
        cliente: pickField(row, headerIndex, 'cliente'),
        transportadora: pickField(row, headerIndex, 'transportadora'),
        motorista: pickField(row, headerIndex, 'motorista'),
        cidade: pickField(row, headerIndex, 'cidade'),
        uf: pickField(row, headerIndex, 'uf'),
        valorNF: pickField(row, headerIndex, 'valorNF'),
        dataEntrega: pickField(row, headerIndex, 'dataEntrega')
      });
    }
    bluesoftStatusByNF = map;
  }

  /**
   * Faz o "PROCV" entre a base principal e a Base Bluesoft pela NF, sem duplicar notas:
   *  - Se a NF já existe na base principal mas ficou sem situação (coluna M em branco/#N/D),
   *    completa com o status da Base Bluesoft.
   *  - Se a NF só existe na Base Bluesoft (não está na base principal), cria um registro novo
   *    com os dados que a Base Bluesoft tem disponíveis.
   */
  function applyBluesoftEnrichment() {
    if (bluesoftStatusByNF.size === 0) return;

    const existingNFs = new Set(rawRecords.map(r => r.nf));

    for (const r of rawRecords) {
      if (r.situacao !== 'NF Não encontrada') continue;
      const info = bluesoftStatusByNF.get(r.nf);
      if (!info) continue;
      r.situacao = info.status;
      if (info.status === 'Entregue') r.status = 'ENTREGUE';
    }

    for (const [nf, info] of bluesoftStatusByNF) {
      if (existingNFs.has(nf)) continue;
      const status = info.status === 'Entregue' ? 'ENTREGUE' : 'EM_ABERTO';
      rawRecords.push({
        nf,
        cliente: String(info.cliente || 'Não informado').trim() || 'Não informado',
        grupoEconomico: '',
        transportadora: String(info.transportadora || 'Não informado').trim() || 'Não informado',
        motorista: String(info.motorista || 'Não informado').trim() || 'Não informado',
        vendedor: 'Não informado',
        supervisor: '',
        cidade: String(info.cidade || 'Não informado').trim() || 'Não informado',
        uf: String(info.uf || '').trim().toUpperCase(),
        status,
        prazoStatus: normalizePrazo('', status),
        valorNF: parseMoney(info.valorNF),
        dataEmissao: null,
        dataAgendamento: null,
        dataFaturamento: null,
        dataEntrega: Utils.parseDate(info.dataEntrega),
        situacao: info.status
      });
      existingNFs.add(nf);
    }
  }

  /**
   * Carrega a "Planilha1" (Cliente + Vendedor + CNPJ + Grupo Econômico) como fonte
   * de vendedor para notas que vieram da Base Bluesoft (sem vendedor próprio) — cruzada
   * pelo nome do cliente, já que os registros dessas notas não trazem CNPJ.
   */
  async function loadClientesFromUrl(url, format = 'csv') {
    const adapter = DataAdapters[format];
    const rawRows = await adapter.loadFromUrl(url);
    indexClienteRows(rawRows);
    applyClienteEnrichment();
    notify();
  }

  async function loadClientesFromFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const format = ext === 'json' ? 'json' : 'csv';
    const rawRows = await DataAdapters[format].loadFromFile(file);
    indexClienteRows(rawRows);
    applyClienteEnrichment();
    notify();
  }

  function indexClienteRows(rawRows) {
    const map = new Map();
    const entries = [];
    for (const row of rawRows) {
      const headerIndex = buildHeaderIndex(row);
      const clienteHeader = FIELD_ALIASES.cliente.map(a => headerIndex[a]).find(h => h !== undefined);
      const vendedorHeader = FIELD_ALIASES.vendedor.map(a => headerIndex[a]).find(h => h !== undefined);
      const grupoHeader = FIELD_ALIASES.grupoEconomico.map(a => headerIndex[a]).find(h => h !== undefined);
      const cliente = clienteHeader !== undefined ? row[clienteHeader] : '';
      const key = normalizeClienteKey(cliente);
      if (!key) continue;
      const vendedor = vendedorHeader !== undefined ? String(row[vendedorHeader] || '').trim() : '';
      const grupoEconomico = grupoHeader !== undefined ? row[grupoHeader] : '';
      entries.push({ key, vendedor, grupoEconomico });
      if (!map.has(key)) map.set(key, { vendedor, grupoEconomico }); // primeira ocorrência do nome já basta
    }
    clienteInfoByName = map;
    clienteEntriesList = entries;
  }

  function applyClienteEnrichment() {
    if (clienteInfoByName.size === 0) return;

    // 0ª passada: correções manuais (cliente ausente da Planilha1, ou cadastrado só em
    // outra filial/UF da mesma rede).
    for (const r of rawRecords) {
      if (r.vendedor && r.vendedor !== 'Não informado') continue;
      const vendedor = CLIENTE_VENDEDOR_OVERRIDES[normalizeClienteKey(r.cliente)];
      if (vendedor) r.vendedor = vendedor;
    }

    // 1ª passada: correspondência exata pelo nome do cliente.
    for (const r of rawRecords) {
      if (r.vendedor && r.vendedor !== 'Não informado') continue;
      const info = clienteInfoByName.get(normalizeClienteKey(r.cliente));
      if (!info) continue;
      if (info.vendedor) r.vendedor = String(info.vendedor).trim();
      if (!r.grupoEconomico && info.grupoEconomico) r.grupoEconomico = String(info.grupoEconomico).trim();
    }

    // 2ª passada: quando a nota só traz a razão social da matriz (ex.: "SENDAS DISTRIBUIDORA
    // S/A"), mas a Planilha1 só cadastra as filiais (ex.: "ASSAI - SENDAS DISTRIBUIDORA S/A -
    // CAMPINAS"), considera matriz e filiais como do mesmo vendedor responsável (decisão do
    // usuário) — usa o vendedor mais frequente entre as filiais cujo nome contém o da matriz.
    const missingKeys = new Set();
    for (const r of rawRecords) {
      if (!r.vendedor || r.vendedor === 'Não informado') {
        const key = normalizeClienteKey(r.cliente);
        if (key) missingKeys.add(key);
      }
    }

    const substituteByKey = new Map();
    for (const key of missingKeys) {
      if (key.length < 4) continue; // nomes muito curtos geram falso-positivo por substring
      const votes = new Map();
      for (const entry of clienteEntriesList) {
        if (entry.vendedor && entry.key.includes(key)) {
          votes.set(entry.vendedor, (votes.get(entry.vendedor) || 0) + 1);
        }
      }
      if (votes.size === 0) continue;
      const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
      substituteByKey.set(key, best);
    }

    for (const r of rawRecords) {
      if (r.vendedor && r.vendedor !== 'Não informado') continue;
      const vendedor = substituteByKey.get(normalizeClienteKey(r.cliente));
      if (vendedor) r.vendedor = vendedor;
    }
  }

  /**
   * Carrega a planilha de Agendamentos (NF, Agendado, Data de Agendamento, Status, Reagenda)
   * como fonte única e sempre autoritativa desses campos — cruzada pela NF, por decisão do
   * usuário ("os dados de agendamento sempre abastecidos por ela").
   */
  async function loadAgendamentosFromUrl(url, format = 'csv') {
    const adapter = DataAdapters[format];
    const rawRows = await adapter.loadFromUrl(url);
    indexAgendamentoRows(rawRows);
    applyAgendamentoEnrichment();
    notify();
  }

  async function loadAgendamentosFromFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const format = ext === 'json' ? 'json' : 'csv';
    const rawRows = await DataAdapters[format].loadFromFile(file);
    indexAgendamentoRows(rawRows);
    applyAgendamentoEnrichment();
    notify();
  }

  function indexAgendamentoRows(rawRows) {
    const map = new Map();
    for (const row of rawRows) {
      const headerIndex = buildHeaderIndex(row);
      const nfHeader = FIELD_ALIASES.nf.map(a => headerIndex[a]).find(h => h !== undefined);
      const nfRaw = String((nfHeader !== undefined ? row[nfHeader] : '') || '').trim();
      if (!nfRaw) continue;
      // Nesta planilha a NF vem com sufixo de item/viagem ("170389-1", "170389-2") — a base
      // principal só conhece o número da nota antes do "-".
      const nf = nfRaw.split('-')[0].trim();
      if (!nf) continue;

      const agendadoHeader = FIELD_ALIASES.necessitaAgendamento.map(a => headerIndex[a]).find(h => h !== undefined);
      const statusHeader = headerIndex['status'];
      const reagendaHeader = headerIndex['reagenda'];

      // A mesma NF pode ter mais de uma linha (viagens/itens "-1", "-2"...) — em vez de a
      // última linha simplesmente sobrescrever a anterior, mescla os campos preenchidos, pra
      // uma sub-linha em branco não apagar um dado bom que já veio de outra.
      const existing = map.get(nf) || {};
      const rawDataAgendamento = Utils.parseDate(pickField(row, headerIndex, 'dataAgendamento'));
      const rawStatus = statusHeader !== undefined ? String(row[statusHeader] || '').trim() : '';
      const rawReagenda = reagendaHeader !== undefined ? String(row[reagendaHeader] || '').trim() : '';
      const rawNecessita = agendadoHeader !== undefined && !isBlankOrNA(row[agendadoHeader]);

      map.set(nf, {
        dataAgendamento: rawDataAgendamento || existing.dataAgendamento || null,
        // NF listada na planilha com "Agendado" preenchido (em qualquer sub-linha) = precisa
        // de agendamento; NF fora da lista = não precisa, por decisão do usuário.
        necessitaAgendamento: rawNecessita || !!existing.necessitaAgendamento,
        statusAgendamento: rawStatus || existing.statusAgendamento || '',
        reagendar: rawReagenda || existing.reagendar || ''
      });
    }
    agendamentoByNF = map;
  }

  function applyAgendamentoEnrichment() {
    if (agendamentoByNF.size === 0) return;
    for (const r of rawRecords) {
      const info = agendamentoByNF.get(r.nf);
      if (!info) { r.necessitaAgendamento = false; continue; }
      if (info.dataAgendamento) r.dataAgendamento = info.dataAgendamento;
      r.necessitaAgendamento = info.necessitaAgendamento;
      r.statusAgendamento = info.statusAgendamento;
      r.reagendar = info.reagendar;
      // Por pedido do usuário, o Status do Agendamento usa a mesma coluna "Situação" da
      // tabela — não cria coluna própria — e vence a situação calculada da nota.
      if (info.statusAgendamento) r.situacao = info.statusAgendamento;
    }
  }

  function getRecords() { return rawRecords.slice(); }
  function getLastUpdated() { return lastUpdated; }

  function setFilters(partial) {
    filters = { ...filters, ...partial };
    notify();
  }

  function resetFilters() {
    filters = emptyFilters();
    notify();
  }

  function getFilters() { return { ...filters }; }

  function getFilteredRecords() {
    const { dataInicio, dataFim, mes, ano, situacaoFiltro, transportadora, motorista, vendedor, cliente, cidade, busca } = filters;

    return rawRecords.filter(r => {
      const ref = r.dataEntrega || r.dataFaturamento || r.dataAgendamento || r.dataEmissao;

      if (dataInicio && ref && ref < dataInicio) return false;
      if (dataFim && ref && ref > dataFim) return false;
      if (mes && ref && String(ref.getMonth() + 1) !== String(mes)) return false;
      if (ano && ref && String(ref.getFullYear()) !== String(ano)) return false;

      if (situacaoFiltro && r.situacao !== situacaoFiltro) return false;
      if (transportadora && r.transportadora !== transportadora) return false;
      if (motorista && r.motorista !== motorista) return false;
      if (vendedor && r.vendedor !== vendedor) return false;
      if (cliente && r.cliente !== cliente) return false;
      if (cidade && r.cidade !== cidade) return false;

      if (busca) {
        const needle = busca.toLowerCase();
        const haystack = `${r.nf} ${r.cliente} ${r.transportadora} ${r.motorista} ${r.vendedor} ${r.cidade} ${r.situacao}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }

  function getDistinctValues(field) {
    return Utils.uniqueSorted(rawRecords.map(r => r[field]));
  }

  function getAvailableYears() {
    const years = rawRecords
      .map(r => (r.dataEntrega || r.dataFaturamento || r.dataAgendamento || r.dataEmissao))
      .filter(Boolean)
      .map(d => d.getFullYear());
    return Utils.uniqueSorted(years).sort((a, b) => b - a);
  }

  return {
    loadFromUrl, loadFromFile, setRawRows,
    loadBluesoftFromUrl, loadBluesoftFromFile,
    loadClientesFromUrl, loadClientesFromFile,
    loadAgendamentosFromUrl, loadAgendamentosFromFile,
    getRecords, getFilteredRecords, getLastUpdated,
    setFilters, resetFilters, getFilters,
    getDistinctValues, getAvailableYears,
    onChange
  };
})();

