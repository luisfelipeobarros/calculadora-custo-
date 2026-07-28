// Compara a formula ORIGINAL (copiada literalmente do arquivo antes da
// mudanca, e mantida aqui de proposito) com a que roda hoje, sobre
// entradas aleatorias.
//
// A formula de hoje vem de require('calculo-nucleo.js') — o MESMO
// arquivo que o index.html carrega. Antes este teste recortava o texto
// das funcoes de dentro do HTML com indexOf e remontava tudo com
// new Function(): media uma copia remontada, nao o codigo que roda na
// tela, e passava a medir outra coisa (ou parava de achar o que
// procurava) se alguem renomeasse uma funcao ou movesse um trecho.

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

// ---------- O QUE RODA HOJE ----------
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const App = require(path.join(raiz, 'app-shared.js'));
const novo = require(path.join(raiz, 'calculo-nucleo.js'));
const html = fs.readFileSync(path.join(raiz, process.argv[2] || 'index.html'), 'utf8');

// ---------- A tela usa mesmo este arquivo? ----------
// O teste chamar o nucleo nao serve de nada se o HTML tiver voltado a
// ter a propria copia da formula, ou se parar de carregar o arquivo.
let ligacao = 0;
const exigir = (cond, msg) => { if(!cond){ console.log('  [X] ' + msg); ligacao++; } };

exigir(/<script src="calculo-nucleo\.js\?v=\d+"><\/script>/.test(html),
  'index.html nao carrega calculo-nucleo.js (com ?v= para quebra de cache)');

['computeCalc', 'computeCoeficientes', 'precoParaMargem', 'arredondarNovanta', 'precoSugerido']
  .forEach(nome => {
    exigir(!new RegExp('function\\s+' + nome + '\\s*\\(').test(html),
      'index.html voltou a definir function ' + nome + '() — a tela usaria a copia, e este teste mediria o nucleo');
  });

// As aliquotas e as metas nao podem reaparecer escritas na mao no HTML.
exigir(!/pisCofins\s*:/.test(html), 'aliquotas de tributo voltaram para o index.html');

// Percentual de margem escrito no markup: so' o texto que o usuario le',
// sem os <!-- comentarios --> (que citam "margem de 8%" de exemplo).
const markup = html.slice(0, html.indexOf('<script') === -1 ? undefined : html.indexOf('<script'))
  .replace(/<!--[\s\S]*?-->/g, '');
exigir(!/margem de \d+%/.test(markup),
  'percentual de margem escrito na mao no markup (deve sair de METAS)');

// Cada meta precisa de um <span> de valor e um de dica no markup.
const idsHtml = new Set([...html.matchAll(/\sid=["']([^"']+)["']/g)].map(m => m[1]));
novo.METAS.forEach(meta => {
  exigir(idsHtml.has(meta.id), 'META aponta para id inexistente: ' + meta.id);
  exigir(idsHtml.has(meta.idDica), 'META aponta para id de dica inexistente: ' + meta.idDica);
});

console.log(ligacao === 0 ? 'index.html usa o nucleo (nenhuma copia da formula no HTML)'
                          : '>>> ' + ligacao + ' PROBLEMA(S) na ligacao HTML <-> nucleo');

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

  // As metas de hoje, mais as tres originais — trocar uma meta nao pode
  // fazer o teste deixar de cobrir a faixa que sempre cobriu.
  [...new Set([...novo.METAS.map(m => m.alvo), 0.04, 0.08, 0.13])].forEach(alvo => {
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
  novo.METAS.forEach(({ alvo }) => {
    const p = novo.precoParaMargem(v, alvo);
    if(p === null) return;
    const r = novo.computeCalc(Object.assign({}, v, { venda: p }));
    if(isFinite(r.margem)) piorAlvo = Math.max(piorAlvo, Math.abs(r.margem - alvo));
  });
}
console.log('preco sugerido atinge a margem pedida, pior erro:', piorAlvo.toExponential(3));

// ---------- precoSugerido: a coluna "Sugerido" da cotacao ----------
// Precisa dar exatamente o mesmo numero que a calculadora mostra na
// meta sugerida. Se divergir, o comprador ve um preco na cotacao e
// outro na calculadora para o mesmo produto — e nao sabe em qual
// acreditar.
let divSug = 0, comparados = 0, semSugestao = 0;

// O rotulo da tela e a conta tem que sair da MESMA constante, senao a
// coluna diz um percentual e o numero e' de outro.
if (novo.ROTULO_MARGEM_SUGERIDA !== App.pct(novo.MARGEM_SUGERIDA, 0)) {
  divSug++;
  console.log('ROTULO nao acompanha a MARGEM_SUGERIDA:', novo.ROTULO_MARGEM_SUGERIDA);
}
// A margem sugerida e' uma das metas da calculadora, nao um numero solto.
const alvosMetas = novo.METAS.map(m => m.alvo);
if (!alvosMetas.includes(novo.MARGEM_SUGERIDA)) {
  divSug++;
  console.log('MARGEM_SUGERIDA nao e uma das METAS:', novo.MARGEM_SUGERIDA, alvosMetas);
}
// A referencia da cotacao e' a meta mais alta (o "Ideal"): partir dela
// deixa espaco para negociar para baixo.
if (novo.MARGEM_SUGERIDA !== Math.max(...alvosMetas)) {
  divSug++;
  console.log('MARGEM_SUGERIDA nao e a meta mais alta:', novo.MARGEM_SUGERIDA, alvosMetas);
}

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

  const obtido = novo.precoSugerido(custo, cfg);
  const esperado = novo.arredondarNovanta(novo.precoParaMargem({
    custoNFe: custo, frete: Number(cfg.frete), pctCredFrete: 0,
    valorST: Number(cfg.valorST), icmsCredito: Number(cfg.icmsCredito),
    ipi: Number(cfg.ipi), custoFinanceiroPct: Number(cfg.custoFinanceiroPct),
    avariasPct: Number(cfg.avariasPct), bonificacao: Number(cfg.bonificacao),
    tipoBonificacao: cfg.tipoBonificacao, venda: 0, comST: cfg.comST, prejuizoContabil: 0
  }, novo.MARGEM_SUGERIDA));

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
if (novo.precoSugerido(0, cfgZero) !== null) { divSug++; console.log('custo zero deveria nao sugerir nada'); }
if (novo.precoSugerido(null, cfgZero) !== null) { divSug++; console.log('custo nulo deveria nao sugerir nada'); }

console.log('precoSugerido: ' + comparados + ' comparados, ' + semSugestao + ' sem sugestao possivel');
console.log('metas de margem: ' + novo.METAS.map(m => m.rotulo).join(', ')
            + ' | referencia da cotacao: ' + novo.ROTULO_MARGEM_SUGERIDA);
console.log(divSug === 0 ? '>>> precoSugerido bate com a calculadora'
                         : '>>> ' + divSug + ' DIVERGENCIA(S) no precoSugerido');

process.exitCode = (falhas || divSug || ligacao) ? 1 : 0;
