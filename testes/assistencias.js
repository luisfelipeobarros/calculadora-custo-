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
eq('sete tipos de solucao — a troca virou reposicao e troca por produto novo',
  [N.TIPOS_SOLUCAO.length, N.TIPOS_SOLUCAO[0], N.TIPOS_SOLUCAO[1]], [7, N.REPOSICAO, N.TROCA_NOVO]);
eq('troca por produto novo e reconhecida sem acento e sem caixa', N.ehTrocaPorNovo('troca por PRODUTO novo'), true);

// ── Avarias ──────────────────────────────────────────────────

{
  eq('motivos de avaria: carregamento (nao "descarregamento"), estoque, entrega, fabrica, outro',
    N.MOTIVOS_AVARIA, ['Carregamento', 'Manuseio no estoque', 'Entrega', 'Defeito de fábrica', 'Outro']);
  const lista = [
    { status: 'Aberta', dataAbertura: '2026-10-02', custoLoja: 100, cliente: 'A', sequencia: '1' },
    { tipo: 'avaria', status: 'Resolvida', dataAbertura: '2026-10-03', custoLoja: 40.5, motivo: 'Carregamento', itens: [{ produto: 'Piso' }] },
    { tipo: 'avaria', status: 'Resolvida', dataAbertura: '2026-09-03', custoLoja: 9, motivo: 'Entrega' }
  ];
  const r = N.resumoAssistencias(lista, '2026-10-07');
  eq('resumo: avaria nao conta em aberto nem no custo das assistencias; soma a parte, so do mes',
    [r.emAberto, r.custoMes, r.avariasMes, r.avariasQtdMes], [1, 100, 40.5, 1]);
  eq('filtro: sem tipo lista so assistencias; tipo avaria lista so avarias (ignorando status)',
    [N.filtrarAssistencias(lista, {}).length, N.filtrarAssistencias(lista, { status: 'Aberta' }).length,
     N.filtrarAssistencias(lista, { tipo: 'avaria', status: 'Aberta' }).length], [1, 1, 2]);
  eq('filtro: a busca acha a avaria pelo motivo', N.filtrarAssistencias(lista, { tipo: 'avaria', termo: 'entrega' }).length, 1);
  const linhas = N.linhasExcel(lista);
  eq('planilha: coluna de tipo e motivo', [linhas[0]['Tipo'], linhas[1]['Tipo'], linhas[1]['Motivo da avaria']], ['Assistência', 'Avaria', 'Carregamento']);
  eq('ehAvaria', [N.ehAvaria(lista[1]), N.ehAvaria(lista[0]), N.ehAvaria(null)], [true, false, false]);
}

// ── Produtos da ocorrencia (varios por ficha) ────────────────

