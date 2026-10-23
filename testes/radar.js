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
    [div.partes.length > 1, div.partes.every(p => p.json.length <= 4200), div.meta.partes === div.partes.length, div.meta.produtos, div.meta.anterior],
    [true, true, true, undefined, undefined]);
  eq('partes e estoque anterior vao como texto JSON (nada indexado por dentro)', [typeof div.partes[0].json, Object.keys(div.partes[0]), div.meta.anteriorJson], ['string', ['json'], '{"c1":2}']);
  eq('juntar devolve o documento inteiro', (j => [Object.keys(j.produtos).length, j.importadoEm, j.produtos.c299.v, j.anterior, j.anteriorJson])(N.juntarResumo(div.meta, div.partes)), [300, '2026-10-23', 299, { c1: 2 }, undefined]);
  eq('formato antigo (mapa num documento so) continua lendo', N.juntarResumo({ importadoEm: 'x', anterior: { a: 1 } }, [{ produtos: { z: { v: 1 } } }]).produtos.z.v, 1);
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
eq('contagem', (c => [c.comprar, c.chegando, c.carteira, c.faturado, c.baixoGiro, c.semFicha, c.valorParado, c.todos])(N.contar(linhas)), [1, 3, 2, 2, 1, 2, 500, 5]);
// Carteira viva x entregue x antiga
{
  const movR = { '7899000000011': { faturado: null, recebido: { qtd: 100, em: '2026-10-20', fornecedor: 'X', numero: '1' } } };
  const cartR = { '200': { qtd: 50, em: '2026-10-15', fornecedor: 'F1', cotacoes: 1 }, '100': { qtd: 10, em: '2026-06-01', fornecedor: 'F1', cotacoes: 1 } };
  const r = N.calcularRadar(Object.assign({}, base, { carteira: cartR, movimentos: movR }));
  const q = {}; r.forEach(l => { q[l.codigo] = l; });
  eq('pedido com recebimento depois dele conta como entregue: fora de Chegando, nao desconta da compra',
    [q['200'].carteira.entregue, q['200'].flags.carteira, q['200'].flags.chegando], [true, false, false]);
  eq('pedido sem nota ha mais de 60 dias e antigo: fora de Chegando; argamassa volta a precisar de compra (alvo 300 - estoque 300 = 0, mas sem a carteira)',
    [q['100'].carteira.velho, q['100'].flags.chegando, q['100'].sugestao], [true, false, 0]);
  eq('o prazo de pedido antigo e parametro', N.calcularRadar(Object.assign({}, base, { carteira: cartR, movimentos: movR, parametros: { coberturaDias: 30, pedidoVelhoDias: 400 } })).find(l => l.codigo === '100').carteira.velho, false);
  eq('abas: so carteira e so faturado', [N.filtrar(linhas, { aba: 'carteira' }).map(l => l.codigo), N.filtrar(linhas, { aba: 'faturado' }).map(l => l.codigo)], [['100', '200'], ['200', '400']]);
}
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

