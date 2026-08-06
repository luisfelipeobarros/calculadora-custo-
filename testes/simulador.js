/*
  Simulador de compra: divisao de parcelas em centavos, geracao de
  compras mensais (com a rampa), projecao dos recorrentes e a
  agregacao mensal em tres origens.

  Os invariantes que estes testes travam:

  - a soma das parcelas BATE com o valor da compra, sempre — inclusive
    quando nao divide redondo e com 1a parcela informada;
  - dinheiro nunca passa por float no meio da conta;
  - o 12o mes da janela recebe a mesma carga de regime que o 6o (a
    rampa: sem gerar compras alem da janela, o fim despencaria com
    falsa sensacao de alivio);
  - a projecao de recorrente NAO conta em dobro o mes cujo documento
    ja' existe, e parcelasTotal encerra a corrente mesmo com
    parcelaAtual ausente;
  - "ja' contratado" inclui as pagas do mes e exclui nota cancelada.
*/
const App = require('../app-shared.js');
const S = require('../simulador-nucleo.js');

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => {
  const va = JSON.stringify(a), vb = JSON.stringify(b);
  va === vb ? ok(t) : erro(t + ' — esperava ' + vb + ', veio ' + va);
};
const soma = (xs) => xs.reduce((s, x) => s + x, 0);

// ── 1. Divisao: a soma SEMPRE bate ───────────────────────────

eq('30.000 em 3 divide redondo', S.dividirParcelas(3000000, 3), [1000000, 1000000, 1000000]);
eq('10.000 em 3: sobra de centavo vai na ULTIMA',
  S.dividirParcelas(1000000, 3), [333333, 333333, 333334]);
eq('  ...e a soma bate com o total', soma(S.dividirParcelas(1000000, 3)), 1000000);
eq('valor quebrado em 7 tambem fecha', soma(S.dividirParcelas(999997, 7)), 999997);

// ── 2. 1a parcela informada ──────────────────────────────────

eq('30.000 com 1a de 12.000 em 3 -> 12.000/9.000/9.000',
  S.dividirParcelas(3000000, 3, 1200000), [1200000, 900000, 900000]);
eq('1a informada com resto que nao divide redondo fecha a soma',
  soma(S.dividirParcelas(1000000, 3, 100001)), 1000000);
eq('1a parcela MAIOR que o total nao divide (null, a linha avisa)',
  S.dividirParcelas(1000000, 3, 1000001), null);
eq('1a parcela igual ao total vale (demais ficam zeradas)',
  S.dividirParcelas(1000000, 3, 1000000), [1000000, 0, 0]);
eq('parcela unica ignora a 1a informada — vale o total',
  S.dividirParcelas(500000, 1, 120000), [500000]);

// ── parsePrazo (o insumo da divisao) ─────────────────────────

eq('parsePrazo aceita lista', S.parsePrazo('70/84/98'), [70, 84, 98]);
eq('parsePrazo aceita parcela unica', S.parsePrazo('28'), [28]);
eq('parsePrazo ordena o que vier fora de ordem', S.parsePrazo('90/30/60'), [30, 60, 90]);
// "A vista" normaliza para [0] — uma parcela, dia zero. Lista VAZIA
// seria divisao por zero no dividirParcelas; normalizar aqui evita o
// caso especial espalhado pelo nucleo inteiro.
eq('parsePrazo("à vista") -> [0]', S.parsePrazo('à vista'), [0]);
eq('parsePrazo("a vista", sem acento) -> [0]', S.parsePrazo('a vista'), [0]);
eq('parsePrazo("") -> [0]', S.parsePrazo(''), [0]);
eq('parsePrazo invalido -> null, nunca zero', S.parsePrazo('70//98'), null);
eq('parsePrazo com letra -> null', S.parsePrazo('abc'), null);

// ── 3. Datas: dia 31, fevereiro, bissexto, virada de ano ─────

