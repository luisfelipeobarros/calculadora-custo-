// Compara a formula ORIGINAL (copiada literalmente do arquivo antes da
// mudanca) com a NOVA (extraida do arquivo atual), sobre entradas aleatorias.

// ---------- ORIGINAL ----------
function computeCalcAntigo(v){
  const custoNFe = v.custoNFe;
  const frete = v.frete;
  const pctCredFrete = v.pctCredFrete/100;
  const valorST = v.valorST/100;
  const icmsCredito = v.icmsCredito/100;
  const ipi = v.ipi/100;
  const custoFinanceiroPct = v.custoFinanceiroPct/100;
  const avariasPct = v.avariasPct/100;
  const bonificacaoRS = v.tipoBonificacao === 1 ? (custoNFe * (v.bonificacao||0)/100) : (v.bonificacao || 0);
  const venda = v.venda;
  const comST = !!v.comST;
  const prejuizoContabil = !!v.prejuizoContabil;

  const avariasRS = venda * avariasPct;
  const parteST = comST ? (custoNFe * valorST) : (venda*0.205 - custoNFe*icmsCredito);
  const creditoFrete = pctCredFrete !== 0 ? (pctCredFrete * frete) : 0;
  const custo = parteST + custoNFe + frete + (ipi*custoNFe) + (venda*0.0925) - ((custoNFe+frete)*0.0925) - creditoFrete - bonificacaoRS;

  const base = venda - custo - (venda*custoFinanceiroPct) - avariasRS;
  const semTributo = (base < 0) || prejuizoContabil;
  const irpj = semTributo ? 0 : base*0.25;
  const csll = semTributo ? 0 : base*0.09;

  const lucro = venda*(1-custoFinanceiroPct) - custo - irpj - csll - avariasRS;
  const margem = venda !== 0 ? (lucro/venda) : NaN;
  const custoFinanceiroRS = venda * custoFinanceiroPct;
  const total = custo + custoFinanceiroRS + irpj + csll + avariasRS;
  return {custo, irpj, csll, avariasRS, custoFinanceiroRS, total, lucro, margem};
}
function computeCoeficientesAntigo(v){
  const custoNFe = v.custoNFe, frete = v.frete;
  const pctCredFrete = v.pctCredFrete/100, valorST = v.valorST/100;
  const icmsCredito = v.icmsCredito/100, ipi = v.ipi/100;
  const custoFinanceiroPct = v.custoFinanceiroPct/100, avariasPct = v.avariasPct/100;
  const bonificacaoRS = v.tipoBonificacao === 1 ? (custoNFe * (v.bonificacao||0)/100) : (v.bonificacao || 0);
  const comST = !!v.comST;
  const creditoFrete = pctCredFrete !== 0 ? (pctCredFrete * frete) : 0;
  let k, C0;
  if(comST){
    k = 0.0925;
    C0 = custoNFe*valorST + custoNFe + frete + (ipi*custoNFe) - ((custoNFe+frete)*0.0925) - creditoFrete - bonificacaoRS;
  } else {
    k = 0.205 + 0.0925;
    C0 = -(custoNFe*icmsCredito) + custoNFe + frete + (ipi*custoNFe) - ((custoNFe+frete)*0.0925) - creditoFrete - bonificacaoRS;
  }
  return { C0, m: 1 - k - custoFinanceiroPct - avariasPct };
}
function precoParaMargemAntigo(v, t){
  const { C0, m } = computeCoeficientesAntigo(v);
  const denom = 0.66*m - t;
  if(denom <= 0) return null;
  const p = (0.66*C0) / denom;
  return (!isFinite(p) || p <= 0) ? null : p;
}