{
  const antigo = { codigo: '4455', produto: 'Piso 46x46', tonalidade: 'B2', quantidade: 12.5 };
  eq('documento antigo: os campos soltos viram um item',
    N.produtosDaFicha(antigo), [{ codigo: '4455', produto: 'Piso 46x46', tonalidade: 'B2', quantidade: 12.5 }]);
  eq('documento novo: a lista "itens" vale, linha vazia e ignorada, quantidade em texto vira numero',
    N.produtosDaFicha({ itens: [{ codigo: '1', produto: 'A', quantidade: '3' }, {}, { produto: ' B ', quantidade: 'x' }], produto: 'ignorado' }),
    [{ codigo: '1', produto: 'A', tonalidade: '', quantidade: 3 }, { codigo: '', produto: 'B', tonalidade: '', quantidade: null }]);
  eq('sem produto nenhum, lista vazia', [N.produtosDaFicha({}), N.produtosDaFicha(null)], [[], []]);
  eq('produtos novos so na troca por produto novo',
    [N.produtosNovos({ tipoSolucao: N.TROCA_NOVO, itensNovos: [{ produto: 'C', quantidade: 2 }] }).length,
     N.produtosNovos({ tipoSolucao: N.REPOSICAO, itensNovos: [{ produto: 'C' }] }).length], [1, 0]);
  eq('resumo para a lista e a planilha',
    N.resumoProdutos([{ codigo: '4455', produto: 'Piso 46x46', tonalidade: 'B2', quantidade: 12.5 }, { codigo: '', produto: 'Rejunte', tonalidade: '', quantidade: 2 }]),
    '4455 Piso 46x46 (ton. B2) × 12,5; Rejunte × 2');
  eq('a busca acha pelo produto',
    N.filtrarAssistencias([{ cliente: 'X', sequencia: '1', itens: [{ produto: 'Porcelanato Cinza' }] }], { termo: 'cinza' }).length, 1);
  const linha = N.linhasExcel([{ itens: [{ codigo: '1', produto: 'A', tonalidade: 'T', quantidade: 3 }, { codigo: '2', produto: 'B', quantidade: 1.5 }],
    tipoSolucao: N.TROCA_NOVO, itensNovos: [{ codigo: '9', produto: 'Z', quantidade: 4 }] }])[0];
  eq('planilha: varios produtos na mesma linha, e o produto novo da troca',
    [linha['Código'], linha['Produto'], linha['Tonalidade'], linha['Qtd'], linha['Produto novo (troca)']],
    ['1; 2', 'A; B', 'T; ', '3; 1.5', '9 Z × 4']);
  eq('planilha: um produto so mantem a quantidade como numero', N.linhasExcel([{ produto: 'A', quantidade: 3 }])[0]['Qtd'], 3);
}
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
  N.resumoAssistencias([], '2026-08-31'), { emAberto: 0, custoMes: 0, liquidoMes: 0, avariasMes: 0, avariasQtdMes: 0 });

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

// ── Ordem de entrega de material (impressao) ─────────────────

