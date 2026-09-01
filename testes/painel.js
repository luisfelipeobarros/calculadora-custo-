/*
  Painel de metas da Calculadora: dias uteis, limite de 60% e a
  previsao de faturamento do mes corrente.

  Os numeros de referencia vem da PLANILHA que o painel substitui
  (ano de 2026): dias de trabalho mes a mes, faturamento diario
  previsto e realizado, e a diferenca objetivo x realizado. Se a
  conta daqui discordar da planilha, quem muda e' o codigo.

  Regras que estes testes travam:
  - dia de trabalho = tudo menos DOMINGO e menos feriado cadastrado
    (sabado e' dia normal);
  - feriado que cai no domingo nao desconta duas vezes;
  - a previsao so' projeta sobre dias uteis que FALTAM, e sem dia
    util decorrido nao ha' media — previsao em branco, nunca
    inventada de amostra vazia.
*/
const App = require('../app-shared.js');
const P = require('../painel-nucleo.js');

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => {
  const va = JSON.stringify(a), vb = JSON.stringify(b);
  va === vb ? ok(t) : erro(t + ' — esperava ' + vb + ', veio ' + va);
};

// ── Dias de trabalho: os 12 meses de 2026, como na planilha ──

// [mes, feriados cadastrados, dias esperados na planilha]
[
  ['2026-01', ['2026-01-01'], 26],
  ['2026-02', ['2026-02-09', '2026-02-10'], 22],
  ['2026-03', [], 26],
  ['2026-04', ['2026-04-03'], 25],
  ['2026-05', ['2026-05-01'], 25],
  ['2026-06', ['2026-06-24'], 25],
  ['2026-07', [], 27],
  ['2026-08', [], 26],
  ['2026-09', [], 26],
  ['2026-10', [], 27],
  ['2026-11', [], 25],
  ['2026-12', [], 27]
].forEach(([mes, feriados, esperado]) => {
  eq('dias de trabalho de ' + mes + (feriados.length ? ' (' + feriados.length + ' feriado(s))' : ''),
    P.diasDeTrabalho(mes, feriados), esperado);
});

// Feriado no domingo nao desconta duas vezes (01/03/2026 e' domingo).
eq('feriado que cai no domingo nao desconta duas vezes',
  P.diasDeTrabalho('2026-03', ['2026-03-01']), 26);
// Fevereiro bissexto.
eq('fevereiro bissexto tem os dias certos (2028)',
  P.diasDeTrabalho('2028-02', []), 25); // 29 dias - 4 domingos

// ── Limite e derivados da linha (numeros da planilha) ────────

// Janeiro fechado: objetivo 6.470.000, vendas 6.656.607,40.
{
  const r = P.resumoDoMes({
    mes: '2026-01', objetivo: 6470000, feriados: ['2026-01-01'],
    faturamento: { acumulado: 6656607.40, ate: '2026-01-31' },
    aPagar: 3873749.24
  }, '2026-08-04');
  eq('limite = 60% do objetivo (janeiro)', r.limite, 3882000);
  eq('disponivel = limite - a pagar (janeiro)', r.disponivel, 8250.76);
  eq('diario previsto = objetivo / dias de trabalho', r.diarioPrevisto, 248846.15);
  eq('diario realizado (mes fechado) = vendas / dias de trabalho', r.diarioRealizado, 256023.36);
  eq('diferenca obj x real de janeiro ~ 2,88%', Math.round(r.difPct * 10000), 288);
  eq('mes anterior ao de hoje e "fechado"', r.estado, 'fechado');
  eq('mes fechado nao tem previsao', r.previsao, null);
}

// Maio: vendas abaixo do objetivo -> diferenca negativa.
{
  const r = P.resumoDoMes({
    mes: '2026-05', objetivo: 6200000, feriados: ['2026-05-01'],
    faturamento: { acumulado: 6121019.08, ate: '2026-05-31' }, aPagar: 0
  }, '2026-08-04');
  eq('diferenca negativa de maio ~ -1,27%', Math.round(r.difPct * 10000), -127);
}

// Sem objetivo lancado, nada de limite nem diario previsto — campo
// vazio e' vazio, nao zero.
{
  const r = P.resumoDoMes({ mes: '2026-09', feriados: [], aPagar: 100 }, '2026-08-04');
  eq('sem objetivo: limite null', r.limite, null);
  eq('sem objetivo: disponivel null', r.disponivel, null);
  eq('sem vendas: diferenca null', r.difPct, null);
  eq('mes depois do de hoje e "futuro"', r.estado, 'futuro');
}

// ── A previsao do mes corrente ───────────────────────────────

