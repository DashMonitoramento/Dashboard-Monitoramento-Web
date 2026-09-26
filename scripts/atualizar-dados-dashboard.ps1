<#
  atualizar-dados-dashboard.ps1

  Substitui o processo manual de "abrir cada aba no Excel, Salvar Como CSV, conferir
  acentuação, subir um por um pelo GitHub" descrito em
  "Atualização do B.I\Passo a passo para atualizar os dados do dashboard.docx".

  O que este script faz, em uma unica execucao:
    1. Abre a planilha "Controle Base Do Monitoramento - Consolidado.xlsx" (somente leitura,
       sem travar o arquivo pra ninguem mais).
    2. Le direto das abas "Base Bluesoft", "Agendamentos", "Vendedor x Cliente", "Base BI" e
       "RETORNO", gerando os CSVs correspondentes em assets/data/ já em UTF-8 correto (sem
       risco do erro de "Devolução" virar "Devolu??o" que já aconteceu 3 vezes nessa nem
       sempre confiável exportação manual do Excel). "Agendamentos" e "RETORNO" são
       OPCIONAIS (2026-08-23): se a aba não existir mais na planilha (já aconteceu — foram
       removidas), o script pula só esse arquivo específico com um aviso claro no log, sem
       travar a extração dos outros — o site já não depende criticamente de nenhuma das duas
       (Agendamento vem da própria Base Bluesoft + do que é digitado no site; Prazo tem
       reserva pelo Lead Time Atualizado).
    3. Envia os arquivos atualizados direto pro GitHub via API (sem precisar abrir o
       site do GitHub nem arrastar arquivo nenhum).
    4. Roda gerar-indice-canhotos.ps1 (varre a pasta do SharePoint sincronizada) e envia o
       assets/data/canhotos-index.json atualizado também — 2026-09-10, antes isso era um passo
       manual separado que ninguém lembrava de rodar (ficou ~1 mês desatualizado até uma NF com
       canhoto salvo não aparecer na busca). Isolado em try/catch próprio: se a pasta do
       SharePoint estiver indisponível, só esse passo é pulado, os CSVs principais já foram
       enviados normalmente antes dele.

  NAO esta incluida (fica igual a hoje, manual): a aba "NF Aberta (BI STATUS ENTREGAS)"
  (sample-data.csv, ~503 notas) — o layout dela é um relatório com células mescladas, bem
  mais complexo de ler de forma confiável por script; e muda pouco, então o ganho de
  automatizar seria pequeno perto do risco.

  COMO USAR:
    1. Confira as variáveis de configuração logo abaixo (ExcelPath já deveria estar certo).
    2. Na primeira vez, crie um Personal Access Token no GitHub (Settings > Developer
       settings > Personal access tokens > Fine-grained tokens), com permissão de
       "Contents: Read and write" só no repositório Dashboard-Monitoramento-Web. Copie o
       token gerado (começa com "github_pat_...") e cole (só o token, nada mais) num arquivo
       chamado "github-token.txt" nesta mesma pasta "scripts" — esse arquivo é seu, local,
       nunca é enviado a lugar nenhum por este script.
    3. Rode primeiro com -SomenteExtrair, pra conferir os CSVs gerados em assets/data/ antes
       de mandar pro GitHub:
         powershell -ExecutionPolicy Bypass -File .\atualizar-dados-dashboard.ps1 -SomenteExtrair
    4. Conferido que está tudo certo, rode sem o parâmetro pra extrair E enviar pro GitHub:
         powershell -ExecutionPolicy Bypass -File .\atualizar-dados-dashboard.ps1

  Se algo mudar na estrutura da planilha (nome de aba, coluna removida/renomeada), este
  script provavelmente vai dar erro claro no lugar certo (não silenciosamente errado) — me
  avise pra eu ajustar o mapeamento de colunas.
#>

param(
  [switch]$SomenteExtrair
)

# Qualquer erro (inclusive falha de chamada COM) para a execução na hora, com stack trace —
# sem isso, um erro no meio da extração pode ficar só impresso e o script segue adiante como
# se tivesse dado certo, gerando CSV vazio/incompleto sem avisar.
$ErrorActionPreference = 'Stop'

# ============================================================
# CONFIGURAÇÃO
# ============================================================

$ExcelPath = "C:\Users\Daterrinha87\OneDrive - daterrinhaalimentos.com.br\Área de Trabalho\Atualização do B.I\Controle Base Do Monitoramento - Consolidado.xlsx"
$PastaSaida = Join-Path $PSScriptRoot "..\assets\data"
$TokenFile = Join-Path $PSScriptRoot "github-token.txt"

$GitHubOwner = "DashMonitoramento"
$GitHubRepo = "Dashboard-Monitoramento-Web"
$GitHubBranch = "main"

$xlUp = -4162

# 2026-08-23: as abas eram acessadas por INDICE fixo aqui (.Item("nome") direto já se mostrou
# instável nessa planilha específica). Só que a ORDEM e a QUANTIDADE de abas já mudaram desde
# então (abas removidas/reorganizadas — "Agendamentos" e "RETORNO" nem existem mais hoje, e
# "Vendedor x Cliente" pulou do índice 8 pro 6), e cada vez que isso acontece os índices fixos
# ficavam errados e o script quebrava ou lia a aba errada sem avisar. Trocado pra
# Pegar-AbaPorNome (abaixo) pras abas todas: resolve por NOME percorrendo os índices e
# comparando .Name, em vez de .Item(nome) direto — mantém a mesma estabilidade de antes sem
# depender de uma posição fixa que muda a cada reorganização da planilha.

# ============================================================
# FUNÇÕES DE APOIO
# ============================================================

function Escrever-Log($msg) {
  Write-Output "[$(Get-Date -Format 'HH:mm:ss')] $msg"
}

# Converte um valor de célula do Excel pra texto de data dd/MM/yyyy — datas vêm como
# serial OLE (numero de dias desde 30/12/1899) quando lidas via .Value2, não como texto.
function Formatar-Data($valor) {
  if ($null -eq $valor -or $valor -eq '') { return '' }
  # Célula lida como [DateTime] .NET direto (visto 2026-09-09, aba "Indicador de Frete") em vez
  # do serial OLE numérico de sempre (outras abas) -- sem isso, cai no fallback "return $texto"
  # mais abaixo, que faz ToString() padrão do DateTime e sai "01/05/2026 00:00:00" (com hora),
  # formato que Utils.parseDate (dashboard) não reconhece -- toda linha era descartada calada.
  if ($valor -is [DateTime]) { return $valor.ToString('dd/MM/yyyy') }
  if ($valor -is [double] -or $valor -is [int]) {
    try { return ([DateTime]::FromOADate([double]$valor)).ToString('dd/MM/yyyy') } catch { return '' }
  }
  # Célula formatada como Texto em vez de Data, mas ainda com o serial OLE cru dentro (visto
  # 2026-08-18, num lote reimportado da Base Bluesoft) -- sem isso, o CSV recebe literalmente
  # "46251" no lugar de "17/08/2026" e o dashboard mostra/filtra a nota como se fosse ano 46251.
  $texto = [string]$valor
  if ($texto -match '^\d{5,6}$') {
    $numero = 0.0
    if ([double]::TryParse($texto, [ref]$numero)) {
      try { return ([DateTime]::FromOADate($numero)).ToString('dd/MM/yyyy') } catch { }
    }
  }
  # Célula já é TEXTO puro com data+hora juntos (ex.: "01/05/2026 00:00:00") -- visto de novo
  # 2026-09-09 na aba "Indicador de Frete" mesmo depois do fix acima pra [DateTime], ou seja, é
  # um 3º jeito dessa mesma célula chegar aqui (célula formatada como Texto na planilha, com o
  # texto já pronto com hora, nem [DateTime] nem serial OLE numérico). Pega só a parte antes do
  # espaço -- cobre qualquer um dos 3 formatos de uma vez, sem precisar saber qual é de antemão.
  if ($texto -match '^(\d{1,2}/\d{1,2}/\d{4})\s') { return $Matches[1] }
  return $texto
}

# Converte um valor numerico (Valor NF, CNPJ, etc.) pra texto puro, sem virar notação
# científica (o bug "4,75084E+13" que já aparecia nos CNPJs exportados manualmente) e sem
# separador de milhar (ponto decimal simples — o parseMoney() do dashboard já aceita isso).
function Formatar-Numero($valor) {
  if ($null -eq $valor -or $valor -eq '') { return '' }
  if ($valor -is [double] -or $valor -is [int]) {
    return ([double]$valor).ToString('0.##########', [System.Globalization.CultureInfo]::InvariantCulture)
  }
  return [string]$valor
}

function Formatar-Texto($valor) {
  if ($null -eq $valor) { return '' }
  return ([string]$valor).Trim()
}

# TRUE/FALSE booleano do Excel -> "VERDADEIRO"/"FALSO" (mesma convenção do CSV atual).
function Formatar-Booleano($valor) {
  if ($null -eq $valor -or $valor -eq '') { return '' }
  if ($valor -is [bool]) { return $(if ($valor) { 'VERDADEIRO' } else { 'FALSO' }) }
  return [string]$valor
}

# Acha a ultima linha com dado real numa coluna-chave, subindo a partir do fundo da
# planilha — muito mais confiável que UsedRange.Rows.Count, que nessa planilha vem inflado
# (formatação/formula aplicada até a última linha do Excel, sem dado nenhum de verdade).
function Achar-UltimaLinha($sheet, [int]$colunaChave) {
  return $sheet.Cells($sheet.Rows.Count, $colunaChave).End($xlUp).Row
}