// ---------- NOVO: extraido do arquivo atual ----------
const fs = require('fs');
const html = fs.readFileSync(process.argv[2] || 'index.html', 'utf8');
function extrair(nome){
  const i = html.indexOf('function ' + nome + '(');
  if(i === -1) throw new Error('nao achei ' + nome);
  let d = 0, j = html.indexOf('{', i);
  const ini = j;
  for(; j < html.length; j++){
    if(html[j] === '{') d++;
    else if(html[j] === '}'){ d--; if(d === 0) break; }
  }
  return html.slice(i, j + 1);
}
const App = { centavos: v => (v == null || !isFinite(v)) ? v : Math.round((v + Number.EPSILON) * 100) / 100 };
const codigo = html.slice(html.indexOf('const TRIBUTOS'), html.indexOf('TRIBUTOS.fatorLucro') ) +
  'TRIBUTOS.fatorLucro = 1 - TRIBUTOS.irpj - TRIBUTOS.csll;\n' +
  extrair('computeCoeficientes') + '\n' + extrair('computeCalc') + '\n' + extrair('precoParaMargem') + '\n' +
  extrair('arredondarNovanta') + '\n' +
  'return { computeCalc, computeCoeficientes, precoParaMargem, arredondarNovanta, METAS_MARGEM };';
const novo = new Function('App', codigo)(App);

// ---------- Comparacao ----------
function rnd(a, b){ return a + Math.random() * (b - a); }
let piorAbs = 0, piorCampo = '', falhas = 0, piorPreco = 0;
const N = 200000;

for(let i = 0; i < N; i++){
  const v = {
    custoNFe: Math.round(rnd(1, 5000) * 100) / 100,
    frete: Math.round(rnd(0, 800) * 100) / 100,
    pctCredFrete: Math.random() < 0.5 ? 0 : Math.round(rnd(0, 20) * 100) / 100,
    valorST: Math.round(rnd(0, 40) * 100) / 100,
    icmsCredito: Math.round(rnd(0, 25) * 100) / 100,
    ipi: Math.round(rnd(0, 15) * 100) / 100,
    custoFinanceiroPct: Math.random() < 0.4 ? 0 : Math.round(rnd(0, 8) * 100) / 100,
    avariasPct: Math.round(rnd(0, 5) * 100) / 100,
    bonificacao: Math.random() < 0.5 ? 0 : Math.round(rnd(0, 60) * 100) / 100,
    tipoBonificacao: Math.random() < 0.5 ? 0 : 1,
    venda: Math.round(rnd(0, 9000) * 100) / 100,
    comST: Math.random() < 0.5 ? 0 : 1,
    prejuizoContabil: Math.random() < 0.2 ? 1 : 0
  };

  const a = computeCalcAntigo(v);
  const b = novo.computeCalc(v);

  ['custo','irpj','csll','avariasRS','custoFinanceiroRS','total','lucro'].forEach(campo => {
    const d = Math.abs(App.centavos(a[campo]) - b[campo]);
    // 'total' agora e' a soma das parcelas JA' arredondadas, entao pode
    // ficar ate' ~2,5 centavos do total antigo (5 parcelas x meio centavo).
    // Isso e' a correcao, nao um desvio: e' o que faz a coluna fechar.
    const limite = campo === 'total' ? 0.03 : 0.011;
    if(campo !== 'total' && d > piorAbs){ piorAbs = d; piorCampo = campo; }
    if(d > limite){ falhas++; if(falhas < 4) console.log('DIVERGE', campo, a[campo], b[campo], JSON.stringify(v)); }
  });

  const dm = Math.abs((a.margem || 0) - (b.margem || 0));
  if(isFinite(dm) && dm > 1e-9){ falhas++; if(falhas < 4) console.log('MARGEM diverge', a.margem, b.margem); }

  [0.04, 0.08, 0.13].forEach(alvo => {
    const pa = precoParaMargemAntigo(v, alvo);
    const pb = novo.precoParaMargem(v, alvo);
    if((pa === null) !== (pb === null)){ falhas++; console.log('PRECO null diverge', alvo, pa, pb); return; }
    if(pa !== null){
      const d = Math.abs(pa - pb);
      if(d > piorPreco) piorPreco = d;
      if(d > 1e-6){ falhas++; if(falhas < 6) console.log('PRECO diverge', alvo, pa, pb); }
    }
  });
}