// Agosto/2026, hoje dia 04, faturado 300.000 ate o dia 03.
// Dias uteis de 01..03 = sabado 01 + segunda 03 (domingo 02 fora) = 2.
// Agosto tem 26 uteis -> restam 24 depois do dia 03.
{
  const r = P.resumoDoMes({
    mes: '2026-08', objetivo: 6500000, feriados: [],
    faturamento: { acumulado: 300000, ate: '2026-08-03' }, aPagar: 0
  }, '2026-08-04');
  const p = r.previsao;
  eq('mes de hoje e "corrente"', r.estado, 'corrente');
  eq('dias uteis decorridos ate 03/08 = 2 (domingo fora)', p.decorridos, 2);
  eq('dias uteis restantes depois de 03/08 = 24', p.restantes, 24);
  eq('media = acumulado / decorridos', p.media, 150000);
  eq('previsao = acumulado + media x restantes', p.prevista, 300000 + 150000 * 24);
  eq('necessario por dia util restante', p.necessarioPorDia, App.centavos((6500000 - 300000) / 24));
  eq('diario realizado do mes corrente divide pelos DECORRIDOS', r.diarioRealizado, 150000);
}

// Um feriado no meio do mes tira um dia dos restantes.
{
  const r = P.resumoDoMes({
    mes: '2026-08', objetivo: null, feriados: ['2026-08-20'],
    faturamento: { acumulado: 300000, ate: '2026-08-03' }, aPagar: 0
  }, '2026-08-04');
  eq('feriado cadastrado sai dos dias restantes', r.previsao.restantes, 23);
  eq('sem objetivo, necessario por dia fica null', r.previsao.necessarioPorDia, null);
}

// Comeco de mes: lancamento "ate 31/07" nao tem dia util decorrido em
// agosto -> sem media e SEM previsao inventada.
{
  const r = P.resumoDoMes({
    mes: '2026-08', objetivo: 6500000, feriados: [],
    faturamento: { acumulado: 0, ate: '2026-08-01' }, aPagar: 0
  }, '2026-08-01');
  // 01/08 e' sabado, dia util: com um unico dia decorrido ja' ha' media.
  eq('primeiro dia util ja' + ' da media', r.previsao.decorridos, 1);
}
{
  // "ate" anterior ao inicio do mes: zero decorridos.
  const r = P.resumoDoMes({
    mes: '2026-08', objetivo: 6500000, feriados: [],
    faturamento: { acumulado: 100, ate: '2026-07-31' }, aPagar: 0
  }, '2026-08-01');
  eq('"ate" fora do mes: zero dias decorridos', r.previsao.decorridos, 0);
  eq('  ...sem media', r.previsao.media, null);
  eq('  ...sem previsao inventada', r.previsao.prevista, null);
  eq('  ...mas o necessario por dia existe', r.previsao.necessarioPorDia,
    App.centavos((6500000 - 100) / 26));
}

// ── Dif. obj. do mes corrente: contra o objetivo PROPORCIONAL ──
// Comparar vendas de 2 dias com o objetivo do mes inteiro diria
// "-91%" todo dia 04. O comparavel e' objetivo x decorridos/uteis.
{
  const r = P.resumoDoMes({
    mes: '2026-08', objetivo: 6500000, feriados: [],
    faturamento: { acumulado: 529667.57, ate: '2026-08-03' }, aPagar: 0
  }, '2026-08-04');
  eq('objetivo comparavel = proporcional (2 de 26 dias uteis)',
    r.objetivoComparavel, 500000);
  eq('dif do mes corrente vs proporcional ~ +5,93%',
    Math.round(r.difPct * 10000), 593);
}
{
  // Zero dia util decorrido: comparavel zero, diferenca em branco —
  // nunca "-100%" no primeiro dia do mes.
  const r = P.resumoDoMes({
    mes: '2026-08', objetivo: 6500000, feriados: [],
    faturamento: { acumulado: 100, ate: '2026-07-31' }, aPagar: 0
  }, '2026-08-01');
  eq('zero dias decorridos: objetivo comparavel zero', r.objetivoComparavel, 0);
  eq('  ...e diferenca em branco, nunca -100%', r.difPct, null);
}
{
  // Mes fechado segue comparando com o objetivo inteiro (a conta da
  // planilha, ja' travada nos testes de janeiro/maio acima).
  const r = P.resumoDoMes({
    mes: '2026-01', objetivo: 6470000, feriados: ['2026-01-01'],
    faturamento: { acumulado: 6656607.40, ate: '2026-01-31' }, aPagar: 0
  }, '2026-08-04');
  eq('mes fechado: objetivo comparavel = objetivo inteiro',
    r.objetivoComparavel, 6470000);
}

