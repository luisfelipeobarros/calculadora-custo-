/*
  Radar de estoque e compras (aba da Calculadora + radar-nucleo.js).

  O que estes testes travam:
  - a leitura do relatorio de vendas (cabecalho por rotulo, asterisco,
    barras so' digitos, linha ilegivel vira problema);
  - o resumo gravado (compacto, com o estoque anterior);
  - carteira (itens "pedido" das cotacoes, com a data do pedido) e
    movimentos (faturado x recebido pelas notas, por codigo de barras);
  - a conta da sugestao (media x cobertura - estoque - carteira -
    faturado), as abas, o "pedido feito" manual que expira;
  - o catalogo do Etiquetas atualizado de carona (pisos pelo catalogo
    ou pela nota com NCM 6907).
*/
const App = require('../app-shared.js');
const N = require('../radar-nucleo.js');

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => {
  const va = JSON.stringify(a), vb = JSON.stringify(b);
  va === vb ? ok(t) : erro(t + ' — esperava ' + vb + ', veio ' + va);
};

// ── Leitura ──────────────────────────────────────────────────
const cab = ['Código Produto', 'Nome Produto', 'Código Adicional 1', 'Código Barras', 'Código Edição', 'Vendas', 'Valor', 'Estoque'];
const matriz = [
  ['Relatório', null, null, null, null, null, null, null],
  cab,
  ['100', 'ARGAMASSA AC-1 20 KG', '1000.1', '0700371770037', 0, 600, 12000, 300],
  ['200', 'PISO X 60X60', null, '7899000000011', 0, 120, 9000, 20],
  ['300', '*PISO ANTIGO 45X45', null, '7899000000028', 0, 0, 0, 50],
  ['400', 'PISO NOVO 80X80', null, '7899000000035', 0, 30, 3000, 0],
  ['500', 'SEM BARRAS', null, '', 0, 10, 100, 5],
  ['600', 'RUIM', null, '', 0, 'x', 1, 1]
];
const lido = N.lerPlanilhaVendas(matriz);
eq('le o relatorio: acha o cabecalho, 5 itens, 1 problema', [lido.itens.length, lido.problemas.length], [5, 1]);
eq('campos do item', lido.itens[2], { codigo: '300', nome: '*PISO ANTIGO 45X45', naoRepor: true, ean: '7899000000028', vendas: 0, valor: 0, estoque: 50 });
eq('sem cabecalho: problema explicado', N.lerPlanilhaVendas([['a'], [1]]).problemas.length, 1);
eq('sem a coluna de barras: avisa', N.lerPlanilhaVendas([['Código Produto', 'Nome Produto', 'Vendas', 'Estoque'], ['1', 'A', 1, 1]]).problemas.length, 1);

// ── Resumo gravado ───────────────────────────────────────────
const doc1 = N.resumoVendas(lido.itens, '2026-10-22', 60, null);
eq('resumo: compacto, com periodo e data', [doc1.qtd, doc1.produtos['200'], doc1.importadoEm, doc1.periodoDias, doc1.anteriorEm], [5, { n: 'PISO X 60X60', e: '7899000000011', v: 120, r: 9000, q: 20 }, '2026-10-22', 60, null]);
const doc2 = N.resumoVendas(lido.itens.map(it => it.codigo === '200' ? Object.assign({}, it, { estoque: 8 }) : it), '2026-10-23', 60, doc1);
eq('resumo seguinte guarda o estoque anterior', [doc2.anterior['200'], doc2.anteriorEm, doc2.produtos['200'].q], [20, '2026-10-22', 8]);

// ── Partes: documento do Firestore nao passa de 1 MB ─────────
{
  const muitos = {};
  for (let i = 0; i < 300; i++) muitos['c' + i] = { n: 'PRODUTO NUMERO ' + i + ' COM NOME COMPRIDO', e: '78990000' + String(i).padStart(5, '0'), v: i, r: i * 10, q: i % 7 };
  const doc = { produtos: muitos, qtd: 300, importadoEm: '2026-10-23', periodoDias: 62, anterior: { c1: 2 }, anteriorEm: '2026-10-22' };
  const div = N.dividirResumo(doc, 4000);
  eq('divide os produtos em partes abaixo do limite, com a meta separada',
    [div.partes.length > 1, div.partes.every(p => JSON.stringify(p).length <= 4200), div.meta.partes === div.partes.length, div.meta.produtos, div.meta.anterior],
    [true, true, true, undefined, { c1: 2 }]);
  eq('juntar devolve o documento inteiro', (j => [Object.keys(j.produtos).length, j.importadoEm, j.produtos.c299.v])(N.juntarResumo(div.meta, div.partes.map(p => ({ produtos: p })))), [300, '2026-10-23', 299]);
  eq('o relatorio real (9 mil produtos) cabe em poucas partes de 700 KB', N.dividirResumo({ produtos: muitos }).partes.length, 1);
}

