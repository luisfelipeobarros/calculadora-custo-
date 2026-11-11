/*
  Regras da tela de cotacao que nao passam pelo nucleo de calculo, mas
  decidem QUAIS numeros chegam nele.

  normalizarCfg roda sem DOM: e' funcao pura, extraida do index.html.
  O resto sao travas de origem — a forma do codigo que garante que o
  campo escondido tambem some da tela, e que as escutas do Controle de
  Notas nao se multiplicam.
*/
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, process.argv[2] || 'index.html'), 'utf8');
const notas = fs.readFileSync(path.join(raiz, 'controle-notas.html'), 'utf8');
const shared = fs.readFileSync(path.join(raiz, 'app-shared.js'), 'utf8');

function extrair(nome){
  const i = html.indexOf('function ' + nome + '(');
  if(i === -1) throw new Error('nao achei ' + nome + ' no index.html');
  let d = 0, j = html.indexOf('{', i);
  for(; j < html.length; j++){
    if(html[j] === '{') d++;
    else if(html[j] === '}'){ d--; if(d === 0) break; }
  }
  return html.slice(i, j + 1);
}

const normalizarCfg = new Function(extrair('normalizarCfg') + '\nreturn normalizarCfg;')();

let problemas = 0;
const ok = (m) => console.log('  [ok] ' + m);
const erro = (m) => { console.log('  [X] ' + m); problemas++; };

// ============================================================
// 1) O campo escondido nao entra na conta
// ============================================================

// Quem digitava 12% de credito sobre o frete e depois voltava para "Nao"
// continuava com o credito na conta: com custo 100 / frete 50 / ST 20%,
// o sugerido saia R$ 216,90 em vez de R$ 225,90, e a margem exibida
// (13,03%) discordava da Calculadora depois de salvar (11,20%).
let c = normalizarCfg({ pctCredFrete:'12', credIcmsFrete:0, comST:1, icmsCredito:'7', valorST:'20' });
if(c.pctCredFrete === '0') ok('credito de frete zerado quando o toggle esta em Nao');
else erro('credito de frete FANTASMA: pctCredFrete = ' + c.pctCredFrete);

c = normalizarCfg({ pctCredFrete:'12', credIcmsFrete:1, comST:1, icmsCredito:'7', valorST:'20' });
if(c.pctCredFrete === '12') ok('credito de frete preservado quando o toggle esta em Sim');
else erro('credito de frete sumiu com o toggle em Sim: ' + c.pctCredFrete);

// Com ST o ICMS de credito nao existe; sem ST o valor de ST nao existe.
c = normalizarCfg({ pctCredFrete:'0', credIcmsFrete:0, comST:1, icmsCredito:'7', valorST:'20' });
if(c.icmsCredito === '0' && c.valorST === '20') ok('com ST: zera o ICMS de credito, mantem o valor de ST');
else erro('com ST deu icmsCredito=' + c.icmsCredito + ' valorST=' + c.valorST);

c = normalizarCfg({ pctCredFrete:'0', credIcmsFrete:0, comST:0, icmsCredito:'7', valorST:'20' });
if(c.valorST === '0' && c.icmsCredito === '7') ok('sem ST: zera o valor de ST, mantem o ICMS de credito');
else erro('sem ST deu valorST=' + c.valorST + ' icmsCredito=' + c.icmsCredito);

// As duas telas precisam passar por ela — se uma escapar, so' aquela
// volta a somar o campo escondido, e em silencio.
const compacto = html.replace(/\s+/g, ' ');
['coletarConfigLote', 'configIndividual'].forEach(fn => {
  if(new RegExp('function ' + fn + '\\(\\)\\{ return normalizarCfg\\(').test(compacto)){
    ok(fn + '() passa por normalizarCfg');
  } else {
    erro(fn + '() nao passa por normalizarCfg');
  }
});

// configIndividual precisa LER o toggle, senao normalizarCfg recebe
// credIcmsFrete undefined e zera o credito sempre — inclusive com o
// toggle em Sim.
if(/credIcmsFrete: parseInt\(\$\('indCredIcmsFrete'\)\.value,10\)/.test(compacto)){
  ok('configIndividual() le o toggle de credito de frete');
} else {
  erro('configIndividual() nao le indCredIcmsFrete — o credito seria zerado sempre');
}

