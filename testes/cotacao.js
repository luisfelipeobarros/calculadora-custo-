/*
  Regras da tela de cotacao que nao passam pelo nucleo de calculo, mas
  decidem QUAIS numeros chegam nele:

  1. normalizarCfg — campo escondido nao entra na conta.
  2. aplicarCfgIndividual + configIndividual — o vaivem entre o modo em
     lote e o individual nao pode inventar nem perder configuracao.

  Roda sem DOM de verdade: estas funcoes so' tocam .value e .style de
  elementos buscados por id, entao um stub de meia duzia de linhas basta.
*/
const fs = require('fs');
const html = fs.readFileSync(process.argv[2] || 'index.html', 'utf8');

function extrair(nome){
  const i = html.indexOf('function ' + nome + '(');
  if(i === -1) throw new Error('nao achei ' + nome);
  let d = 0, j = html.indexOf('{', i);
  for(; j < html.length; j++){
    if(html[j] === '{') d++;
    else if(html[j] === '}'){ d--; if(d === 0) break; }
  }
  return html.slice(i, j + 1);
}

// --- DOM de mentira: so' campos com .value e .style.display ---
const campos = {};
function $(id){
  if(!campos[id]) campos[id] = { value: '', textContent: '', style: {} };
  return campos[id];
}

const CFG_PADRAO_SRC = html.slice(html.indexOf('const CFG_INDIVIDUAL_PADRAO'),
                                  html.indexOf('function aplicarCfgIndividual'));

const mod = new Function('$', 'toNum',
  CFG_PADRAO_SRC + '\n' +
  extrair('normalizarCfg') + '\n' +
  extrair('aplicarCfgIndividual') + '\n' +
  extrair('sincronizarSubcamposIndividual') + '\n' +
  extrair('configIndividual') + '\n' +
  'return { normalizarCfg, aplicarCfgIndividual, configIndividual, CFG_INDIVIDUAL_PADRAO };'
)($, v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; });

let problemas = 0;
const ok = (m) => console.log('  [ok] ' + m);
const erro = (m) => { console.log('  [X] ' + m); problemas++; };

// ============================================================
// 1) normalizarCfg: o campo escondido nao entra na conta
// ============================================================

// Quem digitou 12% de credito sobre o frete e depois voltou para "Nao"
// continuava com o credito na conta: o preco sugerido saia R$ 216,90 em
// vez de R$ 225,90, e a margem exibida discordava da calculadora depois
// que o produto era salvo.
let c = mod.normalizarCfg({ pctCredFrete:'12', credIcmsFrete:0, comST:1, icmsCredito:'7', valorST:'20' });
if(c.pctCredFrete === '0') ok('credito de frete zerado quando "credita ICMS sobre o frete" e Nao');
else erro('credito de frete FANTASMA: pctCredFrete = ' + c.pctCredFrete);

c = mod.normalizarCfg({ pctCredFrete:'12', credIcmsFrete:1, comST:1, icmsCredito:'7', valorST:'20' });
if(c.pctCredFrete === '12') ok('credito de frete preservado quando o toggle esta em Sim');
else erro('credito de frete sumiu com o toggle em Sim: ' + c.pctCredFrete);

// Com ST, o ICMS de credito nao existe; sem ST, o valor de ST nao existe.
c = mod.normalizarCfg({ pctCredFrete:'0', credIcmsFrete:0, comST:1, icmsCredito:'7', valorST:'20' });
if(c.icmsCredito === '0' && c.valorST === '20') ok('com ST: zera o ICMS de credito, mantem o valor de ST');
else erro('com ST deu icmsCredito=' + c.icmsCredito + ' valorST=' + c.valorST);

c = mod.normalizarCfg({ pctCredFrete:'0', credIcmsFrete:0, comST:0, icmsCredito:'7', valorST:'20' });
if(c.valorST === '0' && c.icmsCredito === '7') ok('sem ST: zera o valor de ST, mantem o ICMS de credito');
else erro('sem ST deu valorST=' + c.valorST + ' icmsCredito=' + c.icmsCredito);

// ============================================================
// 2) Vaivem entre o modo em lote e o individual
// ============================================================

// Uma cfg vinda do lote reposta no form individual tem que voltar igual.
// Antes o form era zerado ao escolher o produto, e a margem daquele item
// mudava sozinha — junto com o preco de venda, que era apagado.
const doLote = {
  frete:'25', pctCredFrete:'12', valorST:'0', icmsCredito:'7', ipi:'0.65',
  custoFinanceiroPct:'2', avariasPct:'1.5', bonificacao:'3',
  tipoBonificacao:1, comST:0, credIcmsFrete:1
};
mod.aplicarCfgIndividual(doLote);
const voltou = mod.configIndividual();
const diferentes = Object.keys(doLote).filter(k => String(doLote[k]) !== String(voltou[k]));
if(diferentes.length === 0) ok('cfg do lote sobrevive ao ir e voltar do modo individual');
else erro('cfg mudou no vaivem, campos: ' + diferentes.map(k =>
      k + ' (' + doLote[k] + ' -> ' + voltou[k] + ')').join(', '));