// ── Carteira e movimentos ────────────────────────────────────
const ts = (y, m, d) => ({ toDate: () => new Date(y, m - 1, d, 12) });
const cotacoes = [
  { fornecedor: 'F1', data: ts(2026, 10, 1), itens: [
    { codigo: '200', status: 'pedido', quantidadeEsperada: 100, quantidadeRecebida: 90, pedidoEm: '2026-10-15' },
    { codigo: '400', status: 'negociacao', quantidadeEsperada: 50 },
    { codigo: '100', status: 'pedido', quantidadeEsperada: 10 }] },
  { fornecedor: 'F2', data: ts(2026, 9, 1), itens: [{ codigo: '200', status: 'pedido', quantidadeEsperada: 30 }] }
];
const cart = N.carteira(cotacoes);
eq('carteira: soma os pedidos do codigo; data = pedidoEm (ou a da cotacao); fornecedor do mais recente',
  [cart['200'], cart['100'].em, cart['400']], [{ qtd: 120, em: '2026-10-15', fornecedor: 'F1', cotacoes: 2 }, '2026-10-01', undefined]);

const itensDocs = [
  { chave: 'A', numero: '10', dataEmissao: '2026-10-18', nomeEmitente: 'CERAMICA X', itens: [{ ean: '7899000000011', qtd: 40, ncm: '69072200' }, { ean: '7899000000035', qtd: 12, ncm: '69072100' }] },
  { chave: 'B', numero: '11', dataEmissao: '2026-10-20', nomeEmitente: 'CERAMICA X', itens: [{ ean: '7899000000011', qtd: 60, ncm: '69072200' }] },
  { chave: 'C', numero: '12', dataEmissao: '2026-10-10', nomeEmitente: 'CERAMICA X', itens: [{ ean: '7899000000011', qtd: 80, ncm: '69072200' }] },
  { chave: 'D', numero: '13', dataEmissao: '2026-10-01', nomeEmitente: 'CANCELADA', itens: [{ ean: '7899000000035', qtd: 99, ncm: '69072100' }] }
];
const notas = { C: { noSistema: true, noSistemaEm: '2026-10-14' }, D: { status: 'cancelada' } };
const mov = N.movimentos(itensDocs, notas);
eq('movimentos: faturado soma as notas sem entrada (data da mais recente); recebido = ultima entrada; cancelada fora',
  [mov['7899000000011'].faturado, mov['7899000000011'].recebido, mov['7899000000035'].faturado.qtd, mov['7899000000035'].recebido],
  [{ qtd: 100, em: '2026-10-20', fornecedor: 'CERAMICA X', numero: '11' }, { qtd: 80, em: '2026-10-14', fornecedor: 'CERAMICA X', numero: '12' }, 12, null]);

// ── O radar ──────────────────────────────────────────────────
const fichas = { '100': { fornecedor: 'DO MESTRE', custo: 20, venda: 30 }, '200': { fornecedor: 'CERAMICA X', custo: 25, venda: 40 }, '300': { fornecedor: 'CERAMICA X', custo: 10, venda: 15 } };
const base = { produtos: doc2.produtos, anterior: doc2.anterior, periodoDias: 60, fichas, carteira: cart, movimentos: mov, parametros: { coberturaDias: 30, baixoGiroMax: 0, compraMinima: 1 }, hoje: '2026-10-23' };
const linhas = N.calcularRadar(base);
const por = {}; linhas.forEach(l => { por[l.codigo] = l; });
eq('argamassa: 600 em 60 dias = 10/dia; alvo 300 - estoque 300 - carteira 10 = nada a comprar; cobertura 30 dias',
  [por['100'].mediaDia, por['100'].coberturaDias, por['100'].sugestao, por['100'].flags.comprar, por['100'].flags.chegando], [10, 30, 0, false, true]);
eq('piso X: 2/dia, alvo 60 - estoque 8 - carteira 120 - faturado 100 < 0: nada a comprar, chegando, cobertura 4 dias, variacao do estoque',
  [por['200'].sugestao, por['200'].flags.chegando, por['200'].coberturaDias, por['200'].estoqueAnterior, por['200'].recebido.em], [0, true, 4, 20, '2026-10-14']);