// E o campo tem que sumir da tela junto, senao o usuario ve 12% escrito
// e um preco que nao usa esse 12%.
[['lotePctCredFrete','lote'], ['indPctCredFrete','individual']].forEach(([id, tela]) => {
  if(new RegExp("\\$\\('" + id + "'\\)\\.value = ''").test(compacto)){
    ok('o campo escondido e limpo na tela (' + tela + ')');
  } else {
    erro('o campo de credito nao e limpo na tela (' + tela + ')');
  }
});

// ============================================================
// 2) A margem do historico e' a mesma da cotacao
// ============================================================

// O historico so' conhece o custo negociado; frete, ST, IPI e avarias
// vem da ficha em Produtos salvos. Zerando tudo isso, como antes, um
// item de custo 100 / frete 10 / ST 20% vendido a 173,90 aparecia com
// 25,45% aqui e 13,18% na cotacao.
const nucleo = require(path.join(raiz, 'calculo-nucleo.js'));
const fichaExemplo = {
  custoNFe:100, frete:10, pctCredFrete:0, valorST:20, icmsCredito:0, ipi:0.65,
  custoFinanceiroPct:0, avariasPct:1.5, bonificacao:0, tipoBonificacao:0,
  comST:1, prejuizoContabil:0, venda:0
};
const vendaExemplo = nucleo.arredondarNovanta(nucleo.precoParaMargem(fichaExemplo, 0.13));
const margemCotacao = nucleo.computeCalc(Object.assign({}, fichaExemplo, { venda: vendaExemplo })).margem;
const margemComFicha = nucleo.computeCalc(Object.assign({}, fichaExemplo, {
  custoNFe: 100, venda: vendaExemplo, prejuizoContabil: 0
})).margem;
const margemSemFicha = nucleo.computeCalc({
  custoNFe:100, frete:0, pctCredFrete:0, valorST:0, icmsCredito:0, ipi:0,
  custoFinanceiroPct:0, avariasPct:0, bonificacao:0, tipoBonificacao:0,
  venda: vendaExemplo, comST:1, prejuizoContabil:0
}).margem;

if(Math.abs(margemCotacao - margemComFicha) < 1e-12){
  ok('com a ficha, a margem do historico e a mesma da cotacao (' +
     (margemCotacao * 100).toFixed(2) + '%)');
} else {
  erro('a margem diverge: cotacao ' + margemCotacao + ' vs historico ' + margemComFicha);
}
if(margemSemFicha > margemComFicha + 0.05){
  ok('sem ficha o numero sai bem maior — por isso a celula marca com "*"');
} else {
  erro('o exemplo perdeu o efeito: sem ficha deu ' + margemSemFicha + ', com ficha ' + margemComFicha);
}

