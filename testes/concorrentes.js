/*
  Catalogo da pesquisa em lote por planilha (aba Concorrentes).

  Cobre os dez pontos obrigatorios do pedido: cabecalho tolerante,
  preco com sujeira de float, linha ruim contada (nunca engolida),
  consulta de busca sem a notacao interna, fabricante SEM
  agrupamento automatico, contagem de buscas, painel por fabricante
  (incluindo "nunca pesquisado" = todos desatualizados), a
  serializacao do catalogo, o comparativo da substituicao e o
  motivo "preco mudou" vencendo o "passou do prazo".
*/
const App = require('../app-shared.js');
const C = require('../concorrentes-nucleo.js');

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => {
  const va = JSON.stringify(a), vb = JSON.stringify(b);
  va === vb ? ok(t) : erro(t + ' — esperava ' + vb + ', veio ' + va);
};

// ── 1. Cabecalho: ordem, acento e caixa nao importam ─────────

const CAB = ['Código Produto', 'Nome Produto', 'Unidade de Venda', 'Preço de Venda', 'Fabricante/Fornecedor'];

{
  const r = C.lerCatalogo([CAB, ['840', 'PISO A', 'M²', '36.9', 'CERAL']]);
  eq('cabecalho padrao lido', r.itens.length, 1);
  eq('  ...com todos os campos', [r.itens[0].codigo, r.itens[0].fabricante], ['840', 'CERAL']);
}
{
  // Ordem trocada + caixa/acento diferentes.
  const r = C.lerCatalogo([
    ['FABRICANTE/FORNECEDOR', 'preco de venda', 'nome produto', 'codigo produto'],
    ['CERAL', '36,90', 'PISO A', '840']
  ]);
  eq('colunas fora de ordem e sem acento tambem funcionam',
    [r.itens[0].codigo, r.itens[0].precoCent, r.itens[0].fabricante], ['840', 3690, 'CERAL']);
}
{
  // "Código Produto" contem "produto": codigo tem prioridade e o nome
  // nao rouba a coluna errada.
  const r = C.lerCatalogo([CAB, ['77', 'REVEST X', 'M²', '10', 'KARINA']]);
  eq('a coluna de codigo nao e confundida com a de nome', r.itens[0].nome, 'REVEST X');
}
eq('sem cabecalho reconhecivel -> erro explicito, nao catalogo vazio',
  !!C.lerCatalogo([['a', 'b'], ['c', 'd']]).erro, true);
eq('sem coluna de codigo -> erro explicito (o codigo e a chave de tudo)',
  !!C.lerCatalogo([['Nome Produto', 'Preço de Venda'], ['X', '10']]).erro, true);

// ── 2. Preco: sujeira de float e virgula decimal ─────────────

eq('64.900000000000006 vira 64,90 em centavos', C.precoParaCentavos('64.900000000000006'), 6490);
eq('virgula decimal aceita', C.precoParaCentavos('36,90'), 3690);
eq('1.234 (milhar sem centavos) e R$ 1.234, nao R$ 1,23',
  C.precoParaCentavos('1.234'), 123400);
eq('preco vazio -> null', C.precoParaCentavos(''), null);
eq('preco zero nao vale (nao ha venda a zero)', C.precoParaCentavos('0'), null);

// ── 3. Linha ruim e contada, nunca engolida ──────────────────

{
  const r = C.lerCatalogo([CAB,
    ['840', 'PISO A', 'M²', '36.9', 'CERAL'],
    ['841', '', 'M²', '10', 'CERAL'],          // sem nome
    ['842', 'PISO B', 'M²', '', 'CERAL'],      // sem preco
    ['', 'PISO C', 'M²', '10', 'CERAL'],       // sem codigo
    ['840', 'PISO A DE NOVO', 'M²', '40', 'CERAL'] // codigo repetido
  ]);
  eq('so a linha completa (e inedita) entra', r.itens.length, 1);
  eq('as quatro ruins sao contadas com motivo',
    r.ignoradas.map(i => i.motivo), ['sem nome', 'sem preço', 'sem código', 'código repetido']);
  eq('  ...com o numero da linha da planilha', r.ignoradas[0].linha, 3);
  eq('no codigo repetido, a PRIMEIRA linha vale', r.itens[0].precoCent, 3690);
}

// Sinonimo guloso: "Código de Barras" nao pode virar a chave, nem
// "Preço de Custo" virar o preco de venda.
{
  const r = C.lerCatalogo([
    ['Código de Barras', 'Código Produto', 'Nome Produto', 'Preço de Custo', 'Preço de Venda'],
    ['789100012345', '840', 'PISO A', '20,00', '36,90']
  ]);
  eq('"Código de Barras" nao rouba a coluna de codigo', r.itens[0].codigo, '840');
  eq('"Preço de Custo" nao rouba o preco de venda', r.itens[0].precoCent, 3690);
}

// ── 4. Consulta de busca sem a notacao interna ───────────────

{
  const nome = '*REVEST ARABESCO CZ HD 32X57 A (CX2,22MT)CERAL';
  const r = C.lerCatalogo([CAB, ['840', nome, 'M²', '36.9', 'CERAL']]);
  eq('a consulta perde o * e o (CX...)',
    r.itens[0].consulta, 'REVEST ARABESCO CZ HD 32X57 A CERAL');
  eq('  ...e o nome original fica INTACTO para exibir e salvar',
    r.itens[0].nome, nome);
}
eq('consulta sem notacao nenhuma fica igual ao nome',
  C.consultaDeBusca('PISO 46X46 BRANCO'), 'PISO 46X46 BRANCO');

