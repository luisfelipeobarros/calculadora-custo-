/*
  Nucleo da aba Exposicao do Etiquetas (etiquetas.html) — 28/10/2026.

  O mapa dos expositores da loja e o cadastro "o que esta' em cada um".
  - EXPOSITORES: o desenho, em unidades do viewBox (0..92 x 0..132),
    copiado do mapa da loja com as correcoes combinadas: o "L" de
    E16/E17/E18 abraca P6, P7, P8-P11 e P4 (P1-P3 e P5 ficam fora); F8
    ao lado de F2; F7 e F6 fecham a loja embaixo; F5 e F4 continuam o
    E19; F9 vem depois do E15; P4 termina na altura do P7.
    Um expositor pode ter mais de um pedaco (D1, C20): mesmo id.
  - Documentos da colecao `exposicao`: um por expositor (id = codigo do
    expositor), { produtos: [{ codigo, nome, ean, desde }] }. So' lista,
    sem quantidade.

  Puro: devolve o SVG como texto, busca, "onde esta'" e as listas novas.
  Nada de Firebase nem DOM.
*/
(function (global) {
  'use strict';

  var App = (typeof module === 'object' && module.exports)
    ? require('./app-shared.js')
    : global.App;
  if (!App || !App.normalizarTexto) {
    throw new Error('exposicao-nucleo.js precisa de app-shared.js carregado antes.');
  }
  var norm = App.normalizarTexto;
  var e = App.escapeHtml;
  function soDigitos(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

  var VIEWBOX = { w: 92, h: 132 };

  // Cor por familia (a letra do codigo), como no mapa da loja.
  var FAMILIAS = {
    A: { cor: '#FFFFFF', texto: '#000', nome: 'A' },
    B: { cor: '#5B9BD5', texto: '#fff', nome: 'B' },
    C: { cor: '#70AD47', texto: '#000', nome: 'C' },
    D: { cor: '#262626', texto: '#fff', nome: 'D' },
    E: { cor: '#FFC000', texto: '#000', nome: 'E' },
    F: { cor: '#7F7F7F', texto: '#fff', nome: 'F' },
    P: { cor: '#ED7D31', texto: '#000', nome: 'P' }
  };

  function r(id, x, y, w, h, rot) { return { id: id, x: x, y: y, w: w, h: h, rot: rot || 0 }; }
  var EXPOSITORES = [
    // Entrada / parede de cima, lado esquerdo
    r('A1', 14, 2, 14, 7, -10),
    r('B1', 24, 12, 3, 12), r('B2', 24, 27, 3, 12),
    r('D1', 15, 44, 2.5, 14), r('D1', 20, 45.5, 11, 2.5, 20), r('D1', 20, 50.5, 11, 2.5, 20), r('D1', 18, 58, 15, 2.5),
    // Lado direito de cima
    r('C15', 44, 5, 3, 13), r('C16', 44, 21, 3, 13), r('C17', 44, 37, 3, 13),
    r('C1', 50, 4, 20, 2.4), r('C2', 50, 7.4, 20, 2.4), r('C3', 50, 10.8, 20, 2.4), r('C4', 50, 14.2, 20, 2.4),
    r('C5', 50, 17.6, 20, 2.4), r('C6', 50, 21, 20, 2.4), r('C7', 50, 24.4, 20, 2.4), r('C8', 50, 27.8, 20, 2.4),
    r('C9', 50, 31.2, 20, 2.4), r('C10', 50, 34.6, 20, 2.4), r('C11', 50, 38, 20, 2.4), r('C12', 50, 41.4, 20, 2.4),
    r('C13', 50, 44.8, 20, 2.4), r('C14', 50, 48.2, 20, 2.4),
    r('P1', 75, 4, 3, 46), r('P2', 80, 4, 3, 46), r('P3', 85, 4, 3, 46),
    // Meio
    r('C18', 44, 55, 3, 16), r('C19', 50, 55, 3, 16),
    r('P5', 57, 56, 3, 18),
    r('C20', 61.5, 56, 2, 15), r('C20', 61.5, 71, 9, 2),
    r('C21', 67, 58, 2, 13),
    // Bloco E (amarelo), embaixo a' esquerda
    r('F1', 11, 76, 8, 2.5),
    r('E1', 2, 77, 2.8, 42),
    r('E2', 8, 79, 3, 7.5), r('E3', 8, 88, 3, 7.5), r('E4', 8, 97, 3, 7.5), r('E5', 8, 106, 3, 7.5), r('E6', 8, 115, 3, 7.5),
    r('E7', 13, 79, 3, 7.5), r('E8', 13, 88, 3, 7.5), r('E9', 13, 97, 3, 7.5), r('E10', 13, 106, 3, 7.5), r('E11', 13, 115, 3, 7.5),
    r('E12', 18, 79, 3, 7.5), r('E13', 18, 88, 3, 7.5), r('E14', 18, 97, 3, 7.5), r('E15', 18, 106, 3, 7.5),
    r('F9', 18, 115, 3, 6),
    r('F2', 2, 121, 2.8, 6), r('F8', 5.3, 121, 2.5, 6),
    // O "L": E16 e E17 em pe', E18 deitado — abraca os P
    r('E16', 23, 79, 3, 14), r('E17', 23, 94, 3, 14), r('E18', 23, 109, 34, 2.8),
    r('P6', 29, 80, 3, 15), r('P7', 29, 96, 3, 12),
    r('P10', 35, 81, 3.5, 6), r('P8', 40, 81, 3.5, 6), r('P11', 35, 89, 3.5, 6), r('P9', 40, 89, 3.5, 6),
    r('P4', 46, 80, 3, 28),
    // Fim do E18 e o fecho da loja
    r('E19', 58, 105, 3, 14),
    r('F3', 49, 115, 8, 2.5),
    r('F5', 58, 120, 3, 3.5), r('F4', 58, 124, 3, 3.5),
    r('E21', 23, 114, 3, 8), r('E20', 28, 114, 3, 8),
    r('F7', 2, 128.5, 27, 2.5), r('F6', 30, 128.5, 31, 2.5)
  ];

  // ---- Layout editavel ----
  // O desenho do codigo e' o ponto de partida; o que a loja arrastou
  // fica em config/exposicaoMapa como { pecas: { 'E16#0': {x,y,w,h,rot} } }.
  // Chave da peca: id + '#' + indice do pedaco (D1 tem quatro).
  var GRADE = 0.5, MIN_LADO = 1.5;
  function chavesPecas(lista) {
    var cont = {};
    return (lista || EXPOSITORES).map(function (p) {
      var k = cont[p.id] || 0; cont[p.id] = k + 1;
      return p.id + '#' + k;
    });
  }
  function arred(v) { return Math.round(v / GRADE) * GRADE; }
  function limitar(p) {
    var q = Object.assign({}, p);
    // Tamanho na grade e no minimo; esticar alem da borda corta o tamanho,
    // mover alem da borda encosta nela.
    q.w = Math.max(MIN_LADO, arred(q.w)); q.h = Math.max(MIN_LADO, arred(q.h));
    q.x = Math.max(0, arred(q.x)); q.y = Math.max(0, arred(q.y));
    q.w = Math.min(q.w, VIEWBOX.w - q.x); q.h = Math.min(q.h, VIEWBOX.h - q.y);
    q.x = Math.min(q.x, VIEWBOX.w - q.w); q.y = Math.min(q.y, VIEWBOX.h - q.h);
    q.rot = Math.round((q.rot || 0) / 5) * 5;
    if (q.rot <= -180) q.rot += 360; if (q.rot > 180) q.rot -= 360;
    return q;
  }
  // Lista de pecas com o que foi editado por cima do desenho original.
  function comLayout(override) {
    var pecas = (override && override.pecas) || {};
    var chaves = chavesPecas();
    return EXPOSITORES.map(function (p, i) {
      var o = pecas[chaves[i]];
      var q = Object.assign({}, p, { chave: chaves[i] });
      if (o) { ['x', 'y', 'w', 'h', 'rot'].forEach(function (c) { if (o[c] != null && isFinite(Number(o[c]))) q[c] = Number(o[c]); }); }
      return q;
    });
  }
  function pecaAtual(override, chave) {
    var lista = comLayout(override);
    for (var i = 0; i < lista.length; i++) if (lista[i].chave === chave) return lista[i];
    return null;
  }
  // Devolve o override novo (sem mexer no de entrada) com a peca ajustada.
  function ajustarPeca(override, chave, delta) {
    var atual = pecaAtual(override, chave);
    if (!atual) return override || { pecas: {} };
    var d = delta || {};
    var nova = limitar({
      x: atual.x + (d.dx || 0), y: atual.y + (d.dy || 0),
      w: atual.w + (d.dw || 0), h: atual.h + (d.dh || 0),
      rot: (atual.rot || 0) + (d.drot || 0)
    });
    var pecas = Object.assign({}, (override && override.pecas) || {});
    pecas[chave] = { x: nova.x, y: nova.y, w: nova.w, h: nova.h, rot: nova.rot };
    return { pecas: pecas };
  }
  function restaurarPeca(override, chave) {
    var pecas = Object.assign({}, (override && override.pecas) || {});
    delete pecas[chave];
    return { pecas: pecas };
  }
  function pecasEditadas(override) { return Object.keys((override && override.pecas) || {}).length; }

  function familiaDe(id) { return FAMILIAS[String(id || '').charAt(0).toUpperCase()] || { cor: '#ddd', texto: '#000', nome: '?' }; }
  function ids() {
    var vistos = {}, lista = [];
    EXPOSITORES.forEach(function (x) { if (!vistos[x.id]) { vistos[x.id] = true; lista.push(x.id); } });
    return lista;
  }
  // Ordem natural: letra, depois numero (E2 antes de E10).
  function ordenarIds(lista) {
    return (lista || []).slice().sort(function (a, b) {
      var la = a.charAt(0), lb = b.charAt(0);
      if (la !== lb) return la < lb ? -1 : 1;
      return (parseInt(a.slice(1), 10) || 0) - (parseInt(b.slice(1), 10) || 0);
    });
  }

  function fmt(n) { return String(Math.round(n * 100) / 100); }
  function rotulo(p, fam) {
    var txt = p.id, len = txt.length;
    var alto = p.h > p.w * 1.8;
    var fs = alto
      ? Math.min(2.3, (p.h - 0.8) / (len * 0.62), p.w * 0.8)
      : Math.min(2.3, (p.w - 0.8) / (len * 0.62), p.h * 0.8);
    fs = Math.max(1.2, fs);
    var cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    var tr = 'translate(' + fmt(cx) + ' ' + fmt(cy) + ')' + (alto ? ' rotate(-90)' : '') + (p.rot && !alto ? ' rotate(' + p.rot + ')' : '');
    return '<text transform="' + tr + '" font-size="' + fmt(fs) + '" fill="' + fam.texto + '" text-anchor="middle" dominant-baseline="central" font-weight="700">' + e(txt) + '</text>';
  }

  // o: { destaque: [ids], selecionado: id, contagem: { id: n },
  //      expositores: lista (com layout), edicao: true, pecaSel: chave }
  // Pedaco do mesmo expositor vai no mesmo <g data-ex>; um rect
  // transparente maior por pedaco e' a area de toque (dedo no celular).
  function svgMapa(o) {
    o = o || {};
    var dest = {};
    (o.destaque || []).forEach(function (id) { dest[id] = true; });
    var cont = o.contagem || {};
    var temDestaque = Object.keys(dest).length > 0;
    var grupos = {};
    var ordem = [];
    var lista = o.expositores || comLayout(null);
    lista.forEach(function (p) { if (!grupos[p.id]) { grupos[p.id] = []; ordem.push(p.id); } grupos[p.id].push(p); });
    var h = '<svg class="ex-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + VIEWBOX.w + ' ' + VIEWBOX.h + '" role="img" aria-label="Mapa dos expositores da loja">';
    h += '<rect x="0" y="0" width="' + VIEWBOX.w + '" height="' + VIEWBOX.h + '" fill="#fff"/>';
    ordem.forEach(function (id) {
      var fam = familiaDe(id);
      var cls = 'ex' + (dest[id] ? ' ativo' : '') + (o.selecionado === id ? ' sel' : '') + (temDestaque && !dest[id] ? ' apagado' : '') + (cont[id] ? ' com-produtos' : ' vazio');
      h += '<g class="' + cls + '" data-ex="' + e(id) + '" role="button" tabindex="0" aria-label="Expositor ' + e(id) + (cont[id] ? ', ' + cont[id] + ' produto(s)' : ', sem produtos cadastrados') + '">';
      grupos[id].forEach(function (p) {
        var tr = p.rot ? ' transform="rotate(' + p.rot + ' ' + fmt(p.x + p.w / 2) + ' ' + fmt(p.y + p.h / 2) + ')"' : '';
        var sel = o.edicao && o.pecaSel === p.chave;
        var dp = p.chave ? ' data-peca="' + e(p.chave) + '"' : '';
        h += '<rect class="ex-hit" x="' + fmt(p.x - 1.2) + '" y="' + fmt(p.y - 1.2) + '" width="' + fmt(p.w + 2.4) + '" height="' + fmt(p.h + 2.4) + '"' + tr + dp + '/>';
        h += '<rect class="ex-corpo' + (sel ? ' peca-sel' : '') + '" x="' + fmt(p.x) + '" y="' + fmt(p.y) + '" width="' + fmt(p.w) + '" height="' + fmt(p.h) + '" rx="0.4" fill="' + fam.cor + '"' + tr + dp + '/>';
        // Puxador de tamanho no canto de baixo/direita da peca selecionada.
        if (sel) h += '<rect class="ex-puxador" data-puxador="' + e(p.chave) + '" x="' + fmt(p.x + p.w - 1.2) + '" y="' + fmt(p.y + p.h - 1.2) + '" width="2.4" height="2.4"' + tr + '/>';
      });
      // Rotulo no maior pedaco
      var maior = grupos[id].reduce(function (m, p) { return (p.w * p.h > m.w * m.h) ? p : m; }, grupos[id][0]);
      h += rotulo(maior, fam);
      h += '</g>';
    });
    return h + '</svg>';
  }

  // ---- Cadastro ----
  function chaveProduto(p) {
    if (!p) return '';
    var c = String(p.codigo == null ? '' : p.codigo).trim();
    if (c) return 'c:' + c;
    var ean = soDigitos(p.ean);
    if (ean) return 'e:' + ean;
    return 'n:' + norm(p.nome || '');
  }
  // O que a pessoa digitou vira produto: codigo interno do catalogo,
  // codigo de barras do catalogo, ou texto livre (nome).
  function produtoDoTexto(texto, catalogo) {
    var t = String(texto == null ? '' : texto).trim();
    if (!t) return null;
    var cat = catalogo || {};
    var porCod = cat.porCodigo && cat.porCodigo[t];
    if (porCod) return { codigo: t, nome: porCod.n || '', ean: soDigitos(porCod.e), origem: 'codigo' };
    var dig = soDigitos(t);
    var porEan = dig.length >= 8 && cat.porEan && cat.porEan[dig];
    if (porEan) return { codigo: porEan.codigo || '', nome: porEan.nome || '', ean: dig, origem: 'barras' };
    return { codigo: /^\d+$/.test(t) ? t : '', nome: /^\d+$/.test(t) ? '' : t, ean: '', origem: 'texto' };
  }
  // Sugestoes para o campo "adicionar": por prefixo do codigo ou pelas
  // palavras do nome, no catalogo importado.
  function sugestoes(catalogo, texto, max) {
    var t = String(texto == null ? '' : texto).trim();
    var lim = max || 8;
    if (!t || !catalogo || !catalogo.porCodigo) return [];
    var nt = norm(t), termos = nt.split(/\s+/).filter(Boolean);
    var out = [];
    var codigos = Object.keys(catalogo.porCodigo);
    for (var i = 0; i < codigos.length && out.length < lim; i++) {
      var c = codigos[i], p = catalogo.porCodigo[c];
      var nome = (p && p.n) || '';
      var bate = c.indexOf(t) === 0 || (termos.length && termos.every(function (x) { return norm(nome).indexOf(x) !== -1; }));
      if (bate) out.push({ codigo: c, nome: nome, ean: soDigitos(p && p.e) });
    }
    return out;
  }
  function adicionar(doc, produto, hoje) {
    var lista = ((doc && doc.produtos) || []).slice();
    var k = chaveProduto(produto);
    if (!k || lista.some(function (p) { return chaveProduto(p) === k; })) return { produtos: lista, mudou: false };
    lista.push({ codigo: produto.codigo || '', nome: produto.nome || '', ean: soDigitos(produto.ean), desde: hoje || App.hojeISO() });
    lista.sort(function (a, b) { return (a.nome || '').localeCompare(b.nome || '', 'pt-BR'); });
    return { produtos: lista, mudou: true };
  }
  function remover(doc, chave) {
    var lista = ((doc && doc.produtos) || []).filter(function (p) { return chaveProduto(p) !== chave; });
    return { produtos: lista, mudou: lista.length !== ((doc && doc.produtos) || []).length };
  }

  // docs: { E16: { produtos: [...] }, ... }
  // -> { porCodigo: { codigo: [ids] }, porEan: { ean: [ids] }, porNome: { nomeNorm: [ids] } }
  function ondeEsta(docs) {
    var r = { porCodigo: {}, porEan: {}, porNome: {} };
    function poe(mapa, k, id) { if (!k) return; if (!mapa[k]) mapa[k] = []; if (mapa[k].indexOf(id) < 0) mapa[k].push(id); }
    Object.keys(docs || {}).forEach(function (id) {
      ((docs[id] && docs[id].produtos) || []).forEach(function (p) {
        poe(r.porCodigo, String(p.codigo == null ? '' : p.codigo).trim(), id);
        poe(r.porEan, soDigitos(p.ean), id);
        poe(r.porNome, norm(p.nome || ''), id);
      });
    });
    Object.keys(r).forEach(function (m) { Object.keys(r[m]).forEach(function (k) { r[m][k] = ordenarIds(r[m][k]); }); });
    return r;
  }
  // 'E16, F3' para um produto (codigo interno e/ou barras).
  function textoOnde(onde, codigo, ean) {
    if (!onde) return '';
    var ids = [];
    var c = String(codigo == null ? '' : codigo).trim();
    (c && onde.porCodigo[c] || []).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    var d = soDigitos(ean);
    (d && onde.porEan[d] || []).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    return ordenarIds(ids).join(', ');
  }
  // Busca na aba: codigo, barras ou nome dos produtos cadastrados, ou o
  // proprio codigo do expositor. -> [{ codigo, nome, ean, expositores }]
  function buscar(docs, termo) {
    var t = norm(termo || '').trim();
    if (!t) return [];
    var por = {};
    Object.keys(docs || {}).forEach(function (id) {
      ((docs[id] && docs[id].produtos) || []).forEach(function (p) {
        var casa = norm(id) === t || String(p.codigo || '').indexOf(t) === 0 || (soDigitos(p.ean) && soDigitos(p.ean).indexOf(soDigitos(t) || '\u0000') === 0) ||
          t.split(/\s+/).every(function (x) { return norm(p.nome || '').indexOf(x) !== -1; });
        if (!casa) return;
        var k = chaveProduto(p);
        if (!por[k]) por[k] = { codigo: p.codigo || '', nome: p.nome || '', ean: soDigitos(p.ean), expositores: [] };
        if (por[k].expositores.indexOf(id) < 0) por[k].expositores.push(id);
      });
    });
    return Object.keys(por).map(function (k) { por[k].expositores = ordenarIds(por[k].expositores); return por[k]; })
      .sort(function (a, b) { return (a.nome || '').localeCompare(b.nome || '', 'pt-BR'); });
  }
  // Estoque do catalogo (config/etiquetasProdutos) para um produto da
  // exposicao: pelo codigo interno, senao pelas barras. null = o
  // catalogo nao conhece (produto cadastrado por nome livre, ou sem
  // estoque na planilha importada).
  function estoqueDe(catalogo, produto) {
    if (!catalogo || !produto) return null;
    var cod = String(produto.codigo == null ? '' : produto.codigo).trim();
    var p = cod && catalogo.porCodigo && catalogo.porCodigo[cod];
    if (p && p.q != null && isFinite(Number(p.q))) return Number(p.q);
    var ean = soDigitos(produto.ean);
    var e = ean && catalogo.porEan && catalogo.porEan[ean];
    if (e && e.qtd != null && isFinite(Number(e.qtd))) return Number(e.qtd);
    return null;
  }
  function contagem(docs) {
    var c = {};
    Object.keys(docs || {}).forEach(function (id) { c[id] = ((docs[id] && docs[id].produtos) || []).length; });
    return c;
  }

  var api = {
    VIEWBOX: VIEWBOX, FAMILIAS: FAMILIAS, EXPOSITORES: EXPOSITORES,
    ids: ids, ordenarIds: ordenarIds, familiaDe: familiaDe, svgMapa: svgMapa,
    chaveProduto: chaveProduto, produtoDoTexto: produtoDoTexto, sugestoes: sugestoes, adicionar: adicionar, remover: remover,
    ondeEsta: ondeEsta, textoOnde: textoOnde, buscar: buscar, contagem: contagem, estoqueDe: estoqueDe,
    GRADE: GRADE, chavesPecas: chavesPecas, comLayout: comLayout, pecaAtual: pecaAtual, ajustarPeca: ajustarPeca, restaurarPeca: restaurarPeca, pecasEditadas: pecasEditadas
  };
  global.ExposicaoNucleo = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