// Sem cfg guardada (produto ainda sem preco de venda), cai no padrao —
// e o padrao tem que ser o mesmo que a tela sempre mostrou.
mod.aplicarCfgIndividual(null);
const padrao = mod.configIndividual();
if(padrao.ipi === '0.65' && padrao.avariasPct === '1.5' && padrao.comST === 1 &&
   padrao.credIcmsFrete === 0 && padrao.tipoBonificacao === 0){
  ok('sem cfg guardada, o form individual abre nos valores padrao');
} else {
  erro('padrao do form individual mudou: ' + JSON.stringify(padrao));
}

// Repor uma cfg incoerente (crédito preenchido com o toggle em Nao) nao
// pode ressuscitar o credito fantasma pela porta dos fundos.
mod.aplicarCfgIndividual({
  frete:'25', pctCredFrete:'12', valorST:'20', icmsCredito:'7', ipi:'0.65',
  custoFinanceiroPct:'0', avariasPct:'1.5', bonificacao:'0',
  tipoBonificacao:0, comST:1, credIcmsFrete:0
});
const saneada = mod.configIndividual();
if(saneada.pctCredFrete === '0' && saneada.icmsCredito === '0'){
  ok('cfg incoerente gravada no passado e saneada ao ser reposta');
} else {
  erro('cfg incoerente passou: pctCredFrete=' + saneada.pctCredFrete +
       ' icmsCredito=' + saneada.icmsCredito);
}

// Os sub-campos escondidos/mostrados acompanham os selects.
mod.aplicarCfgIndividual({ credIcmsFrete:1, comST:0, tipoBonificacao:1 });
if($('indPctCredFreteSub').style.display === 'block' &&
   $('indStSub').style.display === 'none' &&
   $('indIcmsCreditoSub').style.display === 'block' &&
   $('indBonificacaoPrefix').textContent === '%'){
  ok('sub-campos e prefixo acompanham a cfg reposta');
} else {
  erro('sub-campos fora de sincronia com a cfg reposta');
}

// ============================================================
// 3) Escolher um produto no modo individual nao pode apagar nada
// ============================================================

// Este era o bug: ao escolher o produto, o handler limpava indVenda e
// logo chamava atualizarMargemIndividual(), que grava
// "precoVenda = venda > 0 ? venda : null" — ou seja, apagava o preco
// digitado no modo em lote. E como a tabela do lote nao era redesenhada,
// a tela seguia mostrando o valor enquanto "Salvar cotacao" gravava nulo.
//
// Nao da' para exercitar o handler sem um DOM de verdade, entao o que se
// trava aqui e' a forma dele: o form tem que ser REPOSTO a partir do
// item, nunca zerado.
const compacto = html.replace(/\s+/g, ' ');

if(/aplicarCfgIndividual\(r\.precoVendaCfg\)/.test(compacto)){
  ok('o form individual e reposto com a cfg do proprio item');
} else {
  erro('o form individual nao repoe a cfg do item (aplicarCfgIndividual(r.precoVendaCfg))');
}

if(/\$\('indVenda'\)\.value = r\.precoVenda != null \? r\.precoVenda : ''/.test(compacto)){
  ok('o campo Venda e reposto com o preco ja definido no item');
} else {
  erro('o campo Venda nao e reposto — o preco do modo em lote sera apagado');
}

// A cfg tem que viajar junto do preco nos DOIS modos, senao o historico
// recebe preco sem configuracao e cai no custo puro.
const gravaCfg = (compacto.match(/r\.precoVendaCfg = venda > 0 \? Object\.assign\(\{\}, cfg\) : null/g) || []).length;
if(gravaCfg >= 2){
  ok('lote e individual gravam a cfg junto do preco de venda (' + gravaCfg + ' pontos)');
} else {
  erro('so ' + gravaCfg + ' modo(s) gravam precoVendaCfg — esperado 2 (lote e individual)');
}

// As linhas do card sao chaveadas por indice, nao por nome: numa cotacao
// com dois itens de mesmo nome, a chave por nome fazia as duas linhas
// apontarem para a mesma celula e para o mesmo objeto.
if(/data-produto=/.test(compacto)){
  erro('ainda ha celula do card de produtos chaveada por nome (data-produto)');
} else {
  ok('as linhas do card de produtos sao chaveadas por indice');
}

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
