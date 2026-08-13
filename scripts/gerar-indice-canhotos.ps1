<#
  gerar-indice-canhotos.ps1

  Varre a biblioteca do SharePoint sincronizada "DT - LOGISTICA - MONITORAMENTO" e gera um
  indice NF -> arquivo(s) de canhoto, salvo em assets/data/canhotos-index.json.

  Rode este script sempre que quiser atualizar a busca de canhoto do dashboard (ex.: junto
  com a atualizacao dos CSVs), e suba o assets/data/canhotos-index.json pro GitHub do mesmo
  jeito que os outros arquivos de assets/data.

  IMPORTANTE sobre o link gerado: o link e uma tentativa de montar a URL do SharePoint a
  partir do caminho relativo do arquivo dentro da biblioteca. Antes de confiar nos links,
  clique em um resultado no dashboard pra confirmar que abre o arquivo certo. Se abrir errado
  (pagina de erro, ou pasta errada), me avise o link que gerou e o caminho real do arquivo,
  que eu ajusto o padrao da URL.
#>

$PastaCanhotos = "C:\Users\Daterrinha87\daterrinhaalimentos.com.br\DT - LOGISTICA - MONITORAMENTO"
$SiteUrl = "https://daterrinhaalimentoscombr.sharepoint.com/sites/DT-LOGISTICA"
$BibliotecaSegment = "MONITORAMENTO"
$SaidaJson = Join-Path $PSScriptRoot "..\assets\data\canhotos-index.json"

$ExtensoesValidas = @('.pdf', '.jpg', '.jpeg', '.png', '.jfif')
$PastasIgnoradas = @('PRINT''S MONITORAMENTO')

if (-not (Test-Path $PastaCanhotos)) {
  Write-Error "Pasta nao encontrada: $PastaCanhotos"
  exit 1
}

Write-Output "Varrendo $PastaCanhotos ..."
$todosArquivos = Get-ChildItem -Path $PastaCanhotos -Recurse -File -ErrorAction SilentlyContinue

Write-Output "Total de itens encontrados (antes de filtrar): $($todosArquivos.Count)"

$indice = @{}
$arquivosValidos = 0
$arquivosSemNF = 0
$arquivosIgnorados = 0

foreach ($arquivo in $todosArquivos) {
  # Ignora paginas salvas ("NNNNNN_files") e pastas de ruido conhecido.
  if ($arquivo.DirectoryName -match '_files($|\\)') { $arquivosIgnorados++; continue }
  if ($PastasIgnoradas | Where-Object { $arquivo.DirectoryName -like "*$_*" }) { $arquivosIgnorados++; continue }

  $extensao = $arquivo.Extension.ToLowerInvariant()
  if ($ExtensoesValidas -notcontains $extensao) { $arquivosIgnorados++; continue }

  $nomeBase = $arquivo.BaseName
  # Ruido conhecido que nao e canhoto, mesmo tendo numeros no nome (ex.: "Boleto 138834 - SERRANO").
  if ($nomeBase -match '(?i)whatsapp|boleto|prorroga') { $arquivosIgnorados++; continue }

  # Extrai sequencias de 4 a 7 digitos como candidatas a numero de NF (cobre o intervalo
  # observado, de "10000" a "290933"), tratando cada sequencia isolada por separadores
  # (espaco, hifen, virgula, ponto, underscore) como um numero de NF distinto.
  $numeros = [regex]::Matches($nomeBase, '(?<![\d])\d{4,7}(?![\d])') | ForEach-Object { $_.Value }
  if ($numeros.Count -eq 0) { $arquivosSemNF++; continue }

  $arquivosValidos++
  $caminhoRelativo = $arquivo.FullName.Substring($PastaCanhotos.Length + 1).Replace('\', '/')

  foreach ($nf in ($numeros | Select-Object -Unique)) {
    if (-not $indice.ContainsKey($nf)) { $indice[$nf] = New-Object System.Collections.Generic.List[string] }
    $indice[$nf].Add($caminhoRelativo)
  }
}

Write-Output "Arquivos validos indexados: $arquivosValidos"
Write-Output "Arquivos ignorados (ruido/extensao/pasta): $arquivosIgnorados"
Write-Output "Arquivos sem numero de NF reconhecivel no nome: $arquivosSemNF"
Write-Output "NFs distintas no indice: $($indice.Keys.Count)"

# Monta o objeto final: NF -> { paths: [...], urls: [...] }. A URL e uma tentativa (ver aviso
# no topo do script) — encodifica cada segmento do caminho separadamente pra preservar
# espacos/acentos/apostrofos como parte do nome, nao como separador de URL.
$saida = [ordered]@{}
foreach ($nf in ($indice.Keys | Sort-Object)) {
  $paths = @($indice[$nf] | Select-Object -Unique)
  # Formato final e so "NF": [url1, url2, ...] — sem o caminho relativo redundante (o
  # dashboard só usa a URL) — isso corta o arquivo quase à metade (151 mil NFs, cada campo
  # extra pesa). @(...) forca array mesmo com 1 elemento so — sem isso, PowerShell
  # "desembrulha" uma lista de 1 item pra escalar, e o ConvertTo-Json grava como string
  # solta em vez de array de 1 posicao (o dashboard faria urls[0] pegar só a 1ª LETRA da URL).
  $saida[$nf] = @($paths | ForEach-Object {
    $segmentos = $_ -split '/' | ForEach-Object { [System.Uri]::EscapeDataString($_) }
    "$SiteUrl/$BibliotecaSegment/" + ($segmentos -join '/')
  })
}

$saidaDir = Split-Path $SaidaJson -Parent
if (-not (Test-Path $saidaDir)) { New-Item -ItemType Directory -Path $saidaDir -Force | Out-Null }
$saida | ConvertTo-Json -Depth 5 -Compress | Out-File -FilePath $SaidaJson -Encoding utf8 -NoNewline

Write-Output "Indice salvo em: $SaidaJson"