console.log('casos testados:', N);
console.log('maior diferenca em dinheiro:', piorAbs.toFixed(10), '(campo ' + piorCampo + ') — limite de 1 centavo');
console.log('maior diferenca no preco sugerido:', piorPreco.toExponential(3));
console.log(falhas === 0 ? '>>> IDENTICAS' : '>>> ' + falhas + ' DIVERGENCIA(S)');

// Coerencia interna: total deve fechar com venda - lucro
let piorFecha = 0;
for(let i = 0; i < 20000; i++){
  const v = { custoNFe: rnd(1,2000), frete: rnd(0,300), pctCredFrete: 0, valorST: rnd(0,30),
    icmsCredito: rnd(0,20), ipi: rnd(0,10), custoFinanceiroPct: rnd(0,6), avariasPct: rnd(0,4),
    bonificacao: 0, tipoBonificacao: 0, venda: rnd(100,4000), comST: 1, prejuizoContabil: 0 };
  const r = novo.computeCalc(v);
  piorFecha = Math.max(piorFecha, Math.abs(r.total - (v.venda - r.lucro)));
}
console.log('identidade total == venda - lucro, pior erro:', piorFecha.toFixed(6));

// A margem-alvo realmente sai o que foi pedido?
let piorAlvo = 0;
for(let i = 0; i < 20000; i++){
  const v = { custoNFe: rnd(1,2000), frete: rnd(0,300), pctCredFrete: 0, valorST: rnd(0,30),
    icmsCredito: rnd(0,20), ipi: rnd(0,10), custoFinanceiroPct: rnd(0,5), avariasPct: rnd(0,3),
    bonificacao: 0, tipoBonificacao: 0, venda: 0, comST: 1, prejuizoContabil: 0 };
  [0.04,0.08,0.13].forEach(alvo => {
    const p = novo.precoParaMargem(v, alvo);
    if(p === null) return;
    const r = novo.computeCalc(Object.assign({}, v, { venda: p }));
    if(isFinite(r.margem)) piorAlvo = Math.max(piorAlvo, Math.abs(r.margem - alvo));
  });
}
console.log('preco sugerido atinge a margem pedida, pior erro:', piorAlvo.toExponential(3));

// ---------- precoSugerido: a coluna "Sugerido" da cotacao ----------
// Precisa dar exatamente o mesmo numero que a calculadora mostra em
// "Aceitavel". Se divergir, o comprador ve um preco na cotacao e outro
// na calculadora para o mesmo produto — e nao sabe em qual acreditar.
const toNumTeste = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const pctTeste = (v, casas) => {
  const c = casas == null ? 2 : casas;
  return (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }) + '%';
};
// O trecho extraido tambem escreve o rotulo na tela; aqui o $ devolve um
// objeto de mentira so' para a atribuicao nao estourar.
const $teste = () => ({ textContent: '' });
const extra = new Function('precoParaMargem', 'arredondarNovanta', 'toNum', 'pct', '$', 'METAS_MARGEM',
  html.slice(html.indexOf('const MARGEM_SUGERIDA'), html.indexOf('function renderListaLote')) +
  '\nreturn { precoSugerido, MARGEM_SUGERIDA, ROTULO_MARGEM_SUGERIDA, valoresParaCalculo, CFG_SO_PRODUTO };'
)(novo.precoParaMargem, novo.arredondarNovanta, toNumTeste, pctTeste, $teste, novo.METAS_MARGEM);

// O rotulo da tela e a conta tem que sair da MESMA constante, senao a
// coluna diz um percentual e o numero e' de outro.
if (extra.ROTULO_MARGEM_SUGERIDA !== pctTeste(extra.MARGEM_SUGERIDA, 0)) {
  console.log('ROTULO nao acompanha a MARGEM_SUGERIDA:', extra.ROTULO_MARGEM_SUGERIDA);
  process.exitCode = 1;
}

