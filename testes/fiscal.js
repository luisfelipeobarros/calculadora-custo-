/*
  Banco fiscal por NCM + UF (aba "NCM & ST" da Calculadora).

  O que estes testes travam:

  - o agrupamento e' por NCM + UF DE ORIGEM (da chave de acesso):
    mesmo NCM de estados diferentes sao regras diferentes;
  - o % de ST observado = soma da ST / soma dos produtos, somados em
    centavos inteiros — e null quando nao ha' base (nunca zero
    inventado);
  - a classificacao por CFOP conta com/sem ST e "retida
    anteriormente" separadas (5405/6404 nao viram "com ST");
  - a divergencia cadastro x observado e' so' CATEGORICA — percentual
    nao ganha veredito automatico (tolerancia seria invencao); sem
    cadastro nao ha' divergencia.
*/
const App = require('../app-shared.js');
const F = require('../fiscal-nucleo.js');

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => {
  const va = JSON.stringify(a), vb = JSON.stringify(b);
  va === vb ? ok(t) : erro(t + ' — esperava ' + vb + ', veio ' + va);
};

// Chaves com UF nos 2 primeiros digitos (26 = PE, 35 = SP).
const chavePE1 = '26' + '0'.repeat(42);
const chavePE2 = '26' + '1'.repeat(42);
const chaveSP = '35' + '0'.repeat(42);

const docs = [
  { chave: chavePE1, nomeEmitente: 'FORN A', itens: [
    { ncm: '6907.23.00', cfop: '6401', vTotal: 1000, icmsStValor: 110, descricao: 'PISO X' },
    { ncm: '69072300', cfop: '6401', vTotal: 500, icmsStValor: 58, descricao: 'PISO Y' }
  ]},
  { chave: chavePE2, nomeEmitente: 'FORN B', itens: [
    { ncm: '69072300', cfop: '6404', vTotal: 300, icmsStValor: 0, descricao: 'PISO X' }
  ]},
  { chave: chaveSP, nomeEmitente: 'FORN C', itens: [
    { ncm: '69072300', cfop: '6102', vTotal: 200, icmsStValor: 0, descricao: 'PISO Z' }
  ]}
];

const grupos = F.agruparFiscal(docs);

// ── Agrupamento por NCM + UF ─────────────────────────────────

eq('mesmo NCM em UFs diferentes vira grupos separados',
  grupos.map(g => g.id).sort(), ['69072300_PE', '69072300_SP']);

const pe = grupos.find(g => g.id === '69072300_PE');
const sp = grupos.find(g => g.id === '69072300_SP');

eq('o NCM com pontos normaliza para so digitos', pe.ncm, '69072300');
eq('PE juntou as 2 notas e os 3 itens', [pe.qtdNotas, pe.qtdItens], [2, 3]);
eq('fornecedores distintos listados', pe.fornecedores, ['FORN A', 'FORN B']);
eq('produtos distintos, sem repetir o PISO X', pe.produtos, ['PISO X', 'PISO Y']);
eq('grupos ordenados por valor comprado (PE > SP)', grupos[0].id, '69072300_PE');

// ── % de ST observado (centavos inteiros) ────────────────────

eq('soma dos produtos em centavos', pe.somaValorCent, 180000);
eq('soma da ST em centavos', pe.somaStCent, 16800);
eq('% observado = ST / produtos', Math.round(pe.pctStObservado * 100) / 100, 9.33);
eq('grupo sem ST: percentual zero de verdade (ha base de valor)', sp.pctStObservado, 0);
{
  const vazio = F.agruparFiscal([{ chave: chavePE1, itens: [{ ncm: '1', cfop: '6101', vTotal: 0, icmsStValor: 0 }] }]);
  eq('sem base de valor: percentual null, nunca zero inventado', vazio[0].pctStObservado, null);
}

// ── Classificacao por CFOP ───────────────────────────────────

eq('6401 conta como venda com ST (2 itens)', pe.observado.comSt, 2);
eq('6404 conta como RETIDA anteriormente, nao como "com ST"', pe.observado.retida, 1);
eq('6102 conta como sem ST', sp.observado.semSt, 1);

// UF desconhecida (chave fora do padrao) agrupa em '??'.
{
  const g = F.agruparFiscal([{ chave: 'abc', itens: [{ ncm: '11112222', cfop: '6101', vTotal: 10, icmsStValor: 0 }] }]);
  eq('chave fora do padrao agrupa em UF "??"', g[0].id, '11112222_??');
}

// ── Divergencia cadastro x observado (so categorica) ────────

eq('sem cadastro -> null (ausencia nao e divergencia)',
  F.divergenciaFiscal(pe, null), null);
eq('cadastro sem modalidade -> null',
  F.divergenciaFiscal(pe, { percentual: 11 }), null);
eq('cadastrado SEM ST com notas cobrando ST -> aviso',
  F.divergenciaFiscal(pe, { modalidade: 'sem' }) !== null, true);
eq('cadastrado "na nota" onde ha ST cobrada -> sem aviso',
  F.divergenciaFiscal(pe, { modalidade: 'nota', percentual: 11 }), null);
eq('cadastrado "antecipacao" com notas cobrando ST na nota -> aviso',
  F.divergenciaFiscal(pe, { modalidade: 'antecipacao' }) !== null, true);
eq('cadastrado "antecipacao" onde so ha retida -> sem aviso',
  F.divergenciaFiscal({ observado: { comSt: 0, semSt: 0, retida: 3, outros: 0 }, somaStCent: 0 },
    { modalidade: 'antecipacao' }), null);
eq('cadastrado "na nota" onde nada de ST apareceu -> aviso',
  F.divergenciaFiscal({ observado: { comSt: 0, semSt: 4, retida: 0, outros: 0 }, somaStCent: 0 },
    { modalidade: 'nota' }) !== null, true);
// Percentual divergente NAO gera veredito automatico: tolerancia
// numerica seria invencao — os numeros ficam lado a lado na tela.
eq('percentual diferente do observado NAO e divergencia automatica',
  F.divergenciaFiscal(pe, { modalidade: 'nota', percentual: 99 }), null);

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