// Objetivo ja' batido: necessario por dia = 0, nao negativo.
{
  const r = P.resumoDoMes({
    mes: '2026-08', objetivo: 100000, feriados: [],
    faturamento: { acumulado: 150000, ate: '2026-08-03' }, aPagar: 0
  }, '2026-08-04');
  eq('objetivo batido: necessario por dia = 0', r.previsao.necessarioPorDia, 0);
}

// "ate" alem do fim do mes vale o fim (mes completo).
{
  const r = P.resumoDoMes({
    mes: '2026-07', objetivo: 6540000, feriados: [],
    faturamento: { acumulado: 7490144, ate: '2026-08-15' }, aPagar: 0
  }, '2026-08-04');
  eq('"ate" depois do fim do mes: divide pelos dias do mes inteiro',
    r.diarioRealizado, App.centavos(7490144 / 27));
}

// O 60% mora num lugar so'.
eq('a constante do limite e 60%', P.LIMITE_DO_OBJETIVO, 0.6);

// ── Projecao anual e crescimento vs ano anterior ────────────
// Regra de 21/08/2026: fechados pelas vendas, corrente pela previsao,
// futuros pelo objetivo ("vamos bater a meta") — e o que faltar e'
// AVISADO, nunca zero mudo.

{
  // Cenario minimo com as tres fatias: julho fechado (vendas 100.000),
  // agosto corrente (previsao) e setembro futuro (objetivo 120.000).
  // Agosto/2026 sem feriados: 26 dias uteis; ate 07/08 (6 uteis, o
  // domingo dia 02 fora) acumulou 30.000 -> media 5.000 -> previsao
  // 30.000 + 5.000 x 20 restantes = 130.000.
  const entradas = [
    { mes: '2026-07', objetivo: 100000, feriados: [], faturamento: { acumulado: 100000, ate: '2026-07-31' } },
    { mes: '2026-08', objetivo: 130000, feriados: [], faturamento: { acumulado: 30000, ate: '2026-08-07' } },
    { mes: '2026-09', objetivo: 120000, feriados: [], faturamento: null }
  ];
  const p = P.projecaoAnual(entradas, '2026-08-10');
  eq('fechado entra pelas vendas', p.realizado, 100000);
  eq('corrente entra pela PREVISAO', [p.corrente.fonte, p.corrente.valor], ['previsao', 130000]);
  eq('futuro entra pelo objetivo', p.futuros, 120000);
  eq('total = as tres fatias somadas', p.total, 350000);
  eq('nada faltando: listas vazias',
    [p.fechadosSemVendas, p.futurosSemObjetivo], [[], []]);
}
{
  // Mes corrente sem lancamento cai para o objetivo — e diz isso.
  const p = P.projecaoAnual([
    { mes: '2026-08', objetivo: 90000, feriados: [], faturamento: null }
  ], '2026-08-10');
  eq('corrente sem lancamento usa o objetivo, declarando a fonte',
    [p.corrente.fonte, p.corrente.valor, p.total], ['objetivo', 90000, 90000]);
}
{
  // Fechado sem vendas e futuro sem objetivo sao AVISADOS, nao zerados
  // em silencio.
  const p = P.projecaoAnual([
    { mes: '2026-06', objetivo: 100000, feriados: [], faturamento: null },
    { mes: '2026-10', objetivo: null, feriados: [], faturamento: null }
  ], '2026-08-10');
  eq('fechado sem vendas vai para a lista de avisos', p.fechadosSemVendas, ['2026-06']);
  eq('futuro sem objetivo tambem', p.futurosSemObjetivo, ['2026-10']);
  eq('e nenhum dos dois entra no total', p.total, 0);
}

eq('crescimento = total / anterior - 1',
  Math.round(P.crescimentoAnual(72942769.81, 66311608.92) * 10000) / 10000, 0.1);
eq('queda sai negativa', P.crescimentoAnual(50, 100), -0.5);
eq('sem ano anterior: null, nunca 0%', P.crescimentoAnual(100, null), null);
eq('anterior zero nao divide', P.crescimentoAnual(100, 0), null);

// ── Historico mes a mes (metasMensais): total anual, crescimento ──
// ate agora e a projecao por sazonalidade. Nenhum faturamento fica
// escrito em codigo: a fonte e' o que o usuario lancou na tabela.

// Constroi o mapa no MESMO formato dos documentos do Firestore.
function metasDe(pares){
  const m = {};
  Object.keys(pares).forEach(mes => {
    m[mes] = { faturamento: { acumulado: pares[mes], ate: P.ultimoDiaDoMes(mes) } };
  });
  return m;
}
function anoCheio(ano, porMes){ // porMes: [12 valores]
  const pares = {};
  for(let m = 1; m <= 12; m++) pares[ano + '-' + String(m).padStart(2, '0')] = porMes[m - 1];
  return pares;
}