# Lê um retângulo inteiro (linha 1 até $ultimaLinha, coluna 1 até $ultimaColuna) numa única
# chamada COM — ler célula por célula pra dezenas de milhares de linhas seria muito lento
# (cada .Cells(r,c).Text é uma chamada COM separada).
#
# O "return ,$dados" (com a vírgula) é OBRIGATÓRIO aqui, não estético: o PowerShell trata
# qualquer array como uma sequência a "desenrolar" ao sair de uma função (mesmo array
# multidimensional), e no meio do caminho ele vira um array 1D comum — a partir daí,
# "$dados[$r,$c]" deixa de indexar uma célula e passa a devolver uma LISTA de elementos
# (índices r E c juntos), que na conversão pra texto viram "valor1 valor2" concatenados com
# espaço. Foi exatamente isso que corrompeu (silenciosamente, sem erro nenhum) TODAS as
# extrações que passam por essa função — descoberto e confirmado isolando o problema
# (2026-08-15). O prefixo "," força o PowerShell a tratar o array como UM objeto só.
function Ler-Matriz($sheet, [int]$ultimaLinha, [int]$ultimaColuna) {
  if ($ultimaLinha -lt 2) { return $null }
  $range = $sheet.Range($sheet.Cells(1, 1), $sheet.Cells($ultimaLinha, $ultimaColuna))
  $dados = $range.Value2
  if ($null -eq $dados) { throw "Range.Value2 devolveu nulo — instabilidade do COM, tente rodar de novo." }
  if ($dados.GetLength(0) -ne $ultimaLinha) {
    throw "Leitura incompleta: esperava $ultimaLinha linhas, a matriz veio com $($dados.GetLength(0)) — instabilidade do COM, tente rodar de novo."
  }
  if ($dados.GetLength(1) -ne $ultimaColuna) {
    throw "Leitura incompleta: esperava $ultimaColuna colunas, a matriz veio com $($dados.GetLength(1)) — instabilidade do COM ou colunas finais vazias, tente rodar de novo."
  }
  return ,$dados
}

# Só sobrescreve o CSV existente se o resultado novo parecer plausível — nunca troca um
# arquivo que já funciona por um vazio/quase vazio (ex.: a aba de origem ficou com uma
# fórmula quebrada, ou o layout da planilha mudou e o script não reconheceu mais as
# colunas certas). Sem essa proteção, um problema silencioso na extração apagaria dados
# bons do site na próxima atualização. Devolve $true se escreveu, $false se recusou.
function Escrever-Csv([string]$caminho, [string]$cabecalho, [string[]]$linhas) {
  $linhasExistentes = 0
  if (Test-Path $caminho) {
    $linhasExistentes = (Get-Content -Path $caminho | Measure-Object -Line).Lines
  }
  $minimoAceitavel = [Math]::Max(10, [int]($linhasExistentes * 0.3))
  if ($linhasExistentes -gt 0 -and $linhas.Count -lt $minimoAceitavel) {
    Escrever-Log "  !! RECUSADO: $caminho tinha $linhasExistentes linhas, a extração nova trouxe só $($linhas.Count) — abaixo do mínimo aceitável ($minimoAceitavel). Mantendo o arquivo antigo. Confira a aba de origem (pode ter uma fórmula quebrada ou coluna fora do lugar)."
    return $false
  }
  $conteudo = $cabecalho + "`n" + ($linhas -join "`n")
  $utf8SemBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($caminho, $conteudo, $utf8SemBom)
  Escrever-Log "  -> $caminho ($($linhas.Count) linhas, era $linhasExistentes)"
  return $true
}

# ============================================================
# SESSÃO DO EXCEL — cada extração abre e fecha sua PRÓPRIA instância do Excel, em vez de
# compartilhar uma sessão só pras 4 abas (mais lento, ~1 min a mais por aba, mas evita
# qualquer resquício de uma sessão anterior).
#
# IMPORTANTE: chamadas COM pro Excel às vezes falham CALADAS (sem lançar exceção nem com
# $ErrorActionPreference='Stop') — Workbooks.Open() ou Sheets.Item() podem devolver $null
# ocasionalmente (visto durante os testes: alguns registros voltavam bem menos do que o
# esperado, sem erro nenhum, aparentemente por instabilidade do COM depois de várias
# aberturas seguidas desse arquivo de 117MB). Por isso todo ponto que pode voltar nulo tem
# uma verificação explícita que já lança um erro claro na hora — sem isso, o script segue
# adiante com dado incompleto e ninguém percebe.
function Abrir-Excel([string]$caminho) {
  $maxTentativas = 3
  for ($tentativa = 1; $tentativa -le $maxTentativas; $tentativa++) {
    $excel = $null
    try {
      $excel = New-Object -ComObject Excel.Application
      $excel.Visible = $false
      $excel.DisplayAlerts = $false
      $wb = $excel.Workbooks.Open($caminho, $false, $true)
      if ($null -eq $wb) { throw "Workbooks.Open devolveu nulo (sem lançar exceção) — instabilidade do COM." }
      # Esse arquivo tem 117MB — o Excel devolve o Workbooks.Open() mas ainda fica "ocupado"
      # processando por alguns segundos; qualquer chamada COM nesse meio tempo é rejeitada com
      # RPC_E_CALL_REJECTED (0x80010001), mesmo com $wb não nulo. Confirmado isolando o problema
      # (2026-08-15): sem essa pausa, a extração falha quase sempre logo na primeira aba.
      Start-Sleep -Seconds 5
      return @{ Excel = $excel; Wb = $wb }
    } catch {
      Escrever-Log "  Falha ao abrir a planilha (tentativa $tentativa/$maxTentativas): $($_.Exception.Message)"
      if ($excel) {
        try { $excel.Quit() } catch {}
        try { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null } catch {}
      }
      if ($tentativa -ge $maxTentativas) { throw }
      Start-Sleep -Seconds 5
    }
  }
}

# Caso real (2026-09-26): a planilha "Controle Base Do Monitoramento" estava aberta por alguém
# no mesmo horário de uma das 4 rodadas agendadas (08:40/09:40/13:10/17:00) -- o Excel abriu uma
# caixa de diálogo perguntando o que fazer (ficou esperando resposta) só que, como a automação
# roda com $excel.Visible=$false, essa caixa fica ESCONDIDA -- a chamada COM trava pra sempre,
# sem lançar nenhum erro, e o script (+ o Excel invisível dele) ficam vivos indefinidamente até
# alguém notar manualmente (aconteceu, ficou travado por horas). Não dá pra impor um timeout de
# verdade numa chamada COM síncrona sem risco de erro de thread (Excel é STA) -- a solução mais
# segura é: toda vez que a automação começa uma rodada NOVA, ela primeiro limpa qualquer resquício
# de uma rodada ANTERIOR que ainda esteja presa (script + Excel dela), garantindo que cada horário
# agendado sempre começa do zero, mesmo que o anterior nunca tenha se resolvido sozinho. NUNCA
# mexe num Excel com janela visível (MainWindowTitle preenchido) -- isso é sempre uma planilha
# aberta manualmente por alguém pra editar, nunca a automação (que sempre roda invisível).
function Limpar-InstanciasTravadas([int]$minutosParaConsiderarTravado = 20) {
  $meuPid = $PID
  $nomeDoScript = Split-Path -Leaf $PSCommandPath
  $processosAntigos = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $meuPid -and $_.CommandLine -and $_.CommandLine -match [regex]::Escape($nomeDoScript) }
  foreach ($p in $processosAntigos) {
    $tempoRodando = (Get-Date) - $p.CreationDate
    if ($tempoRodando.TotalMinutes -ge $minutosParaConsiderarTravado) {
      Escrever-Log "Encontrada execução anterior travada (PID $($p.ProcessId), rodando há $([int]$tempoRodando.TotalMinutes) min) -- encerrando antes de começar uma rodada nova."
      try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { Escrever-Log "  (nao consegui encerrar PID $($p.ProcessId): $($_.Exception.Message))" }
    }
  }
  Get-Process -Name EXCEL -ErrorAction SilentlyContinue | Where-Object {
    [string]::IsNullOrEmpty($_.MainWindowTitle) -and ((Get-Date) - $_.StartTime).TotalMinutes -ge $minutosParaConsiderarTravado
  } | ForEach-Object {
    Escrever-Log "Encontrado Excel invisível travado (PID $($_.Id), rodando há $([int]((Get-Date)-$_.StartTime).TotalMinutes) min, sem nenhuma janela) -- encerrando."
    try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch { Escrever-Log "  (nao consegui encerrar PID $($_.Id): $($_.Exception.Message))" }
  }
}

# Acha a aba pelo NOME, percorrendo por indice (Sheets.Item(nome) direto ja se mostrou
# instavel nessa planilha, ver comentario acima de $xlUp) — usada por TODAS as abas desde
# 2026-08-23 (antes só "RETORNO" usava isso; as outras tinham índice fixo, que quebrou quando
# a planilha foi reorganizada).
function Pegar-AbaPorNome($wb, [string]$nome) {
  for ($i = 1; $i -le $wb.Sheets.Count; $i++) {
    $sheet = $wb.Sheets.Item($i)
    if ($sheet.Name -eq $nome) { return $sheet }
  }
  throw "Aba '$nome' nao encontrada (a planilha tem $($wb.Sheets.Count) abas) — confira se o nome nao mudou."
}

# Acha uma coluna pelo TEXTO do cabeçalho (linha 1), tentando uma lista de nomes possíveis —
# em vez de confiar numa posição fixa. Motivo: a planilha de origem já trocou a ORDEM e até o
# NOME de colunas entre uma reimportação de dados e outra (confirmado 2026-08-15: "Peso Bruto"
# e "Valor NF/CF2" trocaram de coluna, e "Valor NF/CF2" passou a se chamar só "Valor NF" — o
# script continuou rodando sem erro nenhum, só que somando peso no lugar de valor no
# dashboard). Aceita variações de nome já vistas (mais antiga primeiro) pra cobrir tanto
# planilhas já atualizadas quanto uma extração feita antes da próxima reimportação. Lança erro
# claro se NENHUMA bater, em vez de silenciosamente pegar a coluna errada.
function Achar-ColunaPorCabecalho($sheet, [string[]]$nomesPossiveis, [int]$colunaMax = 40, [int]$colunaInicio = 1) {
  for ($c = $colunaInicio; $c -le $colunaMax; $c++) {
    $texto = ([string]$sheet.Cells(1, $c).Text).Trim()
    foreach ($nome in $nomesPossiveis) {
      if ($texto -eq $nome) { return $c }
    }
  }
  throw "Nenhuma coluna com cabecalho '$($nomesPossiveis -join "' ou '")' encontrada na aba '$($sheet.Name)' (colunas $colunaInicio a $colunaMax) — confira se o nome mudou de novo e adicione a variação nova na lista."
}

