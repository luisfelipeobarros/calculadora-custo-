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
  'return { computeCalc, computeCoeficientes, precoParaMargem };';
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
process.exitCode = falhas ? 1 : 0;