{
  // Compra dia 31/08; meses seguintes encolhem e VOLTAM ao 31.
  const parcelas = S.gerarCompras({
    valorCent: 300000, prazoDias: [0], dataPrimeira: '2026-08-31', ateData: '2027-01-31'
  });
  eq('compra dia 31 encolhe em setembro e volta ao 31 em outubro',
    parcelas.map(p => p.compra),
    ['2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']);
  eq('  ...e a virada de ano nao pula mes', parcelas[5].compra, '2027-01-31');
}
{
  const parcelas = S.gerarCompras({
    valorCent: 100, prazoDias: [0], dataPrimeira: '2027-12-31', ateData: '2028-02-29'
  });
  eq('fevereiro bissexto recebe a compra no dia 29',
    parcelas.map(p => p.compra), ['2027-12-31', '2028-01-31', '2028-02-29']);
}
{
  // Parcela vence em compra + N dias, sem arredondar mes: o que cai
  // em 31/12 e' dezembro, nao janeiro.
  const parcelas = S.gerarCompras({
    valorCent: 100, prazoDias: [30], dataPrimeira: '2026-12-01', ateData: '2026-12-01'
  });
  eq('parcela de 31/12 fica em dezembro', parcelas[0].vencimento, '2026-12-31');
}

// ── 4. A vista: parcela unica NA data da compra ──────────────

{
  const parcelas = S.gerarCompras({
    valorCent: 123456, prazoDias: S.parsePrazo('à vista'),
    dataPrimeira: '2026-08-05', ateData: '2026-08-05'
  });
  eq('a vista: uma parcela', parcelas.length, 1);
  eq('  ...na propria data da compra', parcelas[0].vencimento, '2026-08-05');
  eq('  ...com o valor inteiro', parcelas[0].cent, 123456);
}

// ── ST: adicional, cobrada na 1a parcela ou aos 30 dias ──────
// Total da linha = compra + ST. A ST nao participa da divisao da
// compra e recorre com cada compra mensal. Onde cai:
//   1a parcela antes de 30 dias  -> junto dela;
//   parcela unica OU 1a >= 30    -> parcela propria aos 30 dias.

{
  // 70/84/98: a 1a parcela vence aos 70 (> 30) -> ST propria aos 30.
  const ps = S.gerarCompras({
    valorCent: 300000, stCent: 45000, prazoDias: [70, 84, 98],
    dataPrimeira: '2026-08-05', ateData: '2026-08-05'
  });
  eq('ST com 1a parcela alem de 30 dias vira parcela propria aos 30',
    ps.find(p => p.st).vencimento, App.somarDias('2026-08-05', 30));
  eq('  ...o total da compra = mercadoria + ST', soma(ps.map(p => p.cent)), 345000);
  eq('  ...e a mercadoria continua dividida igual, sem a ST',
    ps.filter(p => !p.st).map(p => p.cent), [100000, 100000, 100000]);
}
{
  // 15/45: a 1a parcela vence aos 15 (< 30) -> ST cobrada JUNTO dela.
  const ps = S.gerarCompras({
    valorCent: 10000, stCent: 5000, prazoDias: [15, 45],
    dataPrimeira: '2026-08-05', ateData: '2026-08-05'
  });
  eq('ST com 1a parcela antes de 30 dias cai junto dela (mesma data)',
    ps.find(p => p.st).vencimento, App.somarDias('2026-08-05', 15));
}
{
  // Parcela unica: a vista e "112" — nos dois casos, ST aos 30 dias.
  const aVista = S.gerarCompras({
    valorCent: 10000, stCent: 5000, prazoDias: S.parsePrazo('à vista'),
    dataPrimeira: '2026-08-05', ateData: '2026-08-05'
  });
  eq('ST com compra a vista vai para os 30 dias',
    aVista.find(p => p.st).vencimento, App.somarDias('2026-08-05', 30));
  const cento12 = S.gerarCompras({
    valorCent: 10000, stCent: 5000, prazoDias: [112],
    dataPrimeira: '2026-08-05', ateData: '2026-08-05'
  });
  eq('ST com parcela unica de 112 dias tambem: 30 dias',
    cento12.find(p => p.st).vencimento, App.somarDias('2026-08-05', 30));
}
{
  // A ST recorre com cada compra mensal, e sem ST nada muda.
  const ps = S.gerarCompras({
    valorCent: 10000, stCent: 5000, prazoDias: [70],
    dataPrimeira: '2026-08-05', ateData: '2026-09-05'
  });
  eq('cada compra mensal traz a propria ST', ps.filter(p => p.st).length, 2);
  const sem = S.gerarCompras({
    valorCent: 10000, prazoDias: [70],
    dataPrimeira: '2026-08-05', ateData: '2026-08-05'
  });
  eq('sem ST, nenhuma parcela marcada', sem.filter(p => p.st).length, 0);
}