# Versão OPCIONAL de Achar-ColunaPorCabecalho (2026-09-10) — pra colunas que ela avisou que vai
# adicionar no FUTURO (Pedágio/Descarga/Diária/Tipo de Veículo/Capacidade — ver
# Extrair-IndicadorFrete abaixo) e ainda não existem na planilha hoje. A versão normal LANÇA
# EXCEÇÃO quando não acha (linha 264 acima, de propósito, pra colunas que já deveriam existir) —
# aqui, devolve $null em vez de derrubar o script inteiro, então a coluna nova simplesmente sai
# vazia no CSV até ela criar a coluna na planilha, sem precisar mexer neste script de novo.
function Achar-ColunaPorCabecalhoOpcional($sheet, [string[]]$nomesPossiveis, [int]$colunaMax = 40, [int]$colunaInicio = 1) {
  try { return Achar-ColunaPorCabecalho $sheet $nomesPossiveis $colunaMax $colunaInicio }
  catch { return $null }
}

# Best-effort: nesse ponto os dados já foram lidos (Ler-Matriz já terminou) — uma falha só
# pra FECHAR a planilha (às vezes o Excel ainda rejeita a chamada logo em seguida a uma
# leitura grande, RPC_E_CALL_REJECTED) não pode derrubar uma extração que já deu certo.
function Fechar-Excel($sessao) {
  try { if ($sessao.Wb) { $sessao.Wb.Close($false) } } catch { Escrever-Log "  (aviso: falha ao fechar a planilha, ignorando: $($_.Exception.Message))" }
  try { $sessao.Excel.Quit() } catch { Escrever-Log "  (aviso: falha ao encerrar o Excel, ignorando: $($_.Exception.Message))" }
  try { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($sessao.Excel) | Out-Null } catch {}
}

# ============================================================
# EXTRAÇÃO — uma função por aba, cada uma devolve as linhas já formatadas como CSV
# ============================================================

# Aba "Base Bluesoft" -> sample-data-bluesoft.csv
# Colunas achadas pelo NOME do cabeçalho (ver Achar-ColunaPorCabecalho), não por posição fixa —
# a ordem/nome delas já mudou entre uma reimportação de dados e outra (2026-08-15).
function Extrair-BaseBluesoft() {
  Escrever-Log "Abrindo planilha para ler 'Base Bluesoft'..."
  $sessao = Abrir-Excel $ExcelPath
  try {
  $sheet = Pegar-AbaPorNome $sessao.Wb "Base Bluesoft"

  $colNf = Achar-ColunaPorCabecalho $sheet @('N° NF/CF', 'N°NF/CF', 'NF/CF')
  $colStatus = Achar-ColunaPorCabecalho $sheet @('Status da Entrega')
  $colTransportadora = Achar-ColunaPorCabecalho $sheet @('Transportadora')
  $colMotorista = Achar-ColunaPorCabecalho $sheet @('Motorista')
  $colValorNF = Achar-ColunaPorCabecalho $sheet @('Valor NF/CF2', 'Valor NF/CF', 'Valor NF')
  $colData = Achar-ColunaPorCabecalho $sheet @('Data de Entrega', 'Data de Coleta')
  $colDestinatario = Achar-ColunaPorCabecalho $sheet @('Destinatário')
  # "CNPJ" (nome original) passou a se chamar "CPF/CNPJ" — confirmado 2026-08-24. Mantém o
  # nome antigo como alias de reserva, mesma lógica das outras colunas acima.
  $colCnpj = Achar-ColunaPorCabecalho $sheet @('CPF/CNPJ', 'CNPJ')
  $colCidade = Achar-ColunaPorCabecalho $sheet @('Cidade')
  $colUf = Achar-ColunaPorCabecalho $sheet @('UF')
  # "Agendado" (nome original) passou a se chamar "Agendamento" — confirmado 2026-08-24.
  $colAgendado = Achar-ColunaPorCabecalho $sheet @('Agendamento', 'Agendado')
  # "Viagem" (Status de Viagem: "Finalizado"/"Em trânsito"/etc.) — usada só pra pegar o caso
  # raro (1 em ~61 mil notas na base real, 2026-08-18) de uma nota com viagem já finalizada mas
  # cuja Situação/Status ainda ficou "Em aberto" (resíduo/erro do sistema já resolvido na
  # prática) — ver removerNotasComViagemFinalizadaMasEmAberto em data.js.
  # ATENÇÃO: a planilha tem DUAS colunas de "viagem" — a 1ª (antes de Motorista/Placa/
  # Transportadora) é o NÚMERO da viagem; a que queremos é a de STATUS. Ela foi renomeada pra
  # "Status da Viagem" (confirmado 2026-08-24, antes era só "Viagem" mesmo, repetido) — o
  # ponto de início (depois de Transportadora) continua como proteção extra, caso o nome
  # volte a ser só "Viagem" de novo — confirmado real, 2026-08-18: sem essa proteção já
  # extraiu "297411" (número) em vez de "Finalizado" nesse cenário.
  $colViagem = Achar-ColunaPorCabecalho $sheet @('Status da Viagem', 'Viagem') 40 ($colTransportadora + 1)
  # Colunas adicionadas 2026-08-22 (usadas pelo painel "Lead Time de Pedidos e Entregas" e
  # pelas colunas ocultas-por-padrão de "Registros detalhados") — faltavam aqui, só existiam
  # no script novo (extrair-bluesoft-leadtime.js). Ficaram sem dado no site depois que uma
  # atualização por ESTE script sobrescreveu o CSV mais completo por um sem elas (2026-08-24,
  # quebrou "Análise por Região" e "Lead Time de Pedidos e Entregas" - nenhuma das duas telas
  # funciona sem Data de Criação/Data Entrega NF). Mesmos nomes de cabeçalho no CSV de saída
  # que o script novo usa, pra qualquer um dos dois gerar um arquivo compatível.
  $colDataCriacao = Achar-ColunaPorCabecalho $sheet @('Data de Criação')
  $colDataEntregaNF = Achar-ColunaPorCabecalho $sheet @('Dt. Entrega NF')
  $colDataFaturamentoBluesoft = Achar-ColunaPorCabecalho $sheet @('Data de Faturamento')
  $colPlaca = Achar-ColunaPorCabecalho $sheet @('Placa')
  $colFilial = Achar-ColunaPorCabecalho $sheet @('Filial')
  $colCodigoCliente = Achar-ColunaPorCabecalho $sheet @('Cód. Cliente', 'Cod. Cliente')
  $colTelefone = Achar-ColunaPorCabecalho $sheet @('Telefone')
  $colNumeroPedidoEcommerce = Achar-ColunaPorCabecalho $sheet @('N° Pedido Ecommerce')
  $colNumeroFatura = Achar-ColunaPorCabecalho $sheet @('Número da Fatura')
  $colRota = Achar-ColunaPorCabecalho $sheet @('Rota')
  # Coluna Z, criada pela usuária (2026-08-27) — classifica quem fez o transporte
  # (Transportadora/Agregado/Próprio Retira/Exportação), ver parseCategoriaTransporte em data.js.
  $colCategoria = Achar-ColunaPorCabecalho $sheet @('Categoria')
  # "Peso Bruto" (2026-09-08, pedido da usuária pra alimentar a coluna "Peso" da tela nova
  # "Controle de Despesas Extra") — já existe na planilha há tempos (ver o comentário de
  # Achar-ColunaPorCabecalho acima: já foi confundida uma vez com Valor NF, 2026-08-15), só
  # nunca tinha sido extraída pro CSV até agora.
  $colPesoBruto = Achar-ColunaPorCabecalho $sheet @('Peso Bruto')
  Escrever-Log "  colunas achadas: NF=$colNf Status=$colStatus Transportadora=$colTransportadora Motorista=$colMotorista ValorNF=$colValorNF Data=$colData Destinatario=$colDestinatario CNPJ=$colCnpj Cidade=$colCidade UF=$colUf Agendado=$colAgendado Viagem=$colViagem DataCriacao=$colDataCriacao DataEntregaNF=$colDataEntregaNF DataFaturamento=$colDataFaturamentoBluesoft Placa=$colPlaca Filial=$colFilial CodigoCliente=$colCodigoCliente Telefone=$colTelefone NumeroPedidoEcommerce=$colNumeroPedidoEcommerce NumeroFatura=$colNumeroFatura Rota=$colRota Categoria=$colCategoria PesoBruto=$colPesoBruto"

  $ultimaLinha = Achar-UltimaLinha $sheet $colNf
  Escrever-Log "  ultima linha com NF preenchida: $ultimaLinha"
  $ultimaColuna = ($colNf, $colStatus, $colTransportadora, $colMotorista, $colValorNF, $colData, $colDestinatario, $colCnpj, $colCidade, $colUf, $colAgendado, $colViagem, $colDataCriacao, $colDataEntregaNF, $colDataFaturamentoBluesoft, $colPlaca, $colFilial, $colCodigoCliente, $colTelefone, $colNumeroPedidoEcommerce, $colNumeroFatura, $colRota, $colCategoria, $colPesoBruto | Measure-Object -Maximum).Maximum
  $dados = Ler-Matriz $sheet $ultimaLinha $ultimaColuna

  $linhas = New-Object System.Collections.Generic.List[string]
  for ($r = 2; $r -le $ultimaLinha; $r++) {
    $nf = Formatar-Texto $dados[$r, $colNf]
    if (-not $nf) { continue }
    $status = Formatar-Texto $dados[$r, $colStatus]
    if (-not $status) { continue }
    $cliente = Formatar-Texto $dados[$r, $colDestinatario]
    $transportadora = Formatar-Texto $dados[$r, $colTransportadora]
    $motorista = Formatar-Texto $dados[$r, $colMotorista]
    $cidade = Formatar-Texto $dados[$r, $colCidade]
    $uf = Formatar-Texto $dados[$r, $colUf]
    $valorNF = Formatar-Numero $dados[$r, $colValorNF]
    $dataEntrega = Formatar-Data $dados[$r, $colData]
    $cnpj = Formatar-Numero $dados[$r, $colCnpj]
    # Coluna "Agendado" ("Obriga Agenda" / "Não obriga agenda") — por decisão do usuário
    # (2026-08-14), usada como fonte de "precisa de agendamento" no lugar da aba Agendamentos
    # (que depende de uma fórmula frágil e ficou quebrada). Junto com o CNPJ (já extraído
    # acima), evita o cruzamento por nome de cliente.
    $necessitaAgendamento = Formatar-Texto $dados[$r, $colAgendado]
    $viagem = Formatar-Texto $dados[$r, $colViagem]
    $dataCriacao = Formatar-Data $dados[$r, $colDataCriacao]
    $dataEntregaNF = Formatar-Data $dados[$r, $colDataEntregaNF]
    $dataFaturamentoBluesoft = Formatar-Data $dados[$r, $colDataFaturamentoBluesoft]
    $placa = Formatar-Texto $dados[$r, $colPlaca]
    $filial = Formatar-Texto $dados[$r, $colFilial]
    $codigoCliente = Formatar-Numero $dados[$r, $colCodigoCliente]
    $telefone = Formatar-Texto $dados[$r, $colTelefone]
    $numeroPedidoEcommerce = Formatar-Texto $dados[$r, $colNumeroPedidoEcommerce]
    $numeroFatura = Formatar-Numero $dados[$r, $colNumeroFatura]
    $rota = Formatar-Texto $dados[$r, $colRota]
    $categoria = Formatar-Texto $dados[$r, $colCategoria]
    $pesoBruto = Formatar-Numero $dados[$r, $colPesoBruto]
    $linhas.Add("$nf;$status;$cliente;$transportadora;$motorista;$cidade;$uf;$valorNF;$dataEntrega;$cnpj;$necessitaAgendamento;$viagem;$dataCriacao;$dataEntregaNF;$dataFaturamentoBluesoft;$placa;$filial;$codigoCliente;$telefone;$numeroPedidoEcommerce;$numeroFatura;$rota;$categoria;$pesoBruto")
  }
  return @{ Cabecalho = "NF;Status Bluesoft;Cliente;Transportadora;Motorista;Cidade;UF;Valor NF;Data Entrega;CNPJ;Agendado;Viagem;Data Criacao;Data Entrega NF;Data Faturamento Bluesoft;Placa;Filial;Codigo Cliente;Telefone;Numero Pedido Ecommerce;Numero Fatura;Rota;Categoria;Peso Bruto"; Linhas = $linhas }
  } finally {
    Fechar-Excel $sessao
  }
}