// ---------- METAS_MARGEM: uma fonte so' para numero, campo e rotulo ----------
// Os percentuais "4%", "8%" e "13%" ja' estiveram digitados a mao no HTML
// E repetidos como numero em calcular(). Aqui garantimos que existe uma
// definicao unica, e que o preco sugerido da cotacao sai dela.
let divMetas = 0;
const niveisEsperados = ['minimo', 'aceitavel', 'ideal'];
niveisEsperados.forEach(nivel => {
  const m = novo.METAS_MARGEM[nivel];
  if (!m) { divMetas++; console.log('METAS_MARGEM sem o nivel', nivel); return; }
  if (!(m.alvo > 0 && m.alvo < 1)) { divMetas++; console.log('alvo fora de faixa em', nivel, m.alvo); }
  // O id do campo e o do rotulo tem que existir no HTML, senao a tela
  // fica com o percentual em branco e ninguem percebe.
  [m.campo, m.rotulo].forEach(id => {
    if (!new RegExp('id="' + id + '"').test(html)) {
      divMetas++; console.log('METAS_MARGEM aponta para id inexistente:', id);
    }
  });
});
// A ordem dos niveis precisa fazer sentido: minimo < aceitavel < ideal.
if (!(novo.METAS_MARGEM.minimo.alvo < novo.METAS_MARGEM.aceitavel.alvo &&
      novo.METAS_MARGEM.aceitavel.alvo < novo.METAS_MARGEM.ideal.alvo)) {
  divMetas++; console.log('as metas nao estao em ordem crescente');
}
// O preco sugerido da cotacao E' o nivel "Ideal" — nao um numero solto.
if (extra.MARGEM_SUGERIDA !== novo.METAS_MARGEM.ideal.alvo) {
  divMetas++;
  console.log('MARGEM_SUGERIDA desgrudou do nivel Ideal:',
    extra.MARGEM_SUGERIDA, novo.METAS_MARGEM.ideal.alvo);
}
// Nenhum percentual de margem pode continuar digitado a mao no markup.
const estatico = html.slice(0, html.indexOf('<script'));
const rotuloNaMao = estatico.match(/margem de \d/);
if (rotuloNaMao) {
  divMetas++;
  console.log('rotulo de margem digitado a mao no HTML:', rotuloNaMao[0]);
}
console.log(divMetas === 0 ? 'METAS_MARGEM: numero, campo e rotulo vem de um lugar so'
                           : '>>> ' + divMetas + ' PROBLEMA(S) em METAS_MARGEM');

// ---------- valoresParaCalculo: o mapeamento cfg -> nucleo ----------
// Esta funcao e' a unica ponte entre os campos da tela e computeCalc.
// Se ela esquecer um campo, a margem daquela tela discorda das outras
// em silencio — foi o que aconteceu com a coluna do historico.
let divMap = 0;
const cfgCheia = {
  frete:'10', pctCredFrete:'12', valorST:'20', icmsCredito:'7', ipi:'0.65',
  custoFinanceiroPct:'2', avariasPct:'1.5', bonificacao:'3',
  tipoBonificacao:1, comST:0
};
const mapeado = extra.valoresParaCalculo(100, cfgCheia, 250);
const esperadoMap = {
  custoNFe:100, frete:10, pctCredFrete:12, valorST:20, icmsCredito:7, ipi:0.65,
  custoFinanceiroPct:2, avariasPct:1.5, bonificacao:3, tipoBonificacao:1,
  venda:250, comST:0, prejuizoContabil:0
};
Object.keys(esperadoMap).forEach(k => {
  if (mapeado[k] !== esperadoMap[k]) {
    divMap++;
    console.log('valoresParaCalculo perdeu/torceu o campo', k, ':', mapeado[k], '!=', esperadoMap[k]);
  }
});
// computeCoeficientes le exatamente estes campos; sobrar e' inofensivo,
// faltar nao e'.
['custoNFe','frete','pctCredFrete','valorST','icmsCredito','ipi',
 'custoFinanceiroPct','avariasPct','bonificacao','tipoBonificacao',
 'venda','comST','prejuizoContabil'].forEach(k => {
  if (!(k in mapeado)) { divMap++; console.log('valoresParaCalculo nao devolve', k); }
});

