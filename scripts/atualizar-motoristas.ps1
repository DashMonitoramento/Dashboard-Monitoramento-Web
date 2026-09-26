<#
  atualizar-motoristas.ps1

  Extrai o cadastro de motoristas agregados (aba "AGREGADOS" da planilha
  "AGREGADOS ESCALA.xlsx") pro CSV que alimenta o Controle de Cargas e Disponibilidade de
  Motoristas, e envia pro GitHub -- mesmo mecanismo já usado por atualizar-dados-dashboard.ps1
  (não mexe nele, é um script irmão, já que essa fonte é um arquivo totalmente separado e bem
  menor: 1 aba só, 4 colunas).

  O que faz, numa unica execucao:
    1. Abre "AGREGADOS ESCALA.xlsx" (somente leitura).
    2. Lê a aba "AGREGADOS" (Nome, Rodízio, Veículo/Peso, Placa) por NOME de cabeçalho, não
       posição fixa -- mesmo padrão de robustez do script principal.
    3. Normaliza Rodízio pros 5 dias da semana (a planilha tem texto inconsistente: "QUINTA"
       vs "QUINTA FEIRA" vs "QUINTA-FEIRA" etc.) e a Placa (maiúscula, só letras/números).
    4. Gera assets/data/sample-data-motoristas.csv e envia pro GitHub.

  COMO USAR: igual ao script principal --
    powershell -ExecutionPolicy Bypass -File .\atualizar-motoristas.ps1 -SomenteExtrair
    powershell -ExecutionPolicy Bypass -File .\atualizar-motoristas.ps1
  (usa o mesmo scripts\github-token.txt já configurado pro outro script.)
#>

param(
  [switch]$SomenteExtrair
)

$ErrorActionPreference = 'Stop'

# ============================================================
# CONFIGURAÇÃO
# ============================================================

$ExcelPath = "C:\Users\Daterrinha87\OneDrive - daterrinhaalimentos.com.br\Área de Trabalho\Atualização do B.I\AGREGADOS ESCALA.xlsx"
$PastaSaida = Join-Path $PSScriptRoot "..\assets\data"
$TokenFile = Join-Path $PSScriptRoot "github-token.txt"

$GitHubOwner = "DashMonitoramento"
$GitHubRepo = "Dashboard-Monitoramento-Web"
$GitHubBranch = "main"

# Correção pontual confirmada pela usuária (2026-09-04): a planilha real tem a placa
# "ELQ1J17" duplicada em 2 linhas -- uma do José Antonio da Silva (certa) e outra do Emerson
# (errada, a placa de verdade dele é "ELQ6181"). Corrige só essa linha específica por nome;
# qualquer OUTRA duplicata futura só gera aviso no log (ver Extrair-Motoristas), não é
# corrigida sozinha -- decisão de negócio, não algo pro script resolver "adivinhando".
$CorrecoesPlacaConhecidas = @{ 'EMERSON' = 'ELQ6181' }

# ============================================================
# FUNÇÕES DE APOIO (mesmas de atualizar-dados-dashboard.ps1, copiadas aqui de propósito --
# script irmão, independente, sem compartilhar estado com o principal)
# ============================================================

function Escrever-Log($msg) {
  Write-Output "[$(Get-Date -Format 'HH:mm:ss')] $msg"
}

function Formatar-Texto($valor) {
  if ($null -eq $valor) { return '' }
  return ([string]$valor).Trim()
}

function Remover-Acentos([string]$texto) {
  $formD = $texto.Normalize([System.Text.NormalizationForm]::FormD)
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $formD.ToCharArray()) {
    $cat = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch)
    if ($cat -ne [System.Globalization.UnicodeCategory]::NonSpacingMark) { [void]$sb.Append($ch) }
  }
  return $sb.ToString().Normalize([System.Text.NormalizationForm]::FormC)
}

# Cobre as 10 variações reais já vistas na planilha: SEXTA-FEIRA / SEXTA -FEIRA, TERÇA-FEIRA,
# SEGUNDA-FEIRA, QUINTA / QUINTA FEIRA / QUINTA-FEIRA, QUARTA -FEIRA / QUARTA-FEIRA (com ou
# sem espaço sobrando). Tira acento/espaço/hífen e casa pelo radical -- texto não reconhecido
# vira '' (fica sem rodízio marcado, não quebra a extração).
function Normalizar-Rodizio([string]$valor) {
  $texto = (Remover-Acentos (([string]$valor).ToUpper().Trim())) -replace '[-\s]+', ''
  switch -regex ($texto) {
    '^SEGUNDA' { return 'Segunda-feira' }
    '^TERCA'   { return 'Terça-feira' }
    '^QUARTA'  { return 'Quarta-feira' }
    '^QUINTA'  { return 'Quinta-feira' }
    '^SEXTA'   { return 'Sexta-feira' }
    default    { return '' }
  }
}

