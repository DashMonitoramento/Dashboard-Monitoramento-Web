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
  necessitaAgendamento: ['agendamentos', 'agendado'],
  cnpj: ['cnpj'],
  motivo: ['motivo']
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

/**
 * Chave de cruzamento por CNPJ entre planilhas: mantém só os dígitos e descarta zeros à
 * esquerda. O Excel guarda CNPJ como número (não texto) em algumas abas, o que apaga zeros
 * à esquerda na exportação — descartá-los dos dois lados garante que o mesmo CNPJ bata
 * independente de qual planilha perdeu o zero.
 */
function normalizeCnpj(value) {
  const digits = String(value || '').replace(/\D/g, '').replace(/^0+/, '');
  return digits;
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

// Coluna "Agendado" da Base Bluesoft ("Obriga Agenda" / "Não obriga agenda") — pergunta
// diferente da coluna "Agendado" (Sim/Não) da planilha de Agendamentos: aqui é "o cliente
// exige agendamento", não "essa nota já tem data marcada".
function parseObrigaAgendamentoBluesoft(rawValue) {
  const s = normalizeHeaderKey(rawValue || '');
  if (!s) return null;
  // Só existem 2 valores possíveis nessa coluna ("Obriga Agenda" / "Não obriga agenda"). Uma
  // exportação manual (Salvar Como CSV) da Base Bluesoft às vezes grava "ã" como um único byte
  // inválido em UTF-8 (visto 2026-08-18) — o navegador troca esse byte pelo caractere de
  // substituição U+FFFD, quebrando o "nao obriga" de "n�o obriga" e caindo, por engano, no
  // "obriga" positivo abaixo. O "." no lugar do "a"/"ã" tolera esse caractere sem exigir que o
  // texto esteja limpo.
  if (/n.?o\s+obriga/.test(s)) return false;
  if (s.includes('obriga')) return true;
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
    cnpj: String(get('cnpj') || '').trim(),
    transportadora: String(get('transportadora') || 'Não informado').trim(),
    motorista: String(get('motorista') || 'Não informado').trim(),
    vendedor: String(get('vendedor') || 'Não informado').trim(),
    supervisor: String(get('supervisor') || '').trim(),
    cidade: String(get('cidade') || 'Não informado').trim(),
    uf: String(get('uf') || '').trim().toUpperCase(),
    status,
    // Recalculado logo em seguida por recomputarPrazoStatus() (ver setRawRows/applyBluesoftEnrichment)
    // — não confia mais no texto pronto da planilha, ver comentário lá.
    prazoStatus: 'SEM_INFO',
    prazoDiasPermitidos: null,
    valorNF: parseMoney(get('valorNF')),
    dataEmissao: Utils.parseDate(get('dataEmissao')),
    dataAgendamento,
    dataFaturamento: Utils.parseDate(get('dataFaturamento')),
    dataEntrega,
    // Só existe pra registros vindos da Base Bluesoft (ver applyBluesoftEnrichment) — a aba
    // "NF Aberta" não distingue início de viagem de entrega, então fica nulo aqui.
    dataInicioViagem: null,
    // Idem — só a Bluesoft distingue tentativas repetidas da mesma NF (ver
    // bluesoftDataColetaMaisRecentePorBaseNF/getFilteredRecords).
    dataUltimaTentativaBluesoft: null,
    // Status de Viagem ("Finalizado"/"Em trânsito"/etc.) — só existe pra registros vindos da
    // Base Bluesoft (ver applyBluesoftEnrichment/removerNotasComViagemFinalizadaMasEmAberto).
    viagem: '',
    // Transportadora própria (frota agregada) x transportadora terceirizada — vem da aba
    // RETORNO, coluna "Tipo de Transporte" (ver applyRetornoEnrichment).
    tipoTransporte: 'NÃO INFORMADO',
    situacao,
    // Preenchidos pela planilha de Agendamentos (cruzada por NF) — ficam nulos/vazios até
    // essa base ser carregada, já que nenhuma outra fonte hoje traz esses três campos.
    necessitaAgendamento: null,
    statusAgendamento: '',
    observacaoAgendamento: '',
    reagendar: '',
    // Preenchidos pela planilha de Motivos (Base BI), só para as notas que ela cobre —
    // ver applyMotivoEnrichment. Cobertura parcial (~dez/2025 a abr/2026), por isso não dá
    // pra contar com esses campos pra todo o histórico.
    motivo: '',
    motivoCategoria: ''
  };
}

// Cada regra é testada em ordem contra o texto normalizado (minúsculo, sem acento) do motivo
// bruto vindo da Base BI — a primeira que bater decide a categoria. Texto que não bate em
// nenhuma fica como "Outro" (com o texto original preservado em r.motivo, pra não escondê-lo).
const MOTIVO_CATEGORIAS = [
  { nome: 'Fora do horário/rota', match: s => s.includes('fora de horario') || s.includes('fora de rota') || s.includes('fora do dia de recebimento') },
  { nome: 'Pedido expirado/cancelado/duplicado', match: s => s.includes('pedido expirado') || s.includes('pedido cancelado') || s.includes('duplicidade') || s.includes('substituida') },
  { nome: 'Sem pedido / não localizado', match: s => s.includes('sem pedido') || s.includes('nao estava no sistema') },
  { nome: 'Divergência fiscal/comercial', match: s => s.includes('divergencia') || s.includes('divergência') || s.includes('tributac') || s.includes('cnpj') || s.includes('natureza da operacao') || s.includes('regime especial') || s.includes('erro de faturamento') },
  { nome: 'Cliente fechado/inventário/feriado', match: s => s.includes('inventario') || s.includes('balanco') || s.includes('loja fechada') || s.includes('estabelecimento fechado') || s.includes('encerrou operacao') || s.includes('feriado') },
  { nome: 'Falta de mercadoria / não carregou', match: s => s.includes('falta de mercadoria') || s.includes('nao carregou') || s.includes('nao foi carregad') },
  { nome: 'Qualidade/avaria da mercadoria', match: s => s.includes('qualidade recusada') || s.includes('estufad') || s.includes('amarelad') || s.includes('avaria') || s.includes('tarja preta') },
  { nome: 'Cliente sem espaço/estoque cheio', match: s => s.includes('sem espaco') || s.includes('estoque cheio') || s.includes('recebe no final do mes') },
  { nome: 'Sem agendamento', match: s => s.includes('sem agendamento') || s.includes('agendamento suspenso') || s.includes('nao foi agendado') },
  { nome: 'Problema de sistema/cadastro', match: s => s.includes('sem sistema') || s.includes('problema sistemico') || s.includes('erro de sistema') || s.includes('sem cadastro') || s.includes('nao cadastrado') },
  { nome: 'Cliente recusou/solicitou', match: s => s.includes('recusou') || s.includes('recusado pelo cliente') || s.includes('solicitou') || s.includes('solicitacao comercial') || s.includes('novo pedido') },
  { nome: 'Erro de digitação/pedido', match: s => s.includes('digitad') || s.includes('inversao de produtos') || s.includes('nota incompleta') },
  { nome: 'Extravio/sinistro/pane', match: s => s.includes('extravio') || s.includes('extraviad') || s.includes('assalto') || s.includes('quebrou') || s.includes('permissao na via') },
  { nome: 'Excesso de veículos', match: s => s.includes('excesso de veiculo') },
  { nome: 'Exigência de padrão do cliente', match: s => s.includes('fora de padrao') || s.includes('so recebe') || s.includes('bonificacao') || s.includes('trocar') }
];