// ── Media de compra mensal (referencia para preencher a linha) ──
// Mes sem compra conta como zero: e' a media REAL de desembolso do
// semestre, nao a media so' dos meses com nota.

{
  const notas = [
    { dataEmissao: '2026-07-10', valorTotal: 60000 },   // dentro da janela
    { dataEmissao: '2026-05-20', valorTotal: 30000 },   // dentro
    { dataEmissao: '2026-03-01', valorTotal: 30000 },   // dentro (> corte 2026-02-05)
    { dataEmissao: '2026-01-15', valorTotal: 999999 },  // FORA (antes de 6 meses)
    { dataEmissao: '2026-09-01', valorTotal: 999999 },  // FORA (futuro; emissao > hoje)
    { valorTotal: 500 }                                  // sem data: fora
  ];
  const m = S.mediaCompraMensal(notas, '2026-08-05', 6);
  eq('media de 6 meses soma so as notas da janela', m.totalCent, 12000000);
  eq('  ...e divide pelos 6 meses, com mes vazio contando zero',
    m.mediaCent, 2000000);
  eq('  ...contando as notas consideradas', m.qtdNotas, 3);
}
{
  const m = S.mediaCompraMensal([], '2026-08-05', 6);
  eq('fornecedor sem compra no semestre: zero de verdade (janela completa carregada)',
    [m.totalCent, m.mediaCent, m.qtdNotas], [0, 0, 0]);
}
{
  // Centavos: 100,01 em 6 meses nao vira float perdido.
  const m = S.mediaCompraMensal([{ dataEmissao: '2026-07-01', valorTotal: 100.01 }], '2026-08-05', 6);
  eq('media arredonda em centavos inteiros', m.mediaCent, Math.round(10001 / 6));
}
{
  // A janela padronizada das telas e' 12 meses: nota de 11 meses atras
  // entra, de 13 fica fora.
  const m = S.mediaCompraMensal([
    { dataEmissao: '2025-09-10', valorTotal: 1200 },  // 11 meses atras: entra
    { dataEmissao: '2025-07-10', valorTotal: 9999 }   // 13 meses atras: fora
  ], '2026-08-05', 12);
  eq('janela de 12 meses: 11 meses atras entra, 13 fica fora',
    [m.totalCent, m.qtdNotas], [120000, 1]);
  eq('  ...e a media divide pelos 12', m.mediaCent, 10000);
}

// ── Ajuste % por mes de COMPRA ("-10 em novembro") ───────────
// O percentual escala a COMPRA feita no mes (mercadoria + ST; o frete
// acompanha porque a tela passa o mesmo mapa). O efeito aparece nos
// vencimentos daquelas parcelas, meses depois — fluxo de caixa real.