# Mesma normalização que o app do motorista (JS) vai usar pra reconhecer a placa digitada --
# maiúscula, só letras/números (cobre formato antigo com hífen, Mercosul, e espaço sobrando
# vindo da planilha, ex.: "STO8J09 ").
function Normalizar-Placa([string]$valor) {
  return (([string]$valor).ToUpper() -replace '[^A-Z0-9]', '')
}

function Achar-UltimaLinha($sheet, [int]$colunaChave) {
  return $sheet.Cells($sheet.Rows.Count, $colunaChave).End(-4162).Row
}

function Ler-Matriz($sheet, [int]$ultimaLinha, [int]$ultimaColuna) {
  if ($ultimaLinha -lt 2) { return $null }
  $range = $sheet.Range($sheet.Cells(1, 1), $sheet.Cells($ultimaLinha, $ultimaColuna))
  $dados = $range.Value2
  if ($null -eq $dados) { throw "Range.Value2 devolveu nulo -- instabilidade do COM, tente rodar de novo." }
  if ($dados.GetLength(0) -ne $ultimaLinha) {
    throw "Leitura incompleta: esperava $ultimaLinha linhas, a matriz veio com $($dados.GetLength(0)) -- instabilidade do COM, tente rodar de novo."
  }
  if ($dados.GetLength(1) -ne $ultimaColuna) {
    throw "Leitura incompleta: esperava $ultimaColuna colunas, a matriz veio com $($dados.GetLength(1)) -- instabilidade do COM, tente rodar de novo."
  }
  return ,$dados
}

function Escrever-Csv([string]$caminho, [string]$cabecalho, [string[]]$linhas) {
  $linhasExistentes = 0
  if (Test-Path $caminho) {
    $linhasExistentes = (Get-Content -Path $caminho | Measure-Object -Line).Lines
  }
  $minimoAceitavel = [Math]::Max(10, [int]($linhasExistentes * 0.3))
  if ($linhasExistentes -gt 0 -and $linhas.Count -lt $minimoAceitavel) {
    Escrever-Log "  !! RECUSADO: $caminho tinha $linhasExistentes linhas, a extração nova trouxe só $($linhas.Count) -- abaixo do mínimo aceitável ($minimoAceitavel). Mantendo o arquivo antigo."
    return $false
  }
  $conteudo = $cabecalho + "`n" + ($linhas -join "`n")
  $utf8SemBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($caminho, $conteudo, $utf8SemBom)
  Escrever-Log "  -> $caminho ($($linhas.Count) linhas, era $linhasExistentes)"
  return $true
}

