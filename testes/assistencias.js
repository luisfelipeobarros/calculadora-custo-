/*
  App de Assistencias/Reclamacoes (assistencias.html + nucleo).

  O que estes testes travam:
  - as listas de status/causa/solucao e a cor do badge por status
    (status desconhecido cai no vermelho, nunca parece resolvido);
  - o resumo dos cartoes: "em aberto" = tudo que nao esta resolvido,
    custos SO do mes corrente (pela data de abertura) e o liquido =
    custo - ressarcimento;
  - o filtro (status, causa, periodo e busca em cliente E sequencia,
    sem acento) e a ordenacao (mais recentes primeiro);
  - a duplicidade de sequencia: outro documento com a mesma sequencia
    avisa; o PROPRIO documento em edicao nao conta;
  - a exportacao: liquido em branco quando nao ha dinheiro lancado.
*/
const App = require('../app-shared.js');
const N = require('../assistencias-nucleo.js');

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => {
  const va = JSON.stringify(a), vb = JSON.stringify(b);
  va === vb ? ok(t) : erro(t + ' — esperava ' + vb + ', veio ' + va);
};

// ── Listas e badge ───────────────────────────────────────────

eq('quatro status, na ordem do fluxo',
  N.STATUS, ['Aberta', 'Em análise', 'Aguardando fábrica', 'Resolvida']);
eq('seis causas', N.CAUSAS.length, 6);
eq('seis tipos de solucao', N.TIPOS_SOLUCAO.length, 6);
eq('badge: aberta e vermelha', N.classeStatus('Aberta'), 'st-aberta');
eq('badge: em analise e amarela', N.classeStatus('Em análise'), 'st-analise');
eq('badge: aguardando fabrica e azul', N.classeStatus('Aguardando fábrica'), 'st-fabrica');
eq('badge: resolvida e verde', N.classeStatus('Resolvida'), 'st-resolvida');
eq('status desconhecido cai no vermelho (nunca parece resolvido)',
  N.classeStatus('zzz'), 'st-aberta');

// ── Resumo dos cartoes ───────────────────────────────────────

const lista = [
  { id: 'a', sequencia: '100', cliente: 'Maria José', dataAbertura: '2026-08-05',
    status: 'Aberta', causa: 'Defeito de fabricação', custoLoja: 500, ressarcimentoFabrica: 200 },
  { id: 'b', sequencia: '101', cliente: 'João', dataAbertura: '2026-08-20',
    status: 'Resolvida', causa: 'Entrega errada', custoLoja: 100 },
  { id: 'c', sequencia: '102', cliente: 'ACAO Construções', dataAbertura: '2026-07-10',
    status: 'Em análise', causa: 'Quebra no transporte', custoLoja: 900, ressarcimentoFabrica: 900 }
];

{
  const r = N.resumoAssistencias(lista, '2026-08-31');
  eq('em aberto = tudo que NAO esta resolvido', r.emAberto, 2);
  eq('custo do mes soma so agosto (500 + 100)', r.custoMes, 600);
  eq('liquido do mes desconta o ressarcimento (600 - 200)', r.liquidoMes, 400);
}
eq('lista vazia: resumo zerado de verdade',
  N.resumoAssistencias([], '2026-08-31'), { emAberto: 0, custoMes: 0, liquidoMes: 0 });

// ── Filtro e ordenacao ───────────────────────────────────────

eq('sem filtro passa tudo', N.filtrarAssistencias(lista, {}).length, 3);
eq('por status', N.filtrarAssistencias(lista, { status: 'Aberta' }).map(a => a.id), ['a']);
eq('por causa', N.filtrarAssistencias(lista, { causa: 'Entrega errada' }).map(a => a.id), ['b']);
eq('por periodo (agosto)', N.filtrarAssistencias(lista, { de: '2026-08-01', ate: '2026-08-31' }).length, 2);
eq('busca por cliente sem acento ("acao" acha "ACAO")',
  N.filtrarAssistencias(lista, { termo: 'acao' }).map(a => a.id), ['c']);
eq('busca por sequencia', N.filtrarAssistencias(lista, { termo: '101' }).map(a => a.id), ['b']);
eq('busca que nao casa nada', N.filtrarAssistencias(lista, { termo: 'xyz' }).length, 0);
eq('ordenacao: mais recentes primeiro',
  N.ordenarAssistencias(lista).map(a => a.id), ['b', 'a', 'c']);

// ── Duplicidade de sequencia ─────────────────────────────────