# Aba "Agendamentos" -> sample-data-agendamentos.csv
# Colunas: Motorista(1) Transportadora(2) N°NF/CF(3) Destinatário(4) CNPJ(5)
# Status da Entrega(6) Agendado(7) Data de Agendamento(8) Status(9) Reagenda(10) ...
function Extrair-Agendamentos() {
  Escrever-Log "Abrindo planilha para ler 'Agendamentos'..."
  $sessao = Abrir-Excel $ExcelPath
  try {
  $sheet = Pegar-AbaPorNome $sessao.Wb "Agendamentos"
  $ultimaLinha = Achar-UltimaLinha $sheet 3
  Escrever-Log "  ultima linha com NF preenchida: $ultimaLinha"
  $dados = Ler-Matriz $sheet $ultimaLinha 10

  $linhas = New-Object System.Collections.Generic.List[string]
  for ($r = 2; $r -le $ultimaLinha; $r++) {
    $nf = Formatar-Texto $dados[$r, 3]
    if (-not $nf) { continue }
    $motorista = Formatar-Texto $dados[$r, 1]
    $transportadora = Formatar-Texto $dados[$r, 2]
    $destinatario = Formatar-Texto $dados[$r, 4]
    $agendado = Formatar-Texto $dados[$r, 7]
    $dataAgendamento = Formatar-Data $dados[$r, 8]
    $status = Formatar-Texto $dados[$r, 9]
    $reagenda = Formatar-Booleano $dados[$r, 10]
    $linhas.Add("$motorista;$transportadora;$nf;$destinatario;$agendado;$dataAgendamento;$status;$reagenda")
  }
  return @{ Cabecalho = "Motorista;Transportadora;NF;Destinatário;Agendado;Data Agendamento;Status;Reagenda"; Linhas = $linhas }
  } finally {
    Fechar-Excel $sessao
  }
}

# Aba "Vendedor x Cliente" -> sample-data-clientes.csv
# Colunas: vendedor(1) Cliente(2) cpf_cnpj(3) grupo_economico(4) CNPJ2(5) Vendedor(6, nao usada)
function Extrair-VendedorCliente() {
  Escrever-Log "Abrindo planilha para ler 'Vendedor x Cliente'..."
  $sessao = Abrir-Excel $ExcelPath
  try {
  $sheet = Pegar-AbaPorNome $sessao.Wb "Vendedor x Cliente"
  $ultimaLinha = Achar-UltimaLinha $sheet 2
  Escrever-Log "  ultima linha com Cliente preenchido: $ultimaLinha"
  $dados = Ler-Matriz $sheet $ultimaLinha 4

  $linhas = New-Object System.Collections.Generic.List[string]
  for ($r = 2; $r -le $ultimaLinha; $r++) {
    $cliente = Formatar-Texto $dados[$r, 2]
    if (-not $cliente) { continue }
    $vendedor = Formatar-Texto $dados[$r, 1]
    $cnpj = Formatar-Numero $dados[$r, 3]
    $grupoEconomico = Formatar-Texto $dados[$r, 4]
    $linhas.Add("$cliente;$vendedor;$cnpj;$grupoEconomico")
  }
  return @{ Cabecalho = "Cliente;Vendedor;CNPJ;Grupo Economico"; Linhas = $linhas }
  } finally {
    Fechar-Excel $sessao
  }
}

# Aba "Base BI" -> sample-data-motivos.csv (cobertura parcial, só Devolução/Cancelado/
# Reentrega com a coluna OBS. preenchida — mesmo critério já documentado no dashboard).
# Colunas relevantes: STATUS ENTREGA(5) NF numero(7) OBS.(17)
function Extrair-Motivos() {
  Escrever-Log "Abrindo planilha para ler 'Base BI'..."
  $sessao = Abrir-Excel $ExcelPath
  try {
  $sheet = Pegar-AbaPorNome $sessao.Wb "Base BI"
  $ultimaLinha = Achar-UltimaLinha $sheet 7
  Escrever-Log "  ultima linha com NF preenchida: $ultimaLinha"
  $dados = Ler-Matriz $sheet $ultimaLinha 17

  $linhas = New-Object System.Collections.Generic.List[string]
  for ($r = 2; $r -le $ultimaLinha; $r++) {
    $nf = Formatar-Texto $dados[$r, 7]
    if (-not $nf) { continue }
    $obs = Formatar-Texto $dados[$r, 17]
    if (-not $obs) { continue }
    $statusRaw = (Formatar-Texto $dados[$r, 5]).ToUpperInvariant()
    $status = $null
    if ($statusRaw -like '*REENTREGA*') { $status = 'Reentrega' }
    elseif ($statusRaw -like '*DEVOLU*') { $status = 'Devolução' }
    elseif ($statusRaw -like '*CANCELA*') { $status = 'Cancelado' }
    if (-not $status) { continue }
    $linhas.Add("$nf;$status;$obs")
  }
  return @{ Cabecalho = "NF;Status;Motivo"; Linhas = $linhas }
  } finally {
    Fechar-Excel $sessao
  }
}

# Aba "Base BI" -> sample-data-faturamento.csv (Data de Faturamento por NF, TODAS as linhas
# com NF preenchido — cobertura completa, diferente de Extrair-Motivos acima). Decisão do
# usuário (2026-08-17): o filtro de Período/Mês do dashboard passou a priorizar essa data em
# vez da Data de Coleta — algumas notas só aparecem no mês certo com essa informação (uma nota
# coletada num mês pode ter sido faturada só no mês seguinte). Colunas: NF numero(7) Data
# faturamento(13).
function Extrair-Faturamento() {
  Escrever-Log "Abrindo planilha para ler 'Base BI' (Data de Faturamento)..."
  $sessao = Abrir-Excel $ExcelPath
  try {
  $sheet = Pegar-AbaPorNome $sessao.Wb "Base BI"
  $ultimaLinha = Achar-UltimaLinha $sheet 7
  Escrever-Log "  ultima linha com NF preenchida: $ultimaLinha"
  $dados = Ler-Matriz $sheet $ultimaLinha 13

  $linhas = New-Object System.Collections.Generic.List[string]
  for ($r = 2; $r -le $ultimaLinha; $r++) {
    $nf = Formatar-Texto $dados[$r, 7]
    if (-not $nf) { continue }
    $dataFaturamento = Formatar-Data $dados[$r, 13]
    if (-not $dataFaturamento) { continue }
    $linhas.Add("$nf;$dataFaturamento")
  }
  return @{ Cabecalho = "NF;Data Faturamento"; Linhas = $linhas }
  } finally {
    Fechar-Excel $sessao
  }
}

# Aba "RETORNO" -> sample-data-retorno.csv (prazo de entrega em dias + tipo de transporte
# por nota — usada pra calcular Vencido/Dentro do prazo e pro filtro de Transporte;
# decisão do usuário, 2026-08-15). Colunas: NF(A=1) Prazo para Entrega(T=20) Transportador
# (U=21) Tipo de Transporte(V=22) — o Transportador entra pra dar de reserva o tipo mais
# frequente daquela transportadora nas notas que essa aba não cobre (ela só cobre uma
# fração do total; ver applyRetornoEnrichment em data.js). Achada pelo NOME (não índice
# fixo, ver Pegar-AbaPorNome).
function Extrair-Retorno() {
  Escrever-Log "Abrindo planilha para ler 'RETORNO'..."
  $sessao = Abrir-Excel $ExcelPath
  try {
  $sheet = Pegar-AbaPorNome $sessao.Wb "RETORNO"
  $ultimaLinha = Achar-UltimaLinha $sheet 1
  Escrever-Log "  ultima linha com NF preenchida: $ultimaLinha"
  $dados = Ler-Matriz $sheet $ultimaLinha 22

  $linhas = New-Object System.Collections.Generic.List[string]
  for ($r = 2; $r -le $ultimaLinha; $r++) {
    $nf = Formatar-Texto $dados[$r, 1]
    if (-not $nf) { continue }
    $prazoDias = Formatar-Numero $dados[$r, 20]
    $transportador = Formatar-Texto $dados[$r, 21]
    $tipoTransporte = Formatar-Texto $dados[$r, 22]
    $linhas.Add("$nf;$prazoDias;$transportador;$tipoTransporte")
  }
  return @{ Cabecalho = "NF;Prazo para Entrega;Transportador;Tipo de Transporte"; Linhas = $linhas }
  } finally {
    Fechar-Excel $sessao
  }
}