{
  const base = { sequencia: '1167310', cliente: 'Fulano <b>de Tal</b>', codigo: '4455', produto: 'Piso 46x46', tonalidade: 'B2',
    quantidade: 12.5, nfVenda: '9876', problema: 'Peças trincadas', causa: 'Quebra no transporte', responsavel: 'Gerente', dataAbertura: '2026-10-03' };
  const item = { codigo: '4455', descricao: 'Piso 46x46 — tonalidade B2', quantidade: '12,5' };
  eq('ordem: REPOSICAO entrega e recolhe o produto', N.itensDaOrdem(Object.assign({ tipoSolucao: N.REPOSICAO }, base)), { entregar: [item], devolver: [item] });
  eq('ordem: "Troca" de documento antigo vale como reposicao', N.itensDaOrdem(Object.assign({ tipoSolucao: 'Troca' }, base)), { entregar: [item], devolver: [item] });
  eq('ordem: TROCA POR PRODUTO NOVO recolhe o da ficha e entrega o que o cliente leva',
    N.itensDaOrdem(Object.assign({ tipoSolucao: N.TROCA_NOVO, itensNovos: [{ codigo: '7', produto: 'Piso 60x60', tonalidade: 'A1', quantidade: 10 }] }, base)),
    { entregar: [{ codigo: '7', descricao: 'Piso 60x60 — tonalidade A1', quantidade: '10' }], devolver: [item] });
  eq('ordem: varios produtos, todos nas tabelas',
    N.itensDaOrdem({ tipoSolucao: N.REPOSICAO, itens: [{ produto: 'A', quantidade: 1 }, { produto: 'B', quantidade: 2 }] }).devolver.map(i => i.descricao), ['A', 'B']);
  eq('ordem: DEVOLUCAO so recolhe', N.itensDaOrdem(Object.assign({ tipoSolucao: 'Devolução (dinheiro)' }, base)), { entregar: [], devolver: [item] });
  eq('ordem: CREDITO na loja so recolhe', N.itensDaOrdem(Object.assign({ tipoSolucao: 'Crédito na Loja' }, base)), { entregar: [], devolver: [item] });
  eq('ordem: abatimento / assistencia da fabrica / sem solucao = tabelas em branco (nao inventa entrega)',
    [N.itensDaOrdem(Object.assign({ tipoSolucao: 'Abatimento do pedido' }, base)), N.itensDaOrdem(Object.assign({ tipoSolucao: 'Assistência da fábrica' }, base)), N.itensDaOrdem(base)],
    [{ entregar: [], devolver: [] }, { entregar: [], devolver: [] }, { entregar: [], devolver: [] }]);
  eq('ordem: sem produto na ficha, nada nas tabelas mesmo na troca', N.itensDaOrdem({ tipoSolucao: 'Troca' }), { entregar: [], devolver: [] });
  eq('ordem: quantidade inteira sem casas, e vazia quando nao ha',
    [N.itensDaOrdem({ tipoSolucao: 'Troca', produto: 'X', quantidade: 30 }).entregar[0].quantidade, N.itensDaOrdem({ tipoSolucao: 'Troca', produto: 'X' }).entregar[0].quantidade], ['30', '']);

  const credito = N.htmlOrdemEntrega(Object.assign({ tipoSolucao: 'Crédito na Loja' }, base));
  eq('impressao: sem produto a entregar, a tabela "a ser entregue" nao sai; a de devolvido sai',
    [credito.indexOf('PRODUTOS A SER ENTREGUE') === -1, credito.indexOf('PRODUTO DEVOLVIDO') !== -1], [true, true]);
  const html = N.htmlOrdemEntrega(Object.assign({ tipoSolucao: 'Troca', solucao: 'trocar as 3 caixas' }, base));
  eq('impressao: na troca as duas tabelas saem', html.indexOf('PRODUTOS A SER ENTREGUE') !== -1, true);
  eq('ordem: titulo e as secoes do formulario de papel',
    ['ORDEM DE ENTREGA DE MATERIAL', 'PRODUTOS A SER ENTREGUE', 'PRODUTO DEVOLVIDO', 'DISCRIMINAÇÃO DA OCORRÊNCIA',
     'RESPONSÁVEL PELA OCORRÊNCIA:', 'RESPONSÁVEL PELA ENTREGA:', 'VISTO DO CLIENTE OU RESPONSÁVEL:'].every(s => html.indexOf(s) !== -1), true);
  eq('ordem: dado da ficha sai ESCAPADO (cliente com HTML nao vira tag)',
    [html.indexOf('<b>de Tal</b>') === -1, html.indexOf('Fulano &lt;b&gt;de Tal&lt;/b&gt;') !== -1], [true, true]);
  eq('ordem: NF e sequencia na linha da nota, data de abertura no cabecalho',
    [html.indexOf('NF 9876 · seq. 1167310') !== -1, html.indexOf('aberta em 03/10/2026') !== -1], [true, true]);
  eq('ordem: problema, causa e solucao no texto da ocorrencia',
    ['Peças trincadas', 'Causa: Quebra no transporte', 'Solução: Troca — trocar as 3 caixas'].every(s => html.indexOf(s) !== -1), true);
  eq('ordem: cada tabela tem as 6 linhas do papel (1 preenchida + 5 em branco)',
    (html.match(/<tr><td>/g) || []).length, 12);
  // Campos criados para a ordem sair completa (05/10/2026).
  const completa = N.htmlOrdemEntrega(Object.assign({ endereco: 'Rua das Flores, 100 — Centro', documento: '000.111.222-33',
    telefone: '(81) 90000-0000', dataNota: '2026-09-20', dataEntrega: '2026-09-22', tipoSolucao: 'Troca' }, base));
  eq('ordem: endereco, CNPJ/CPF, telefone, data da nota e data da entrega saem preenchidos',
    ['Rua das Flores, 100 — Centro', '000.111.222-33', '(81) 90000-0000', '20/09/2026', '22/09/2026'].every(s => completa.indexOf(s) !== -1), true);
  eq('ordem: so a data da troca/entrega fica em branco para a caneta (uma unica lacuna de data)',
    [completa.indexOf('DATA DA TROCA / ENTREGA:') !== -1, completa.split('____/____/______').length - 1], [true, 1]);
  eq('ordem: sem as datas na ficha, as tres lacunas ficam para a caneta',
    html.split('____/____/______').length - 1, 3);
  eq('ordem: ficha vazia ainda rende o formulario inteiro, sem "null" nem "undefined"',
    [/null|undefined/.test(N.htmlOrdemEntrega({})), N.htmlOrdemEntrega({}).indexOf('ORDEM DE ENTREGA') !== -1], [false, true]);
}

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