eq('vendasDoMes: sem lancamento -> null, nunca zero',
  P.vendasDoMes(metasDe({}), '2025-03'), null);
eq('vendasDoMes: com lancamento devolve o valor',
  P.vendasDoMes(metasDe({ '2025-03': 123.45 }), '2025-03'), 123.45);

{
  const cheio = metasDe(anoCheio(2025, [100,100,100,100,100,100,100,100,100,100,100,100]));
  eq('totalAnualVendas soma os 12 meses', P.totalAnualVendas(cheio, 2025), 1200);
  const semJun = metasDe(anoCheio(2025, [100,100,100,100,100,100,100,100,100,100,100,100]));
  delete semJun['2025-06'];
  eq('faltou um mes -> null (total parcial rotulado de anual seria mentira)',
    P.totalAnualVendas(semJun, 2025), null);
}

{
  // 2025 completo a 100/mes; 2026 jan-jul a 110 e agosto (corrente em
  // 15/08) tambem lancado — o corrente NAO pode entrar.
  const pares = Object.assign(
    anoCheio(2025, [100,100,100,100,100,100,100,100,100,100,100,100]),
    { '2026-01':110, '2026-02':110, '2026-03':110, '2026-04':110,
      '2026-05':110, '2026-06':110, '2026-07':110, '2026-08':500 });
  const g = P.crescimentoAteAgora(metasDe(pares), 2026, '2026-08-15');
  eq('crescimento ate agora: jan-jul x jan-jul, corrente FORA',
    [g.atual, g.anterior, g.deMes, g.ateMes], [770, 700, 1, 7]);
  eq('  ...com o pct de fato contra fato', Math.round(g.pct * 1000) / 1000, 0.1);
}
{
  // Mes sem lancamento num dos anos sai da conta DOS DOIS lados.
  const pares = Object.assign(
    anoCheio(2025, [100,100,100,100,100,100,100,100,100,100,100,100]),
    { '2026-01':110, '2026-03':110 }); // fevereiro/2026 nao lancado
  const g = P.crescimentoAteAgora(metasDe(pares), 2026, '2026-04-01');
  eq('mes faltando sai da conta dos dois anos', [g.atual, g.anterior], [220, 200]);
}
eq('sem meses comparaveis -> null, nunca 0%',
  P.crescimentoAteAgora(metasDe({ '2026-01': 100 }), 2026, '2026-03-01'), null);

{
  // Sazonalidade de 2025: jan pesa 10%, fev 30%, o resto 60%.
  const base2025 = anoCheio(2025, [100,300,60,60,60,60,60,60,60,60,60,60]);
  const m1 = metasDe(Object.assign({}, base2025, { '2026-01': 150, '2026-02': 450 }));
  const s1 = P.projecaoSazonal(m1, 2026, '2026-03-10');
  eq('sazonalidade: vendido 600 sobre 40% do ano -> projeta 1.500',
    [s1.total, s1.anosBase], [1500, [2025]]);

  // Ano-base INCOMPLETO nao entra na media.
  const m2 = metasDe(Object.assign({}, base2025,
    { '2024-01': 999 }, { '2026-01': 150, '2026-02': 450 }));
  const s2 = P.projecaoSazonal(m2, 2026, '2026-03-10');
  eq('ano-base incompleto fica fora da media', s2.anosBase, [2025]);

  // Dois anos-base completos: a media dos pesos e' que vale.
  const m3 = metasDe(Object.assign({},
    anoCheio(2024, [200,200,60,60,60,60,60,60,60,60,60,60]), // total 1.000: jan 20%, fev 20%
    base2025,                                                 // total 1.000: jan 10%, fev 30%
    { '2026-01': 150, '2026-02': 450 }));
  const s3 = P.projecaoSazonal(m3, 2026, '2026-03-10');
  eq('dois anos-base: media dos pesos (15% + 25% = 40%) -> 1.500 tambem',
    [s3.total, s3.anosBase], [1500, [2024, 2025]]);

  // Mes fechado sem lancamento sai da conta inteiro (vendido E peso).
  const m4 = metasDe(Object.assign({}, base2025, { '2026-01': 150 }));
  const s4 = P.projecaoSazonal(m4, 2026, '2026-03-10'); // fev fechado, nao lancado
  eq('mes fechado sem lancamento nao distorce a proporcao', s4.total, 1500);

  eq('sem ano-base completo -> null',
    P.projecaoSazonal(metasDe({ '2026-01': 150 }), 2026, '2026-03-10'), null);
  eq('sem mes fechado lancado -> null',
    P.projecaoSazonal(metasDe(base2025), 2026, '2026-01-10'), null);
}

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