# Aba renomeada pela usuária (2026-08-28) -- era "Pedidos não Faturados", virou "Pedido Não
# Faturados (Emissão)" (a planilha também ganhou uma segunda aba nova, "Pedidos não
# Faturados (DT Agen)", com layout diferente -- essa NÃO é a que usamos aqui: ela não tem
# coluna "Cliente", que o site precisa). Pedidos que ainda não viraram nota fiscal, usada pelo
# card "Pedidos Aguardando Faturamento" no gráfico "Situação de agendamento".
#
# Coluna nova "Data agendamento" (2026-08-28): mesma ideia de statusAgendamento/dataAgendamento
# dupla-finalidade já usada em rawRecords -- a célula ou tem uma DATA de verdade (pedido já tem
# data marcada) ou um TEXTO livre dizendo por que ainda não tem ("Aguardando Confirmação",
# "Sem Roteiro", etc.). Formatar-Data já trata os dois casos certo (serial OLE -> dd/MM/yyyy,
# texto -> devolve como está) -- e como aqui a leitura é via .Value2 (COM), a ambiguidade
# M/D/aa americana vs d/m/aaaa brasileira nem chega a existir (o valor numérico bruto da data
# não depende do formato de exibição da célula, só o texto exibido dependeria).
function Extrair-PedidosNaoFaturados() {
  Escrever-Log "Abrindo planilha para ler 'Pedidos não Faturados (Emissão)'..."
  $sessao = Abrir-Excel $ExcelPath
  try {
  $sheet = Pegar-AbaPorNome $sessao.Wb "Pedidos não Faturados (Emissão)"

  $colDataEmissao = Achar-ColunaPorCabecalho $sheet @('Data_emissao')
  $colGrupoEconomico = Achar-ColunaPorCabecalho $sheet @('Grupo Economico')
  $colCliente = Achar-ColunaPorCabecalho $sheet @('Cliente')
  $colNumeroPedido = Achar-ColunaPorCabecalho $sheet @('Nº Pedido')
  $colValorPedido = Achar-ColunaPorCabecalho $sheet @('Valor Pedido R$')
  $colPedidosEmAberto = Achar-ColunaPorCabecalho $sheet @('Pedidos em Aberto', 'PEDIDOS EM ABERTO')
  $colQtdePedido = Achar-ColunaPorCabecalho $sheet @('QTD Pedidos (CXs)', 'QTDE PEDIDO(CXS)')
  $colPrecoPedido = Achar-ColunaPorCabecalho $sheet @('Preço Pedido', 'PREÇO PEDIDO')
  $colDataAgendamento = Achar-ColunaPorCabecalho $sheet @('Data agendamento', 'Data Agendamento')

  $ultimaLinha = Achar-UltimaLinha $sheet $colNumeroPedido
  Escrever-Log "  ultima linha com Pedido preenchido: $ultimaLinha"
  $ultimaColuna = ($colDataEmissao, $colGrupoEconomico, $colCliente, $colNumeroPedido, $colValorPedido, $colPedidosEmAberto, $colQtdePedido, $colPrecoPedido, $colDataAgendamento | Measure-Object -Maximum).Maximum
  $dados = Ler-Matriz $sheet $ultimaLinha $ultimaColuna

  $linhas = New-Object System.Collections.Generic.List[string]
  for ($r = 2; $r -le $ultimaLinha; $r++) {
    $numeroPedido = Formatar-Numero $dados[$r, $colNumeroPedido]
    if (-not $numeroPedido) { continue }
    $dataEmissao = Formatar-Data $dados[$r, $colDataEmissao]
    $grupoEconomico = Formatar-Texto $dados[$r, $colGrupoEconomico]
    $cliente = Formatar-Texto $dados[$r, $colCliente]
    $valorPedido = Formatar-Numero $dados[$r, $colValorPedido]
    $pedidosEmAberto = Formatar-Numero $dados[$r, $colPedidosEmAberto]
    $qtdePedido = Formatar-Numero $dados[$r, $colQtdePedido]
    $precoPedido = Formatar-Numero $dados[$r, $colPrecoPedido]
    $dataAgendamento = Formatar-Data $dados[$r, $colDataAgendamento]
    $linhas.Add("$dataEmissao;$grupoEconomico;$cliente;$numeroPedido;$valorPedido;$pedidosEmAberto;$qtdePedido;$precoPedido;$dataAgendamento")
  }
  return @{ Cabecalho = "Data Emissao;Grupo Economico;Cliente;Numero Pedido;Valor Pedido;Pedidos Em Aberto;Qtde Pedido;Preco Pedido;Data Agendamento"; Linhas = $linhas }
  } finally {
    Fechar-Excel $sessao
  }
}

# Aba "Pedido X Nota (agendamento)" -> sample-data-pedido-x-nota.csv (2026-09-23, pedido da
# usuária: quando um Pedido de "Pedidos não Faturados" é faturado, ele some daquela aba e a Data
# de Agendamento que ela já tinha preenchido se perdia, dando retrabalho de digitar de novo na
# nota fiscal em "Aguardando Agendamento". Ela criou essa aba nova especificamente pra dar a
# ponte Pedido -> Nota: cada linha nasce como Pedido (coluna "Nº NF/CF" ainda vazia) e, quando é
# faturado, essa coluna passa a vir preenchida com o número da nota gerada — é o mesmo número de
# pedido que já usamos em "Pedidos não Faturados" (ela confirmou). Só exporta linhas que JÁ tem
# NF/CF preenchido: linha sem NF ainda é só o mesmo pedido pendente, já coberto pela aba de
# pedidos não faturados — exportar as duas seria redundante.
function Extrair-PedidoXNota() {
  Escrever-Log "Abrindo planilha para ler 'Pedido X Nota (agendamento)'..."
  $sessao = Abrir-Excel $ExcelPath
  try {
  $sheet = Pegar-AbaPorNome $sessao.Wb "Pedido X Nota (agendamento)"

  $colNumeroPedidoCliente = Achar-ColunaPorCabecalho $sheet @('Nº Pedido Cliente', 'N° Pedido Cliente', 'Nº Pedido do Cliente', 'N° Pedido do Cliente')
  $colNfCf = Achar-ColunaPorCabecalho $sheet @('Nº NF/CF', 'N° NF/CF', 'NF/CF', 'Nº NF / CF')
  $colCliente = Achar-ColunaPorCabecalhoOpcional $sheet @('Cliente')
  $colVendedor = Achar-ColunaPorCabecalhoOpcional $sheet @('Vendedor')
  $colEmissao = Achar-ColunaPorCabecalhoOpcional $sheet @('Emissão', 'Emissao')

  $ultimaLinha = Achar-UltimaLinha $sheet $colNumeroPedidoCliente
  Escrever-Log "  ultima linha com Pedido preenchido: $ultimaLinha"
  $colunas = @($colNumeroPedidoCliente, $colNfCf)
  if ($colCliente) { $colunas += $colCliente }
  if ($colVendedor) { $colunas += $colVendedor }
  if ($colEmissao) { $colunas += $colEmissao }
  $ultimaColuna = ($colunas | Measure-Object -Maximum).Maximum
  $dados = Ler-Matriz $sheet $ultimaLinha $ultimaColuna

  $linhas = New-Object System.Collections.Generic.List[string]
  for ($r = 2; $r -le $ultimaLinha; $r++) {
    $numeroPedidoCliente = Formatar-Numero $dados[$r, $colNumeroPedidoCliente]
    if (-not $numeroPedidoCliente) { continue }
    $nfCf = Formatar-Texto $dados[$r, $colNfCf]
    if (-not $nfCf) { continue } # ainda não faturado -- ja coberto por "Pedidos não Faturados"
    $cliente = $(if ($colCliente) { Formatar-Texto $dados[$r, $colCliente] } else { '' })
    $vendedor = $(if ($colVendedor) { Formatar-Texto $dados[$r, $colVendedor] } else { '' })
    $emissao = $(if ($colEmissao) { Formatar-Data $dados[$r, $colEmissao] } else { '' })
    $linhas.Add("$numeroPedidoCliente;$nfCf;$cliente;$vendedor;$emissao")
  }
  return @{ Cabecalho = "Numero Pedido Cliente;NF CF;Cliente;Vendedor;Emissao"; Linhas = $linhas }
  } finally {
    Fechar-Excel $sessao
  }
}