{
  const ps = S.gerarCompras({
    valorCent: 1000000, stCent: 100000, prazoDias: [70, 84, 98],
    dataPrimeira: '2026-08-05', ateData: '2026-09-05',
    ajustes: { '2026-09': -10 }
  });
  const ago = ps.filter(p => p.compra === '2026-08-05');
  const set = ps.filter(p => p.compra === '2026-09-05');
  eq('mes sem ajuste fica intacto', soma(ago.map(p => p.cent)), 1100000);
  eq('compra de setembro com -10%: total escalado (mercadoria + ST)',
    soma(set.map(p => p.cent)), 900000 + 90000);
  eq('  ...a ST escala junto', set.find(p => p.st).cent, 90000);
  eq('  ...e a divisao refeita fecha em cima do total escalado',
    soma(set.filter(p => !p.st).map(p => p.cent)), 900000);
}
{
  // Aumento tambem, e valor que nao divide redondo continua fechando.
  const ps = S.gerarCompras({
    valorCent: 999999, prazoDias: [30, 60, 90],
    dataPrimeira: '2026-08-05', ateData: '2026-08-05',
    ajustes: { '2026-08': 15 }
  });
  eq('+15% escala o total e a soma das parcelas bate com o escalado',
    soma(ps.map(p => p.cent)), Math.round(999999 * 1.15));
}
{
  // Abaixo de -100% nao existe compra negativa: trava no zero.
  const ps = S.gerarCompras({
    valorCent: 1000, prazoDias: [30], dataPrimeira: '2026-08-05',
    ateData: '2026-08-05', ajustes: { '2026-08': -150 }
  });
  eq('ajuste abaixo de -100% trava no zero, nunca vira negativo',
    soma(ps.map(p => p.cent)), 0);
}

// ── 5. Rampa: o 12o mes recebe a carga de regime do 6o ───────

{
  const mesInicial = '2026-08';
  const ultimoDia = App.somarDias(App.somarMeses(mesInicial + '-01', 12), -1);
  const prazo = [70, 84, 98];
  const parcelas = S.gerarCompras({
    valorCent: 300000, prazoDias: prazo, dataPrimeira: '2026-08-05',
    ateData: App.somarDias(ultimoDia, 98) // a regra da tela: janela + maior prazo
  });
  const meses = S.resumoMensal({
    mesInicial, meses: 12,
    simuladas: parcelas.map(p => ({ vencimento: p.vencimento, cent: p.cent }))
  });
  const m6 = meses[5], m12 = meses[11];
  eq('regime: o 12o mes simulado tem a mesma carga do 6o (' + m6.simuladoCent + ')',
    m12.simuladoCent, m6.simuladoCent);
  eq('  ...e nenhum dos dois fica em zero', m6.simuladoCent > 0, true);
}

// ── 6. Projecao de recorrente nao conta em dobro ─────────────

{
  // A (paga) ja' gerou B como documento; projetar A tem que PARAR em
  // B (quem continua a corrente e' B) — senao o mes de setembro
  // apareceria duas vezes: no contratado (documento B) e na projecao.
  const A = { id: 'a', descricao: 'Folha', valor: 5000, vencimento: '2026-08-05',
              recorrente: true, regra: 'diaFixo', diaFixo: 5, pago: true };
  const B = { id: 'a_2026-09-05', descricao: 'Folha', valor: 5000, vencimento: '2026-09-05',
              recorrente: true, regra: 'diaFixo', diaFixo: 5, pago: false, origemId: 'a' };
  const proj = S.projetarInternos([A, B], '2026-12-31');
  eq('A para na existencia de B: nenhuma projecao para setembro',
    proj.filter(p => p.vencimento === '2026-09-05').length, 0);
  eq('a corrente segue a partir de B (out, nov, dez)',
    proj.map(p => p.vencimento), ['2026-10-05', '2026-11-05', '2026-12-05']);

  // E no resumo, setembro aparece UMA vez: como contratado (doc B).
  const meses = S.resumoMensal({
    mesInicial: '2026-08', meses: 5,
    pagamentosInternos: [A, B], projetados: proj
  });
  const set = meses.find(m => m.mes === '2026-09');
  eq('setembro no resumo: so o documento, sem dobra',
    [set.contratadoCent, set.projetadoCent], [500000, 0]);
}