function categorizeMotivo(rawMotivo) {
  const s = normalizeHeaderKey(rawMotivo);
  for (const cat of MOTIVO_CATEGORIAS) {
    if (cat.match(s)) return cat.nome;
  }
  return 'Outro';
}

/* ============================================================
 * 4. DATASTORE — estado central de dados + filtros (padrão Observable simples)
 * ============================================================ */

/**
 * Fallback por UF pro filtro "Região Comercial" — mesma regra da aba "Orientacoes" da
 * planilha Mapa_Dashboard_Regioes_Comerciais.xlsx ("Regra SP: São Paulo capital, Grande São
 * Paulo, Baixada Santista e Interior de São Paulo. Demais estados: RJ, MG, ES e PR separados;
 * demais UFs agrupadas em Sul, Centro-Oeste, Nordeste e Norte."). Usado só quando a cidade da
 * nota não está no cadastro de 334 cidades (ver regiaoPorCidadeUf) — cobre QUALQUER cidade
 * brasileira pela UF, mesmo uma que nunca apareceu na base até agora. Cidade de SP fora do
 * cadastro cai em "Interior de São Paulo" (RC04), o mesmo padrão já usado no GeoJSON do
 * Dashboard Logístico por Região.
 */
const REGIAO_POR_UF_FALLBACK = {
  SP: 'RC04', RJ: 'RC05', MG: 'RC06', ES: 'RC07', PR: 'RC08',
  RS: 'RC09', SC: 'RC09',
  MT: 'RC10', MS: 'RC10', GO: 'RC10', DF: 'RC10',
  MA: 'RC11', PI: 'RC11', CE: 'RC11', RN: 'RC11', PB: 'RC11', PE: 'RC11', AL: 'RC11', SE: 'RC11', BA: 'RC11',
  AC: 'RC12', RO: 'RC12', RR: 'RC12', AP: 'RC12', PA: 'RC12', TO: 'RC12', AM: 'RC12',
};
const NOME_REGIAO_POR_CODIGO = {
  RC01: 'Capital SP', RC02: 'Grande São Paulo', RC03: 'Baixada Santista', RC04: 'Interior de São Paulo',
  RC05: 'Rio de Janeiro', RC06: 'Minas Gerais', RC07: 'Espírito Santo', RC08: 'Paraná',
  RC09: 'Sul (RS e SC)', RC10: 'Centro-Oeste', RC11: 'Nordeste', RC12: 'Norte',
  RC13: 'Exterior / Não mapeado',
};

// Usada só como critério de desempate (data igual, ou nenhuma das duas linhas tem data) —
// o critério principal é sempre a data mais recente (ver bluesoftCandidatoMaisRecente).
const BLUESOFT_PRIORITY = ['Entregue', 'Devolução', 'Cancelado', 'Reentrega', 'Em aberto'];

/**
 * Decide se `candidato` deve substituir `atual` quando a mesma NF aparece mais de uma vez na
 * Base Bluesoft (viagens/tentativas repetidas). Por decisão do usuário (2026-08-14): vale
 * sempre o registro mais RECENTE por data — não o "mais conclusivo" por categoria. Isso cobre
 * tanto o caso comum (Em aberto numa data → Entregue numa data posterior, onde a mais nova já
 * é a mais conclusiva mesmo) quanto o caso que motivou a mudança (Reentrega numa data, depois
 * Em aberto de novo numa data posterior — saiu com uma transportadora, não foi entregue, saiu
 * de novo com outra; a tentativa mais recente é a que reflete a realidade, mesmo que "menos
 * conclusiva" que a anterior). Sem data em algum dos lados (ou empate exato), cai pra
 * BLUESOFT_PRIORITY como critério de desempate.
 */