# Histórico de Data de Agendamento por Pedido -> sample-data-pedidos-agendamento-historico.csv
# (2026-09-23, mesmo pedido acima). NÃO lê a planilha Excel — lê o CSV de "Pedidos não
# Faturados" que acabou de ser (re)gerado nesta mesma rodada (ver $fontes mais abaixo, esta
# função vem logo depois na lista, então o arquivo já está atualizado no disco) e o histórico já
# publicado da rodada ANTERIOR, e faz um MERGE que só CRESCE: todo pedido que já apareceu uma vez
# com uma Data de Agendamento de verdade fica guardado pra sempre, mesmo depois que ele some de
# "Pedidos não Faturados" (assim que fatura). É esse histórico que o site cruza com a aba nova
# "Pedido X Nota (agendamento)" pra "herdar" a data original pra dentro da nota fiscal recém-
# faturada, sem precisar digitar de novo.
function Extrair-HistoricoAgendamentoPedidos() {
  $caminhoAtual = Join-Path $PastaSaida "sample-data-pedidos-nao-faturados.csv"
  $caminhoHistorico = Join-Path $PastaSaida "sample-data-pedidos-agendamento-historico.csv"

  $historico = @{} # numero pedido -> linha completa do historico (mantem tudo que ja tinha)
  if (Test-Path $caminhoHistorico) {
    $linhasExistentes = Get-Content -Path $caminhoHistorico -Encoding UTF8
    for ($i = 1; $i -lt $linhasExistentes.Count; $i++) {
      if (-not $linhasExistentes[$i]) { continue }
      $campos = $linhasExistentes[$i] -split ';'
      if ($campos.Count -lt 1 -or -not $campos[0]) { continue }
      $historico[$campos[0]] = $linhasExistentes[$i]
    }
  }
  Escrever-Log "  historico de agendamento de pedidos: $($historico.Count) pedido(s) ja conhecido(s) antes desta rodada"

  if (-not (Test-Path $caminhoAtual)) {
    Escrever-Log "  aviso: $caminhoAtual ainda nao existe nesta rodada (extração de 'Pedidos não Faturados' pulou ou falhou) — historico mantido como estava, sem pedido novo."
  } else {
    $linhasAtuais = Get-Content -Path $caminhoAtual -Encoding UTF8
    $novos = 0
    for ($i = 1; $i -lt $linhasAtuais.Count; $i++) {
      if (-not $linhasAtuais[$i]) { continue }
      $campos = $linhasAtuais[$i] -split ';'
      # Cabecalho de Extrair-PedidosNaoFaturados: Data Emissao;Grupo Economico;Cliente;
      # Numero Pedido;Valor Pedido;Pedidos Em Aberto;Qtde Pedido;Preco Pedido;Data Agendamento
      # (indices 0..8)
      if ($campos.Count -lt 9) { continue }
      $numeroPedido = $campos[3]
      $cliente = $campos[2]
      $dataAgendamento = $campos[8]
      # Só guarda quando é uma DATA de verdade (dd/mm/aaaa) -- textos como "Aguardando
      # Agendamento"/"Entrega Direta"/"Sem Roteiro" não servem pra herdar, não é uma data real.
      if ($dataAgendamento -notmatch '^\d{2}/\d{2}/\d{4}$') { continue }
      if (-not $historico.ContainsKey($numeroPedido)) { $novos++ }
      $historico[$numeroPedido] = "$numeroPedido;$dataAgendamento;$cliente"
    }
    Escrever-Log "  historico de agendamento de pedidos: $novos pedido(s) novo(s) com data real nesta rodada"
  }

  $linhas = New-Object System.Collections.Generic.List[string]
  foreach ($linha in ($historico.Values | Sort-Object)) { $linhas.Add($linha) }
  return @{ Cabecalho = "Numero Pedido;Data Agendamento;Cliente"; Linhas = $linhas }
}

# Aba "Indicador de Frete" -> sample-data-indicador-frete.csv (2026-09-09, pedido da usuária:
# medir custo de frete por Transportadora/Período). DIFERENTE de todas as outras abas: não é por
# NF, é por VIAGEM (Placa + Data Embarque) -- ela mesma preenche essa aba manualmente olhando o
# TMS Lincros, e uma viagem pode levar várias notas juntas (frete/pedágio/diária são da viagem
# inteira, não de uma nota isolada). O cruzamento com Transportadora/Motorista/NF é feito no
# dashboard (js/data.js), casando por Placa + dia de coleta contra os registros já carregados --
# essa aba não precisa (nem deve) repetir esses campos. Colunas achadas por NOME (ela avisou que
# pode crescer no futuro com Pedágio/Descarga/Diária -- Achar-ColunaPorCabecalho já cobre isso
# sem precisar mudar posição nenhuma quando ela acrescentar).
function Extrair-IndicadorFrete() {
  Escrever-Log "Abrindo planilha para ler 'Indicador de Frete'..."
  $sessao = Abrir-Excel $ExcelPath
  try {
  $sheet = Pegar-AbaPorNome $sessao.Wb "Indicador de Frete"

  $colPlaca = Achar-ColunaPorCabecalho $sheet @('Placa')
  $colDataEmbarque = Achar-ColunaPorCabecalho $sheet @('Data Embarque')
  $colEmbarque = Achar-ColunaPorCabecalho $sheet @('Embarque')
  $colCidadeDestino = Achar-ColunaPorCabecalho $sheet @('Cidade Destino')
  $colValorFrete = Achar-ColunaPorCabecalho $sheet @('Valor Frete Calculado')
  $colPeso = Achar-ColunaPorCabecalho $sheet @('Peso')
  $colVolumes = Achar-ColunaPorCabecalho $sheet @('Volumes')
  # 3 colunas novas (2026-09-14, pedido "Auditoria de Embarques") -- já existiam na planilha,
  # só nunca tinham sido extraídas por falta de uso até agora. "Identificador (Viagem)" vem
  # majoritariamente VAZIO (confirmado por print real dela) -- nunca pode ser chave única de
  # cruzamento, só um dado auxiliar de exibição quando existir.
  $colTransportador = Achar-ColunaPorCabecalhoOpcional $sheet @('Transportador')
  $colDataCriacao = Achar-ColunaPorCabecalhoOpcional $sheet @('Data de criação', 'Data de criacao')
  $colIdentificadorViagem = Achar-ColunaPorCabecalhoOpcional $sheet @('Identificador (Viagem)', 'Identificador (viagem)')
  # ATENÇÃO: nome da coluna na PLANILHA é "Valor total das NFs" (com "das") -- o cabeçalho do
  # CSV de saída abaixo usa "Valor Total NFs" (sem "das", só pra ficar mais curto); o dashboard
  # (js/data.js) procura pelo texto do CABEÇALHO DO CSV, não da planilha original -- os dois
  # precisam ficar em sincronia, foi exatamente esse descompasso que zerou a coluna 2026-09-09.
  $colValorNFs = Achar-ColunaPorCabecalho $sheet @('Valor total das NFs')
  # Colunas AINDA NÃO existentes na planilha (2026-09-10) — "vou implementar no futuro", ela
  # mesma disse (Pedágio/Descarga/Diária) — mais Tipo de Veículo/Capacidade, preparando pro
  # cálculo futuro de Ocupação do Veículo. Usa a versão OPCIONAL (não lança erro se não achar);
  # o CSV já sai com essas 6 colunas no cabeçalho (vazias por enquanto), então quando ela criar
  # a coluna na planilha não precisa mexer neste script de novo.
  $colPedagio = Achar-ColunaPorCabecalhoOpcional $sheet @('Pedágio', 'Pedagio')
  $colDescarga = Achar-ColunaPorCabecalhoOpcional $sheet @('Descarga')
  $colDiaria = Achar-ColunaPorCabecalhoOpcional $sheet @('Diária', 'Diaria')
  $colTipoVeiculo = Achar-ColunaPorCabecalhoOpcional $sheet @('Tipo de Veículo', 'Tipo de Veiculo')
  $colCapacidadeMaxKg = Achar-ColunaPorCabecalhoOpcional $sheet @('Capacidade Máxima Kg', 'Capacidade Maxima Kg')
  $colCapacidadeVolumes = Achar-ColunaPorCabecalhoOpcional $sheet @('Capacidade Volumes')
  Escrever-Log "  colunas achadas: Placa=$colPlaca DataEmbarque=$colDataEmbarque Embarque=$colEmbarque CidadeDestino=$colCidadeDestino ValorFreteCalculado=$colValorFrete Peso=$colPeso Volumes=$colVolumes ValorTotalNFs=$colValorNFs"
  Escrever-Log "  colunas opcionais (ainda podem nao existir): Pedagio=$colPedagio Descarga=$colDescarga Diaria=$colDiaria TipoVeiculo=$colTipoVeiculo CapacidadeMaxKg=$colCapacidadeMaxKg CapacidadeVolumes=$colCapacidadeVolumes Transportador=$colTransportador DataCriacao=$colDataCriacao IdentificadorViagem=$colIdentificadorViagem"

  $ultimaLinha = Achar-UltimaLinha $sheet $colPlaca
  Escrever-Log "  ultima linha com Placa preenchida: $ultimaLinha"
  $colunasOpcionaisAchadas = @($colPedagio, $colDescarga, $colDiaria, $colTipoVeiculo, $colCapacidadeMaxKg, $colCapacidadeVolumes, $colTransportador, $colDataCriacao, $colIdentificadorViagem) | Where-Object { $_ }
  $ultimaColuna = (@($colPlaca, $colDataEmbarque, $colEmbarque, $colCidadeDestino, $colValorFrete, $colPeso, $colVolumes, $colValorNFs) + $colunasOpcionaisAchadas | Measure-Object -Maximum).Maximum
  $dados = Ler-Matriz $sheet $ultimaLinha $ultimaColuna

  $linhas = New-Object System.Collections.Generic.List[string]
  for ($r = 2; $r -le $ultimaLinha; $r++) {
    $placa = Formatar-Texto $dados[$r, $colPlaca]
    if (-not $placa) { continue }
    $dataEmbarque = Formatar-Data $dados[$r, $colDataEmbarque]
    if (-not $dataEmbarque) { continue }
    $embarque = Formatar-Texto $dados[$r, $colEmbarque]
    $cidadeDestino = Formatar-Texto $dados[$r, $colCidadeDestino]
    $valorFrete = Formatar-Numero $dados[$r, $colValorFrete]
    $peso = Formatar-Numero $dados[$r, $colPeso]
    $volumes = Formatar-Numero $dados[$r, $colVolumes]
    $valorNFs = Formatar-Numero $dados[$r, $colValorNFs]
    $pedagio = if ($colPedagio) { Formatar-Numero $dados[$r, $colPedagio] } else { '' }
    $descarga = if ($colDescarga) { Formatar-Numero $dados[$r, $colDescarga] } else { '' }
    $diaria = if ($colDiaria) { Formatar-Numero $dados[$r, $colDiaria] } else { '' }
    $tipoVeiculo = if ($colTipoVeiculo) { Formatar-Texto $dados[$r, $colTipoVeiculo] } else { '' }
    $capacidadeMaxKg = if ($colCapacidadeMaxKg) { Formatar-Numero $dados[$r, $colCapacidadeMaxKg] } else { '' }
    $capacidadeVolumes = if ($colCapacidadeVolumes) { Formatar-Numero $dados[$r, $colCapacidadeVolumes] } else { '' }
    $transportador = if ($colTransportador) { Formatar-Texto $dados[$r, $colTransportador] } else { '' }
    $dataCriacao = if ($colDataCriacao) { Formatar-Data $dados[$r, $colDataCriacao] } else { '' }
    $identificadorViagem = if ($colIdentificadorViagem) { Formatar-Texto $dados[$r, $colIdentificadorViagem] } else { '' }
    $linhas.Add("$placa;$dataEmbarque;$embarque;$cidadeDestino;$valorFrete;$peso;$volumes;$valorNFs;$pedagio;$descarga;$diaria;$tipoVeiculo;$capacidadeMaxKg;$capacidadeVolumes;$transportador;$dataCriacao;$identificadorViagem")
  }
  return @{ Cabecalho = "Placa;Data Embarque;Embarque;Cidade Destino;Valor Frete Calculado;Peso;Volumes;Valor Total NFs;Pedágio;Descarga;Diária;Tipo de Veículo;Capacidade Máxima Kg;Capacidade Volumes;Transportador;Data Criacao;Identificador Viagem"; Linhas = $linhas }
  } finally {
    Fechar-Excel $sessao
  }
}

