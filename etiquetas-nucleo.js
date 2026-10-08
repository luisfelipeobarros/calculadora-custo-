/*
  Nucleo do app de Etiquetas (etiquetas.html) — 08/10/2026.

  Controle das etiquetas de gondola para produto que a loja ja'
  comprou e esta' a caminho:
  - AZUL: sem estoque (ou baixo), mas ja' faturado pelo fornecedor e em
    transito. Cada produto de cada NF-e emitida contra a empresa vira
    uma linha aqui; quem colocou a etiqueta marca "etiquetei".
  - VERMELHA: sem estoque e AINDA NAO faturado. Registro manual (nao
    ha' nota para puxar). Quando um produto parecido aparece faturado,
    o app avisa para trocar a vermelha pela azul.

  Quando a nota da' entrada no ERP (noSistema, gravado pelo Apps
  Script) a mercadoria chegou: toda linha etiquetada vira "retirar
  etiqueta" ate' alguem marcar que retirou.

  Puro: recebe os documentos de itensNotas, o estado das notas e os
  documentos da colecao `etiquetas`; devolve linhas, contagens, filtro
  e o relatorio em HTML. Nada de Firebase aqui.
*/
(function (global) {
  'use strict';

  var App = (typeof module === 'object' && module.exports)
    ? require('./app-shared.js')
    : global.App;
  if (!App || !App.normalizarTexto) {
    throw new Error('etiquetas-nucleo.js precisa de app-shared.js carregado antes.');
  }
  var norm = App.normalizarTexto;

  // Na ordem em que a lista mostra: primeiro o que exige acao.
  var SITUACOES = {
    retirar:    { rotulo: 'Retirar etiqueta',        curto: 'Retirar',     ordem: 0, classe: 'si-retirar' },
    etiquetar:  { rotulo: 'Etiquetar',               curto: 'Etiquetar',   ordem: 1, classe: 'si-etiquetar' },
    transito:   { rotulo: 'Etiquetada · em trânsito', curto: 'Em trânsito', ordem: 2, classe: 'si-transito' },
    dispensada: { rotulo: 'Sem etiqueta (estoque ok)', curto: 'Sem etiqueta', ordem: 3, classe: 'si-dispensada' },
    recebida:   { rotulo: 'Recebida sem etiqueta',   curto: 'Recebida',    ordem: 4, classe: 'si-recebida' },
    concluida:  { rotulo: 'Etiqueta retirada',       curto: 'Concluída',   ordem: 5, classe: 'si-concluida' }
  };
  var ENCERRADAS = ['recebida', 'concluida'];

  // Id do documento em `etiquetas`: chave da NF-e + numero do item.
  function idDaLinha(chave, n) { return String(chave) + '_' + String(n); }

  // e: documento de `etiquetas` da linha (ou nada).
  function situacaoDe(recebida, e) {
    e = e || {};
    if (recebida) {
      if (e.etiquetada === true && e.retirada !== true) return 'retirar';
      if (e.etiquetada === true) return 'concluida';
      return 'recebida';
    }
    if (e.etiquetada === true) return 'transito';
    if (e.dispensada === true) return 'dispensada';
    return 'etiquetar';
  }

  // Pisos, revestimentos e porcelanatos: NCM 6907 (ladrilhos e placas
  // ceramicas; o 6908 antigo foi fundido nele em 2017). O controle de
  // etiquetas e' so' para eles — o resto da nota nem vira linha.
  var NCM_PISOS = ['6907'];
  function ncmCasa(ncm, prefixos) {
    if (!prefixos || !prefixos.length) return true;
    var n = String(ncm == null ? '' : ncm).replace(/D/g, '');
    return prefixos.some(function (p) { return n.indexOf(String(p)) === 0; });
  }

  // itensDocs: [{ chave, numero, dataEmissao, nomeEmitente, itens: [{ n, codigo, descricao, ncm, qtd, un }] }]
  // notasPorChave: { chave: { noSistema, status, previsaoEntrega } }
  // etiquetasPorId: { id: { etiquetada, dispensada, retirada } }
  // opcoes.ncm: prefixos de NCM aceitos (ex.: NCM_PISOS); vazio = todos.
  // Nota cancelada some; nota que nao esta' carregada conta como nao recebida.
  function linhasDeTransito(itensDocs, notasPorChave, etiquetasPorId, opcoes) {
    var prefixos = (opcoes || {}).ncm || null;
    var linhas = [];
    (itensDocs || []).forEach(function (doc) {
      if (!doc || !doc.chave) return;
      var nota = (notasPorChave || {})[doc.chave] || null;
      if (nota && (nota.status || 'ativa') === 'cancelada') return;
      var itens = Array.isArray(doc.itens) ? doc.itens : [];
      var descricoes = itens.map(function (it) { return it && it.descricao; });
      var fornecedor = App.rotularFornecedor(doc.nomeEmitente, descricoes);
      var recebida = !!(nota && nota.noSistema === true);
      itens.forEach(function (it, i) {
        it = it || {};
        if (!ncmCasa(it.ncm, prefixos)) return;
        var n = it.n != null && it.n !== '' ? it.n : i + 1;
        var id = idDaLinha(doc.chave, n);
        var e = (etiquetasPorId || {})[id] || {};
        linhas.push({
          id: id, chave: doc.chave, n: n,
          numero: doc.numero == null ? '' : String(doc.numero),
          dataEmissao: doc.dataEmissao || '',
          fornecedor: fornecedor, nomeEmitente: doc.nomeEmitente || '',
          codigo: it.codigo == null ? '' : String(it.codigo),
          descricao: it.descricao == null ? '' : String(it.descricao),
          qtd: (it.qtd == null || it.qtd === '') ? null : Number(it.qtd),
          un: it.un == null ? '' : String(it.un),
          recebida: recebida,
          previsaoEntrega: (nota && nota.previsaoEntrega) || null,
          etiquetada: e.etiquetada === true,
          dispensada: e.dispensada === true,
          retirada: e.retirada === true,
          situacao: situacaoDe(recebida, e)
        });
      });
    });
    return linhas;
  }

  function contar(linhas) {
    var c = {};
    Object.keys(SITUACOES).forEach(function (s) { c[s] = 0; });
    (linhas || []).forEach(function (l) { if (c[l.situacao] != null) c[l.situacao]++; });
    return c;
  }

  // Acao primeiro; depois a emissao mais recente; depois fornecedor e item.
  function ordenar(linhas) {
    return (linhas || []).slice().sort(function (a, b) {
      return (SITUACOES[a.situacao].ordem - SITUACOES[b.situacao].ordem) ||
        String(b.dataEmissao).localeCompare(String(a.dataEmissao)) ||
        String(a.fornecedor).localeCompare(String(b.fornecedor), 'pt-BR') ||
        String(a.numero).localeCompare(String(b.numero), 'pt-BR', { numeric: true }) ||
        (Number(a.n) - Number(b.n));
    });
  }

  function casaTermo(l, termo) {
    var t = norm(termo);
    if (!t) return true;
    return norm([l.fornecedor, l.nomeEmitente, l.codigo, l.descricao, l.numero].join(' ')).indexOf(t) !== -1;
  }

  // f: { grupo, termos }. grupo: '' = tudo que ainda pede acao ou esta'
  // a caminho (sem as encerradas); 'encerradas'; ou uma situacao.
  // termos: lista da busca com chips — basta UM casar.
  function filtrar(linhas, f) {
    var o = f || {};
    var termos = (o.termos || []).filter(Boolean);
    return (linhas || []).filter(function (l) {
      if (o.grupo === 'encerradas') { if (ENCERRADAS.indexOf(l.situacao) === -1) return false; }
      else if (o.grupo) { if (l.situacao !== o.grupo) return false; }
      else if (ENCERRADAS.indexOf(l.situacao) !== -1) return false;
      if (termos.length && !termos.some(function (t) { return casaTermo(l, t); })) return false;
      return true;
    });
  }

  /* ------------------------------------------------------------
     Etiquetas vermelhas (registro manual)
     v: { id, produto, codigo, obs, criadaEm, resolvidaEm }
     ------------------------------------------------------------ */

  function vermelhasPendentes(lista) {
    return (lista || []).filter(function (v) { return v && !v.resolvidaEm; })
      .sort(function (a, b) { return String(a.criadaEm || '').localeCompare(String(b.criadaEm || '')); });
  }

  // Produto da vermelha que aparece faturado (em transito ou recebido):
  // pelo codigo igual, ou pelo nome contido na descricao (com pelo menos
  // 4 letras, para "piso" sozinho nao casar com a loja inteira).
  function dicaDeFaturamento(vermelha, linhas) {
    var cod = norm(vermelha && vermelha.codigo);
    var nome = norm(vermelha && vermelha.produto);
    if (!cod && nome.length < 4) return [];
    return (linhas || []).filter(function (l) {
      if (ENCERRADAS.indexOf(l.situacao) !== -1) return false;
      if (cod && norm(l.codigo) === cod) return true;
      return nome.length >= 4 && norm(l.descricao).indexOf(nome) !== -1;
    });
  }

  /* ------------------------------------------------------------
     Relatorio para imprimir: o que RETIRAR (recebido com etiqueta),
     o que ETIQUETAR (a caminho, sem etiqueta) e as VERMELHAS
     pendentes. Agrupado por fornecedor, com quadrinho para marcar
     na gondola.
     ------------------------------------------------------------ */

  function fmtQtd(q) {
    return q == null ? '' : Number(q).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  }

  function htmlRelatorio(linhas, vermelhas, opcoes) {
    var o = opcoes || {};
    var e = App.escapeHtml;
    var hoje = o.hoje || App.hojeISO();

    function secao(titulo, lista, vazio) {
      var h = '<div class="rl-secao">' + e(titulo) + ' <span class="rl-qtd">(' + lista.length + ')</span></div>';
      if (!lista.length) return h + '<div class="rl-vazio">' + e(vazio) + '</div>';
      var porForn = {};
      var ordem = [];
      ordenar(lista).forEach(function (l) {
        if (!porForn[l.fornecedor]) { porForn[l.fornecedor] = []; ordem.push(l.fornecedor); }
        porForn[l.fornecedor].push(l);
      });
      ordem.sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
      ordem.forEach(function (forn) {
        h += '<div class="rl-forn">' + e(forn) + '</div>' +
          '<table class="rl-tab"><thead><tr><th class="rl-ok"></th><th class="rl-cod">CÓD</th><th>PRODUTO</th>' +
          '<th class="rl-q">QTD</th><th class="rl-nf">NF · EMISSÃO</th></tr></thead><tbody>';
        porForn[forn].forEach(function (l) {
          h += '<tr><td class="rl-ok"><span class="rl-caixa"></span></td><td>' + e(l.codigo) + '</td><td>' + e(l.descricao) + '</td>' +
            '<td class="rl-q">' + e(fmtQtd(l.qtd) + (l.un ? ' ' + l.un : '')) + '</td>' +
            '<td class="rl-nf">' + e((l.numero ? l.numero + ' · ' : '') + (l.dataEmissao ? App.fmtData(l.dataEmissao) : '')) + '</td></tr>';
        });
        h += '</tbody></table>';
      });
      return h;
    }

    var retirar = (linhas || []).filter(function (l) { return l.situacao === 'retirar'; });
    var etiquetar = (linhas || []).filter(function (l) { return l.situacao === 'etiquetar'; });
    var verm = vermelhasPendentes(vermelhas);
    var hv = '<div class="rl-secao">ETIQUETAS VERMELHAS — SEM ESTOQUE, NÃO FATURADO <span class="rl-qtd">(' + verm.length + ')</span></div>';
    if (!verm.length) hv += '<div class="rl-vazio">Nenhuma etiqueta vermelha pendente.</div>';
    else {
      hv += '<table class="rl-tab"><thead><tr><th class="rl-ok"></th><th class="rl-cod">CÓD</th><th>PRODUTO</th><th>OBS.</th><th class="rl-nf">DESDE</th></tr></thead><tbody>';
      verm.forEach(function (v) {
        hv += '<tr><td class="rl-ok"><span class="rl-caixa"></span></td><td>' + e(v.codigo || '') + '</td><td>' + e(v.produto || '') + '</td>' +
          '<td>' + e(v.obs || '') + '</td><td class="rl-nf">' + e(v.criadaEm ? App.fmtData(v.criadaEm) : '') + '</td></tr>';
      });
      hv += '</tbody></table>';
    }

    return '<div class="rl">' +
      '<div class="rl-loja">' + e(o.loja || 'LOJÃO DA CONSTRUÇÃO') + '</div>' +
      '<div class="rl-titulo">ETIQUETAS DE PRODUTO EM TRÂNSITO</div>' +
      '<div class="rl-ref">' + e(App.fmtData(hoje)) + (o.hora ? ' ' + e(o.hora) : '') + '</div>' +
      secao('RETIRAR ETIQUETA — MERCADORIA RECEBIDA', retirar, 'Nada para retirar.') +
      secao('COLOCAR ETIQUETA AZUL — FATURADO, A CAMINHO', etiquetar, 'Nada para etiquetar.') +
      hv +
      '</div>';
  }

  var EtiquetasNucleo = {
    SITUACOES: SITUACOES,
    ENCERRADAS: ENCERRADAS,
    NCM_PISOS: NCM_PISOS,
    ncmCasa: ncmCasa,
    idDaLinha: idDaLinha,
    situacaoDe: situacaoDe,
    linhasDeTransito: linhasDeTransito,
    contar: contar,
    ordenar: ordenar,
    filtrar: filtrar,
    vermelhasPendentes: vermelhasPendentes,
    dicaDeFaturamento: dicaDeFaturamento,
    htmlRelatorio: htmlRelatorio
  };

  global.EtiquetasNucleo = EtiquetasNucleo;
  if (typeof module === 'object' && module.exports) module.exports = EtiquetasNucleo;
})(typeof window !== 'undefined' ? window : globalThis);