function bluesoftCandidatoMaisRecente(atual, candidato) {
  if (!atual) return true;
  const d1 = atual._dataEntregaParsed, d2 = candidato._dataEntregaParsed;
  if (d1 && d2) {
    const cmp = d2.getTime() - d1.getTime();
    if (cmp !== 0) return cmp > 0;
    return BLUESOFT_PRIORITY.indexOf(candidato.status) < BLUESOFT_PRIORITY.indexOf(atual.status);
  }
  if (d2 && !d1) return true;
  if (!d2 && d1) return false;
  return BLUESOFT_PRIORITY.indexOf(candidato.status) < BLUESOFT_PRIORITY.indexOf(atual.status);
}

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
  // NF base (sem sufixo) -> data de coleta mais ANTIGA entre TODAS as linhas da Bluesoft com
  // essa NF, mesmo repetindo o mesmo sufixo (ex.: duas linhas "178473-1", uma de julho e outra
  // de agosto — a mesma viagem reexportada depois de resolvida). Calculado à parte de
  // bluesoftStatusByNF porque aquele já reduz a UMA linha por sufixo exato (a mais recente),
  // perdendo a data mais antiga se o sufixo se repetir — ver indexBluesoftRows.
  let bluesoftDataColetaMaisAntigaPorBaseNF = new Map();
  // Contraparte "mais recente" do mapa acima — usada só como RESERVA pro filtro de
  // Período/Mês/Ano (ver getFilteredRecords), quando a nota não tem Data de Faturamento na
  // Base BI (decisão do usuário, 2026-08-17): nesse caso, uma nota com mais de uma
  // tentativa (ex.: reentrega em junho, entregue em julho) passa a contar no mês da
  // tentativa MAIS recente, não da mais antiga — reflete melhor "o que aconteceu esse mês"
  // no relatório de Registros detalhados. Não afeta "Data Coleta" (r.dataEntrega) nem o
  // card "Total geral de notas", que continuam usando a mais antiga de propósito.
  let bluesoftDataColetaMaisRecentePorBaseNF = new Map();
  let clienteInfoByName = new Map(); // nome do cliente (normalizado) -> { vendedor, grupoEconomico }
  let clienteInfoByCNPJ = new Map(); // CNPJ (normalizado) -> { vendedor, grupoEconomico } — mais preciso que o nome, distingue filiais
  let clienteEntriesList = []; // todas as linhas da Planilha1 (mesmo nomes repetidos), para o fallback por substring
  let agendamentoByNF = new Map(); // NF -> { dataAgendamento, necessitaAgendamento, statusAgendamento, reagendar }
  let motivoByNfStatus = new Map(); // "NF|Situação" -> motivo bruto (cobertura parcial, ver Base BI)
  let retornoInfoByNF = new Map(); // NF -> { prazoDias, tipoTransporte } (aba RETORNO)
  // Nome da transportadora (normalizado) -> tipo de transporte mais frequente entre as notas
  // dela na aba RETORNO — usado como reserva pras ~77% das notas que a aba não cobre (ver
  // applyRetornoEnrichment). Só serve pra tipoTransporte (propriedade fixa da transportadora);
  // o prazo em dias fica de fora do fallback, pois pode variar por rota/cliente/pedido.
  let retornoTipoPorTransportadora = new Map();
  // NF (base) -> Data de Faturamento (aba "Base BI" da planilha, coluna "Data faturamento") —
  // por decisão do usuário (2026-08-17), essa passou a ser a data prioritária pro filtro de
  // Período/Mês (ver getFilteredRecords/getAvailableYears), no lugar da Data de Coleta: uma
  // nota coletada num mês só é faturada no mês seguinte às vezes, e o relatório de "Registros
  // detalhados" precisa contar pelo mês de faturamento nesses casos.
  let faturamentoPorNF = new Map();
  // "cidade|uf" (normalizado) -> código da região comercial (RC01..RC12) — cadastro da
  // planilha Mapa_Dashboard_Regioes_Comerciais.xlsx (aba "Cadastro Regioes"), usado pelo filtro
  // "Região Comercial" da barra lateral. Só cobre cidades que já tiveram nota (334 no
  // cadastro); cidade fora dessa lista cai no fallback por UF (REGIAO_POR_UF_FALLBACK).
  let regiaoPorCidadeUf = new Map();
  const listeners = new Set();

  function emptyFilters() {
    return {
      dataInicio: null,
      dataFim: null,
      mes: '',       // '1'..'12'
      ano: '',       // 'YYYY'
      // Todos os filtros de múltipla escolha abaixo seguem o mesmo padrão: array de valores
      // marcados (vazio = todos, sem filtro) — mesma convenção do checkbox de Status.
      situacaoFiltro: [],
      transportadora: [],
      tipoTransporte: [],
      motorista: [],
      vendedor: [],
      cliente: [],
      cidade: [],
      regiaoComercial: [],
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
    const dataMaisAntigaPorBaseNF = new Map();
    const dataMaisRecentePorBaseNF = new Map();
    for (const row of rawRows) {
      const headerIndex = buildHeaderIndex(row);
      // Aceita tanto o CSV enxuto (NF; Status Bluesoft) quanto uma exportação bruta
      // da aba "Base Bluesoft Entregas" (cabeçalhos reais: "N° NF/CF" e "STATUS").
      const nfHeader = FIELD_ALIASES.nf.map(a => headerIndex[a]).find(h => h !== undefined);
      const statusHeader = ['status bluesoft', 'status'].map(a => headerIndex[a]).find(h => h !== undefined);
      const nf = String((nfHeader !== undefined ? row[nfHeader] : '') || '').trim();
      const status = mapBluesoftStatus(statusHeader !== undefined ? row[statusHeader] : '');
      if (!nf || !status) continue;

      const dataEntregaRaw = pickField(row, headerIndex, 'dataEntrega');
      const dataEntregaParsed = Utils.parseDate(dataEntregaRaw);
      // Coluna "Agendado" opcional (nem todo CSV de Bluesoft já exportado tem essa coluna
      // ainda) — "Obriga Agenda" / "Não obriga agenda". Ausente, fica null e não afeta nada
      // (ver applyBluesoftEnrichment: só define necessitaAgendamento quando não é null).
      const agendadoHeader = headerIndex['agendado'];
      const agendadoRaw = agendadoHeader !== undefined ? String(row[agendadoHeader] || '').trim() : '';
      // Coluna "Viagem" opcional (Status de Viagem: "Finalizado"/"Em trânsito"/etc.) — CSVs
      // antigos sem essa coluna ficam com '' (nunca bate 'Finalizado', não muda nada). Ver
      // removerNotasComViagemFinalizadaMasEmAberto, mais abaixo.
      const viagemHeader = headerIndex['viagem'];
      const viagemRaw = viagemHeader !== undefined ? String(row[viagemHeader] || '').trim() : '';
      const candidato = {
        status,
        cliente: pickField(row, headerIndex, 'cliente'),
        transportadora: pickField(row, headerIndex, 'transportadora'),
        motorista: pickField(row, headerIndex, 'motorista'),
        cidade: pickField(row, headerIndex, 'cidade'),
        uf: pickField(row, headerIndex, 'uf'),
        valorNF: pickField(row, headerIndex, 'valorNF'),
        dataEntrega: dataEntregaRaw,
        _dataEntregaParsed: dataEntregaParsed,
        cnpj: pickField(row, headerIndex, 'cnpj'),
        necessitaAgendamento: parseObrigaAgendamentoBluesoft(agendadoRaw),
        viagem: viagemRaw
      };

      // Data de coleta mais antiga por NF BASE — calculada aqui, sobre TODAS as linhas brutas,
      // porque o mapa abaixo (bluesoftStatusByNF) reduz a UMA linha por sufixo EXATO (a mais
      // recente); se o mesmo sufixo aparecer mais de uma vez (a mesma viagem reexportada depois
      // de resolvida, ex.: "178473-1" uma vez em julho e de novo em agosto), a ocorrência mais
      // antiga se perderia antes de chegar aqui. Ver applyBluesoftEnrichment/decisão 2026-08-16.
      if (dataEntregaParsed) {
        const baseNf = nf.split('-')[0];
        const maisAntiga = dataMaisAntigaPorBaseNF.get(baseNf);
        if (!maisAntiga || dataEntregaParsed < maisAntiga) dataMaisAntigaPorBaseNF.set(baseNf, dataEntregaParsed);
        const maisRecente = dataMaisRecentePorBaseNF.get(baseNf);
        if (!maisRecente || dataEntregaParsed > maisRecente) dataMaisRecentePorBaseNF.set(baseNf, dataEntregaParsed);
      }

      // Uma NF pode aparecer em várias viagens/tentativas — fica a linha mais recente por data
      // (ver bluesoftCandidatoMaisRecente).
      if (!bluesoftCandidatoMaisRecente(map.get(nf), candidato)) continue;
      map.set(nf, candidato);
    }
    bluesoftStatusByNF = map;
    bluesoftDataColetaMaisAntigaPorBaseNF = dataMaisAntigaPorBaseNF;
    bluesoftDataColetaMaisRecentePorBaseNF = dataMaisRecentePorBaseNF;
  }

  /**
   * Faz o "PROCV" entre a base principal e a Base Bluesoft pela NF, sem duplicar notas:
   *  - Se a NF já existe na base principal mas ficou sem situação (coluna M em branco/#N/D),
   *    completa com o status da Base Bluesoft.
   *  - Se a NF só existe na Base Bluesoft (não está na base principal), cria um registro novo
   *    com os dados que a Base Bluesoft tem disponíveis.
   *
   * "Valor NF" por decisão do usuário (2026-08-15, revendo a decisão de 2026-08-14): quando a
   * nota existe nas duas bases, o "Valor NF" da Base Bluesoft é quem vale agora — confirmado
   * com o usuário comparando direto com a planilha de origem que o valor da Bluesoft é o
   * correto/atualizado (ex.: NF 185310, R$10.489,20 na Bluesoft vs R$148.584,00 desatualizado
   * na planilha principal). Mesmo critério do status: Bluesoft sempre vence quando conhece a
   * nota; o valor da planilha principal só continua valendo pras notas que a Bluesoft não tem.
   */
  function applyBluesoftEnrichment() {
    if (bluesoftStatusByNF.size === 0) return;

    // bluesoftStatusByNF é indexado pela NF COM sufixo de viagem/item (ex.: "138124-1"), mas a
    // base principal ("NF Aberta") não tem esse sufixo — comparando a NF completa, a mesma nota
    // física "não batia" nunca, e a nota acabava duplicada: uma vez vinda da base principal,
    // outra empurrada de novo pela Bluesoft (confirmado: 495 das 503 notas da base principal
    // também existem na Bluesoft). Um índice auxiliar por NF base resolve os dois lados.
    // Sufixos diferentes (item/viagem) da mesma NF base também usam a data mais recente pra
    // decidir qual prevalece (mesmo critério de bluesoftCandidatoMaisRecente).
    const bluesoftByBaseNF = new Map();
    for (const [nf, info] of bluesoftStatusByNF) {
      const baseNf = nf.split('-')[0];
      if (bluesoftCandidatoMaisRecente(bluesoftByBaseNF.get(baseNf), info)) {
        bluesoftByBaseNF.set(baseNf, { ...info, nfCompleta: nf });
      }
    }
    // Data de Coleta por NF base = a mais ANTIGA entre TODAS as linhas brutas da Bluesoft (não
    // só entre sufixos distintos — o mesmo sufixo pode se repetir, ver indexBluesoftRows) — por
    // decisão do usuário (2026-08-16): uma nota que saiu pra entrega em julho e só foi resolvida
    // (reentrega/devolução) em agosto continua contando em julho, que foi quando ela realmente
    // entrou no sistema. Status/Valor/etc. continuam vindo da tentativa MAIS recente
    // (bluesoftByBaseNF) — só a data usada pro filtro de Período/"Data Coleta" muda de critério.
    const earliestDataEntregaByBaseNF = bluesoftDataColetaMaisAntigaPorBaseNF;
    const existingBaseNFs = new Set(rawRecords.map(r => r.nf.split('-')[0]));

    for (const r of rawRecords) {
      // A Base Bluesoft é a fonte mais confiável e atualizada pro status real de entrega — a
      // planilha principal é atualizada com menos frequência, e a coluna "Situação" dela
      // acumula categorias improvisadas ("Em rota", "Cliente Retira Mercadoria na
      // Transportadora", e até "Reentrega"/"Devolução" desatualizados) que na prática só
      // significam "ainda não resolvido" — igual "Em aberto". Por decisão do usuário
      // (2026-08-14, confirmado comparando direto com a Bluesoft): a Bluesoft sempre vence
      // quando tem informação sobre a NF; a Situação própria da planilha principal só é usada
      // quando a Bluesoft não conhece essa nota.
      const info = bluesoftByBaseNF.get(r.nf.split('-')[0]);
      if (!info) continue;
      // Valor NF: Bluesoft sempre vence quando tem a nota (ver decisão 2026-08-15 no
      // comentário da função) — aplicado incondicionalmente aqui, antes de qualquer outro
      // critério, pra não ficar de fora no caso raro de "Aguardando agendamento" abaixo.
      if (info.valorNF !== null && info.valorNF !== undefined && info.valorNF !== '') {
        r.valorNF = parseMoney(info.valorNF);
      }
      // "Precisa de agendamento" agora vem da própria coluna "Agendado" da Base Bluesoft
      // (mais precisa: usa CNPJ, não nome de cliente) — por decisão do usuário (2026-08-14),
      // no lugar da planilha de Agendamentos, cuja fórmula quebra com frequência. Só aplica
      // quando a coluna existe no CSV (info.necessitaAgendamento não é null) — CSVs antigos
      // sem essa coluna deixam quem já foi definido por outra fonte (ex.: Agendamentos, se
      // ainda estiver em uso) intacto.
      if (info.necessitaAgendamento !== null && info.necessitaAgendamento !== undefined) {
        r.necessitaAgendamento = info.necessitaAgendamento;
      }
      // A Bluesoft não distingue "aguardando agendamento" — pra ela é tudo "Em aberto" igual.
      // Se a planilha principal já classificou como isso (mais específico, vem da flag
      // NECESSITA AGENDAMENTO), não faz sentido rebaixar pra um "Em aberto" genérico. Qualquer
      // status mais conclusivo da Bluesoft (Entregue/Devolução/Cancelado/Reentrega) continua
      // vencendo normalmente — só o "Em aberto" genérico que não sobrescreve esse caso.
      if (r.situacao === 'Aguardando agendamento' && info.status === 'Em aberto') continue;
      r.situacao = info.status;
      r.status = info.status === 'Entregue' ? 'ENTREGUE' : 'EM_ABERTO';
      if (!r.cnpj && info.cnpj) r.cnpj = String(info.cnpj).trim();
      // "Data de Entrega"/"Data Coleta" na Base Bluesoft é, na prática, a data de coleta/início
      // da viagem (confirmado com o usuário) — não a data real de entrega ao cliente. Mesmo
      // assim, precisa preencher r.dataEntrega (não só dataInicioViagem) quando a planilha
      // principal não tem nenhuma data própria — é o mesmo campo usado pelo filtro de Período
      // (Mês/Ano) pra decidir em qual mês a nota conta. Usa a coleta MAIS ANTIGA entre as
      // tentativas dessa NF (earliestDataEntregaByBaseNF), não a da tentativa mais recente —
      // por decisão do usuário (2026-08-16), uma nota conta no mês em que entrou no sistema,
      // mesmo que só tenha sido resolvida (reentrega/devolução) num mês seguinte.
      if (!r.dataEntrega) {
        const dataColeta = earliestDataEntregaByBaseNF.get(r.nf.split('-')[0]);
        if (dataColeta) r.dataEntrega = dataColeta;
      }
      if (!r.dataInicioViagem && info.dataEntrega) r.dataInicioViagem = Utils.parseDate(info.dataEntrega);
      // Reserva pro filtro de Período/Mês/Ano quando não há Data de Faturamento na Base BI
      // (ver getFilteredRecords/decisão do usuário, 2026-08-17) — a tentativa MAIS recente
      // entre as da Bluesoft, não a mais antiga (essa é r.dataEntrega, usada em "Data Coleta"
      // e no card "Total geral de notas", que continuam por critério antigo de propósito).
      r.dataUltimaTentativaBluesoft = bluesoftDataColetaMaisRecentePorBaseNF.get(r.nf.split('-')[0]) || null;
      r.viagem = info.viagem || '';
    }

    // Itera bluesoftByBaseNF (já reduzido à tentativa mais recente por NF base), não
    // bluesoftStatusByNF (uma linha por tentativa) — sem isso, uma NF só-Bluesoft com mais de
    // uma tentativa criava o registro com dados de QUALQUER tentativa (a que aparecesse
    // primeiro no CSV), não necessariamente a mais recente.
    for (const [baseNf, info] of bluesoftByBaseNF) {
      if (existingBaseNFs.has(baseNf)) continue;
      existingBaseNFs.add(baseNf);
      const status = info.status === 'Entregue' ? 'ENTREGUE' : 'EM_ABERTO';
      const dataColeta = earliestDataEntregaByBaseNF.get(baseNf) || Utils.parseDate(info.dataEntrega);
      rawRecords.push({
        nf: info.nfCompleta,
        cliente: String(info.cliente || 'Não informado').trim() || 'Não informado',
        grupoEconomico: '',
        cnpj: String(info.cnpj || '').trim(),
        transportadora: String(info.transportadora || 'Não informado').trim() || 'Não informado',
        motorista: String(info.motorista || 'Não informado').trim() || 'Não informado',
        vendedor: 'Não informado',
        supervisor: '',
        cidade: String(info.cidade || 'Não informado').trim() || 'Não informado',
        uf: String(info.uf || '').trim().toUpperCase(),
        status,
        prazoStatus: 'SEM_INFO', // recalculado logo abaixo por recomputarPrazoStatus()
        prazoDiasPermitidos: null,
        valorNF: parseMoney(info.valorNF),
        dataEmissao: null,
        dataAgendamento: null,
        dataFaturamento: null,
        dataEntrega: dataColeta,
        dataInicioViagem: Utils.parseDate(info.dataEntrega),
        dataUltimaTentativaBluesoft: bluesoftDataColetaMaisRecentePorBaseNF.get(baseNf) || null,
        viagem: info.viagem || '',
        tipoTransporte: 'NÃO INFORMADO',
        situacao: info.status,
        necessitaAgendamento: info.necessitaAgendamento || false,
        statusAgendamento: '',
        observacaoAgendamento: '',
        motivo: '',
        motivoCategoria: ''
      });
    }

    removerNotasComViagemFinalizadaMasEmAberto();
    aplicarReagendarQuandoObrigaAgendamento();
    recomputarPrazoStatus();
  }

  /**
   * Caso raro (1 em ~61 mil notas na base real, 2026-08-18): a viagem na Base Bluesoft já
   * consta como "Finalizado", mas a Situação/Status da nota ainda ficou "Em aberto" — um
   * resíduo/erro do sistema que, na prática, já está resolvido (confirmado com o usuário,
   * casos reportados: NF 145017). Por decisão do usuário, essas notas somem de TODOS os
   * relatórios (não só do filtro de Status), diferente do bug de statusAgendamento resolvido
   * antes (ver getFilteredRecords em data.js), que só afetava o FILTRO, sem remover a nota.
   * Não confundir com "Em aberto" + "Em trânsito"/"Aberto"/"Carregado WMS" — essas continuam
   * genuinamente em aberto e não são tocadas (826+304+158 casos reais, bem mais comuns).
   */
  function removerNotasComViagemFinalizadaMasEmAberto() {
    rawRecords = rawRecords.filter(r => !(r.situacao === 'Em aberto' && r.viagem === 'Finalizado'));
  }

  /**
   * Fonte da verdade pro campo Prazo (Entregue/No Prazo/Atrasado/Sem informação) — não confia
   * mais no texto pronto da planilha principal (a coluna "Prazo" de lá vinha de uma fórmula
   * frágil, e pras notas que só existem na Bluesoft ficava sempre "Sem informação"). Compara o
   * prazo em dias daquela nota específica (aba RETORNO, coluna "Prazo para Entrega" — ver
   * applyRetornoEnrichment) com os dias corridos contados a partir de:
   * - Data de Início de Viagem/Coleta, pras notas que "Não Obriga Agenda" (necessitaAgendamento
   *   false) — pra essas a data de coleta é sempre a referência.
   * - Data de Agendamento, pras notas que "Obriga Agendamento" (necessitaAgendamento true) — a
   *   data de coleta não vale nada aqui; sem uma Data de Agendamento definida ainda, fica "Sem
   *   informação" (quem mostra a etapa dessas notas é o card "Situação de agendamento").
   * Decisão do usuário (2026-08-15).
   */
  /** Nota que "Obriga Agendamento" mas cuja situação é "Reentrega" vira "Reagendar" — por
   * decisão do usuário (2026-08-17): pra quem precisa agendar, uma reentrega na prática
   * significa "precisa reagendar a entrega", não é só mais uma tentativa comum de reentrega.
   * Chamada nos mesmos pontos que recomputarPrazoStatus() — sempre que necessitaAgendamento ou
   * situacao podem ter mudado (enriquecimento da Bluesoft, Agendamentos, edição manual). Usa o
   * necessitaAgendamento FINAL do registro (depois de toda enriquecimento já ter rodado), não
   * o valor visto no momento da leitura da planilha principal — por isso é uma função própria,
   * não faz parte de normalizeSituacao(). */
  function aplicarReagendarQuandoObrigaAgendamento() {
    for (const r of rawRecords) {
      if (r.necessitaAgendamento && r.situacao === 'Reentrega') {
        r.situacao = 'Reagendar';
      }
    }
  }

  function recomputarPrazoStatus() {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    for (const r of rawRecords) {
      if (r.status === 'ENTREGUE') { r.prazoStatus = 'ENTREGUE'; continue; }
      const referencia = r.necessitaAgendamento ? r.dataAgendamento : r.dataInicioViagem;
      if (!referencia) { r.prazoStatus = 'SEM_INFO'; continue; }

      const dataRef = new Date(referencia.getTime());
      dataRef.setHours(0, 0, 0, 0);

      if (r.prazoDiasPermitidos === null || r.prazoDiasPermitidos === undefined) {
        // Sem prazo em dias cadastrado (aba RETORNO) pra essa transportadora/NF. Pras notas com
        // Data de Agendamento já definida (necessitaAgendamento), decisão do usuário
        // (2026-08-16): compara a própria data agendada contra hoje, em vez de ficar presa em
        // "Sem informação" só por faltar o prazo em dias (a data agendada já é, nesse caso, o
        // compromisso que interessa observar). Pras que usam Data de Início de Viagem, mantém
        // "Sem informação" como sempre — não é o cenário que motivou essa mudança.
        r.prazoStatus = r.necessitaAgendamento ? (dataRef < hoje ? 'VENCIDO' : 'DENTRO_PRAZO') : 'SEM_INFO';
        continue;
      }

      const diasCorridos = Math.floor((hoje - dataRef) / 86400000);
      r.prazoStatus = diasCorridos > r.prazoDiasPermitidos ? 'VENCIDO' : 'DENTRO_PRAZO';
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
    const cnpjMap = new Map();
    const entries = [];
    for (const row of rawRows) {
      const headerIndex = buildHeaderIndex(row);
      const clienteHeader = FIELD_ALIASES.cliente.map(a => headerIndex[a]).find(h => h !== undefined);
      const vendedorHeader = FIELD_ALIASES.vendedor.map(a => headerIndex[a]).find(h => h !== undefined);
      const grupoHeader = FIELD_ALIASES.grupoEconomico.map(a => headerIndex[a]).find(h => h !== undefined);
      const cnpjHeader = FIELD_ALIASES.cnpj.map(a => headerIndex[a]).find(h => h !== undefined);
      const cliente = clienteHeader !== undefined ? row[clienteHeader] : '';
      const key = normalizeClienteKey(cliente);
      const vendedor = vendedorHeader !== undefined ? String(row[vendedorHeader] || '').trim() : '';
      const grupoEconomico = grupoHeader !== undefined ? row[grupoHeader] : '';

      // CNPJ identifica a filial exata — ao contrário do nome, que se repete entre filiais
      // de uma mesma rede (ex.: "ATACADÃO S.A.") com vendedores diferentes cada uma.
      const cnpjKey = cnpjHeader !== undefined ? normalizeCnpj(row[cnpjHeader]) : '';
      if (cnpjKey && vendedor && !cnpjMap.has(cnpjKey)) cnpjMap.set(cnpjKey, { vendedor, grupoEconomico });

      if (!key) continue;
      entries.push({ key, vendedor, grupoEconomico });
      if (!map.has(key)) map.set(key, { vendedor, grupoEconomico }); // primeira ocorrência do nome já basta
    }
    clienteInfoByName = map;
    clienteInfoByCNPJ = cnpjMap;
    clienteEntriesList = entries;
  }

  function applyClienteEnrichment() {
    if (clienteInfoByName.size === 0 && clienteInfoByCNPJ.size === 0) return;

    // 0ª passada: cruzamento pelo CNPJ — mais preciso que o nome, pois distingue filiais de
    // uma mesma rede (o CNPJ só está disponível para notas enriquecidas via Base Bluesoft).
    for (const r of rawRecords) {
      if (r.vendedor && r.vendedor !== 'Não informado') continue;
      const cnpjKey = normalizeCnpj(r.cnpj);
      if (!cnpjKey) continue;
      const info = clienteInfoByCNPJ.get(cnpjKey);
      if (!info) continue;
      if (info.vendedor) r.vendedor = String(info.vendedor).trim();
      if (!r.grupoEconomico && info.grupoEconomico) r.grupoEconomico = String(info.grupoEconomico).trim();
    }

    // 1ª passada: correções manuais (cliente ausente da Planilha1, ou cadastrado só em
    // outra filial/UF da mesma rede).
    for (const r of rawRecords) {
      if (r.vendedor && r.vendedor !== 'Não informado') continue;
      const vendedor = CLIENTE_VENDEDOR_OVERRIDES[normalizeClienteKey(r.cliente)];
      if (vendedor) r.vendedor = vendedor;
    }

    // 2ª passada: correspondência exata pelo nome do cliente.
    for (const r of rawRecords) {
      if (r.vendedor && r.vendedor !== 'Não informado') continue;
      const info = clienteInfoByName.get(normalizeClienteKey(r.cliente));
      if (!info) continue;
      if (info.vendedor) r.vendedor = String(info.vendedor).trim();
      if (!r.grupoEconomico && info.grupoEconomico) r.grupoEconomico = String(info.grupoEconomico).trim();
    }

    // 3ª passada: quando a nota só traz a razão social da matriz (ex.: "SENDAS DISTRIBUIDORA
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
      // A coluna "Agendado" hoje cobre praticamente toda NF com um valor Sim/Não (nunca
      // vazia) — checar só "não está vazia" (como antes) marcaria tudo como precisando de
      // agendamento. O valor real é o que importa: "Sim" = precisa agendar (bate 1:1 com
      // Status = "Aguardando agendamento"); "Não" = entrega direta, não precisa.
      const rawNecessita = agendadoHeader !== undefined && normalizeHeaderKey(row[agendadoHeader]) === 'sim';

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
      // agendamentoByNF é indexado pela NF sem sufixo de viagem/item (ver indexAgendamentoRows);
      // registros vindos da Base Bluesoft guardam a NF COM sufixo (ex.: "138124-1") — sem tirar
      // o sufixo aqui, esse cruzamento nunca batia pra nenhuma nota da Bluesoft (só pras ~503
      // da planilha "NF Aberta", cuja NF já vem sem sufixo).
      const info = agendamentoByNF.get(r.nf.split('-')[0]);
      // Antes, "sem info na planilha de Agendamentos" forçava necessitaAgendamento pra false,
      // mesmo que a Base Bluesoft já tivesse determinado que sim (coluna "Agendado" dela) —
      // por decisão do usuário (2026-08-14), essa planilha virou uma fonte OPCIONAL/aditiva:
      // se ela não conhece a nota, mantém o que já foi definido por outra fonte, em vez de
      // zerar. Isso permite abandonar a planilha de Agendamentos aos poucos sem quebrar nada.
      if (!info) { continue; }
      if (info.dataAgendamento) r.dataAgendamento = info.dataAgendamento;
      r.necessitaAgendamento = info.necessitaAgendamento;
      r.statusAgendamento = info.statusAgendamento;
      r.reagendar = info.reagendar;
      // Por decisão do usuário (2026-08-13): o Status do Agendamento NÃO sobrescreve mais a
      // Situação da nota — a Situação continua vindo só da Bluesoft/planilha principal
      // (Entregue/Devolução/Cancelado/Reentrega/Em aberto), pra não perder essa informação nas
      // notas que também aparecem na planilha de Agendamentos.
    }
    aplicarReagendarQuandoObrigaAgendamento();
    recomputarPrazoStatus(); // a Data de Agendamento pode ter mudado acima
  }

  /**
   * Carrega a aba "RETORNO" (consolidação própria do usuário, cruzando Base Bluesoft + Base
   * Lincros + Base BI) — usada aqui só por duas colunas: "Prazo para Entrega" (dias, usado
   * por recomputarPrazoStatus) e "Tipo de Transporte" (Transportadora x Agregado, usado pelo
   * filtro de Transporte). Por decisão do usuário (2026-08-15).
   */
  async function loadRetornoFromUrl(url, format = 'csv') {
    const adapter = DataAdapters[format];
    const rawRows = await adapter.loadFromUrl(url);
    indexRetornoRows(rawRows);
    applyRetornoEnrichment();
    notify();
  }

  async function loadRetornoFromFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const format = ext === 'json' ? 'json' : 'csv';
    const rawRows = await DataAdapters[format].loadFromFile(file);
    indexRetornoRows(rawRows);
    applyRetornoEnrichment();
    notify();
  }

  function indexRetornoRows(rawRows) {
    const map = new Map();
    // nome da transportadora (normalizado) -> Map<tipo, contagem> — pra decidir o tipo mais
    // frequente dela (ver comentário em retornoTipoPorTransportadora).
    const contagemPorTransportadora = new Map();
    for (const row of rawRows) {
      const headerIndex = buildHeaderIndex(row);
      const nfHeader = FIELD_ALIASES.nf.map(a => headerIndex[a]).find(h => h !== undefined);
      const nfRaw = String((nfHeader !== undefined ? row[nfHeader] : '') || '').trim();
      if (!nfRaw) continue;
      const nf = nfRaw.split('-')[0].trim();
      if (!nf) continue;
      const prazoHeader = headerIndex['prazo para entrega'];
      const prazoDiasRaw = prazoHeader !== undefined ? parseInt(String(row[prazoHeader]).trim(), 10) : NaN;
      const tipoHeader = headerIndex['tipo de transporte'];
      // Maiúsculas por padrão — a planilha traz uma mistura ("Transportadora", "FROTA
      // PROPRIA", "PROPRIO RETIRA"), e o filtro fica mais consistente com um único padrão.
      const tipoTransporte = tipoHeader !== undefined ? String(row[tipoHeader] || '').trim().toUpperCase() : '';
      map.set(nf, {
        prazoDias: isNaN(prazoDiasRaw) ? null : prazoDiasRaw,
        tipoTransporte
      });

      const transportadorHeader = headerIndex['transportador'];
      const transportadorNome = transportadorHeader !== undefined ? String(row[transportadorHeader] || '').trim() : '';
      if (transportadorNome && tipoTransporte) {
        const chave = normalizeHeaderKey(transportadorNome);
        if (!contagemPorTransportadora.has(chave)) contagemPorTransportadora.set(chave, new Map());
        const contagem = contagemPorTransportadora.get(chave);
        contagem.set(tipoTransporte, (contagem.get(tipoTransporte) || 0) + 1);
      }
    }
    retornoInfoByNF = map;

    const tipoPorTransportadora = new Map();
    for (const [nome, contagem] of contagemPorTransportadora) {
      let melhorTipo = null, melhorContagem = 0;
      for (const [tipo, contagemTipo] of contagem) {
        if (contagemTipo > melhorContagem) { melhorTipo = tipo; melhorContagem = contagemTipo; }
      }
      tipoPorTransportadora.set(nome, melhorTipo);
    }
    retornoTipoPorTransportadora = tipoPorTransportadora;
  }

  function applyRetornoEnrichment() {
    if (retornoInfoByNF.size === 0 && retornoTipoPorTransportadora.size === 0) return;
    for (const r of rawRecords) {
      const info = retornoInfoByNF.get(r.nf.split('-')[0]);
      if (info && info.prazoDias !== null) r.prazoDiasPermitidos = info.prazoDias;

      // A aba RETORNO cobre só uma fração das notas (ver decisão do usuário, 2026-08-15) — pra
      // NF que ela não conhece o tipo (não está na aba, OU está mas com a coluna "Tipo de
      // Transporte" em branco — bug corrigido em 2026-08-16: antes, ter uma linha na aba só
      // pra prazo, sem tipo preenchido, já bastava pra pular esse fallback e deixar a nota
      // presa em "Não informado" à toa), assume o tipo mais frequente já visto pra essa
      // transportadora em outras notas (o tipo é uma característica fixa da transportadora,
      // não varia por nota).
      if (info && info.tipoTransporte) {
        r.tipoTransporte = info.tipoTransporte;
      } else {
        const tipoPorNome = retornoTipoPorTransportadora.get(normalizeHeaderKey(r.transportadora));
        if (tipoPorNome) r.tipoTransporte = tipoPorNome;
      }
    }
    aplicarReagendarQuandoObrigaAgendamento();
    recomputarPrazoStatus();
  }

  /**
   * Carrega a Data de Faturamento por NF (aba "Base BI", coluna "Data faturamento" — ver
   * scripts/atualizar-dados-dashboard.ps1/Extrair-Faturamento). Cobertura completa (toda linha
   * com NF preenchido, não só as com motivo registrado como em loadMotivosFromUrl abaixo).
   * Decisão do usuário (2026-08-17): essa passou a ser a data prioritária pro filtro de
   * Período/Mês/Ano — ver applyFaturamentoEnrichment e getFilteredRecords/getAvailableYears.
   */
  async function loadFaturamentoFromUrl(url, format = 'csv') {
    const adapter = DataAdapters[format];
    const rawRows = await adapter.loadFromUrl(url);
    indexFaturamentoRows(rawRows);
    applyFaturamentoEnrichment();
    notify();
  }

  async function loadFaturamentoFromFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const format = ext === 'json' ? 'json' : 'csv';
    const rawRows = await DataAdapters[format].loadFromFile(file);
    indexFaturamentoRows(rawRows);
    applyFaturamentoEnrichment();
    notify();
  }

  function indexFaturamentoRows(rawRows) {
    const map = new Map();
    for (const row of rawRows) {
      const headerIndex = buildHeaderIndex(row);
      const nfHeader = FIELD_ALIASES.nf.map(a => headerIndex[a]).find(h => h !== undefined);
      const nfRaw = String((nfHeader !== undefined ? row[nfHeader] : '') || '').trim();
      if (!nfRaw) continue;
      const nf = nfRaw.split('-')[0].trim();
      if (!nf) continue;
      const dataFaturamentoHeader = headerIndex['data faturamento'];
      const dataFaturamento = dataFaturamentoHeader !== undefined ? Utils.parseDate(row[dataFaturamentoHeader]) : null;
      if (dataFaturamento) map.set(nf, dataFaturamento);
    }
    faturamentoPorNF = map;
  }

  /** Sobrescreve r.dataFaturamento com o valor da Base BI (fonte dedicada e mais confiável pra
   * esse campo especificamente — antes ele só vinha, de forma inconsistente, de outras
   * planilhas). Só sobrescreve quando a Base BI TEM a informação; sem ela, mantém o que já
   * existia (ex.: notas só-Bluesoft, cobertas só por Data de Coleta). */
  function applyFaturamentoEnrichment() {
    if (faturamentoPorNF.size === 0) return;
    for (const r of rawRecords) {
      const dataFaturamento = faturamentoPorNF.get(r.nf.split('-')[0]);
      if (dataFaturamento) r.dataFaturamento = dataFaturamento;
    }
  }

  /**
   * Carrega a planilha de Motivos (extraída da coluna "OBS." da Base BI, único lugar com
   * motivo detalhado que bate com a Situação real da nota) — cruzada por NF + Situação.
   * Cobertura parcial (só ~dez/2025 a abr/2026, a janela da Base BI): sem essa base, os
   * campos motivo/motivoCategoria simplesmente ficam vazios, sem afetar o resto do dashboard.
   */
  async function loadMotivosFromUrl(url, format = 'csv') {
    const adapter = DataAdapters[format];
    const rawRows = await adapter.loadFromUrl(url);
    indexMotivoRows(rawRows);
    applyMotivoEnrichment();
    notify();
  }

  async function loadMotivosFromFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const format = ext === 'json' ? 'json' : 'csv';
    const rawRows = await DataAdapters[format].loadFromFile(file);
    indexMotivoRows(rawRows);
    applyMotivoEnrichment();
    notify();
  }

  function indexMotivoRows(rawRows) {
    const map = new Map();
    for (const row of rawRows) {
      const headerIndex = buildHeaderIndex(row);
      const nfHeader = FIELD_ALIASES.nf.map(a => headerIndex[a]).find(h => h !== undefined);
      const statusHeader = headerIndex['status'];
      const motivoHeader = FIELD_ALIASES.motivo.map(a => headerIndex[a]).find(h => h !== undefined);
      const nf = nfHeader !== undefined ? String(row[nfHeader] || '').trim().split('-')[0] : '';
      const status = statusHeader !== undefined ? String(row[statusHeader] || '').trim() : '';
      const motivo = motivoHeader !== undefined ? String(row[motivoHeader] || '').trim() : '';
      if (!nf || !status || !motivo) continue;
      map.set(`${nf}|${status}`, motivo);
    }
    motivoByNfStatus = map;
  }

  function applyMotivoEnrichment() {
    if (motivoByNfStatus.size === 0) return;
    for (const r of rawRecords) {
      const motivo = motivoByNfStatus.get(`${r.nf.split('-')[0]}|${r.situacao}`);
      if (!motivo) continue;
      r.motivo = motivo;
      r.motivoCategoria = categorizeMotivo(motivo);
    }
  }

  /**
   * Carrega o cadastro cidade -> região comercial (aba "Cadastro Regioes" da planilha
   * Mapa_Dashboard_Regioes_Comerciais.xlsx, mesma fonte do Dashboard Logístico por Região) —
   * usado só pra classificar cada nota numa das 12 regiões (filtro "Região Comercial" da
   * barra lateral). Opcional: sem essa base, o filtro simplesmente não aparece populado.
   */
  async function loadRegioesFromUrl(url, format = 'csv') {
    const adapter = DataAdapters[format];
    const rawRows = await adapter.loadFromUrl(url);
    indexRegioesRows(rawRows);
    applyRegiaoEnrichment();
    notify();
  }

  async function loadRegioesFromFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const format = ext === 'json' ? 'json' : 'csv';
    const rawRows = await DataAdapters[format].loadFromFile(file);
    indexRegioesRows(rawRows);
    applyRegiaoEnrichment();
    notify();
  }

  function indexRegioesRows(rawRows) {
    const map = new Map();
    for (const row of rawRows) {
      const headerIndex = buildHeaderIndex(row);
      const cidadeHeader = headerIndex['cidade'];
      const ufHeader = headerIndex['uf'];
      const codigoHeader = headerIndex['codigo'];
      const cidade = cidadeHeader !== undefined ? String(row[cidadeHeader] || '').trim() : '';
      const uf = ufHeader !== undefined ? String(row[ufHeader] || '').trim().toUpperCase() : '';
      const codigo = codigoHeader !== undefined ? String(row[codigoHeader] || '').trim().toUpperCase() : '';
      if (!cidade || !uf || !codigo) continue;
      map.set(`${normalizeHeaderKey(cidade)}|${uf}`, codigo);
    }
    regiaoPorCidadeUf = map;
  }

  /** Toda nota recebe uma região (mesmo sem UF reconhecida cai em "Não classificado") — cidade
   * exata primeiro (cadastro de 334 cidades), senão pela UF (REGIAO_POR_UF_FALLBACK, cobre
   * qualquer UF válida do Brasil). */
  function applyRegiaoEnrichment() {
    for (const r of rawRecords) {
      const chaveCidade = `${normalizeHeaderKey(r.cidade || '')}|${(r.uf || '').toUpperCase()}`;
      const codigo = regiaoPorCidadeUf.get(chaveCidade) || REGIAO_POR_UF_FALLBACK[(r.uf || '').toUpperCase()];
      r.regiaoComercial = (codigo && NOME_REGIAO_POR_CODIGO[codigo]) || 'Não classificado';
    }
  }

  // Nome -> código (RC01..RC13), o inverso de NOME_REGIAO_POR_CODIGO — usado pelo Dashboard
  // Logístico por Região (mapa-regioes/, embutido em iframe) pra montar os dados ao vivo a
  // partir dos registros já filtrados (ver enviarDadosRegioesParaIframe em dashboard.js).
  const CODIGO_POR_NOME_REGIAO = new Map(
    Object.entries(NOME_REGIAO_POR_CODIGO).map(([codigo, nome]) => [nome, codigo])
  );
  function getCodigoRegiaoComercial(nome) { return CODIGO_POR_NOME_REGIAO.get(nome) || null; }
  function getRegioesComerciaisComCodigo() {
    return Object.entries(NOME_REGIAO_POR_CODIGO).map(([codigo, nome]) => ({ codigo, nome }));
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

  // Espelha AGENDAMENTO_ETAPAS_ESPECIFICAS de dashboard.js (não dá pra importar de lá — data.js
  // é carregado antes e não depende desse módulo). Só ESSES 4 valores são etapas que
  // legitimamente vivem em r.statusAgendamento; qualquer outro texto que apareça ali (ex.:
  // "Em aberto", resquício da planilha de Agendamentos numa nota já entregue, ver bug
  // 2026-08-18) não deve casar com o filtro de Status por acidente.
  const AGENDAMENTO_ETAPAS_ESPECIFICAS_FILTRO = ['Agendado', 'Aguardando Confirmação', 'Reagendar', 'Okker', 'Devolução para Terrinha'];

  function getFilteredRecords() {
    const {
      dataInicio, dataFim, mes, ano,
      situacaoFiltro, transportadora, tipoTransporte, motorista, vendedor, cliente, cidade,
      regiaoComercial, busca
    } = filters;

    return rawRecords.filter(r => {
      // Prioriza Data de Faturamento (decisão do usuário, 2026-08-17): uma nota pode ser
      // coletada num mês e faturada só no seguinte — o filtro de Período/Mês/Ano (e por
      // consequência o relatório exportado de "Registros detalhados") passou a contar pelo mês
      // de faturamento nesses casos. Sem faturamento na Base BI (notas só-Bluesoft), usa a
      // tentativa MAIS RECENTE da Bluesoft — não a mais antiga (essa é r.dataEntrega/"Data
      // Coleta", que continua por critério antigo pro card "Total geral de notas").
      const ref = r.dataFaturamento || r.dataUltimaTentativaBluesoft || r.dataEntrega || r.dataAgendamento || r.dataEmissao;

      if (dataInicio && ref && ref < dataInicio) return false;
      if (dataFim && ref && ref > dataFim) return false;
      if (mes && ref && String(ref.getMonth() + 1) !== String(mes)) return false;
      if (ano && ref && String(ref.getFullYear()) !== String(ano)) return false;

      // "Agendado"/"Aguardando Confirmação"/"Reagendar"/"Okker" (decisão do usuário,
      // 2026-08-16) são etapas de r.statusAgendamento (Situação de Agendamento), não valores
      // de r.situacao — pra caberem no MESMO filtro "Status" da barra lateral, uma nota também
      // bate se a etapa de agendamento dela for uma dessas 4 marcadas. Restrito a essas 4
      // (AGENDAMENTO_ETAPAS_ESPECIFICAS_FILTRO), NÃO a r.statusAgendamento inteiro: sem essa
      // restrição, uma nota já Entregue mas com um "Em aberto" esquecido no statusAgendamento
      // (resquício da planilha de Agendamentos que nunca foi atualizado) aparecia por engano
      // ao marcar "Em aberto" no filtro — bug real, 2026-08-18.
      const etapaBate = AGENDAMENTO_ETAPAS_ESPECIFICAS_FILTRO.includes(r.statusAgendamento) &&
        situacaoFiltro && situacaoFiltro.includes(r.statusAgendamento);
      if (situacaoFiltro && situacaoFiltro.length && !situacaoFiltro.includes(r.situacao) && !etapaBate) return false;
      if (transportadora && transportadora.length && !transportadora.includes(r.transportadora)) return false;
      if (tipoTransporte && tipoTransporte.length && !tipoTransporte.includes(r.tipoTransporte)) return false;
      if (motorista && motorista.length && !motorista.includes(r.motorista)) return false;
      if (vendedor && vendedor.length && !vendedor.includes(r.vendedor)) return false;
      if (cliente && cliente.length && !cliente.includes(r.cliente)) return false;
      if (cidade && cidade.length && !cidade.includes(r.cidade)) return false;
      if (regiaoComercial && regiaoComercial.length && !regiaoComercial.includes(r.regiaoComercial)) return false;

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
      .map(r => (r.dataFaturamento || r.dataUltimaTentativaBluesoft || r.dataEntrega || r.dataAgendamento || r.dataEmissao))
      .filter(Boolean)
      .map(d => d.getFullYear());
    return Utils.uniqueSorted(years).sort((a, b) => b - a);
  }

  /**
   * Mescla os agendamentos preenchidos manualmente no site (Firestore, ver
   * Firebase.getAgendamentosManuais() em firebase-init.js) nos registros já carregados.
   * `porNf` é o objeto { [nf sem sufixo]: { statusAgendamento, dataAgendamento, observacao } }.
   * Substitui a antiga dependência da planilha de Agendamentos pra ESSAS informações
   * especificamente — por decisão do usuário (2026-08-14), que prefere digitar a data/status
   * direto no dashboard em vez de manter uma planilha separada com fórmulas frágeis. A
   * observação (2026-08-17) usa `!== undefined` (não um teste de "verdadeiro") de propósito —
   * precisa dar pra limpar o campo salvando uma string vazia, não só preencher.
   */
  function applyAgendamentoManual(porNf) {
    if (!porNf) return;
    for (const r of rawRecords) {
      const info = porNf[r.nf.split('-')[0]];
      if (!info) continue;
      if (info.statusAgendamento) r.statusAgendamento = info.statusAgendamento;
      if (info.dataAgendamento) r.dataAgendamento = Utils.parseDate(info.dataAgendamento);
      if (info.observacao !== undefined) r.observacaoAgendamento = info.observacao;
    }
    aplicarReagendarQuandoObrigaAgendamento();
    recomputarPrazoStatus(); // a Data de Agendamento pode ter mudado acima
    notify();
  }

  return {
    loadFromUrl, loadFromFile, setRawRows,
    loadBluesoftFromUrl, loadBluesoftFromFile,
    loadClientesFromUrl, loadClientesFromFile,
    loadAgendamentosFromUrl, loadAgendamentosFromFile,
    loadMotivosFromUrl, loadMotivosFromFile,
    loadRetornoFromUrl, loadRetornoFromFile,
    loadFaturamentoFromUrl, loadFaturamentoFromFile,
    loadRegioesFromUrl, loadRegioesFromFile,
    applyAgendamentoManual,
    getRecords, getFilteredRecords, getLastUpdated,
    setFilters, resetFilters, getFilters,
    getDistinctValues, getAvailableYears,
    getCodigoRegiaoComercial, getRegioesComerciaisComCodigo,
    onChange
  };
})();

