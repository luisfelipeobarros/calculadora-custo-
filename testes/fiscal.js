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

// ── Nota cancelada fica fora do observado ────────────────────
// Os itensNotas nao tem status: quem sabe do cancelamento e' a colecao
// "notas". Com o estado em maos, a cancelada nao soma valor nem ST.
{
  const comEstado = F.agruparFiscal(docs, { [chavePE2]: { status: 'cancelada' }, [chavePE1]: { status: 'ativa' } });
  const peAtiva = comEstado.find(g => g.id === '69072300_PE');
  eq('nota cancelada nao entra: PE fica com 1 nota, 2 itens, sem a "retida" dela',
    [peAtiva.qtdNotas, peAtiva.qtdItens, peAtiva.somaValorCent, peAtiva.observado.retida, peAtiva.fornecedores], [1, 2, 150000, 0, ['FORN A']]);
  eq('nota sem estado carregado (ou sem o mapa) continua contando', [F.agruparFiscal(docs, {}).find(g => g.id === '69072300_PE').qtdNotas, pe.qtdNotas], [2, 2]);
  eq('grupo que so tinha nota cancelada some', F.agruparFiscal(docs, { [chaveSP]: { status: 'cancelada' } }).map(g => g.id), ['69072300_PE']);
}

// ── O "% ST" digitado ────────────────────────────────────────
eq('percentual: vazio e valido (sem %), numero com virgula/ponto/% vira valor, texto e invalido (nao apaga o salvo)',
  ['', '18', '18,5', '18.5 %', '0', 'abc', '18a', '-5', '1.234,5'].map(t => F.percentualDigitado(t)),
  [{ vazio: true }, { valor: 18 }, { valor: 18.5 }, { valor: 18.5 }, { valor: 0 },
   { invalido: true }, { invalido: true }, { invalido: true }, { invalido: true }]);

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

// ── Quem pode receber cadastro (espelha o regex do firestore.rules) ──
// Item sem NCM ou chave fora do padrao gera grupo cujo id as regras
// rejeitam ([0-9]{2,8}_[A-Z]{2}): a tela nao pode oferecer o
// formulario, senao o salvamento morre em permission-denied.

eq('grupo normal pode ser cadastrado', F.grupoCadastravel(pe), true);
{
  const semNcm = F.agruparFiscal([{ chave: chavePE1, itens: [{ ncm: '', cfop: '6101', vTotal: 10, icmsStValor: 0 }] }])[0];
  eq('item sem NCM vira grupo "sem-ncm_UF"', semNcm.id, 'sem-ncm_PE');
  eq('  ...que NAO pode ser cadastrado', F.grupoCadastravel(semNcm), false);
  const semUf = F.agruparFiscal([{ chave: 'abc', itens: [{ ncm: '11112222', cfop: '6101', vTotal: 10, icmsStValor: 0 }] }])[0];
  eq('UF desconhecida tambem nao pode', F.grupoCadastravel(semUf), false);
  eq('NCM de 9 digitos (fora do padrao) tambem nao',
    F.grupoCadastravel({ id: '123456789_PE' }), false);
}

// Auditoria externa de 11/11/2026: devolucao nao e' compra.
{
  const ch = '26' + '1'.repeat(42);
  const d = [{ chave: ch, itens: [{ ncm: '69072300', cfop: '6101', vTotal: 100, icmsStValor: 0 }] }];
  eq('nota de devolucao fica fora do observado (como a cancelada); nota comum entra',
    [F.agruparFiscal(d, { [ch]: { devolucao: true } }).length, F.agruparFiscal(d, { [ch]: { devolucao: false } }).length, F.agruparFiscal(d, {}).length], [0, 1, 1]);
}

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