# Aba "Indicador Frete Transportadora" -> sample-data-indicador-frete-transportadora.csv
# (2026-09-10, pedido da usuária). Por EMBARQUE, não por Nota Fiscal -- confirmado por leitura
# direta da planilha (2026-09-11): ela extraiu essa aba de OUTRA fonte/relatório do Lincros (não
# mais o export "por Embarque" de 2026-09-10, que tinha ficado errado pra ela) -- grão agora é por
# CT-e/Nota (Número+Série), confirmado por ela: "Número" é o Nº do CT-e, NÃO a NF. Confirmado
# também que Número+Série SE REPETE de propósito (cada linha é um lançamento real e distinto, não
# é duplicata) -- soma-se tudo normalmente. Colunas confirmadas por leitura direta da planilha
# (2026-09-11): Número | Série | Emissão | Transportadora | Empresa | Unidade | Origem | Estado de
# origem | Destino | Estado de destino | Frete Calculado | Valor realizado | Diferença de frete.
# "Empresa" tem 1 valor só (sempre "Da Terrinha") -- sem informação nenhuma, não extraída de
# propósito (mesmo raciocínio de sempre: só extrai o que tem uso real). "Diferença de frete" é
# coluna que ELA MESMA cria e calcula na planilha (não é derivada aqui): positivo = transportadora
# cobrou A MAIS do que o Frete Calculado; negativo = cobrou A MENOS (confirmado por ela, usado pra
# colorir vermelho/verde no dashboard).
function Extrair-IndicadorFreteTransportadora() {
  Escrever-Log "Abrindo planilha para ler 'Indicador Frete Transportadora'..."
  $sessao = Abrir-Excel $ExcelPath
  try {
  $sheet = Pegar-AbaPorNome $sessao.Wb "Indicador Frete Transportadora"

  $colNumero = Achar-ColunaPorCabecalho $sheet @('Número', 'Numero')
  $colSerie = Achar-ColunaPorCabecalho $sheet @('Série', 'Serie')
  $colEmissao = Achar-ColunaPorCabecalho $sheet @('Emissão', 'Emissao')
  $colTransportadora = Achar-ColunaPorCabecalho $sheet @('Transportadora')
  $colUnidade = Achar-ColunaPorCabecalho $sheet @('Unidade')
  $colOrigem = Achar-ColunaPorCabecalho $sheet @('Origem')
  $colEstadoOrigem = Achar-ColunaPorCabecalho $sheet @('Estado de origem')
  $colDestino = Achar-ColunaPorCabecalho $sheet @('Destino')
  $colEstadoDestino = Achar-ColunaPorCabecalho $sheet @('Estado de destino')
  $colFreteCalc = Achar-ColunaPorCabecalho $sheet @('Frete Calculado')
  $colValorRealizado = Achar-ColunaPorCabecalho $sheet @('Valor realizado')
  $colDifFrete = Achar-ColunaPorCabecalho $sheet @('Diferença de frete', 'Diferenca de frete')
  Escrever-Log "  colunas achadas: Numero=$colNumero Serie=$colSerie Emissao=$colEmissao Transportadora=$colTransportadora Unidade=$colUnidade Origem=$colOrigem EstadoOrigem=$colEstadoOrigem Destino=$colDestino EstadoDestino=$colEstadoDestino FreteCalc=$colFreteCalc ValorRealizado=$colValorRealizado DifFrete=$colDifFrete"

  $ultimaLinha = Achar-UltimaLinha $sheet $colNumero
  Escrever-Log "  ultima linha com Numero preenchido: $ultimaLinha"
  $ultimaColuna = (@($colNumero, $colSerie, $colEmissao, $colTransportadora, $colUnidade, $colOrigem, $colEstadoOrigem, $colDestino, $colEstadoDestino, $colFreteCalc, $colValorRealizado, $colDifFrete) | Measure-Object -Maximum).Maximum
  $dados = Ler-Matriz $sheet $ultimaLinha $ultimaColuna

  $linhas = New-Object System.Collections.Generic.List[string]
  for ($r = 2; $r -le $ultimaLinha; $r++) {
    $numero = Formatar-Texto $dados[$r, $colNumero]
    if (-not $numero) { continue }
    $serie = Formatar-Texto $dados[$r, $colSerie]
    $emissao = Formatar-Data $dados[$r, $colEmissao]
    $transportadora = Formatar-Texto $dados[$r, $colTransportadora]
    $unidade = Formatar-Texto $dados[$r, $colUnidade]
    $origem = Formatar-Texto $dados[$r, $colOrigem]
    $estadoOrigem = Formatar-Texto $dados[$r, $colEstadoOrigem]
    $destino = Formatar-Texto $dados[$r, $colDestino]
    $estadoDestino = Formatar-Texto $dados[$r, $colEstadoDestino]
    $freteCalc = Formatar-Numero $dados[$r, $colFreteCalc]
    $valorRealizado = Formatar-Numero $dados[$r, $colValorRealizado]
    $difFrete = Formatar-Numero $dados[$r, $colDifFrete]
    $linhas.Add("$numero;$serie;$emissao;$transportadora;$unidade;$origem;$estadoOrigem;$destino;$estadoDestino;$freteCalc;$valorRealizado;$difFrete")
  }
  return @{ Cabecalho = "Numero;Serie;Emissao;Transportadora;Unidade;Origem;Estado Origem;Destino;Estado Destino;Frete Calculado;Valor Realizado;Diferenca Frete"; Linhas = $linhas }
  } finally {
    Fechar-Excel $sessao
  }
}

# ============================================================
# ENVIO PRO GITHUB
# ============================================================

# Reenvia do zero (GET do sha + PUT do conteúdo) até 3 vezes -- achado real (2026-09-16): o PUT
# do arquivo grande (Bluesoft, ~25MB) deu "Server Error" do lado do GitHub (falha passageira,
# nunca vista antes nesta sessão) e, como a função não tinha retry nenhum, o erro subia e
# interrompia o script -- NENHUM dos 7 arquivos daquela rodada chegou a ser publicado, mesmo os
# pequenos que teriam ido sem problema. Buscar o sha DE NOVO a cada tentativa (não só na 1ª) é
# de propósito: se um PUT anterior tiver na verdade funcionado do lado do GitHub mas a resposta
# se perdido antes de chegar aqui, a tentativa seguinte usa o sha certo (evita erro 409 de
# conflito por causa de um sha desatualizado).
function Enviar-ParaGitHub([string]$caminhoLocal, [string]$caminhoNoRepo, [string]$token, [int]$maxTentativas = 3) {
  $apiUrl = "https://api.github.com/repos/$GitHubOwner/$GitHubRepo/contents/$caminhoNoRepo"
  $headers = @{
    Authorization = "token $token"
    Accept        = "application/vnd.github+json"
    'User-Agent'  = "atualizar-dados-dashboard-script"
  }

  for ($tentativa = 1; $tentativa -le $maxTentativas; $tentativa++) {
    try {
      $shaAtual = $null
      try {
        $atual = Invoke-RestMethod -Uri "$apiUrl`?ref=$GitHubBranch" -Headers $headers -Method Get
        $shaAtual = $atual.sha
      } catch {
        $status = $_.Exception.Response.StatusCode.value__
        if ($status -ne 404) { throw }
      }

      $bytes = [System.IO.File]::ReadAllBytes($caminhoLocal)
      $base64 = [Convert]::ToBase64String($bytes)
      $mensagem = "Atualiza $caminhoNoRepo via script ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))"

      $corpo = @{ message = $mensagem; content = $base64; branch = $GitHubBranch }
      if ($shaAtual) { $corpo.sha = $shaAtual }
      $corpoJson = $corpo | ConvertTo-Json -Compress

      # TimeoutSec 300 (2026-09-10): o canhotos-index.json tem ~21MB (~28MB em base64) -- o
      # padrão do Invoke-RestMethod (100s) já se mostrou justo pra esse tamanho numa conexão
      # mais lenta; pros CSVs pequenos de sempre isso não muda nada, só sobe o teto.
      Invoke-RestMethod -Uri $apiUrl -Headers $headers -Method Put -Body ([System.Text.Encoding]::UTF8.GetBytes($corpoJson)) -ContentType "application/json; charset=utf-8" -TimeoutSec 300 | Out-Null
      Escrever-Log "  -> enviado para GitHub: $caminhoNoRepo"
      return
    } catch {
      Escrever-Log "  Falha ao enviar '$caminhoNoRepo' pro GitHub (tentativa $tentativa/$maxTentativas): $($_.Exception.Message)"
      if ($tentativa -ge $maxTentativas) { throw }
      Start-Sleep -Seconds 15
    }
  }
}

# Tenta a extração de uma aba inteira do zero (nova sessão do Excel) até 3 vezes — o COM do
# Excel se mostrou instável nos testes (Workbooks.Open ou Sheets.Item ocasionalmente falham
# sem aviso depois de várias aberturas seguidas desse arquivo grande). Se falhar em QUALQUER
# ponto (abrir, achar a aba, ler os dados), tenta de novo do zero em vez de desistir na hora.
function Tentar-Extracao([scriptblock]$extrator, [string]$nomeAba, [int]$maxTentativas = 3) {
  for ($tentativa = 1; $tentativa -le $maxTentativas; $tentativa++) {
    try {
      return & $extrator
    } catch {
      Escrever-Log "  Falha ao extrair '$nomeAba' (tentativa $tentativa/$maxTentativas): $($_.Exception.Message)"
      if ($tentativa -ge $maxTentativas) { throw }
      Start-Sleep -Seconds 10
    }
  }
}

