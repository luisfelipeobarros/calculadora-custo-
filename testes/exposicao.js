/*
  Aba Exposicao do Etiquetas (exposicao-nucleo.js): o mapa dos
  expositores com as correcoes combinadas e o cadastro do que esta'
  em cada um. Dados inventados.
*/
const App = require('../app-shared.js');
const X = require('../exposicao-nucleo.js');

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => {
  const va = JSON.stringify(a), vb = JSON.stringify(b);
  va === vb ? ok(t) : erro(t + ' — esperava ' + vb + ', veio ' + va);
};

// ── O desenho ────────────────────────────────────────────────
const por = {};
X.EXPOSITORES.forEach(p => { (por[p.id] = por[p.id] || []).push(p); });
const um = (id) => { if (!por[id] || por[id].length !== 1) throw new Error(id + ' deveria ter um pedaco'); return por[id][0]; };
const dir = (p) => p.x + p.w, baixo = (p) => p.y + p.h;

eq('todos os expositores do mapa estao no desenho (A, B, C, D, E, F, P)', X.ids().length, 1 + 2 + 21 + 1 + 21 + 9 + 11);
eq('D1 e C20 sao um expositor em mais de um pedaco', [por.D1.length, por.C20.length], [4, 2]);
eq('tudo dentro do viewBox', X.EXPOSITORES.every(p => p.x >= 0 && p.y >= 0 && dir(p) <= X.VIEWBOX.w && baixo(p) <= X.VIEWBOX.h), true);
{
  // O "L" (E16/E17 em pe', E18 deitado) abraca P6, P7, P8-P11 e P4.
  const e16 = um('E16'), e18 = um('E18');
  const dentro = (id) => { const p = um(id); return p.x >= dir(e16) && baixo(p) <= e18.y && dir(p) <= dir(e18) && p.y >= e16.y; };
  eq('o L abraca P6, P7, P10, P11, P8, P9 e P4', ['P6', 'P7', 'P10', 'P11', 'P8', 'P9', 'P4'].map(dentro), [true, true, true, true, true, true, true]);
  eq('P1, P2, P3 e P5 ficam fora do L (em cima)', ['P1', 'P2', 'P3', 'P5'].map(id => baixo(um(id)) <= e16.y), [true, true, true, true]);
  eq('P4 termina na altura do P7', Math.abs(baixo(um('P4')) - baixo(um('P7'))) <= 1, true);
}
eq('F8 fica ao lado do F2', (f2 => { const f8 = um('F8'); return f8.x - dir(f2) < 1 && f8.y === f2.y; })(um('F2')), true);
eq('F5 e F4 continuam o E19 (mesma coluna, abaixo)', (e19 => ['F5', 'F4'].every(id => um(id).x === e19.x && um(id).y >= baixo(e19)))(um('E19')), true);
eq('F9 vem depois do E15 (mesma coluna, abaixo)', (e15 => um('F9').x === e15.x && um('F9').y >= baixo(e15))(um('E15')), true);
eq('F7 e F6 fecham a loja embaixo (a linha mais baixa, lado a lado)', (() => {
  const f7 = um('F7'), f6 = um('F6');
  const maisBaixo = Math.max(...X.EXPOSITORES.map(baixo));
  return baixo(f7) === maisBaixo && baixo(f6) === maisBaixo && f6.x >= dir(f7);
})(), true);
eq('ordem natural dos codigos (E2 antes de E10, letras em ordem)', X.ordenarIds(['E10', 'P4', 'E2', 'C1']), ['C1', 'E2', 'E10', 'P4']);
eq('familia pela letra', [X.familiaDe('E16').cor, X.familiaDe('P4').cor, X.familiaDe('Z9').nome], ['#FFC000', '#ED7D31', '?']);