// E a tela precisa mesmo LER a ficha, nao so' chamar computeCalc.
if(/const ficha = fichaDoProduto\(it\.produto, it\.codigo\);/.test(compacto)){
  ok('o historico busca a ficha do produto');
} else {
  erro('o historico nao busca a ficha (fichaDoProduto)');
}
if(/computeCalc\(Object\.assign\(\{\}, ficha \? ficha\.cfg : CFG_SO_PRODUTO, \{ custoNFe: it\.precoRecebido, venda: precoVenda/.test(compacto)){
  ok('o historico aplica a cfg da ficha sobre o custo desta cotacao');
} else {
  erro('o historico nao aplica a cfg da ficha — a margem volta a sair inflada');
}
// Os indices precisam carregar a cfg junto, senao ficha.cfg vem vazia.
if(/vendaPorProduto = new Map\(comVenda\.map\(p => \[p\.nome, \{ venda: p\.r\.venda, cfg: p\.cfg \}\]\)\)/.test(compacto) &&
   /vendaPorCodigo\.set\(cod, \{ venda: p\.r\.venda, cfg: p\.cfg \}\)/.test(compacto)){
  ok('os indices de Produtos salvos carregam a cfg da ficha');
} else {
  erro('os indices guardam so o preco — ficha.cfg chegaria indefinida');
}

// O selo "✓ por código" le a ficha do indice — que guarda um OBJETO
// { venda, cfg }. Comparar o objeto com "> 0" dava sempre false: o selo
// nunca aparecia e todo casamento seguro era rebaixado a "≈ por nome".
if(!/vendaPorCodigo\.get\([^)]*\) > 0/.test(compacto)){
  ok('o selo "por código" nao compara a ficha (objeto) com numero');
} else {
  erro('vendaPorCodigo.get(...) > 0 voltou — o selo "por código" nunca aparece');
}

// ============================================================
// 2b) A chave do produto: ida e volta
// ============================================================

// Estas duas viraram funcao numa limpeza, e a substituicao por texto
// trocou o corpo da propria definicao pelo nome dela — chaveDoProduto
// passou a chamar a si mesma, e todo "Salvar produto" estourava a pilha.
//
// Nenhum teste pegou porque nenhum teste CHAMAVA a funcao: a carga em
// DOM so' executa o arquivo, e executar a definicao de uma arrow
// function nao dispara a recursao. Nao basta o codigo carregar: tem que
// rodar com dado de verdade.
const defsChave = ['chaveDoProduto', 'nomeDaChave'].map(n => {
  const m = html.match(new RegExp('const ' + n + ' = [^\\n]+'));
  if(!m) throw new Error('nao achei a definicao de ' + n);
  return m[0];
});
const chaves = new Function(defsChave.join('\n') + '\nreturn { chaveDoProduto, nomeDaChave };')();

[
  'Porcelanato Onyx 60x60',
  'TELHA 2,44M x 1,10',
  'Produto com / barra e % porcento',
  'Acentuacao: ACAO',
  'aspas "duplas" e \'simples\''
].forEach(nome => {
  let chave, volta, estourou = null;
  try {
    chave = chaves.chaveDoProduto(nome);
    volta = chaves.nomeDaChave(chave);
  } catch(e) { estourou = e.message; }

  if(estourou){
    erro('chaveDoProduto/nomeDaChave estourou em "' + nome + '": ' + estourou);
  } else if(!chave.startsWith('calc:')){
    erro('a chave nao comeca com o prefixo: ' + chave);
  } else if(volta !== nome){
    erro('ida e volta perdeu o nome: "' + nome + '" -> "' + chave + '" -> "' + volta + '"');
  } else {
    ok('chave ida e volta: "' + nome.slice(0, 28) + (nome.length > 28 ? '...' : '') + '"');
  }
});

// A chave vira id de documento no Firestore: "/" separaria caminho.
if(chaves.chaveDoProduto('a/b').indexOf('/') === -1){
  ok('a barra e codificada — id de documento valido no Firestore');
} else {
  erro('a chave manteve "/", que o Firestore leria como caminho');
}

// ============================================================
// 3) A ficha gravada tambem e' normalizada na LEITURA
// ============================================================

// Fichas salvas antes de normalizarCfg existir podem ter um percentual
// de credito de frete guardado com o toggle em "Nao". A Calculadora
// zera o campo ao abrir a ficha (onToggleChange), entao sem normalizar
// na leitura a mesma ficha rendia 14,85% na lista de Produtos salvos e
// 13,10% depois de aberta — e agora tambem no historico, que passou a
// usar essa configuracao.
const dadosParaCalculo = new Function('toNum', extrair('dadosParaCalculo') + '\nreturn dadosParaCalculo;')
  (v => { const x = parseFloat(v); return isNaN(x) ? 0 : x; });

let d = dadosParaCalculo({ pctCredFrete:'12', valorST:'20', icmsCredito:'7',
  toggles:{ credIcmsFrete:0, comST:1 } });
if(d.pctCredFrete === 0) ok('ficha gravada com credito de frete e toggle em Nao: credito ignorado');
else erro('a leitura da ficha manteve o credito fantasma: ' + d.pctCredFrete);
if(d.icmsCredito === 0 && d.valorST === 20) ok('ficha com ST: le o valor de ST, ignora o ICMS de credito');
else erro('ficha com ST leu icmsCredito=' + d.icmsCredito + ' valorST=' + d.valorST);

d = dadosParaCalculo({ pctCredFrete:'12', valorST:'20', icmsCredito:'7',
  toggles:{ credIcmsFrete:1, comST:0 } });
if(d.pctCredFrete === 12) ok('ficha com o toggle em Sim: credito preservado');
else erro('ficha com o toggle em Sim perdeu o credito: ' + d.pctCredFrete);
if(d.valorST === 0 && d.icmsCredito === 7) ok('ficha sem ST: le o ICMS de credito, ignora o valor de ST');
else erro('ficha sem ST leu valorST=' + d.valorST + ' icmsCredito=' + d.icmsCredito);

// ============================================================
// 4) Uma ponte so' entre a tela e a formula
// ============================================================

// O mapeamento cfg -> nucleo estava copiado em quatro lugares (nucleo,
// margem do lote, margem do individual, coluna do historico). Bastava
// um deles esquecer um campo para aquela tela discordar das outras.
const mapeado = nucleo.valoresParaCalculo(100, {
  frete:'10', pctCredFrete:'12', valorST:'20', icmsCredito:'7', ipi:'0.65',
  custoFinanceiroPct:'2', avariasPct:'1.5', bonificacao:'3',
  tipoBonificacao:1, comST:0
}, 250);
const esperado = {
  custoNFe:100, frete:10, pctCredFrete:12, valorST:20, icmsCredito:7, ipi:0.65,
  custoFinanceiroPct:2, avariasPct:1.5, bonificacao:3, tipoBonificacao:1,
  venda:250, comST:0, prejuizoContabil:0
};
const errados = Object.keys(esperado).filter(k => mapeado[k] !== esperado[k]);
if(errados.length === 0) ok('valoresParaCalculo mapeia os 13 campos que computeCoeficientes le');
else erro('valoresParaCalculo perdeu/torceu: ' + errados.join(', '));

// E as telas precisam usar a ponte, nao remontar o objeto na mao.
const copias = (compacto.match(/custoFinanceiroPct: toNum\(cfg\.custoFinanceiroPct\)/g) || []).length;
if(copias === 0) ok('nenhuma tela remonta o objeto do nucleo por conta propria');
else erro(copias + ' copia(s) do mapeamento cfg -> nucleo sobraram no index.html');

// ============================================================
// 5) A tabela do lote e' chaveada por indice, nao por nome
// ============================================================

// Numa cotacao com dois itens de mesmo nome, a chave por nome fazia as
// duas linhas apontarem para a mesma celula e para o mesmo objeto: a
// segunda nunca recebia margem, e digitar nela alterava a primeira.
// Precisa mirar SO' o card da cotacao. "data-produto-acao" e
// "dataset.produtoNome" sao da lista de Produtos salvos, onde chavear
// pelo nome e' o certo — ali o nome E' a chave do registro.
if(!/data-produto=/.test(compacto) && !/dataset\.produto\b/.test(compacto)){
  ok('as linhas do card de produtos sao chaveadas por indice');
} else {
  erro('ainda ha celula do card de produtos chaveada pelo nome do produto');
}

// ============================================================
// 6) Barra de conta e escutas: nada se multiplica
// ============================================================

if(/container\.dataset\.contaMontada/.test(shared.replace(/\s+/g, ' '))){
  ok('montarBarraConta e idempotente');
} else {
  erro('montarBarraConta sem guarda — cada reconexao acrescenta outro botao Sair');
}

const cn = notas.replace(/\s+/g, ' ');
if(/function escutarColecoes\(\)\{ [^}]*pararEscutas\(\);/.test(cn)){
  ok('escutarColecoes cancela as escutas anteriores antes de abrir novas');
} else {
  erro('escutarColecoes nao cancela as anteriores — as assinaturas se somam');
}
if(/var iniciando = false;/.test(cn) && /function iniciar\(\)\{ if\(iniciando\) return;/.test(cn)){
  ok('iniciar() tem guarda de reentrancia');
} else {
  erro('iniciar() sem guarda — quatro consultas falhando disparam quatro inicializacoes');
}
if(/\}\)\.then\(function\(\)\{ iniciando = false; \}\);/.test(cn)){
  ok('a guarda de iniciar() e liberada no fim da cadeia');
} else {
  erro('a guarda de iniciar() nunca e liberada — uma falha travaria o app para sempre');
}

// NF-e Emitidas ao vivo (05/10/2026): o estado vem de UMA escuta, os
// itens do cache + ultimos dias, e a escuta anterior e' cancelada
// antes de abrir outra.
const ix = html.replace(/\s+/g, ' ');
if(/function escutarEstadoNotas\(corteISO\)\{ if\(pararEscutaNotas\)\{ pararEscutaNotas\(\); pararEscutaNotas = null; \}/.test(ix)){
  ok('escutarEstadoNotas cancela a escuta anterior antes de abrir outra');
} else {
  erro('escutarEstadoNotas nao cancela a anterior — cada Recarregar somaria uma escuta');
}
if(/const consulta = colNotas\.where\('dataEmissao', '>=', corteISO\);/.test(ix) &&
   (ix.match(/consulta\.onSnapshot\(/g) || []).length === 1 && /consultas: \[consulta\], delta: colNotas/.test(ix) &&
   !/where\('dataEmissao', '>=', corteISO\)\.get\(\)/.test(ix)){
  ok('o estado das notas emitidas e uma escuta ao vivo (nao um get por sessao)');
} else {
  erro('o estado das notas emitidas voltou a ser lido uma vez so — a aba fica parada no tempo');
}
if(/App\.lerFaixaComCache\(\{ col: firestoreDb\.collection\('itensNotas'\)/.test(ix) &&
   !/collection\('itensNotas'\)\.where\('dataEmissao', '>=', corteISO\)\.get\(\)/.test(ix)){
  ok('os itens das notas vem do cache do navegador + ultimos dias');
} else {
  erro('os itens das notas voltaram a ser lidos inteiros do servidor a cada abertura');
}
// Recarregar com uma carga em voo entra numa fila de UMA vaga e a trava
// so' e' solta por quem a pos. Antes o .then da 1a carga zerava a
// variavel com a recarga ja' encadeada nela: durante a recarga nao havia
// trava, e um terceiro pedido abria outra carga (duas escutas vivas).
if(/if\(notasEmitidasCache && pararEscutaNotas && !forcar\)/.test(ix) &&
   /if\(cargaNotasEmAndamento\)\{[^}]*if\(forcar && !cargaAtualForcada\) recargaNaFila = true; return cargaNotasEmAndamento; \}/.test(ix) &&
   /while\(recargaNaFila\)\{ recargaNaFila = false; cargaAtualForcada = true; await baixarNotasEmitidas\(true\); \}/.test(ix) &&
   /if\(cargaNotasEmAndamento === carga\) cargaNotasEmAndamento = null;/.test(ix) &&
   !/\.then\(\(\) => \{ cargaNotasEmAndamento = null; \}\)/.test(ix)){
  ok('reabrir a aba so reaproveita a memoria com a escuta viva; cargas simultaneas viram uma, e a recarga pedida no meio roda depois (uma vez)');
} else {
  erro('carregarNotasEmitidas sem as guardas de escuta viva / carga unica / fila de recarga');
}

// ============================================================
// Cotacao: UM ponto de gravacao, por transacao
// ============================================================
// Toda mudanca numa cotacao existente passa por gravarCotacao (le o
// documento fresco, aplica, grava). Um update/set direto com o array
// `itens` tirado da copia em memoria apaga o que outra maquina — ou a
// sincronizacao com as notas — gravou no meio tempo.
if(/async function gravarCotacao\(id, mudar\)\{/.test(ix) && /db\.runTransaction\(async tx => \{ const snap = await tx\.get\(ref\);/.test(ix) &&
   /const campos = mudar\(fresco\); if\(!campos\) return \{ gravou: false, doc: fresco \}; tx\.update\(ref, campos\);/.test(ix)){
  ok('gravarCotacao le o documento fresco dentro da transacao antes de gravar');
} else {
  erro('gravarCotacao nao esta mais no formato transacao: ler fresco -> mudar -> gravar');
}
{
  const diretas = ix.match(/collection\('cotacoes'\)\.doc\([^)]*\)\.(update|set)\(/g) || [];
  if(diretas.length === 0) ok('nenhuma tela grava cotacao por update/set direto (so por gravarCotacao; criar e excluir a parte)');
  else erro(diretas.length + ' gravacao(oes) direta(s) em cotacoes escapando de gravarCotacao: ' + diretas.join(' | '));
  const usos = (ix.match(/gravarCotacao\(/g) || []).length;
  if(usos >= 6) ok('gravarCotacao e usado pelos pontos de gravacao (Pedido feito, Comparar, vinculo, edicao, sincronizacao)');
  else erro('gravarCotacao so aparece ' + usos + ' vez(es) — algum ponto de gravacao saiu dele');
}
// A regra do status (e da data do pedido) mora no radar-nucleo: a tela
// nao escreve `.status =` na mao em item de cotacao.
if(!/\]\.status = /.test(ix) && !/it\.status = 'transito'/.test(ix) && /R\.mudarStatusItem\(/.test(ix)){
  ok('o status do item muda por R.mudarStatusItem (nenhuma atribuicao direta sobrou)');
} else {
  erro('ha atribuicao direta de status de item no index.html — a regra do pedidoEm volta a ter copia');
}
// "Marcar todos como faturado" so' avanca: recebido continua recebido.
if(/R\.mudarStatusItem\(it, 'transito', App\.hojeISO\(\), \{ soAvancar: true \}\)/.test(ix)){
  ok('"todos como faturado" usa soAvancar (nunca rebaixa item recebido)');
} else {
  erro('"todos como faturado" perdeu o soAvancar — volta a rebaixar item recebido');
}
// O Radar nao calcula com carga que falhou.
if(/if\(historicoOk === false\) throw new Error\(/.test(ix) && /if\(!notasEmitidasCache \|\| notasEmitidasErro\)\{ throw new Error\(/.test(ix)){
  ok('o Radar para com erro quando as cotacoes ou as notas nao carregam (nao calcula com zero)');
} else {
  erro('o Radar voltou a calcular sem conferir se cotacoes e notas carregaram');
}
// PDF de fornecedor e' arquivo de fora: sem eval no pdf.js (CVE-2024-4367).
if(/pdfjsLib\.getDocument\(\{ data: buf, isEvalSupported: false \}\)/.test(ix) && !/getDocument\(\{data: buf\}\)/.test(ix)){
  ok('pdf.js abre o PDF com isEvalSupported: false');
} else {
  erro('pdfjsLib.getDocument sem isEvalSupported: false');
}

// ============================================================
// Auditoria de 11/11/2026 (index.html, parte 1): travas de origem
// ============================================================
const corpo = (nome) => extrair(nome).replace(/\s+/g, ' ');

// Erro de LEITURA da ficha nao e' "produto novo": a leitura fica fora do
// try, e produto que a lista conhece sem ficha lida aborta a gravacao.
{
  const g = corpo('gravarPrecoVenda');
  if(!/try\{ const res = await storageGet/.test(g) && /const res = await storageGet\(key\);/.test(g) &&
     /if\(salvo && !\(res && res\.value\)\)\{ throw new Error\(/.test(g)){
    ok('gravarPrecoVenda: falha de leitura sobe; produto existente sem ficha lida nao e recriado por cima');
  } else {
    erro('gravarPrecoVenda voltou a engolir o erro de leitura (a ficha seria sobrescrita com a config do lote)');
  }
}
// Com o Firestore configurado, o teste de conexao que falha NAO rebaixa
// para o armazenamento local.
{
  const t = corpo('testarConexaoFirebase');
  if(/if\(firestoreDb\)\{ storageBackend = 'firebase'; atualizarStatusArmazenamento\(\); \} else \{ rebaixarBackend\(\); \}/.test(t)){
    ok('testarConexaoFirebase: falha com banco configurado mantem o backend firebase');
  } else {
    erro('testarConexaoFirebase voltou a rebaixar para o navegador com o banco configurado');
  }
}
// Desconectar pergunta antes e tem caminho de volta.
if(/\$\('firebaseClearBtn'\)\.addEventListener\('click', async \(\)=>\{ const ok = await App\.confirmar\(/.test(ix) &&
   /\$\('geminiClearBtn'\)\.addEventListener\('click', async \(\)=>\{[^}]*const ok = await App\.confirmar\(/.test(ix) &&
   /localStorage\.removeItem\(FIREBASE_CONFIG_KEY\)/.test(ix) && /localStorage\.removeItem\(RECAPTCHA_KEY\)/.test(ix) &&
   /id="firebasePadraoBtn"/.test(html) && /id="geminiPadraoBtn"/.test(html)){
  ok('Desconectar (Firebase e Gemini) confirma antes, e "usar padrao" apaga a escolha gravada');
} else {
  erro('Desconectar sem confirmacao ou sem o caminho de volta para a configuracao padrao');
}
// O texto nao afirma o que nao foi testado.
if(!/Gemini conectado/.test(html)) ok('a tela nao diz "Gemini conectado" sem ter testado a chave');
else erro('voltou o "✓ Gemini conectado": a Site Key so e testada na primeira chamada');
// Campo ausente na ficha limpa o formulario (nao herda o do produto anterior).
if(!/if\(data\[id\] !== undefined\) \$\(id\)\.value = data\[id\];/.test(ix) &&
   /\$\(id\)\.value = \(data\[id\] !== undefined && data\[id\] !== null\) \? data\[id\] : '';/.test(corpo('preencherForm'))){
  ok('preencherForm limpa o campo que a ficha nao tem');
} else {
  erro('preencherForm voltou a pular campo ausente (ficha antiga herda o codigo do produto anterior)');
}
// Pesquisa em lote: salvar nunca duplica; sair da tela para; resposta
// atrasada do "refazer" nao cai em outro pedido.
if((ix.match(/collection\('concorrentes'\)\.add\(/g) || []).length === 1 &&
   /if\(!it\.docId\) it\.docId = col\.doc\(\)\.id; const ref = col\.doc\(it\.docId\);/.test(ix) && /ref\.set\(dados\)/.test(ix)){
  ok('"Salvar estas pesquisas" regrava o documento do item (docId) — so a busca individual usa add()');
} else {
  erro('"Salvar estas pesquisas" voltou a criar documento novo a cada clique');
}
if(/pararLoteAoSairDaTela\(nome\); \}/.test(ix) &&
   /if\(nome !== 'PesquisaLote' && loteRodando\) loteParar = true;/.test(corpo('pararLoteAoSairDaTela')) &&
   /id="continuarLoteBtn"/.test(html) && /ConcorrentesNucleo\.produtoPesquisado\(/.test(corpo('atualizarBotaoContinuar'))){
  ok('sair da tela do lote para a varredura; "Continuar" pesquisa so o que falta');
} else {
  erro('a varredura em lote voltou a rodar fora da tela, ou perdeu o "Continuar"');
}
if(!/loteItens\[f\.idx\]\.porLoja\[f\.lojaIdx\] = /.test(ix) &&
   /const itemF = loteItens\[f\.idx\]; if\(!itemF\) continue;/.test(ix) &&
   /itemF\.porLoja\[f\.lojaIdx\] = resultado; if\(meuToken !== loteExecToken\) break;/.test(ix)){
  ok('"Refazer as sem resultado" grava no item capturado antes do await e confere o token depois');
} else {
  erro('"Refazer as sem resultado" voltou a gravar por indice em loteItens depois do await');
}
// O menor preco e' o do nucleo, nos tres pontos que tinham copia.
if(!/r\.preco < menorPreco/.test(ix) && !/r\.preco < menor\)/.test(ix) && !/r\.preco < m\)/.test(ix) &&
   (ix.match(/ConcorrentesNucleo\.menorConcorrente\(/g) || []).length >= 6){
  ok('menor preco: lote, comparacoes salvas e pesquisas do pedido usam ConcorrentesNucleo.menorConcorrente');
} else {
  erro('ha copia da regra do menor preco no index.html (o nucleo ignora erro e preco zerado; a copia nao)');
}
// Painel por fabricante hidrata pelo preco do catalogo gravado no documento.
if(/precoCatalogoCent: \(loteOrigemPlanilha && it\.codigo && precoCatalogo\[it\.codigo\] != null\) \? precoCatalogo\[it\.codigo\] : null/.test(ix) &&
   /const refCent = ConcorrentesNucleo\.precoReferenciaCent\(d, daPlanilha\);/.test(ix)){
  ok('a pesquisa de planilha grava precoCatalogoCent e o painel se reidrata por ele');
} else {
  erro('o painel por fabricante voltou a hidratar pelo "Nosso preco" editavel (gera "preco mudou" falso)');
}
// Aba Concorrentes: a lista salva e a consulta por fabricante nao sao
// relidas a cada entrada / clique.
if(/if\(!forcar && concorrentesDocsCache && concorrentesDocsDb === firestoreDb\)\{ renderHistoricoConcorrentes\(\); return; \}/.test(ix) &&
   /let docsFab = pesquisasPorFabricante\.get\(fabricanteAberto\); if\(!docsFab\)\{/.test(ix)){
  ok('comparacoes salvas e "ultima pesquisa" do fabricante reaproveitam o que ja foi lido na sessao');
} else {
  erro('a aba Concorrentes voltou a reler o Firestore a cada entrada/clique');
}
// Previsao de entrega: digitar o ano nao grava 0002-...
{
  const previsaoPlausivel = new Function(extrair('previsaoPlausivel') + '\nreturn previsaoPlausivel;')();
  const casos = [['2026-11-20', true], ['2020-01-01', true], ['0002-11-20', false], ['0202-11-20', false],
                 ['2019-12-31', false], ['20266-01-01', false], ['', false], [null, false], ['20/11/2026', false]];
  const errados = casos.filter(c => previsaoPlausivel(c[0]) !== c[1]);
  if(!errados.length) ok('previsaoPlausivel: so data aaaa-mm-dd com ano de 2020 a 2099 (0002/0202 sao digitacao em andamento)');
  else erro('previsaoPlausivel errou em: ' + errados.map(c => JSON.stringify(c[0])).join(', '));
  if(/if\(valor !== null && !previsaoPlausivel\(valor\)\) return; const antes = notasInfoPorChave\[chave\] \|\| \{\}; inp\.disabled = true;/.test(ix)){
    ok('a previsao de entrega so e gravada (e o campo travado) com data plausivel ou campo limpo');
  } else {
    erro('a previsao de entrega voltou a ser gravada no primeiro change (digitar o ano grava 0002-...)');
  }
}

// ============================================================
// Recebimento derivado do vinculo cotacao <-> NF-e
// ============================================================
// O selo NUNCA e' gravado: deriva das notas vinculadas na hora de
// exibir. Regras travadas: sem vinculo -> null (ausencia de vinculo
// nao e' "nao recebida"); "recebida" exige TODAS com noSistema true;
// nota vinculada sem documento carregado conta como nao recebida —
// o selo nao sai por falta de dado.

const statusRecebimentoCotacao = new Function(
  extrair('statusRecebimentoCotacao') + '\nreturn statusRecebimentoCotacao;')();

const eqRec = (t, a, b) => {
  const va = JSON.stringify(a), vb = JSON.stringify(b);
  va === vb ? ok(t) : erro(t + ' — esperava ' + vb + ', veio ' + va);
};

const estado = {
  'chave-ok-1': { noSistema: true },
  'chave-ok-2': { noSistema: true },
  'chave-pendente': { noSistema: false },
  'chave-sem-flag': {}
};

eqRec('sem vinculo -> null (sem selo, nao "nao recebida")',
  statusRecebimentoCotacao([], estado), null);
eqRec('vinculo ausente (undefined) tambem -> null',
  statusRecebimentoCotacao(undefined, estado), null);
eqRec('todas as vinculadas no ERP -> recebida completa',
  statusRecebimentoCotacao(['chave-ok-1', 'chave-ok-2'], estado),
  { total: 2, recebidas: 2, completa: true });
eqRec('parte no ERP -> parcial, nunca completa',
  statusRecebimentoCotacao(['chave-ok-1', 'chave-pendente'], estado),
  { total: 2, recebidas: 1, completa: false });
eqRec('noSistema ausente no doc conta como NAO recebida',
  statusRecebimentoCotacao(['chave-sem-flag'], estado),
  { total: 1, recebidas: 0, completa: false });
eqRec('nota vinculada sem documento carregado nao vira "recebida"',
  statusRecebimentoCotacao(['chave-que-nao-veio'], estado),
  { total: 1, recebidas: 0, completa: false });

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
