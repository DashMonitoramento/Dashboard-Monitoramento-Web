/*
  MANIFESTO — Central de Sincronização (Google Apps Script)
  ============================================================
  Este código transforma uma planilha Google Sheets em uma
  "central" que recebe os registros e itens de estoque de
  todos os aparelhos (celulares e computadores) que usam o
  app Manifesto.

  COMO INSTALAR (uma vez só):
  1. Crie uma planilha em branco no Google Sheets (sheets.new).
  2. Menu Extensões > Apps Script.
  3. Apague todo o conteúdo do editor e cole este arquivo inteiro.
  4. No menu lateral, clique no ícone de engrenagem
     "Configurações do projeto" > "Propriedades do script" >
     "Adicionar propriedade do script".
     - Nome:  TOKEN
     - Valor: escolha uma senha longa e só sua (ex: uma frase
       aleatória). Essa senha é o que protege sua central —
       guarde-a, você vai colar no app Manifesto depois.
  5. Volte para o editor de código, clique em "Implantar" >
     "Nova implantação".
     - Tipo: "App da Web".
     - Executar como: "Eu" (sua conta).
     - Quem pode acessar: "Qualquer pessoa".
  6. Clique em "Implantar", autorize as permissões pedidas, e
     copie o link (URL) que aparece — é algo como
     https://script.google.com/macros/s/AKfycb.../exec
  7. Cole esse link em "Link da central" no app Manifesto (aba
     Exportar), e a mesma senha do passo 4 em "Token".
  8. Repita só o passo 7 (colar link + token) em cada celular ou
     computador que for usar o Manifesto.

  Cada vez que alguém salvar uma entrega ou um item de estoque no
  app, o registro é enviado automaticamente para esta planilha,
  criando duas abas: "Registros" e "Estoque".
*/

const CAMPOS_REGISTRO = ['id','tipo','cliente','endereco','data','hora','motivo','localizacao','status','obs','createdAt','updatedAt','exportedAt'];
const CAMPOS_PRODUTO  = ['id','nome','quantidade','unidade','localizacao','minimo','obs','createdAt','updatedAt'];

function getToken_(){
  return PropertiesService.getScriptProperties().getProperty('TOKEN');
}

function getSheet_(nomeAba, campos){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(nomeAba);
  if(!sheet){
    sheet = ss.insertSheet(nomeAba);
    sheet.appendRow(campos);
  } else if(sheet.getLastRow() === 0){
    sheet.appendRow(campos);
  }
  return sheet;
}

function upsertLinha_(sheet, campos, dado){
  const idColuna = 1;
  const ultimaLinha = sheet.getLastRow();
  let linhaAlvo = -1;
  if(ultimaLinha > 1){
    const ids = sheet.getRange(2, idColuna, ultimaLinha - 1, 1).getValues();
    for(let i=0; i<ids.length; i++){
      if(String(ids[i][0]) === String(dado.id)){ linhaAlvo = i + 2; break; }
    }
  }
  const valores = campos.map(c => dado[c] === undefined || dado[c] === null ? '' : dado[c]);
  if(linhaAlvo === -1){
    sheet.appendRow(valores);
  }else{
    sheet.getRange(linhaAlvo, 1, 1, campos.length).setValues([valores]);
  }
}

function excluirLinha_(sheet, id){
  const ultimaLinha = sheet.getLastRow();
  if(ultimaLinha < 2) return;
  const ids = sheet.getRange(2, 1, ultimaLinha - 1, 1).getValues();
  for(let i=0; i<ids.length; i++){
    if(String(ids[i][0]) === String(id)){
      sheet.deleteRow(i + 2);
      return;
    }
  }
}

function respostaJson_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e){
  try{
    const body = JSON.parse(e.postData.contents);
    if(body.token !== getToken_()) return respostaJson_({ok:false, erro:'token inválido'});
    const tipo = body.tipo;
    const dado = body.dado;
    if(tipo === 'registro'){
      upsertLinha_(getSheet_('Registros', CAMPOS_REGISTRO), CAMPOS_REGISTRO, dado);
    }else if(tipo === 'produto'){
      upsertLinha_(getSheet_('Estoque', CAMPOS_PRODUTO), CAMPOS_PRODUTO, dado);
    }else if(tipo === 'excluir_registro'){
      excluirLinha_(getSheet_('Registros', CAMPOS_REGISTRO), dado.id);
    }else if(tipo === 'excluir_produto'){
      excluirLinha_(getSheet_('Estoque', CAMPOS_PRODUTO), dado.id);
    }else{
      return respostaJson_({ok:false, erro:'tipo desconhecido'});
    }
    return respostaJson_({ok:true});
  }catch(err){
    return respostaJson_({ok:false, erro:String(err)});
  }
}

function lerAba_(nomeAba, campos){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(nomeAba);
  if(!sheet || sheet.getLastRow() < 2) return [];
  const valores = sheet.getRange(2, 1, sheet.getLastRow() - 1, campos.length).getValues();
  return valores.map(linha => {
    const obj = {};
    campos.forEach((c, i) => obj[c] = linha[i]);
    return obj;
  }).filter(obj => obj.id !== '');
}

function doGet(e){
  const token = e.parameter.token;
  if(token !== getToken_()) return respostaJson_({ok:false, erro:'token inválido'});
  const tipo = e.parameter.tipo || 'todos';
  const resultado = {ok:true};
  if(tipo === 'registro' || tipo === 'todos') resultado.registros = lerAba_('Registros', CAMPOS_REGISTRO);
  if(tipo === 'produto' || tipo === 'todos') resultado.produtos = lerAba_('Estoque', CAMPOS_PRODUTO);
  return respostaJson_(resultado);
}
