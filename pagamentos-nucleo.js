/*
  Nucleo da tela de Pagamentos (controle-notas.html) — 26/10/2026.

  Por enquanto so' o relatorio impresso: recebe a MESMA lista que a
  tela mostra (escopo + chip + busca ja' aplicados) e devolve o HTML
  para o papel — agrupado por dia de vencimento, com subtotal por dia,
  caixinha para marcar o que foi pago no banco e o resumo no topo.

  Puro: nada de Firebase, nada de DOM. Testado em testes/pagamentos.js.
*/
(function (global) {
  'use strict';

  var App = (typeof module === 'object' && module.exports)
    ? require('./app-shared.js')
    : global.App;
  if (!App || !App.escapeHtml) {
    throw new Error('pagamentos-nucleo.js precisa de app-shared.js carregado antes.');
  }

  var ROTULO_FILTRO = {
    pendentes: 'Pendentes', atrasadas: 'Atrasadas', hoje: 'Hoje', semana: 'Pagamento da semana',
    fimmes: 'Até o fim do mês', pagas: 'Pagas', todas: 'Todas'
  };
  var ROTULO_ESCOPO = { fornecedores: 'Fornecedores', interno: 'Pagamento interno', todos: 'Todos' };

  // Situacao de uma linha, com o mesmo corte da tela (inicioHoje).
  function situacao(l, inicioHoje) {
    if (l.pago) return 'pago';
    if (l.vencimento && inicioHoje && l.vencimento < inicioHoje) return 'atrasado';
    return 'aVencer';
  }

  // { itens, total, atrasado, aVencer, pago }
  function resumo(lista, inicioHoje) {
    var r = { itens: 0, total: 0, atrasado: 0, aVencer: 0, pago: 0 };
    (lista || []).forEach(function (l) {
      var v = Number(l.valor) || 0;
      r.itens++; r.total += v;
      var s = situacao(l, inicioHoje);
      if (s === 'pago') r.pago += v; else if (s === 'atrasado') r.atrasado += v; else r.aVencer += v;
    });
    ['total', 'atrasado', 'aVencer', 'pago'].forEach(function (k) { r[k] = App.centavos(r[k]); });
    return r;
  }

  // Agrupa por dia de vencimento, na ordem da lista (que ja' vem por
  // vencimento). Sem vencimento vai para o fim.
  function porDia(lista) {
    var dias = {}, ordem = [];
    (lista || []).forEach(function (l) {
      var k = l.vencimento || '';
      if (!dias[k]) { dias[k] = { dia: k, linhas: [], total: 0 }; ordem.push(k); }
      dias[k].linhas.push(l);
      dias[k].total += Number(l.valor) || 0;
    });
    ordem.sort(function (a, b) { return (a || '9999') < (b || '9999') ? -1 : 1; });
    return ordem.map(function (k) { dias[k].total = App.centavos(dias[k].total); return dias[k]; });
  }

  // o: { hoje, hora, inicioHoje, escopo, filtro, busca, loja, categoriaRotulo(valor) }
  function htmlRelatorio(lista, opcoes) {
    var o = opcoes || {};
    var e = App.escapeHtml;
    var hoje = o.hoje || App.hojeISO();
    var escopo = o.escopo || 'fornecedores';
    var mostraCategoria = escopo !== 'fornecedores';
    var mostraNota = escopo !== 'interno';
    var mostraRecebido = escopo === 'fornecedores';
    var rot = function (v) { return o.categoriaRotulo ? o.categoriaRotulo(v) : String(v || ''); };
    var r = resumo(lista, o.inicioHoje);

    var h = '<div class="rl">' +
      '<div class="rl-loja">' + e(o.loja || 'LOJÃO DA CONSTRUÇÃO') + '</div>' +
      '<div class="rl-titulo">CONTROLE DE PAGAMENTOS — ' + e((ROTULO_ESCOPO[escopo] || escopo).toUpperCase()) + '</div>' +
      '<div class="rl-ref">' + e(App.fmtData(hoje)) + (o.hora ? ' ' + e(o.hora) : '') +
        ' · filtro: ' + e(ROTULO_FILTRO[o.filtro] || o.filtro || 'Pendentes') +
        (o.busca ? ' · busca: "' + e(o.busca) + '"' : '') + '</div>' +
      '<div class="rl-secao">RESUMO <span class="rl-qtd">(' + r.itens + ' item(ns))</span></div>' +
      '<table class="rl-tab rl-resumo"><tbody>' +
        '<tr><td>Total da lista</td><td class="rl-q"><b>' + e(App.brl(r.total)) + '</b></td></tr>' +
        (r.atrasado ? '<tr><td>Atrasado</td><td class="rl-q">' + e(App.brl(r.atrasado)) + '</td></tr>' : '') +
        (r.aVencer ? '<tr><td>A vencer</td><td class="rl-q">' + e(App.brl(r.aVencer)) + '</td></tr>' : '') +
        (r.pago ? '<tr><td>Pago</td><td class="rl-q">' + e(App.brl(r.pago)) + '</td></tr>' : '') +
      '</tbody></table>';

    if (!(lista || []).length) return h + '<div class="rl-vazio">Nenhum item nesse filtro.</div></div>';

    porDia(lista).forEach(function (d) {
      var s0 = d.dia ? situacao({ vencimento: d.dia }, o.inicioHoje) : 'aVencer';
      h += '<div class="rl-secao">' + (d.dia ? 'VENCIMENTO ' + e(App.fmtData(d.dia)) : 'SEM VENCIMENTO') +
        (s0 === 'atrasado' && d.linhas.some(function (l) { return !l.pago; }) ? ' — ATRASADO' : '') +
        ' <span class="rl-qtd">(' + d.linhas.length + ' · ' + e(App.brl(d.total)) + ')</span></div>' +
        '<table class="rl-tab"><thead><tr><th class="rl-ok"></th><th>' + (escopo === 'interno' ? 'DESCRIÇÃO' : 'EMITENTE / DESCRIÇÃO') + '</th>' +
        (mostraCategoria ? '<th class="rl-cod">CATEGORIA</th>' : '') +
        (mostraNota ? '<th class="rl-cod">NOTA</th><th class="rl-ok">PARC.</th>' : '') +
        '<th class="rl-cod">SITUAÇÃO</th>' + (mostraRecebido ? '<th class="rl-ok">REC.</th>' : '') +
        '<th class="rl-q">VALOR</th></tr></thead><tbody>';
      d.linhas.forEach(function (l) {
        var s = situacao(l, o.inicioHoje);
        var sit = s === 'pago' ? 'PAGO' + (l.dataPagamento ? ' ' + App.fmtData(l.dataPagamento) : '') : s === 'atrasado' ? 'ATRASADO' : 'A VENCER';
        h += '<tr><td class="rl-ok">' + (l.pago ? '✔' : '<span class="rl-caixa"></span>') + '</td>' +
          '<td>' + e(l.descricao || '') +
            (l.recorrente ? ' <span class="rl-qtd">· recorrente</span>' : '') +
            (l.obsPagamento ? ' <span class="rl-qtd">· ' + e(l.obsPagamento) + '</span>' : '') + '</td>' +
          (mostraCategoria ? '<td>' + e(rot(l.categoria)) + '</td>' : '') +
          (mostraNota ? '<td>' + e(l.numeroNota || '-') + '</td><td>' + e(l.parcela || '-') + '</td>' : '') +
          '<td>' + e(sit) + '</td>' +
          (mostraRecebido ? '<td>' + (l._tipo === 'fornecedor' ? (l._recebido === null ? '—' : l._recebido ? 'sim' : 'NÃO') : '-') + '</td>' : '') +
          '<td class="rl-q">' + e(App.brl(Number(l.valor) || 0)) + '</td></tr>';
      });
      h += '</tbody></table>';
    });
    return h + '</div>';
  }

  var api = { ROTULO_FILTRO: ROTULO_FILTRO, ROTULO_ESCOPO: ROTULO_ESCOPO, situacao: situacao, resumo: resumo, porDia: porDia, htmlRelatorio: htmlRelatorio };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.PagamentosNucleo = api;
})(typeof window !== 'undefined' ? window : this);