// O preco sugerido, avaliado com a MESMA cfg, tem que devolver a meta
// pedida — e' o que garante que a coluna "Sugerido" e a coluna "Margem"
// da cotacao contam a mesma historia.
let piorMetaCotacao = 0;
for (let i = 0; i < 5000; i++) {
  const cfg = {
    frete: String(Math.round(rnd(0, 400) * 100) / 100),
    pctCredFrete: '0',
    valorST: String(Math.round(rnd(0, 30) * 100) / 100),
    icmsCredito: '0',
    ipi: String(Math.round(rnd(0, 10) * 100) / 100),
    custoFinanceiroPct: String(Math.round(rnd(0, 5) * 100) / 100),
    avariasPct: String(Math.round(rnd(0, 4) * 100) / 100),
    bonificacao: '0', tipoBonificacao: 0, comST: 1
  };
  const custo = Math.round(rnd(1, 2000) * 100) / 100;
  const venda = extra.precoSugerido(custo, cfg);
  if (venda == null) continue;
  const margem = novo.computeCalc(extra.valoresParaCalculo(custo, cfg, venda)).margem;
  // O arredondamento para ",90" so' empurra o preco para CIMA, entao a
  // margem realizada fica >= a meta, nunca abaixo dela.
  if (margem < extra.MARGEM_SUGERIDA - 1e-9) {
    divMap++;
    console.log('sugerido ficou ABAIXO da meta:', margem, '<', extra.MARGEM_SUGERIDA, JSON.stringify(cfg));
    break;
  }
  piorMetaCotacao = Math.max(piorMetaCotacao, margem - extra.MARGEM_SUGERIDA);
}
console.log('margem realizada acima da meta (efeito do ",90"), pior caso:',
  (piorMetaCotacao * 100).toFixed(2) + ' p.p.');

// O historico so' consegue repetir esse numero se a cfg for gravada
// junto do item. Sem ela sobra CFG_SO_PRODUTO, que ignora frete/ST/IPI
// e devolve uma margem MAIOR — o mesmo item aparecia com 13% na cotacao
// e 25% no historico. Estes dois testes travam a regressao.
const cfgReal = { frete:'10', pctCredFrete:'0', valorST:'20', icmsCredito:'0', ipi:'0',
                  custoFinanceiroPct:'0', avariasPct:'0', bonificacao:'0',
                  tipoBonificacao:0, comST:1 };
const vendaReal = extra.precoSugerido(100, cfgReal);
const margemReal = novo.computeCalc(extra.valoresParaCalculo(100, cfgReal, vendaReal)).margem;
const margemSoProduto = novo.computeCalc(
  extra.valoresParaCalculo(100, extra.CFG_SO_PRODUTO, vendaReal)).margem;
if (!(margemSoProduto > margemReal + 0.05)) {
  divMap++;
  console.log('CFG_SO_PRODUTO deveria dar margem bem maior que a real:', margemSoProduto, margemReal);
}
// A tela do historico precisa mesmo LER a cfg gravada, e nao so' chamar
// valoresParaCalculo com qualquer coisa. Um grep e' feio, mas e' o que
// pega quem "simplificar" a coluna de volta para o custo puro — a cfg
// so' entra na conta se cfgItem for o argumento.
const compacto = html.replace(/\s+/g, ' ');
if (!/const cfgItem = it\.precoVendaCfg/.test(compacto)) {
  divMap++;
  console.log('o historico nao le it.precoVendaCfg');
}
if (!/valoresParaCalculo\(it\.precoRecebido, cfgItem \|\| CFG_SO_PRODUTO, it\.precoVenda\)/.test(compacto)) {
  divMap++;
  console.log('o historico nao passa a cfg gravada para valoresParaCalculo');
}
// E a cfg precisa continuar sendo GRAVADA junto do item, senao o
// historico recebe sempre null e cai no custo puro para todo mundo.
if (!/precoVendaCfg: r\.precoVendaCfg \|\| null/.test(compacto)) {
  divMap++;
  console.log('salvarCotacao nao esta gravando precoVendaCfg no item');
}
console.log(divMap === 0
  ? 'valoresParaCalculo: mapeamento completo e historico amarrado a cfg gravada'
  : '>>> ' + divMap + ' PROBLEMA(S) em valoresParaCalculo');