function Abrir-Excel([string]$caminho) {
  $maxTentativas = 3
  for ($tentativa = 1; $tentativa -le $maxTentativas; $tentativa++) {
    $excel = $null
    try {
      $excel = New-Object -ComObject Excel.Application
      $excel.Visible = $false
      $excel.DisplayAlerts = $false
      $wb = $excel.Workbooks.Open($caminho, $false, $true)
      if ($null -eq $wb) { throw "Workbooks.Open devolveu nulo (sem lançar exceção) -- instabilidade do COM." }
      Start-Sleep -Seconds 2
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

# Mesma proteção adicionada em atualizar-dados-dashboard.ps1 (2026-09-26, caso real de Excel
# travado numa caixa de diálogo escondida porque a planilha estava aberta por alguém) -- limpa
# qualquer resquício de uma execução ANTERIOR desta automação que ainda esteja presa, garantindo
# que toda rodada nova começa do zero. Nunca mexe em Excel com janela visível (edição manual).
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

function Pegar-AbaPorNome($wb, [string]$nome) {
  for ($i = 1; $i -le $wb.Sheets.Count; $i++) {
    $sheet = $wb.Sheets.Item($i)
    if ($sheet.Name -eq $nome) { return $sheet }
  }
  throw "Aba '$nome' nao encontrada (a planilha tem $($wb.Sheets.Count) abas) -- confira se o nome nao mudou."
}

function Achar-ColunaPorCabecalho($sheet, [string[]]$nomesPossiveis, [int]$colunaMax = 20) {
  for ($c = 1; $c -le $colunaMax; $c++) {
    $texto = ([string]$sheet.Cells(1, $c).Text).Trim()
    foreach ($nome in $nomesPossiveis) {
      if ($texto -eq $nome) { return $c }
    }
  }
  throw "Nenhuma coluna com cabecalho '$($nomesPossiveis -join "' ou '")' encontrada na aba '$($sheet.Name)' -- confira se o nome mudou."
}

function Fechar-Excel($sessao) {
  try { if ($sessao.Wb) { $sessao.Wb.Close($false) } } catch { Escrever-Log "  (aviso: falha ao fechar a planilha, ignorando: $($_.Exception.Message))" }
  try { $sessao.Excel.Quit() } catch { Escrever-Log "  (aviso: falha ao encerrar o Excel, ignorando: $($_.Exception.Message))" }
  try { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($sessao.Excel) | Out-Null } catch {}
}

function Enviar-ParaGitHub([string]$caminhoLocal, [string]$caminhoNoRepo, [string]$token) {
  $apiUrl = "https://api.github.com/repos/$GitHubOwner/$GitHubRepo/contents/$caminhoNoRepo"
  $headers = @{
    Authorization = "token $token"
    Accept        = "application/vnd.github+json"
    'User-Agent'  = "atualizar-motoristas-script"
  }
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
  Invoke-RestMethod -Uri $apiUrl -Headers $headers -Method Put -Body ([System.Text.Encoding]::UTF8.GetBytes($corpoJson)) -ContentType "application/json; charset=utf-8" | Out-Null
  Escrever-Log "  -> enviado para GitHub: $caminhoNoRepo"
}

# ============================================================
# EXTRAÇÃO — aba "AGREGADOS" -> sample-data-motoristas.csv
# ============================================================

function Extrair-Motoristas() {
  Escrever-Log "Abrindo planilha para ler 'AGREGADOS'..."
  $sessao = Abrir-Excel $ExcelPath
  try {
    $sheet = Pegar-AbaPorNome $sessao.Wb "AGREGADOS"
    $colNome = Achar-ColunaPorCabecalho $sheet @('NOME')
    $colRodizio = Achar-ColunaPorCabecalho $sheet @('RODIZIO', 'RODÍZIO')
    $colVeiculo = Achar-ColunaPorCabecalho $sheet @('VEICULO / PESO', 'VEÍCULO / PESO')
    $colPlaca = Achar-ColunaPorCabecalho $sheet @('PLACA')
    # Coluna nova (2026-09-26, pedido da usuária) -- aceita "TRANSPORTAORA" (erro de digitação
    # real da planilha dela) e "TRANSPORTADORA" (caso ela corrija o cabeçalho depois).
    $colTransportadora = Achar-ColunaPorCabecalho $sheet @('TRANSPORTADORA', 'TRANSPORTAORA')
    $ultimaLinha = Achar-UltimaLinha $sheet $colPlaca
    Escrever-Log "  ultima linha com Placa preenchida: $ultimaLinha"
    $ultimaColuna = ($colNome, $colRodizio, $colVeiculo, $colPlaca, $colTransportadora | Measure-Object -Maximum).Maximum
    $dados = Ler-Matriz $sheet $ultimaLinha $ultimaColuna

    $vistos = @{}
    $linhas = New-Object System.Collections.Generic.List[string]
    for ($r = 2; $r -le $ultimaLinha; $r++) {
      $nome = Formatar-Texto $dados[$r, $colNome]
      if (-not $nome) { continue }
      $placa = Normalizar-Placa (Formatar-Texto $dados[$r, $colPlaca])
      if (-not $placa) { continue }

      if ($placa -eq 'ELQ1J17' -and $CorrecoesPlacaConhecidas.ContainsKey($nome.ToUpper())) {
        $placa = $CorrecoesPlacaConhecidas[$nome.ToUpper()]
      }
      if ($vistos.ContainsKey($placa)) {
        Escrever-Log "  AVISO: placa '$placa' duplicada na planilha (linha $r, '$nome') -- mantendo a primeira ocorrência ('$($vistos[$placa])'), essa foi ignorada. Confira/corrija a planilha de origem."
        continue
      }
      $vistos[$placa] = $nome

      $veiculo = Formatar-Texto $dados[$r, $colVeiculo]
      $rodizio = Normalizar-Rodizio (Formatar-Texto $dados[$r, $colRodizio])
      $transportadora = Formatar-Texto $dados[$r, $colTransportadora]
      $linhas.Add("$nome;$rodizio;$veiculo;$placa;$transportadora")
    }
    return @{ Cabecalho = "Nome;Rodizio;Veiculo;Placa;Transportadora"; Linhas = $linhas }
  } finally {
    Fechar-Excel $sessao
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
    Write-Error "Arquivo de token nao encontrado: $TokenFile`nRode com -SomenteExtrair pra so gerar o CSV sem enviar, ou confira o token usado por atualizar-dados-dashboard.ps1."
    exit 1
  }
  $token = (Get-Content -Path $TokenFile -Raw).Trim()
  if (-not $token) {
    Write-Error "$TokenFile esta vazio."
    exit 1
  }
}

try {
  $resultado = Extrair-Motoristas
  $caminho = Join-Path $PastaSaida "sample-data-motoristas.csv"
  $escreveu = Escrever-Csv $caminho $resultado.Cabecalho $resultado.Linhas
} catch {
  Escrever-Log "ERRO na extração: $($_.Exception.Message)"
  exit 1
}

Escrever-Log "Extracao concluida ($($resultado.Linhas.Count) motoristas)."

if ($SomenteExtrair) {
  Escrever-Log "Rodou com -SomenteExtrair: o CSV foi atualizado localmente, mas NAO foi enviado ao GitHub."
} elseif ($escreveu) {
  Escrever-Log "Enviando para o GitHub ($GitHubOwner/$GitHubRepo, branch $GitHubBranch)..."
  Enviar-ParaGitHub $caminho "assets/data/sample-data-motoristas.csv" $token
  Escrever-Log "Enviado."
} else {
  Escrever-Log "Nada enviado (extração recusada, veja o aviso '!! RECUSADO' acima)."
}