// ── O SVG ────────────────────────────────────────────────────
{
  const svg = X.svgMapa({ destaque: ['E16'], selecionado: 'P4', contagem: { E16: 2 } });
  eq('svg: um grupo clicavel por expositor, com o rotulo', [(svg.match(/data-ex="/g) || []).length, svg.includes('>E16</text>'), svg.includes('>D1</text>')], [X.ids().length, true, true]);
  eq('svg: destaque, selecao e vazio como classes', [/class="ex ativo[^"]*com-produtos"[^>]*data-ex="E16"/.test(svg), /class="ex sel[^"]*"[^>]*data-ex="P4"/.test(svg), /class="ex[^"]*vazio"[^>]*data-ex="C1"/.test(svg)], [true, true, true]);
  eq('svg: com destaque, o resto fica apagado; sem destaque, ninguem', [/apagado[^>]*data-ex="C1"/.test(svg), X.svgMapa({}).includes('apagado')], [true, false]);
  eq('svg: area de toque maior que o desenho', (svg.match(/class="ex-hit"/g) || []).length, X.EXPOSITORES.length);
  eq('svg: escapa o id', X.svgMapa({ destaque: ['<x>'] }).includes('<x>'), false);
}

// ── Cadastro ─────────────────────────────────────────────────
const catalogo = { porCodigo: { '100': { n: 'PISO BEGE 60X60', e: '7899000000011' }, '101': { n: 'PISO CINZA 60X60', e: '' }, '200': { n: 'ARGAMASSA AC2', e: '7899000000028' } },
  porEan: { '7899000000011': { codigo: '100', nome: 'PISO BEGE 60X60' }, '7899000000028': { codigo: '200', nome: 'ARGAMASSA AC2' } } };
eq('texto -> produto: codigo do catalogo', X.produtoDoTexto('100', catalogo), { codigo: '100', nome: 'PISO BEGE 60X60', ean: '7899000000011', origem: 'codigo' });
eq('texto -> produto: barras do catalogo', X.produtoDoTexto('7899000000028', catalogo), { codigo: '200', nome: 'ARGAMASSA AC2', ean: '7899000000028', origem: 'barras' });
eq('texto -> produto: nome livre e codigo fora do catalogo', [X.produtoDoTexto('Rejunte branco', catalogo), X.produtoDoTexto('999', catalogo), X.produtoDoTexto('  ', catalogo)],
  [{ codigo: '', nome: 'Rejunte branco', ean: '', origem: 'texto' }, { codigo: '999', nome: '', ean: '', origem: 'texto' }, null]);
eq('sugestoes: prefixo do codigo ou palavras do nome', [X.sugestoes(catalogo, '10').map(s => s.codigo), X.sugestoes(catalogo, 'piso cinza').map(s => s.codigo), X.sugestoes(catalogo, 'piso', 1).length], [['100', '101'], ['101'], 1]);
let doc = { produtos: [] };
let r1 = X.adicionar(doc, X.produtoDoTexto('200', catalogo), '2026-10-28');
let r2 = X.adicionar({ produtos: r1.produtos }, X.produtoDoTexto('100', catalogo), '2026-10-28');
eq('adicionar: entra com a data, em ordem de nome', r2.produtos.map(p => p.nome + '|' + p.desde), ['ARGAMASSA AC2|2026-10-28', 'PISO BEGE 60X60|2026-10-28']);
eq('adicionar: o mesmo produto nao entra duas vezes (por codigo ou por barras)',
  [X.adicionar({ produtos: r2.produtos }, X.produtoDoTexto('100', catalogo)).mudou, X.adicionar({ produtos: r2.produtos }, { codigo: '', ean: '7899000000011', nome: 'OUTRO NOME' }).mudou], [false, true]);
eq('remover pela chave', X.remover({ produtos: r2.produtos }, 'c:200').produtos.map(p => p.codigo), ['100']);

// ── Onde esta' e busca ───────────────────────────────────────
const docs = { E16: { produtos: r2.produtos }, F3: { produtos: [{ codigo: '100', nome: 'PISO BEGE 60X60', ean: '7899000000011' }, { codigo: '', nome: 'Rejunte branco', ean: '' }] }, E2: { produtos: [] } };
const onde = X.ondeEsta(docs);
eq('onde esta: por codigo e por barras, em ordem', [onde.porCodigo['100'], onde.porEan['7899000000011'], onde.porCodigo['200'], onde.porNome['rejunte branco']], [['E16', 'F3'], ['E16', 'F3'], ['E16'], ['F3']]);
eq('texto do onde: junta codigo e barras sem repetir', [X.textoOnde(onde, '100', '7899000000011'), X.textoOnde(onde, '', '7899000000028'), X.textoOnde(onde, '999', ''), X.textoOnde(null, '100', '')], ['E16, F3', 'E16', '', '']);
eq('busca: por nome, por prefixo do codigo, por barras e pelo expositor', [
  X.buscar(docs, 'piso bege').map(a => a.expositores.join(',')),
  X.buscar(docs, '20').map(a => a.codigo),
  X.buscar(docs, '78990000000').map(a => a.codigo),
  X.buscar(docs, 'f3').map(a => a.nome)
], [['E16,F3'], ['200'], ['200', '100'], ['PISO BEGE 60X60', 'Rejunte branco']]);
eq('busca vazia nao devolve nada', X.buscar(docs, '  '), []);
eq('contagem por expositor', X.contagem(docs), { E16: 2, F3: 2, E2: 0 });
{
  const cat = { porCodigo: { '100': { n: 'PISO BEGE 60X60', e: '7899000000011', q: 41.04 }, '200': { n: 'ARGAMASSA AC2', e: '', q: 0 }, '300': { n: 'SEM ESTOQUE', e: '' } },
    porEan: { '7899000000011': { codigo: '100', nome: 'PISO BEGE 60X60', qtd: 41.04 } } };
  eq('estoque do catalogo: pelo codigo, pelas barras, zero e desconhecido',
    [X.estoqueDe(cat, { codigo: '100' }), X.estoqueDe(cat, { codigo: '', ean: '7899000000011' }), X.estoqueDe(cat, { codigo: '200' }), X.estoqueDe(cat, { codigo: '300' }), X.estoqueDe(cat, { codigo: '', nome: 'Rejunte' }), X.estoqueDe(null, { codigo: '100' })],
    [41.04, 41.04, 0, null, null, null]);
}

// ── Layout editavel ──────────────────────────────────────────
{
  const chaves = X.chavesPecas();
  eq('cada peca tem chave propria (D1 tem quatro)', [new Set(chaves).size === chaves.length, chaves.filter(c => c.startsWith('D1#'))], [true, ['D1#0', 'D1#1', 'D1#2', 'D1#3']]);
  const base = X.comLayout(null);
  eq('sem override, o layout e o desenho original com a chave em cada peca', [base.length, base[0].chave, base.find(p => p.chave === 'E16#0').x], [X.EXPOSITORES.length, 'A1#0', 23]);
  let ov = X.ajustarPeca({ pecas: {} }, 'E16#0', { dx: 1.3, dy: -0.2 });
  eq('ajustar: move na grade de 0,5 e guarda so a peca mexida', [ov.pecas['E16#0'], Object.keys(ov.pecas)], [{ x: 24.5, y: 79, w: 3, h: 14, rot: 0 }, ['E16#0']]);
  ov = X.ajustarPeca(ov, 'E16#0', { dw: -5, dh: 100, drot: 7 });
  eq('ajustar: lado minimo, nao sai do viewBox e giro em passos de 5', ov.pecas['E16#0'], { x: 24.5, y: 79, w: 1.5, h: X.VIEWBOX.h - 79, rot: 5 });
  eq('ajustar peca desconhecida nao muda nada', X.ajustarPeca(ov, 'Z9#0', { dx: 1 }), ov);
  eq('o override entra no layout sem alterar o desenho original', [X.comLayout(ov).find(p => p.chave === 'E16#0').w, X.EXPOSITORES.find(p => p.id === 'E16').w, X.pecasEditadas(ov)], [1.5, 3, 1]);
  eq('restaurar a peca apaga so ela', X.pecasEditadas(X.restaurarPeca(ov, 'E16#0')), 0);
  const svg = X.svgMapa({ expositores: X.comLayout(ov), edicao: true, pecaSel: 'E16#0' });
  eq('svg em edicao: pecas com data-peca, a selecionada com o puxador de tamanho', [(svg.match(/data-peca="/g) || []).length, (svg.match(/data-puxador="E16#0"/g) || []).length, svg.includes('peca-sel')], [X.EXPOSITORES.length * 2, 1, true]);
  eq('svg fora da edicao: sem puxador', X.svgMapa({}).includes('data-puxador'), false);
}

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