// ── 5. Fabricante como esta na coluna, sem juntar parecidos ──

{
  const r = C.lerCatalogo([CAB,
    ['1', 'A', 'M²', '10', 'CERAL'],
    ['2', 'B', 'M²', '10', 'Ceral Porc'],
    ['3', 'C', 'M²', '10', 'STELLA'],
    ['4', 'D', 'M²', '10', 'B Stella']
  ]);
  const painel = C.painelFabricantes(r.itens, {}, '2026-08-12', 30);
  eq('quatro grafias = quatro fabricantes na tela (variacao e SINAL, nao ruido)',
    painel.map(g => g.fabricante).sort(),
    ['B Stella', 'CERAL', 'Ceral Porc', 'STELLA']);
}

// ── 6. Contagem de buscas ────────────────────────────────────

eq('42 produtos x 6 lojas = 252 buscas', C.contarBuscas(42, 6), 252);

// ── 7 e 10. Painel por fabricante e os TRES motivos ──────────

const catalogo = [
  { codigo: '1', nome: 'A', precoCent: 1000, fabricante: 'CERAL' },
  { codigo: '2', nome: 'B', precoCent: 2000, fabricante: 'CERAL' },
  { codigo: '3', nome: 'C', precoCent: 3000, fabricante: 'PAMESA' },
  { codigo: '4', nome: 'D', precoCent: 4000, fabricante: 'KARINA' }
];
const ultimas = {
  '1': { data: '2026-08-10', meuPrecoCent: 1000 },  // fresca e com preco igual: em dia
  '2': { data: '2026-08-11', meuPrecoCent: 1900 },  // fresca MAS o preco mudou
  '3': { data: '2026-06-01', meuPrecoCent: 3000 }   // passou do prazo
  // '4' nunca pesquisado
};

{
  const st1 = C.statusProduto(catalogo[0], ultimas['1'], '2026-08-12', 30);
  const st2 = C.statusProduto(catalogo[1], ultimas['2'], '2026-08-12', 30);
  const st3 = C.statusProduto(catalogo[2], ultimas['3'], '2026-08-12', 30);
  const st4 = C.statusProduto(catalogo[3], undefined, '2026-08-12', 30);
  eq('em dia -> sem motivo', st1.motivo, null);
  eq('pesquisa de ONTEM com preco mudado -> desatualizado por PRECO (nao por prazo)',
    st2.motivo, 'preco');
  eq('velha alem do prazo -> motivo prazo', st3.motivo, 'prazo');
  eq('nunca pesquisado -> motivo nunca', st4.motivo, 'nunca');
}

{
  const painel = C.painelFabricantes(catalogo, ultimas, '2026-08-12', 30);
  const ceral = painel.find(g => g.fabricante === 'CERAL');
  const karina = painel.find(g => g.fabricante === 'KARINA');
  const pamesa = painel.find(g => g.fabricante === 'PAMESA');
  eq('CERAL: 1 de 2 desatualizado, pelo preco',
    [ceral.desatualizados, ceral.motivos.preco], [1, 1]);
  eq('CERAL: ultima pesquisa e a mais recente do grupo', ceral.ultimaData, '2026-08-11');
  eq('KARINA nunca pesquisada: TODOS desatualizados, nunca zero',
    [karina.desatualizados, karina.qtd, karina.ultimaData], [1, 1, null]);
  eq('PAMESA: desatualizada por prazo', pamesa.motivos.prazo, 1);
  eq('ordenacao: 100% desatualizados vem antes de 50%',
    painel[painel.length - 1].fabricante, 'CERAL');
}

// ── 8. O catalogo sobrevive a serializacao (localStorage) ────

{
  const r = C.lerCatalogo([CAB, ['840', '*PISO (CX2,00MT)X', 'M²', '64.900000000000006', 'CERAL']]);
  const idaEVolta = JSON.parse(JSON.stringify({ importadoEm: '2026-08-12', itens: r.itens }));
  eq('serializar e reler nao perde nada',
    idaEVolta.itens[0], r.itens[0]);
  eq('  ...e o preco continua centavo inteiro', idaEVolta.itens[0].precoCent, 6490);
}

// ── 9. Comparativo da substituicao ───────────────────────────

{
  const antigo = [
    { codigo: '1', nome: 'A', precoCent: 1000 },
    { codigo: '2', nome: 'B', precoCent: 2000 },
    { codigo: '3', nome: 'C', precoCent: 3000 },
    { codigo: '4', nome: 'D', precoCent: 4000 }
  ];
  const novo = [
    { codigo: '1', nome: 'A', precoCent: 1000 },   // igual
    { codigo: '2', nome: 'B', precoCent: 2500 },   // mudou preco
    { codigo: '3', nome: 'C novo', precoCent: 3000 }, // mudou SO o nome
    { codigo: '5', nome: 'E', precoCent: 5000 }    // novo ('4' saiu)
  ];
  const d = C.diffCatalogos(antigo, novo);
  eq('resumo: 1 novo, 1 saiu, 2 mudaram, 1 igual',
    [d.novos.length, d.sairam.length, d.mudaram.length, d.iguais], [1, 1, 2, 1]);
  eq('quem saiu', d.sairam[0].codigo, '4');
  const m2 = d.mudaram.find(m => m.codigo === '2');
  const m3 = d.mudaram.find(m => m.codigo === '3');
  eq('mudanca de preco marcada com de/para',
    [m2.mudouPreco, m2.precoDeCent, m2.precoParaCent], [true, 2000, 2500]);
  eq('mesmo codigo com nome novo tambem conta como mudanca',
    [m3.mudouNome, m3.mudouPreco], [true, false]);
}

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
