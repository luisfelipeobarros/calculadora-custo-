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
// 2) Barra de conta e escutas: nada se multiplica
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