eq('piso novo: 0,5/dia, alvo 15 - estoque 0 - faturado 12 = 3 a comprar; sem ficha; fornecedor vem da nota',
  [por['400'].sugestao, por['400'].flags.comprar, por['400'].flags.semFicha, por['400'].fornecedor, por['400'].valorSugestao], [3, true, true, 'CERAMICA X', null]);
eq('asterisco: nunca sugere; baixo giro com valor parado (50 x 10)', [por['300'].sugestao, por['300'].flags.baixoGiro, por['300'].valorParado], [0, true, 500]);
eq('sem vendas no periodo e com estoque: cobertura sem numero (null)', por['300'].coberturaDias, null);
eq('contagem', (c => [c.comprar, c.chegando, c.baixoGiro, c.semFicha, c.valorParado, c.todos])(N.contar(linhas)), [1, 3, 1, 2, 500, 5]);
eq('compra minima corta a sugestao pequena', N.calcularRadar(Object.assign({}, base, { parametros: { coberturaDias: 30, baixoGiroMax: 0, compraMinima: 5 } })).find(l => l.codigo === '400').sugestao, 0);
eq('cobertura maior sugere mais: 90 dias para a argamassa = 900 - 300 - 10 = 590', N.calcularRadar(Object.assign({}, base, { parametros: { coberturaDias: 90 } })).find(l => l.codigo === '100').sugestao, 590);
// Sem as notas no caminho a marca manual vale; com faturado/carteira ela e' superada.
const comPedido = N.calcularRadar(Object.assign({}, base, { movimentos: {}, pedidos: { '400': { qtd: 5, em: '2026-10-20', ref: 'x' }, '500': { qtd: 1, em: '2026-07-01' } } }));
eq('pedido feito a mao tira da fila (e expira depois de 60 dias); faturado supera a marca',
  [comPedido.find(l => l.codigo === '400').flags.comprar, comPedido.find(l => l.codigo === '400').flags.pedidoFeito, comPedido.find(l => l.codigo === '500').flags.pedidoFeito,
   N.calcularRadar(Object.assign({}, base, { pedidos: { '400': { qtd: 5, em: '2026-10-20' } } })).find(l => l.codigo === '400').flags.pedidoFeito], [false, true, false, false]);
eq('filtro por aba, fornecedor e busca',
  [N.filtrar(linhas, { aba: 'comprar' }).map(l => l.codigo), N.filtrar(linhas, { aba: 'todos', fornecedor: 'CERAMICA X' }).length, N.filtrar(linhas, { termos: ['argamassa'] }).map(l => l.codigo)],
  [['400'], 3, ['100']]);
eq('ordem: comprar por valor sugerido; baixo giro por valor parado; resto por cobertura',
  [N.ordenar(N.filtrar(linhas, { aba: 'comprar' }), 'comprar')[0].codigo, N.ordenar(linhas, 'todos')[0].codigo, N.ordenar(N.filtrar(linhas, { aba: 'baixoGiro' }), 'baixoGiro')[0].codigo], ['400', '400', '300']);
eq('por fornecedor: valor somado, sem ficha agrupado',
  N.porFornecedor(N.filtrar(linhas, { aba: 'comprar' })).map(g => g.fornecedor + ':' + g.itens + ':' + g.valor), ['CERAMICA X:1:0']);
eq('por fornecedor: sem ficha e sem nota vai para o grupo proprio',
  N.porFornecedor([{ fornecedor: '', valorSugestao: 10 }, { fornecedor: 'F', valorSugestao: 5 }]).map(g => g.fornecedor + ':' + g.valor), ['Sem fornecedor (sem ficha):10', 'F:5']);
eq('planilha: uma linha por produto com as datas', (r => [r.length, r[0]['Pedido em'], r[1]['Recebido em']])(N.linhasExcel([por['100'], por['200']])), [2, '2026-10-01', '2026-10-14']);