// ── Cotacao x NF-e: status automatico ────────────────────────
{
  const cot = { id: 'c1', fornecedor: 'CERAMICA X LTDA', data: ts(2026, 10, 1), chavesNfe: [], itens: [
    { codigo: '200', codigoRecebido: 'FX-200', produto: 'PISO X 60X60', quantidadeEsperada: 100, status: 'pedido', pedidoEm: '2026-10-05' },
    { codigo: '201', codigoRecebido: '', produto: 'PISO Y 60X60', quantidadeEsperada: 50, status: 'pedido', pedidoEm: '2026-10-05' },
    { codigo: '202', codigoRecebido: '', produto: 'REVEST 33X60 LISO', quantidadeEsperada: 20, status: 'negociacao' },
    { codigo: '203', codigoRecebido: '', produto: 'OUTRA COISA', quantidadeEsperada: 5, status: 'pedido', pedidoEm: '2026-10-05' },
    { codigo: '204', codigoRecebido: 'FX-204', produto: 'JA RECEBIDO', quantidadeEsperada: 5, status: 'recebido', chaveNfe: 'OLD' }
  ] };
  const notasDocs = [
    { chave: 'N1', numero: '48157', dataEmissao: '2026-10-19', nomeEmitente: 'CERAMICA X LTDA.', itens: [
      { codigo: 'FX-200', ean: '7899000000011', descricao: 'PISO X 60X60 A', qtd: 100 },
      { codigo: 'Z', ean: '7899000000012', descricao: 'PISO Y 60X60 B', qtd: 50 },
      { codigo: 'Q', ean: '', descricao: 'REVEST 33X60 LISO BRANCO', qtd: 20 }] },
    { chave: 'N0', numero: '1', dataEmissao: '2026-09-01', nomeEmitente: 'CERAMICA X LTDA.', itens: [{ codigo: 'FX-200', ean: '7899000000011', descricao: 'PISO X 60X60 A', qtd: 999 }] },
    { chave: 'N2', numero: '2', dataEmissao: '2026-10-20', nomeEmitente: 'CERAMICA CAPRI', itens: [{ codigo: 'FX-200', ean: '7899000000011', descricao: 'PISO X 60X60 A', qtd: 7 }] }
  ];
  const estado = { N1: { noSistema: false } };
  const r = N.casarCotacaoComNotas(cot, notasDocs, estado, { '201': '7899000000012' }, '2026-10-23');
  eq('nomes compativeis: mesmo fornecedor com sufixo, outro fornecedor nao', [N.nomesCompativeis('CERAMICA X LTDA', 'CERAMICA X LTDA.'), N.nomesCompativeis('CERAMICA X', 'CERAMICA CAPRI')], [true, false]);
  eq('casa pelo codigo do fornecedor, pelas barras e pelo nome unico; outro fornecedor e nota anterior ao pedido ficam fora',
    r.itens.map(i => (i.status || '') + ':' + (i.numeroNfe || '-') + ':' + (i.casadoPor || '-')),
    ['transito:48157:código do fornecedor', 'transito:48157:código de barras', 'transito:48157:nome', 'pedido:-:-', 'recebido:-:-']);
  eq('faturadoEm e a emissao; negociacao que ganhou nota recebe pedidoEm da cotacao; a nota fica vinculada',
    [r.itens[0].faturadoEm, r.itens[0].qtdNfe, r.itens[2].pedidoEm, r.chavesNfe, r.mudou], ['2026-10-19', 100, '2026-10-01', ['N1'], true]);
  const r2 = N.casarCotacaoComNotas(Object.assign({}, cot, { itens: r.itens, chavesNfe: r.chavesNfe }), notasDocs, { N1: { noSistema: true, noSistemaEm: '2026-10-22' } }, {}, '2026-10-23');
  eq('a nota entrou no ERP: itens viram recebido com a data; nada e regravado sem mudanca depois',
    [r2.itens[0].status, r2.itens[0].recebidoEm, r2.mudou, N.casarCotacaoComNotas(Object.assign({}, cot, { itens: r2.itens, chavesNfe: r2.chavesNfe }), notasDocs, { N1: { noSistema: true, noSistemaEm: '2026-10-22' } }, {}, '2026-10-23').mudou],
    ['recebido', '2026-10-22', true, false]);
  eq('status nunca anda para tras (recebido manual continua recebido)', N.casarCotacaoComNotas({ fornecedor: 'CERAMICA X', data: ts(2026, 10, 1), itens: [{ codigo: '1', codigoRecebido: 'FX-200', produto: 'x', status: 'recebido' }] }, notasDocs, estado, {}, '2026-10-23').itens[0].status, 'recebido');
  // Faturamento parcial em duas notas, preco da nota e alertas
  const cotP = { fornecedor: 'CERAMICA X', data: ts(2026, 10, 1), itens: [
    { codigo: '300', codigoRecebido: 'FX-300', produto: 'PISO P', quantidadeEsperada: 100, precoRecebido: 10, status: 'pedido', pedidoEm: '2026-08-01' },
    { codigo: '301', codigoRecebido: 'FX-301', produto: 'PISO Q', quantidadeEsperada: 10, precoEsperado: 20, status: 'pedido', pedidoEm: '2026-08-01' }] };
  const notasP = [
    { chave: 'P1', numero: '11', dataEmissao: '2026-10-10', nomeEmitente: 'CERAMICA X', itens: [{ codigo: 'FX-300', qtd: 40, vUnit: 11 }] },
    { chave: 'P2', numero: '12', dataEmissao: '2026-10-15', nomeEmitente: 'CERAMICA X', itens: [{ codigo: 'FX-300', qtd: 30, vUnit: 11 }] }
  ];
  const rp = N.casarCotacaoComNotas(cotP, notasP, { P1: { noSistema: true, noSistemaEm: '2026-10-12' } }, {}, '2026-10-23');
  eq('parcial: soma as notas (70 de 100), fica em transito mesmo com uma recebida, guarda as duas NF e o preco da nota',
    [rp.itens[0].status, rp.itens[0].qtdNfe, rp.itens[0].parcial, rp.itens[0].notasNfe.map(x => x.numero), rp.itens[0].precoNfe, rp.chavesNfe.slice().sort()],
    ['transito', 70, { faturado: 70, pedido: 100 }, ['12', '11'], 11, ['P1', 'P2']]);
  eq('carteira: o que faltou faturar continua em carteira (30), e o pedido sem nota inteiro (10)',
    (c => [c['300'].qtd, c['301'].qtd])(N.carteira([Object.assign({}, cotP, { itens: rp.itens })])), [30, 10]);
  eq('preco da NF contra o cotado: +10%', Math.round(N.diferencaPrecoNfe(rp.itens[0]) * 1000) / 1000, 0.1);
  eq('alertas: pedido sem nota ha mais de 60 dias, 1 parcial, 1 preco acima',
    N.alertasDaCotacao(Object.assign({}, cotP, { itens: rp.itens }), '2026-10-23', 60), { semNota: { itens: 1, dias: 83 }, parciais: 1, precoAcima: 1, precoAbaixo: 0 });
  const rp2 = N.casarCotacaoComNotas(Object.assign({}, cotP, { itens: rp.itens, chavesNfe: rp.chavesNfe }), notasP.concat([{ chave: 'P3', numero: '13', dataEmissao: '2026-10-20', nomeEmitente: 'CERAMICA X', itens: [{ codigo: 'FX-300', qtd: 30, vUnit: 11 }] }]), { P1: { noSistema: true }, P2: { noSistema: true }, P3: { noSistema: true, noSistemaEm: '2026-10-22' } }, {}, '2026-10-23');
  eq('terceira nota completa o pedido e tudo recebido: fecha como recebido na ultima entrada', [rp2.itens[0].status, rp2.itens[0].parcial, rp2.itens[0].recebidoEm, rp2.itens[0].qtdNfe], ['recebido', null, '2026-10-22', 100]);

  const pf = N.pedidoFeitoNaCotacao({ itens: [{ status: 'negociacao' }, { status: 'pedido' }, { status: 'transito' }] }, '2026-10-23');
  eq('pedido feito: negociacao vira pedido com a data; pedido sem data ganha a data; o resto fica', pf.map(i => i.status + ':' + (i.pedidoEm || '-')), ['pedido:2026-10-23', 'pedido:2026-10-23', 'transito:-']);
  eq('pedido feito sem nada a mudar devolve null', N.pedidoFeitoNaCotacao({ itens: [{ status: 'transito' }] }, '2026-10-23'), null);
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