// ── 7. parcelasTotal encerra; parcelaAtual ausente conta como 1 ──

{
  const p = { id: 'x', valor: 100, vencimento: '2026-08-10', recorrente: true,
              regra: 'diaFixo', diaFixo: 10, parcelasTotal: 3 }; // parcelaAtual AUSENTE
  const proj = S.projetarInternos([p], '2027-12-31');
  // ausente = 1: projeta a 2 e a 3, e para — "undefined >= 3" da falso
  // e sem a guarda a corrente nunca terminaria.
  eq('parcelaAtual ausente conta como 1: projeta so ate a 3a',
    proj.map(q => q.vencimento), ['2026-09-10', '2026-10-10']);
  eq('  ...numerando as parcelas projetadas', proj.map(q => q.parcelaAtual), [2, 3]);

  const ultima = { id: 'y', valor: 100, vencimento: '2026-08-10', recorrente: true,
                   regra: 'diaFixo', diaFixo: 10, parcelaAtual: 3, parcelasTotal: 3 };
  eq('a ultima parcela nao projeta nada', S.projetarInternos([ultima], '2027-12-31'), []);

  const semFim = { id: 'z', valor: 100, vencimento: '2026-08-10', recorrente: true,
                   regra: 'diaFixo', diaFixo: 10 };
  eq('sem parcelasTotal a corrente vai ate o fim da janela',
    S.projetarInternos([semFim], '2026-11-30').length, 3);
}

// regra ultimoDia tambem vale na projecao
{
  const p = { id: 'u', valor: 100, vencimento: '2026-01-31', recorrente: true, regra: 'ultimoDia' };
  const proj = S.projetarInternos([p], '2026-04-30');
  eq('projecao com regra ultimoDia cai sempre no fim do mes',
    proj.map(q => q.vencimento), ['2026-02-28', '2026-03-31', '2026-04-30']);
}

// ── 8. "Ja contratado": pagas entram, nota cancelada sai ─────

{
  const notasPorChave = {
    'chave-viva': { status: 'ativa' },
    'chave-cancelada': { status: 'cancelada' }
  };
  const dups = [
    { chaveAcesso: 'chave-viva', vencimento: '2026-08-10', valor: 100, pago: true },   // paga: ENTRA
    { chaveAcesso: 'chave-viva', vencimento: '2026-08-20', valor: 50, pago: false },
    { chaveAcesso: 'chave-cancelada', vencimento: '2026-08-15', valor: 999, pago: false }, // cancelada: SAI
    { chaveAcesso: 'chave-sem-nota', vencimento: '2026-08-25', valor: 30, pago: false }    // nota fora da carga: entra (nao ha como afirmar cancelamento)
  ];
  const internos = [{ vencimento: '2026-08-05', valor: 20, pago: true }];
  const meses = S.resumoMensal({
    mesInicial: '2026-08', meses: 1,
    duplicatas: dups, notasPorChave, pagamentosInternos: internos
  });
  eq('contratado do mes: pagas + a pagar + internos, sem a cancelada',
    meses[0].contratadoCent, 10000 + 5000 + 3000 + 2000);
  eq('a cancelada nao esta na lista do detalhe',
    meses[0].contratado.some(d => d.chaveAcesso === 'chave-cancelada'), false);
}

// parcela fora da janela nao entra em mes nenhum
{
  const meses = S.resumoMensal({
    mesInicial: '2026-08', meses: 2,
    simuladas: [{ vencimento: '2026-10-01', cent: 777 }]
  });
  eq('vencimento apos a janela fica fora do resumo',
    soma(meses.map(m => m.simuladoCent)), 0);
}

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