eq('outra assistencia com a mesma sequencia avisa',
  N.sequenciaDuplicada(lista, '100', null), true);
eq('o PROPRIO documento em edicao nao conta como duplicado',
  N.sequenciaDuplicada(lista, '100', 'a'), false);
eq('sequencia inedita nao avisa', N.sequenciaDuplicada(lista, '999', null), false);
eq('sequencia vazia nunca avisa', N.sequenciaDuplicada(lista, '  ', null), false);
eq('espacos nas pontas nao enganam a comparacao',
  N.sequenciaDuplicada(lista, ' 100 ', null), true);

// ── Fotos do problema x termo de acordo (mesmo campo) ────────
// O termo entra no MESMO array `fotos`, marcado com {termo:true} —
// nada novo no Firestore; a separacao e' so' de tela/exportacao.

{
  const misto = ['fotoA', { termo: true, img: 'termoPag1' }, 'fotoB',
    { termo: true, img: 'termoPag2' }];
  eq('separa problema e termo do mesmo array',
    N.separarFotos(misto), { problema: ['fotoA', 'fotoB'], termo: ['termoPag1', 'termoPag2'], outros: [] });
  eq('documento antigo (so strings) continua funcionando',
    N.separarFotos(['a', 'b']), { problema: ['a', 'b'], termo: [], outros: [] });
  // Formato DESCONHECIDO vai para `outros` e sobrevive ao salvar —
  // como a ficha regrava o array inteiro, ignorar seria APAGAR. So'
  // null/undefined/'' morrem de verdade.
  eq('entrada desconhecida e PRESERVADA em outros (null e vazio morrem)',
    N.separarFotos([null, { termo: true }, 42, '', { img: 'legado' }]),
    { problema: [], termo: [], outros: [{ termo: true }, 42, { img: 'legado' }] });
  eq('juntar devolve os desconhecidos intactos no fim',
    N.juntarFotos(['f1'], ['t1'], [{ img: 'legado' }]),
    ['f1', { termo: true, img: 't1' }, { img: 'legado' }]);
  eq('juntar e separar fecham o ciclo sem perder nada',
    N.separarFotos(N.juntarFotos(['f1'], ['t1', 't2'])),
    { problema: ['f1'], termo: ['t1', 't2'], outros: [] });
  eq('sem fotos nenhuma: vazio dos tres lados',
    N.separarFotos(undefined), { problema: [], termo: [], outros: [] });
  eq('fotos que nem array e (doc corrompido) nao derruba a lista',
    N.separarFotos('lixo'), { problema: [], termo: [], outros: [] });
}

// ── Dinheiro digitado a brasileira (o bug dos >= 1000) ───────
// "25.000" formatado sem centavos era relido como 25 — cada
// abrir-e-salvar da ficha dividia o valor por mil.
eq('25.000 e vinte e cinco mil', N.parseDinheiroBR('25.000'), 25000);
eq('1.234 (milhar) e mil duzentos e trinta e quatro', N.parseDinheiroBR('1.234'), 1234);
eq('2.500.000 inteiro', N.parseDinheiroBR('2.500.000'), 2500000);
eq('com centavos continua igual', N.parseDinheiroBR('1.234,56'), 1234.56);
eq('decimal simples com ponto nao muda', N.parseDinheiroBR('64.9'), 64.9);
eq('vazio -> null', N.parseDinheiroBR(''), null);
// E o round-trip que corrompia: renderizado com 2 casas, relido igual.
eq('round-trip do render com 2 casas fecha',
  N.parseDinheiroBR((25000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })), 25000);

// ── Exportacao ───────────────────────────────────────────────

{
  const linhas = N.linhasExcel([
    { sequencia: '100', custoLoja: 500, ressarcimentoFabrica: 200,
      fotos: ['x', 'y', { termo: true, img: 't' }] },
    { sequencia: '101' } // sem dinheiro nenhum
  ]);
  eq('liquido calculado quando ha dinheiro', linhas[0]['Custo líquido (R$)'], 300);
  eq('fotos exportam como CONTAGEM, so as do problema', linhas[0]['Fotos'], 2);
  eq('termo anexado sai como "sim"', linhas[0]['Termo de acordo'], 'sim');
  eq('sem termo: coluna em branco', linhas[1]['Termo de acordo'], '');
  eq('linha sem dinheiro sai com liquido em branco, nao "0"',
    linhas[1]['Custo líquido (R$)'], '');
}

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