// ── Relatorio "Produtos a Comprar" (completo) ─────────────────
{
  const cabC = ['Fornecedor', 'Ordem_Classe', 'Data_Inicial', 'Data_Final', 'Codigo', 'Nome', 'Codigo Barras', 'Qtde. Últ. Compra', 'Últ. Compra', 'Estoque', 'Vendas', 'V. Mensal', 'Sugestão', 'Pedido', 'C. NF-e', 'Total', 'Qtd. Vendas Feitas'];
  const mC = [cabC,
    ['CERAMICA X', 10000, '22/08/2026', '22/10/2026', '200', 'PISO X 60X60', '7899000000011', 100, '15/09/2026', 8, 120, 60, 52, null, 25, 1300, 12],
    ['DO MESTRE', 10020, '22/08/2026', '22/10/2026', '100', 'ARGAMASSA AC-1', '0700371770037', 500, '01/10/2026', 300, 600, 300, 0, null, 20, 0, 40],
    ['FORN GRANDE', 10002, '22/08/2026', '22/10/2026', '700', 'PORC 1 PEDIDO SO', '7899000000042', 50, '02/02/2026', 0, 400, 200, 200, null, 30, 6000, 1],
    ['FORN Z', 10007, '22/08/2026', '22/10/2026', '800', 'TINTA', '7899000000011', null, null, 2, 10, 5, 3, null, 9, 27, 5]
  ];
  const lC = N.lerPlanilhaVendas(mC);
  eq('relatorio completo: periodo lido das colunas (62 dias), fornecedor, classe, custo, ultima compra e vendas feitas',
    [lC.completo, lC.periodo, lC.itens[0].fornecedor, lC.itens[0].classe, lC.itens[0].custo, lC.itens[0].ultimaCompra, lC.itens[0].transacoes, lC.itens[3].ultimaCompra],
    [true, { ini: '2026-08-22', fim: '2026-10-22', dias: 62 }, 'CERAMICA X', '10000', 25, { em: '2026-09-15', qtd: 100, preco: 25 }, 12, null]);
  const docC = N.resumoVendas(lC.itens, '2026-10-23', 60, null, lC.periodo);
  eq('resumo completo: campos compactos e periodo do relatorio', [docC.periodoDias, docC.periodoIni, docC.produtos['200']], [62, '2026-08-22', { n: 'PISO X 60X60', e: '7899000000011', v: 120, r: 0, q: 8, f: 'CERAMICA X', k: '10000', c: 25, t: 12, ud: '2026-09-15', uq: 100 }]);
  const lin = N.calcularRadar({ produtos: docC.produtos, periodoDias: docC.periodoDias, fichas: { '100': { fornecedor: 'FICHA', custo: 99, venda: 30 } }, carteira: {}, movimentos: mov, parametros: { coberturaDias: 30, baixoGiroMax: 0, compraMinima: 1, minVendasFeitas: 3 }, hoje: '2026-10-23' });
  const pc = {}; lin.forEach(l => { pc[l.codigo] = l; });
  eq('fornecedor e custo vem do relatorio (a ficha so completa o preco de venda)', [pc['100'].fornecedor, pc['100'].custo, pc['100'].custoDe, pc['100'].venda], ['DO MESTRE', 20, 'última compra', 30]);
  eq('venda concentrada (1 venda feita): sugestao vai para Conferir, fora do Comprar', [pc['700'].concentrada, pc['700'].flags.comprar, pc['700'].flags.conferir, pc['700'].sugestao > 0], [true, false, true, true]);
  eq('barras repetido em dois produtos: nenhum ganha faturado/recebido, e a linha avisa', [pc['200'].eanRepetido, pc['200'].faturado, pc['800'].eanRepetido, pc['200'].flags.chegando], [true, null, true, false]);
  eq('ultima compra na linha', pc['200'].ultimaCompra, { em: '2026-09-15', qtd: 100, preco: 25 });
  eq('contagem separa comprar de conferir', (c => [c.comprar, c.conferir])(N.contar(lin)), [2, 1]);
  eq('pisos pela classe do relatorio entram no catalogo do Etiquetas (10000/10016/10002), tinta nao',
    (r => [r.novos, Object.keys(r.doc.porCodigo).sort()])(N.pisosParaEtiquetas(lC.itens, null, new Set(), '2026-10-23')), [2, ['200', '700']]);
}

// ── Etiquetas de carona ──────────────────────────────────────
const catalogo = { porCodigo: { '200': { n: 'PISO X 60X60', e: '7899000000011', q: 20 }, '999': { n: 'OUTRO', e: '', q: 3 } }, geradoEm: '2026-10-09', qtd: 2 };
const eans = N.eansComNcm(itensDocs, ['6907']);
eq('eans com NCM 6907 nas notas', [...eans].sort(), ['7899000000011', '7899000000035']);
const novo = N.pisosParaEtiquetas(lido.itens, catalogo, eans, '2026-10-23');
eq('catalogo: quem ja esta ganha o estoque do dia; piso novo entra pela nota; argamassa e sem-barras ficam de fora',
  [novo.atualizados, novo.novos, novo.doc.qtd, novo.doc.porCodigo['200'].q, novo.doc.porCodigo['400'], novo.doc.porCodigo['100'], novo.doc.porCodigo['999'].q, novo.doc.geradoEm],
  [1, 1, 3, 20, { n: 'PISO NOVO 80X80', e: '7899000000035', q: 0 }, undefined, 3, '2026-10-23']);

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