let divSug = 0, comparados = 0, semSugestao = 0;
for (let i = 0; i < 20000; i++) {
  const cfg = {
    frete: String(Math.round(rnd(0, 500) * 100) / 100),
    pctCredFrete: '0',
    valorST: String(Math.round(rnd(0, 35) * 100) / 100),
    icmsCredito: String(Math.round(rnd(0, 20) * 100) / 100),
    ipi: String(Math.round(rnd(0, 12) * 100) / 100),
    custoFinanceiroPct: String(Math.round(rnd(0, 6) * 100) / 100),
    avariasPct: String(Math.round(rnd(0, 4) * 100) / 100),
    bonificacao: String(Math.round(rnd(0, 30) * 100) / 100),
    tipoBonificacao: Math.random() < 0.5 ? 0 : 1,
    comST: Math.random() < 0.5 ? 0 : 1
  };
  const custo = Math.round(rnd(1, 3000) * 100) / 100;

  const obtido = extra.precoSugerido(custo, cfg);
  const esperado = novo.arredondarNovanta(novo.precoParaMargem({
    custoNFe: custo, frete: Number(cfg.frete), pctCredFrete: 0,
    valorST: Number(cfg.valorST), icmsCredito: Number(cfg.icmsCredito),
    ipi: Number(cfg.ipi), custoFinanceiroPct: Number(cfg.custoFinanceiroPct),
    avariasPct: Number(cfg.avariasPct), bonificacao: Number(cfg.bonificacao),
    tipoBonificacao: cfg.tipoBonificacao, venda: 0, comST: cfg.comST, prejuizoContabil: 0
  }, extra.MARGEM_SUGERIDA));

  if (esperado == null) {
    semSugestao++;
    if (obtido != null) { divSug++; console.log('SUGERIDO deveria ser nulo:', obtido); }
    continue;
  }
  comparados++;
  if (obtido == null || Math.abs(obtido - esperado) > 1e-9) {
    divSug++;
    if (divSug < 3) console.log('SUGERIDO diverge', obtido, esperado, JSON.stringify(cfg));
  } else if (Math.abs(((obtido * 100) % 100) - 90) > 1e-6) {
    // Todo preco sugerido termina em ,90, igual ao da calculadora.
    divSug++;
    if (divSug < 5) console.log('SUGERIDO nao termina em ,90:', obtido);
  }
}
const cfgZero = { frete:'0', pctCredFrete:'0', valorST:'0', icmsCredito:'0', ipi:'0',
                  custoFinanceiroPct:'0', avariasPct:'0', bonificacao:'0', tipoBonificacao:0, comST:1 };
if (extra.precoSugerido(0, cfgZero) !== null) { divSug++; console.log('custo zero deveria nao sugerir nada'); }
if (extra.precoSugerido(null, cfgZero) !== null) { divSug++; console.log('custo nulo deveria nao sugerir nada'); }
// A margem sugerida e' a mesma do nivel 'Ideal' da calculadora.
if (extra.MARGEM_SUGERIDA !== 0.13) { divSug++; console.log('MARGEM_SUGERIDA nao e 13%:', extra.MARGEM_SUGERIDA); }

console.log('precoSugerido: ' + comparados + ' comparados, ' + semSugestao + ' sem sugestao possivel');
console.log(divSug === 0 ? '>>> precoSugerido bate com a calculadora'
                         : '>>> ' + divSug + ' DIVERGENCIA(S) no precoSugerido');

process.exitCode = (falhas || divSug || divMetas || divMap) ? 1 : 0;