# ============================================================
# FLUXO PRINCIPAL
# ============================================================

Limpar-InstanciasTravadas

if (-not (Test-Path $ExcelPath)) {
  Write-Error "Planilha nao encontrada: $ExcelPath"
  exit 1
}

$token = $null
if (-not $SomenteExtrair) {
  if (-not (Test-Path $TokenFile)) {
    Write-Error "Arquivo de token nao encontrado: $TokenFile`nCrie esse arquivo com seu Personal Access Token do GitHub (veja instrucoes no topo deste script), ou rode com -SomenteExtrair pra so gerar os CSVs sem enviar."
    exit 1
  }
  $token = (Get-Content -Path $TokenFile -Raw).Trim()
  if (-not $token) {
    Write-Error "$TokenFile esta vazio."
    exit 1
  }
}

Escrever-Log "Verificando quais abas existem na planilha..."
$sessaoInicial = Abrir-Excel $ExcelPath
$nomesAbas = @()
try {
  for ($i = 1; $i -le $sessaoInicial.Wb.Sheets.Count; $i++) { $nomesAbas += $sessaoInicial.Wb.Sheets.Item($i).Name }
} finally {
  Fechar-Excel $sessaoInicial
}
Escrever-Log "  abas encontradas ($($nomesAbas.Count)): $($nomesAbas -join ', ')"

Escrever-Log "Iniciando extração (cada aba abre a planilha de novo, ~1 min cada — pode levar uns minutos no total)..."

$fontes = @(
  # sample-data-bluesoft.csv SAIU desta lista (2026-09-25, migração pro Lincros) -- agora é
  # gerado por scripts/atualizar-bluesoft-lincros.js (Node), lendo a exportação automática do
  # Lincros no SharePoint em vez da planilha manual. Deixar essa entrada aqui sobrescreveria o
  # arquivo novo com o dado velho e desatualizado da planilha a cada rodada desta automação. Ver
  # scripts/atualizar-bluesoft-lincros.js e scripts/3-Atualizar-Bluesoft-Lincros.bat.
  @{ Nome = 'sample-data-agendamentos.csv'; AbaNecessaria = 'Agendamentos'; Extrator = { Extrair-Agendamentos } },
  @{ Nome = 'sample-data-clientes.csv'; AbaNecessaria = 'Vendedor x Cliente'; Extrator = { Extrair-VendedorCliente } },
  @{ Nome = 'sample-data-motivos.csv'; AbaNecessaria = 'Base BI'; Extrator = { Extrair-Motivos } },
  @{ Nome = 'sample-data-faturamento.csv'; AbaNecessaria = 'Base BI'; Extrator = { Extrair-Faturamento } },
  @{ Nome = 'sample-data-retorno.csv'; AbaNecessaria = 'RETORNO'; Extrator = { Extrair-Retorno } },
  @{ Nome = 'sample-data-pedidos-nao-faturados.csv'; AbaNecessaria = 'Pedidos não Faturados (Emissão)'; Extrator = { Extrair-PedidosNaoFaturados } },
  @{ Nome = 'sample-data-pedido-x-nota.csv'; AbaNecessaria = 'Pedido X Nota (agendamento)'; Extrator = { Extrair-PedidoXNota } },
  # Não lê o Excel -- lê o CSV de "Pedidos não Faturados" que a fonte logo acima acabou de
  # (re)gerar neste mesmo run. Por isso reaproveita a MESMA AbaNecessaria: se essa aba não
  # existir mais na planilha, o CSV de pedidos não é regenerado, então também não faz sentido
  # tentar atualizar o histórico agora (ele fica como está, sem perder nada do que já tinha).
  @{ Nome = 'sample-data-pedidos-agendamento-historico.csv'; AbaNecessaria = 'Pedidos não Faturados (Emissão)'; Extrator = { Extrair-HistoricoAgendamentoPedidos } },
  @{ Nome = 'sample-data-indicador-frete.csv'; AbaNecessaria = 'Indicador de Frete'; Extrator = { Extrair-IndicadorFrete } },
  @{ Nome = 'sample-data-indicador-frete-transportadora.csv'; AbaNecessaria = 'Indicador Frete Transportadora'; Extrator = { Extrair-IndicadorFreteTransportadora } }
)

# Cada fonte é isolada num try/catch próprio — antes, uma aba faltando ou com erro
# interrompia o script inteiro (por causa do $ErrorActionPreference='Stop' no topo) e
# NENHUM arquivo chegava a ser enviado, mesmo os que estavam 100% ok. Agora uma fonte com
# problema só fica de fora, o resto continua e vai pro GitHub normalmente.
$arquivosGerados = @()
$arquivosRecusados = @()
$arquivosPulados = @()
$arquivosComErro = @()
foreach ($fonte in $fontes) {
  if ($nomesAbas -notcontains $fonte.AbaNecessaria) {
    Escrever-Log "  PULADO: $($fonte.Nome) precisa da aba '$($fonte.AbaNecessaria)', que não existe mais nessa planilha. O arquivo atual em assets/data/ fica como está (não foi enviado nada novo pra ele)."
    $arquivosPulados += $fonte.Nome
    continue
  }
  try {
    $resultado = Tentar-Extracao $fonte.Extrator $fonte.Nome
    $caminho = Join-Path $PastaSaida $fonte.Nome
    $escreveu = Escrever-Csv $caminho $resultado.Cabecalho $resultado.Linhas
    if ($escreveu) { $arquivosGerados += $caminho } else { $arquivosRecusados += $fonte.Nome }
  } catch {
    Escrever-Log "  ERRO ao extrair $($fonte.Nome), pulando pra próxima fonte: $($_.Exception.Message)"
    $arquivosComErro += $fonte.Nome
  }
}

Escrever-Log "Extracao concluida."
if ($arquivosPulados.Count -gt 0) {
  Escrever-Log "AVISO: $($arquivosPulados.Count) arquivo(s) pulados por falta da aba de origem: $($arquivosPulados -join ', ')"
}
if ($arquivosComErro.Count -gt 0) {
  Escrever-Log "AVISO: $($arquivosComErro.Count) arquivo(s) falharam na extração (veja o erro '!! ERRO' acima) e NÃO foram enviados: $($arquivosComErro -join ', ')"
}
if ($arquivosRecusados.Count -gt 0) {
  Escrever-Log "ATENCAO: $($arquivosRecusados.Count) arquivo(s) NAO foram atualizados (extração suspeita, veja o aviso '!! RECUSADO' acima): $($arquivosRecusados -join ', ')"
}

if ($SomenteExtrair) {
  Escrever-Log "Rodou com -SomenteExtrair: os CSVs foram atualizados localmente, mas NAO foram enviados ao GitHub."
  Escrever-Log "Confira os arquivos em $PastaSaida e, se estiver tudo certo, rode de novo sem -SomenteExtrair."
} else {
  Escrever-Log "Enviando arquivos para o GitHub ($GitHubOwner/$GitHubRepo, branch $GitHubBranch)..."
  # Mesmo espírito do loop de extração acima (linha ~849): um arquivo com problema (esgotou as
  # 3 tentativas de Enviar-ParaGitHub) fica de fora, mas NÃO trava o envio dos outros -- antes
  # disso, uma falha no primeiro arquivo (2026-09-16, o Bluesoft grande) impedia TODOS os outros
  # 6 de serem enviados, mesmo esses não tendo nenhum problema.
  $arquivosComErroEnvio = @()
  foreach ($caminho in $arquivosGerados) {
    $nomeArquivo = Split-Path $caminho -Leaf
    try {
      Enviar-ParaGitHub $caminho "assets/data/$nomeArquivo" $token
    } catch {
      Escrever-Log "  ERRO ao enviar $nomeArquivo pro GitHub (esgotou as tentativas), pulando pro proximo arquivo: $($_.Exception.Message)"
      $arquivosComErroEnvio += $nomeArquivo
    }
  }
  if ($arquivosComErroEnvio.Count -gt 0) {
    Escrever-Log "AVISO: $($arquivosComErroEnvio.Count) arquivo(s) NAO foram enviados ao GitHub mesmo depois de 3 tentativas cada: $($arquivosComErroEnvio -join ', ')"
    Escrever-Log "  Rode o script de novo (só o upload já vai tentar de novo pra esses); se persistir, avise o Claude."
  } else {
    Escrever-Log "Tudo enviado. O site deve refletir os dados novos no proximo carregamento (Ctrl+F5 se o navegador ainda mostrar dado antigo)."
  }

  # Índice de canhotos (2026-09-10) — isolado do resto de propósito: a pasta do SharePoint tem
  # ~173 mil arquivos, a varredura demora bem mais que as abas do Excel acima. Se der problema
  # aqui (sync pausado, pasta indisponível), os CSVs principais JÁ foram enviados antes desta
  # linha, então uma falha aqui não pode derrubar o resultado do resto do script (por isso
  # roda num processo powershell.exe SEPARADO, não "& scriptPath" direto — o gerar-indice-
  # canhotos.ps1 usa "exit 1" quando a pasta não existe, e isso encerraria ESTE script inteiro
  # também se fosse chamado no mesmo processo).
  Escrever-Log "Atualizando indice de canhotos (pode demorar alguns minutos, pasta grande)..."
  try {
    $scriptCanhotos = Join-Path $PSScriptRoot "gerar-indice-canhotos.ps1"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptCanhotos | ForEach-Object { Escrever-Log "  [canhotos] $_" }
    if ($LASTEXITCODE -ne 0) { throw "gerar-indice-canhotos.ps1 terminou com codigo de saida $LASTEXITCODE" }
    $caminhoCanhotos = Join-Path $PastaSaida "canhotos-index.json"
    Enviar-ParaGitHub $caminhoCanhotos "assets/data/canhotos-index.json" $token
    Escrever-Log "Indice de canhotos atualizado e enviado."
  } catch {
    Escrever-Log "AVISO: falha ao atualizar o indice de canhotos, pulando (os CSVs principais ja foram enviados normalmente acima): $($_.Exception.Message)"
  }
}

