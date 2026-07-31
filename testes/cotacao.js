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

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
