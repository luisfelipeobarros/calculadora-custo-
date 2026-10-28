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
  function soDigitos(v) { return String(v == null ? '' : v).replace(/[^0-9]/g, ''); }
  // Timestamp do Firestore (ou Date) -> 'aaaa-mm-dd' local; nulo se nao houver.
  function dataDoCarimbo(v) {
    if (!v) return null;
    var d = typeof v.toDate === 'function' ? v.toDate() : (v instanceof Date ? v : null);
    return d && !isNaN(d.getTime()) ? App.iso(d) : null;
  }

  // Na ordem em que a lista mostra: primeiro o que exige acao.
  var SITUACOES = {
    retirar:    { rotulo: 'Retirar etiqueta',        curto: 'Retirar',     ordem: 0, classe: 'si-retirar' },
    etiquetar:  { rotulo: 'Etiquetar',               curto: 'Etiquetar',   ordem: 1, classe: 'si-etiquetar' },
    transito:   { rotulo: 'Etiquetada · em trânsito', curto: 'Em trânsito', ordem: 2, classe: 'si-transito' },
    naoExposto: { rotulo: 'Não exposto · em trânsito', curto: 'Não exposto', ordem: 2, classe: 'si-transito' },
    dispensada: { rotulo: 'Com estoque (sem etiqueta)', curto: 'Com estoque', ordem: 3, classe: 'si-dispensada' },
    // Decidida pelo app: o cadastro (ultima importacao) diz que tem
    // estoque acima do minimo — faturado, mas nao precisa de etiqueta.
    comEstoque: { rotulo: 'Com estoque no cadastro', curto: 'Com estoque', ordem: 3, classe: 'si-dispensada' },
    recebida:   { rotulo: 'Recebida sem etiqueta',   curto: 'Recebida',    ordem: 4, classe: 'si-recebida' },
    concluida:  { rotulo: 'Etiqueta retirada',       curto: 'Concluída',   ordem: 5, classe: 'si-concluida' }
  };
  // Chips da tela: cada grupo junta as situacoes que a pessoa ve como uma coisa so'.
  var GRUPOS = {
    transito: ['transito', 'naoExposto'],
    azul: ['transito'],              // so' as azuis em transito
    dispensada: ['dispensada', 'comEstoque']
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
    if (e.etiquetada === true) return e.tipo === 'naoExposto' ? 'naoExposto' : 'transito';
    if (e.dispensada === true) return 'dispensada';
    return 'etiquetar';
  }

  // Pisos, revestimentos e porcelanatos: NCM 6907 (ladrilhos e placas
  // ceramicas; o 6908 antigo foi fundido nele em 2017). O controle de
  // etiquetas e' so' para eles — o resto da nota nem vira linha.
  var NCM_PISOS = ['6907'];
  function ncmCasa(ncm, prefixos) {
    if (!prefixos || !prefixos.length) return true;
    var n = String(ncm == null ? '' : ncm).replace(/[^0-9]/g, '');
    return prefixos.some(function (p) { return n.indexOf(String(p)) === 0; });
  }

  // itensDocs: [{ chave, numero, dataEmissao, nomeEmitente, itens: [{ n, codigo, descricao, ncm, qtd, un }] }]
  // notasPorChave: { chave: { noSistema, status, previsaoEntrega } }
  // etiquetasPorId: { id: { etiquetada, dispensada, retirada } }
  // opcoes.ncm: prefixos de NCM aceitos (ex.: NCM_PISOS); vazio = todos.
  // Nota cancelada some; nota que nao esta' carregada conta como nao recebida.
  /* ------------------------------------------------------------
     Catalogo interno (config/etiquetasProdutos)

     O elo entre a nota do fornecedor e o cadastro da loja e' o codigo
     de barras. Na importacao do estoque o app guarda um dicionario
     pequeno — codigo interno -> { n: nome, e: barras } — num documento
     so'. Com ele, a linha em transito mostra o codigo e o nome DA
     LOJA, a busca acha por eles, e a vermelha digitada pelo codigo
     interno ja' sai com o codigo de barras (e casa exato com a nota
     quando ela chega).
     ------------------------------------------------------------ */

  // itens da planilha -> documento compacto (so' o que e' vendavel).
  function montarCatalogo(estoque, hoje) {
    var porCodigo = {};
    (estoque || []).forEach(function (it) {
      if (!it || !it.codigo || foraDoControle(it)) return;
      porCodigo[it.codigo] = { n: it.nome || '', e: it.ean || '', q: it.quantidade == null ? null : Number(it.quantidade) };
    });
    return { porCodigo: porCodigo, geradoEm: hoje || null, qtd: Object.keys(porCodigo).length };
  }
  // documento -> indices de consulta.
  function expandirCatalogo(doc) {
    var porCodigo = (doc && doc.porCodigo) || {};
    var porEan = {};
    Object.keys(porCodigo).forEach(function (c) {
      var p = porCodigo[c] || {};
      var ean = soDigitos(p.e);
      if (ean) porEan[ean] = { codigo: c, nome: p.n || '', qtd: p.q == null ? null : Number(p.q) };
    });
    return { porCodigo: porCodigo, porEan: porEan, geradoEm: (doc && doc.geradoEm) || null, qtd: Object.keys(porCodigo).length };
  }
  function produtoDoCatalogo(catalogo, codigo) {
    var p = catalogo && catalogo.porCodigo && catalogo.porCodigo[String(codigo == null ? '' : codigo).trim()];
    return p ? { codigo: String(codigo).trim(), nome: p.n || '', ean: soDigitos(p.e), qtd: p.q == null ? null : Number(p.q) } : null;
  }

  function linhasDeTransito(itensDocs, notasPorChave, etiquetasPorId, opcoes) {
    var prefixos = (opcoes || {}).ncm || null;
    var catalogo = (opcoes || {}).catalogo || null;
    var porEan = (catalogo && catalogo.porEan) || null;
    var temCatalogo = !!(catalogo && catalogo.qtd);
    // Estoque acima deste minimo no cadastro = faturado, mas nao precisa de etiqueta.
    var minimo = (opcoes || {}).minimo == null ? null : Number((opcoes || {}).minimo);
    var linhas = [];
    (itensDocs || []).forEach(function (doc) {
      if (!doc || !doc.chave) return;
      var nota = (notasPorChave || {})[doc.chave] || null;
      // Nota cancelada some — menos o item que ainda tem etiqueta na
      // gondola: esse fica como "retirar", senao a etiqueta ficava la'.
      var cancelada = !!(nota && (nota.status || 'ativa') === 'cancelada');
      var itens = Array.isArray(doc.itens) ? doc.itens : [];
      var descricoes = itens.map(function (it) { return it && it.descricao; });
      var fornecedor = App.rotularFornecedor(doc.nomeEmitente, descricoes);
      var recebida = cancelada || !!(nota && nota.noSistema === true);
      // Data do recebimento: noSistemaEm (gravada pelo Apps Script ao dar
      // entrada) ou, na falta, o dia do carimbo da nota — que e' o da
      // entrada, tanto pelo script quanto pela marcacao manual no app.
      var recebidaEm = !recebida || cancelada ? null : (nota.noSistemaEm || dataDoCarimbo(nota.alteradoEm));
      itens.forEach(function (it, i) {
        it = it || {};
        if (!ncmCasa(it.ncm, prefixos)) return;
        var n = it.n != null && it.n !== '' ? it.n : i + 1;
        var id = idDaLinha(doc.chave, n);
        var e = (etiquetasPorId || {})[id] || {};
        if (cancelada && !(e.etiquetada === true && e.retirada !== true)) return;
        linhas.push({
          id: id, chave: doc.chave, n: n,
          numero: doc.numero == null ? '' : String(doc.numero),
          dataEmissao: doc.dataEmissao || '',
          fornecedor: fornecedor, nomeEmitente: doc.nomeEmitente || '',
          codigo: it.codigo == null ? '' : String(it.codigo),
          descricao: it.descricao == null ? '' : String(it.descricao),
          qtd: (it.qtd == null || it.qtd === '') ? null : Number(it.qtd),
          un: it.un == null ? '' : String(it.un),
          ean: soDigitos(it.ean),
          // So' pelo codigo de barras: errar o codigo interno e' pior do que nao mostrar.
          codigoInterno: (porEan && soDigitos(it.ean) && porEan[soDigitos(it.ean)]) ? porEan[soDigitos(it.ean)].codigo : '',
          nomeInterno: (porEan && soDigitos(it.ean) && porEan[soDigitos(it.ean)]) ? porEan[soDigitos(it.ean)].nome : '',
          recebida: recebida,
          recebidaEm: recebidaEm,
          cancelada: cancelada,
          previsaoEntrega: (nota && nota.previsaoEntrega) || null,
          // Produto novo? Tem codigo de barras na nota e NAO esta' no cadastro
          // (so' vale com catalogo importado): provavelmente primeira compra.
          possivelNovo: temCatalogo && !!soDigitos(it.ean) && !porEan[soDigitos(it.ean)],
          estoqueCadastro: (porEan && soDigitos(it.ean) && porEan[soDigitos(it.ean)]) ? porEan[soDigitos(it.ean)].qtd : null,
          tipoEtiqueta: e.etiquetada === true ? (e.tipo === 'naoExposto' ? 'naoExposto' : 'azul') : null,
          etiquetada: e.etiquetada === true,
          dispensada: e.dispensada === true,
          // Decisao manual de quem olha o Radar: "estoque baixo" vale por
          // cima do estoque do cadastro e manda a linha para Etiquetar.
          estoqueBaixo: e.estoqueBaixo === true,
          retirada: e.retirada === true,
          situacao: situacaoDe(recebida, e)
        });
        var l = linhas[linhas.length - 1];
        // Ninguem decidiu nada e o cadastro diz que tem estoque: nao precisa de etiqueta.
        if (l.situacao === 'etiquetar' && !l.estoqueBaixo && minimo != null && l.estoqueCadastro != null && l.estoqueCadastro > minimo) l.situacao = 'comEstoque';
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

  /* ------------------------------------------------------------
     Agrupamento: um produto por linha (pedido de 22/10/2026)

     A etiqueta e' por produto, nao por nota: seis NF-e do mesmo piso,
     do mesmo fornecedor, na mesma situacao, viram UMA linha com a
     quantidade somada e "6 NF (47904–47909)". Situacoes diferentes
     (tres notas ja' recebidas, tres a caminho) ficam em linhas
     separadas — e' o que o relatorio precisa dizer. A acao vale para o
     grupo inteiro: por baixo continua um registro por item de nota.
     ------------------------------------------------------------ */
  function chaveDoGrupo(l) {
    return [l.situacao, l.tipoEtiqueta || '', l.fornecedor, norm(l.descricao), norm(l.un), l.codigoInterno || '', l.cancelada ? 1 : 0].join('|');
  }
  function agrupar(linhas) {
    var grupos = [], por = {};
    (linhas || []).forEach(function (l) {
      var k = chaveDoGrupo(l);
      var g = por[k];
      if (!g) {
        g = Object.assign({}, l, { ids: [l.id], linhas: [l], notas: 1,
          numeros: l.numero ? [l.numero] : [], dataEmissaoFim: l.dataEmissao });
        por[k] = g;
        grupos.push(g);
        return;
      }
      g.ids.push(l.id); g.linhas.push(l); g.notas++;
      if (l.qtd != null) g.qtd = (g.qtd || 0) + l.qtd;
      if (l.numero && g.numeros.indexOf(l.numero) === -1) g.numeros.push(l.numero);
      if (l.dataEmissao && (!g.dataEmissao || l.dataEmissao < g.dataEmissao)) g.dataEmissao = l.dataEmissao;
      if (l.dataEmissao && (!g.dataEmissaoFim || l.dataEmissao > g.dataEmissaoFim)) g.dataEmissaoFim = l.dataEmissao;
      if (l.previsaoEntrega && (!g.previsaoEntrega || l.previsaoEntrega > g.previsaoEntrega)) g.previsaoEntrega = l.previsaoEntrega;
      if (l.recebidaEm && (!g.recebidaEm || l.recebidaEm > g.recebidaEm)) g.recebidaEm = l.recebidaEm; // a ultima entrada
      g.possivelNovo = g.possivelNovo || l.possivelNovo;
    });
    grupos.forEach(function (g) {
      g.numeros.sort(function (a, b) { return String(a).localeCompare(String(b), 'pt-BR', { numeric: true }); });
      g.id = g.ids.join('|');
    });
    return grupos;
  }
  // "6 NF (47904–47909)" / "NF 1753825"
  function textoNotas(g) {
    var nums = g.numeros || (g.numero ? [g.numero] : []);
    if (!nums.length) return '';
    if (nums.length === 1) return 'NF ' + nums[0];
    return nums.length + ' NF (' + nums[0] + '–' + nums[nums.length - 1] + ')';
  }
  // "05/10/2026" / "05/10 a 09/10/2026"
  function textoEmissao(g) {
    if (!g.dataEmissao) return '';
    var fim = g.dataEmissaoFim || g.dataEmissao;
    if (fim === g.dataEmissao) return App.fmtData(g.dataEmissao);
    var a = App.fmtData(g.dataEmissao), b = App.fmtData(fim);
    return (a.slice(-4) === b.slice(-4) ? a.slice(0, 5) : a) + ' a ' + b;
  }

  function casaTermo(l, termo) {
    var t = norm(termo);
    if (!t) return true;
    return norm([l.fornecedor, l.nomeEmitente, l.codigo, l.descricao, l.numero, l.codigoInterno, l.nomeInterno].join(' ')).indexOf(t) !== -1;
  }

  // f: { grupo, termos }. grupo: '' = tudo que ainda pede acao ou esta'
  // a caminho (sem as encerradas); 'encerradas'; ou uma situacao.
  // termos: lista da busca com chips — basta UM casar.
  function filtrar(linhas, f) {
    var o = f || {};
    var termos = (o.termos || []).filter(Boolean);
    return (linhas || []).filter(function (l) {
      if (o.grupo === 'encerradas') { if (ENCERRADAS.indexOf(l.situacao) === -1) return false; }
      else if (o.grupo) { if ((GRUPOS[o.grupo] || [o.grupo]).indexOf(l.situacao) === -1) return false; }
      else if (ENCERRADAS.indexOf(l.situacao) !== -1) return false;
      if (termos.length && !termos.some(function (t) { return casaTermo(l, t); })) return false;
      return true;
    });
  }

  /* ------------------------------------------------------------
     Etiquetas vermelhas (registro manual)
     v: { id, produto, codigo, obs, criadaEm, resolvidaEm }
     ------------------------------------------------------------ */

  // Vermelha pendente que casa EXATO com uma linha em transito (barras, ou
  // codigo interno vindo do catalogo). { idDaLinha: vermelha }
  function vermelhasPorLinha(linhas, vermelhas) {
    var mapa = {};
    var pendentes = vermelhasPendentes(vermelhas);
    (linhas || []).forEach(function (l) {
      if (ENCERRADAS.indexOf(l.situacao) !== -1) return;
      var v = null;
      for (var i = 0; i < pendentes.length && !v; i++) {
        var p = pendentes[i];
        var ean = soDigitos(p.ean);
        if ((ean && l.ean && ean === l.ean) ||
            (l.codigoInterno && p.codigo && String(p.codigo).trim() === l.codigoInterno)) v = p;
      }
      if (v) mapa[l.id] = v;
    });
    return mapa;
  }

  function vermelhasPendentes(lista) {
    return (lista || []).filter(function (v) { return v && !v.resolvidaEm; })
      .sort(function (a, b) { return String(a.criadaEm || '').localeCompare(String(b.criadaEm || '')); });
  }

  // Produto da vermelha que aparece faturado (em transito ou recebido):
  // pelo codigo igual, ou pelo nome contido na descricao (com pelo menos
  // 4 letras, para "piso" sozinho nao casar com a loja inteira).
  // O codigo de barras (GTIN) e' a unica ligacao EXATA entre o estoque
  // interno e a nota do fornecedor (o codigo interno nao aparece na
  // NF-e). Sem ele, vale o codigo do item e o nome.
  function dicaDeFaturamento(vermelha, linhas) {
    var ean = soDigitos(vermelha && vermelha.ean);
    var codInterno = String((vermelha && vermelha.codigo) || '').trim();
    // Vermelha vinda da planilha tem o codigo INTERNO, que nao aparece na
    // NF-e (o da nota e' o do fornecedor): comparar os dois so' confunde.
    var cod = (vermelha && vermelha.origem === 'estoque') ? '' : norm(vermelha && vermelha.codigo);
    var nome = norm(vermelha && vermelha.produto);
    if (!ean && !cod && nome.length < 4) return [];
    return (linhas || []).filter(function (l) {
      if (ENCERRADAS.indexOf(l.situacao) !== -1) return false;
      if (ean && l.ean && l.ean === ean) return true;
      if (codInterno && l.codigoInterno && l.codigoInterno === codInterno) return true;
      if (cod && norm(l.codigo) === cod) return true;
      return nome.length >= 4 && norm(l.descricao).indexOf(nome) !== -1;
    });
  }

  /* ------------------------------------------------------------
     Importacao do estoque (relatorio "Estoque - Grade" do sistema)

     A planilha nao e' gravada em lugar nenhum: ela gera SUGESTOES de
     etiqueta vermelha, e so' o que a pessoa confirma vira documento.
     Regras (pedido de 09/10/2026):
     - asterisco no inicio do nome = nao vamos repor -> nunca sugere;
     - classes Amostras e Lojinha ficam de fora;
     - zerado (ou ate' o minimo escolhido), com ultima movimentacao
       (compra ou venda) dentro do prazo — produto parado ha' muito
       tempo nao ganha etiqueta;
     - ja' faturado (nota em transito com o mesmo codigo de barras, ou
       nome muito parecido) vai de AZUL, nao de vermelha;
     - o que ja' tem vermelha pendente, ou foi marcado como "nao
       trabalhamos mais", nao volta.
     ------------------------------------------------------------ */

  var COLUNAS_ESTOQUE = {
    codigo: /^codigo$/, nome: /^nome$/, un: /^unid/, quantidade: /^quantidade$/,
    ean: /^codigo barras/, classe: /^nome classe$/, subclasse: /^nome subclasse$/,
    fabricante: /^nome fabricante$/, familia: /^nome familia$/, ultData: /^ult\.? ?data/
  };
  var CLASSES_FORA = ['amostras', 'lojinha'];

  // matriz: linhas da planilha (a primeira que tiver Codigo + Nome +
  // Quantidade e' o cabecalho). Devolve { itens, problemas }.
  function lerPlanilhaEstoque(matriz) {
    var linhas = Array.isArray(matriz) ? matriz : [];
    var cab = -1, pos = {};
    for (var i = 0; i < Math.min(linhas.length, 30) && cab === -1; i++) {
      var p = {};
      (linhas[i] || []).forEach(function (celula, j) {
        var rot = norm(celula).trim();
        Object.keys(COLUNAS_ESTOQUE).forEach(function (k) {
          if (p[k] == null && COLUNAS_ESTOQUE[k].test(rot)) p[k] = j;
        });
      });
      if (p.codigo != null && p.nome != null && p.quantidade != null) { cab = i; pos = p; }
    }
    if (cab === -1) return { itens: [], problemas: ['Não achei o cabeçalho (Código, Nome, Quantidade) — é o relatório "Estoque - Grade"?'] };
    var itens = [], problemas = [];
    if (pos.ultData == null) problemas.push('coluna "Últ. Data" não encontrada: sem ela ninguém é classificado como parado (saldão/promoção)');
    // "15/09/2026 14:33" (data com hora) vira so' a data.
    var lerData = function (v) {
      if (typeof v === 'string') v = v.trim().replace(/[ T]\d{1,2}:\d{2}.*$/, '');
      return App.dataDeCelula(v) || null;
    };
    var celula = function (linha, k) { return pos[k] == null ? null : linha[pos[k]]; };
    linhas.slice(cab + 1).forEach(function (linha, idx) {
      if (!linha || celula(linha, 'codigo') == null || celula(linha, 'codigo') === '') return;
      var nome = String(celula(linha, 'nome') == null ? '' : celula(linha, 'nome')).trim();
      var q = celula(linha, 'quantidade');
      var qtd = (typeof q === 'number') ? q : App.parseNumeroBR(String(q == null ? '' : q));
      if (qtd == null || isNaN(qtd)) { problemas.push('linha ' + (cab + idx + 2) + ': quantidade ilegível (' + nome + ')'); qtd = null; }
      itens.push({
        codigo: String(celula(linha, 'codigo')).trim(),
        nome: nome,
        naoRepor: /^\*/.test(nome),
        un: String(celula(linha, 'un') == null ? '' : celula(linha, 'un')).trim(),
        quantidade: qtd,
        ean: soDigitos(celula(linha, 'ean')),
        classe: String(celula(linha, 'classe') == null ? '' : celula(linha, 'classe')).trim(),
        subclasse: String(celula(linha, 'subclasse') == null ? '' : celula(linha, 'subclasse')).trim(),
        fabricante: String(celula(linha, 'fabricante') == null ? '' : celula(linha, 'fabricante')).trim(),
        familia: String(celula(linha, 'familia') == null ? '' : celula(linha, 'familia')).trim(),
        ultData: lerData(celula(linha, 'ultData'))
      });
    });
    return { itens: itens, problemas: problemas };
  }

  function foraDoControle(item) {
    return CLASSES_FORA.indexOf(norm(item.classe)) !== -1 || CLASSES_FORA.indexOf(norm(item.subclasse)) !== -1;
  }

  // Nome do estoque x descricao da nota, sem o codigo de barras: as
  // palavras com 3+ letras/numeros, e a fracao delas que aparece do
  // outro lado. "PISO REF 75004 75X75 A POL (CX2,23MT) KARINA" e
  // "PISO 75004 75X75 POLIDO" dividem 75004 e 75X75 — e' isso que casa.
  function palavras(s) {
    var t = norm(s).replace(/[^a-z0-9]+/g, ' ').trim();
    return t ? t.split(' ').filter(function (w) { return w.length >= 3; }) : [];
  }
  // As palavras com digito (referencia, tamanho) do nome do estoque tem
  // que existir todas na descricao da nota — "57X57 CINZA" x "57X57
  // BEGE" dividem o tamanho, mas nao a cor, e com o corte em 0,75 a cor
  // decide.
  function semelhanca(a, b) {
    var pa = palavras(a), pb = palavras(b);
    if (!pa.length || !pb.length) return 0;
    var set = new Set(pb), comum = 0;
    // So' referencia (4+ digitos) e tamanho (NNxNN) sao chave; embalagem
    // ("CX2", "23MT") nao conta.
    var comDigito = pa.filter(function (w) { return /^[0-9]{4,}$/.test(w) || /^[0-9]+x[0-9]+/.test(w); });
    if (comDigito.length && !comDigito.every(function (w) { return set.has(w); })) return 0;
    pa.forEach(function (w) { if (set.has(w)) comum++; });
    return comum / Math.min(pa.length, pb.length);
  }
  var SEMELHANCA_MINIMA = 0.75;

  // Linhas em transito (nao encerradas) que parecem ser este item.
  function faturadosDoItem(item, linhas) {
    return (linhas || []).filter(function (l) {
      if (ENCERRADAS.indexOf(l.situacao) !== -1) return false;
      if (item.ean && l.ean) return l.ean === item.ean;
      return semelhanca(item.nome, l.descricao) >= SEMELHANCA_MINIMA;
    });
  }

  // Classificacao de cada produto vendavel (pedido de 12/10/2026):
  //
  //   movimentou nos ultimos N dias | estoque ate' o minimo, sem nota  -> VERMELHA (sugestao)
  //   movimentou                    | estoque ate' o minimo, com nota  -> AZUL (ja' faturado)
  //   movimentou                    | acima do minimo                  -> normal
  //   parado                        | zero                             -> nada (nem vender nem repor)
  //   parado                        | de 1 ate' o minimo               -> SALDAO
  //   parado                        | acima do minimo                  -> PROMOCAO
  //
  // o: { hoje, minimo (padrao 40), dias (padrao 90), ignorados {codigo: ...},
  //      marcados {codigo: { tipo: 'saldao'|'promocao' }} — ja' esta' la' }
  // Devolve { sugerir, jaFaturados, saldao, promocao, jaMarcados } (listas)
  // e as contagens do que ficou de fora: naoRepor, paradosSemEstoque,
  // foraDoControle, ignorados, jaVermelhas, normais.
  function sugestoesVermelhas(estoque, linhas, vermelhas, o) {
    o = o || {};
    var minimo = o.minimo == null ? 40 : Number(o.minimo);
    var dias = o.dias == null ? 90 : Number(o.dias);
    var corte = o.hoje && dias > 0 ? App.somarDias(o.hoje, -dias) : null;
    var ignorados = o.ignorados || {};
    var marcados = o.marcados || {};
    var pendentes = vermelhasPendentes(vermelhas);
    var r = { sugerir: [], jaFaturados: [], saldao: [], promocao: [], jaMarcados: [],
      naoRepor: 0, paradosSemEstoque: 0, foraDoControle: 0, ignorados: 0, jaVermelhas: 0, normais: 0, semData: 0 };
    (estoque || []).forEach(function (item) {
      if (foraDoControle(item)) { r.foraDoControle++; return; }
      if (item.naoRepor) { r.naoRepor++; return; }
      if (item.quantidade == null) { r.normais++; return; }
      // Sem data de movimentacao nao da' para dizer "parado": fica de
      // fora e contado, em vez de virar saldao/promocao por engano.
      if (corte && !item.ultData) { r.semData++; return; }
      var parado = !!(corte && item.ultData < corte);
      if (parado) {
        if (item.quantidade <= 0) { r.paradosSemEstoque++; return; }
        var marca = marcados[item.codigo];
        if (marca && marca.tipo) { r.jaMarcados.push({ item: item, tipo: marca.tipo, em: marca.em || null }); return; }
        (item.quantidade <= minimo ? r.saldao : r.promocao).push(item);
        return;
      }
      if (item.quantidade > minimo) { r.normais++; return; }
      if (ignorados[item.codigo]) { r.ignorados++; return; }
      if (pendentes.some(function (v) {
        return (item.ean && soDigitos(v.ean) === item.ean) || (v.codigo && String(v.codigo) === item.codigo);
      })) { r.jaVermelhas++; return; }
      var fat = faturadosDoItem(item, linhas);
      if (fat.length) r.jaFaturados.push({ item: item, linhas: fat });
      else r.sugerir.push(item);
    });
    var porNome = function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); };
    r.sugerir.sort(porNome);
    r.saldao.sort(porNome);
    r.promocao.sort(porNome);
    r.jaFaturados.sort(function (a, b) { return porNome(a.item, b.item); });
    r.jaMarcados.sort(function (a, b) { return porNome(a.item, b.item); });
    return r;
  }

  // Vermelha pendente cujo produto aparece COM estoque na planilha: a
  // mercadoria chegou por fora do que o app viu — hora de tirar a etiqueta.
  function vermelhasComEstoque(vermelhas, estoque, minimo) {
    var min = minimo == null ? 40 : Number(minimo);
    var porEan = {}, porCodigo = {};
    (estoque || []).forEach(function (it) {
      if (it.ean) porEan[it.ean] = it;
      if (it.codigo) porCodigo[it.codigo] = it;
    });
    var lista = [];
    vermelhasPendentes(vermelhas).forEach(function (v) {
      var it = (soDigitos(v.ean) && porEan[soDigitos(v.ean)]) || (v.codigo && porCodigo[String(v.codigo)]) || null;
      if (it && it.quantidade != null && it.quantidade > min) lista.push({ vermelha: v, item: it });
    });
    return lista;
  }

  /* ------------------------------------------------------------
     Saldao (registro proprio — pedido da equipe, 22/10/2026)

     Produto que foi para o saldao, interno (dentro da loja) ou externo
     (area externa). Documento na colecao `etiquetas` com tipo 'saldao':
     { produto, codigo, ean, local, estoqueInicial, obs, criadaEm,
       encerradaEm }. O estoque de agora vem do catalogo (ultima
     importacao): a lista mostra inicial -> atual e o que saiu, e avisa
     quando zerou.
     ------------------------------------------------------------ */
  var LOCAIS_SALDAO = { interno: 'Interno', externo: 'Externo' };

  function saldoesAtivos(lista) {
    return (lista || []).filter(function (s) { return s && !s.encerradaEm; })
      .sort(function (a, b) {
        return ((a.local === 'externo') - (b.local === 'externo')) || // interno primeiro
          String(a.produto || '').localeCompare(String(b.produto || ''), 'pt-BR');
      });
  }
  // Estoque do saldao pelo catalogo: { inicial, atual, saiu, zerado, semDado }
  function estoqueDoSaldao(s, catalogo) {
    var p = produtoDoCatalogo(catalogo, s && s.codigo);
    var atual = p && p.qtd != null ? p.qtd : null;
    var inicial = s && s.estoqueInicial != null ? Number(s.estoqueInicial) : null;
    return {
      inicial: inicial,
      atual: atual,
      saiu: (inicial != null && atual != null) ? Math.max(0, inicial - atual) : null,
      zerado: atual != null && atual <= 0,
      semDado: atual == null
    };
  }
  // Para a classificacao do estoque importado: quem ja' esta' no saldao
  // conta como marcado (nao volta como sugestao).
  function marcadosComSaldao(marcados, saldoes) {
    var m = Object.assign({}, marcados || {});
    saldoesAtivos(saldoes).forEach(function (s) {
      if (s.codigo && !m[s.codigo]) m[s.codigo] = { tipo: 'saldao', em: s.criadaEm || null, registro: true };
    });
    return m;
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
      ordenar(agrupar(lista)).forEach(function (l) {
        if (!porForn[l.fornecedor]) { porForn[l.fornecedor] = []; ordem.push(l.fornecedor); }
        porForn[l.fornecedor].push(l);
      });
      ordem.sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
      ordem.forEach(function (forn) {
        h += '<div class="rl-forn">' + e(forn) + '</div>' +
          '<table class="rl-tab"><thead><tr><th class="rl-ok"></th><th class="rl-cod">CÓD</th><th>PRODUTO</th>' +
          '<th class="rl-q">QTD</th><th class="rl-nf">NF · EMISSÃO</th></tr></thead><tbody>';
        porForn[forn].forEach(function (l) {
          h += '<tr><td class="rl-ok"><span class="rl-caixa"></span></td><td>' + e(l.codigoInterno || '') + '</td>' +
            '<td>' + e(l.descricao) + (l.nomeInterno ? ' <span class="rl-qtd">· ' + e(l.nomeInterno) + '</span>' : '') +
            (o.onde && o.onde(l) ? ' <b>· ' + e(o.onde(l)) + '</b>' : '') +
            (l.possivelNovo ? ' <b>· NOVO? (não está no cadastro)</b>' : '') +
            (l.tipoEtiqueta === 'naoExposto' ? ' <b>· NÃO EXPOSTO — expor o produto</b>' : '') +
            (l.estoqueBaixo && l.situacao === 'etiquetar' ? ' <span class="rl-qtd">· estoque baixo (marcado à mão)</span>' : '') +
            (l.recebidaEm ? ' <span class="rl-qtd">· recebida em ' + e(App.fmtData(l.recebidaEm)) + '</span>' : '') + '</td>' +
            '<td class="rl-q">' + e(fmtQtd(l.qtd) + (l.un ? ' ' + l.un : '')) + '</td>' +
            '<td class="rl-nf">' + e([textoNotas(l), textoEmissao(l)].filter(Boolean).join(' · ')) + '</td></tr>';
        });
        h += '</tbody></table>';
      });
      return h;
    }

    // Saldao e promocao (vem da planilha de estoque importada; opcional).
    function secaoEstoque(titulo, lista) {
      var h = '<div class="rl-secao">' + e(titulo) + ' <span class="rl-qtd">(' + lista.length + ')</span></div>';
      if (!lista.length) return h + '<div class="rl-vazio">Nenhum produto.</div>';
      h += '<table class="rl-tab"><thead><tr><th class="rl-ok"></th><th>PRODUTO</th><th class="rl-q">ESTOQUE</th><th class="rl-nf">ÚLT. MOV.</th></tr></thead><tbody>';
      lista.forEach(function (it) {
        h += '<tr><td class="rl-ok"><span class="rl-caixa"></span></td><td>' + e(it.nome) + (it.fabricante ? ' <span class="rl-qtd">· ' + e(it.fabricante) + '</span>' : '') + '</td>' +
          '<td class="rl-q">' + e(fmtQtd(it.quantidade) + (it.un ? ' ' + it.un : '')) + '</td>' +
          '<td class="rl-nf">' + e(it.ultData ? App.fmtData(it.ultData) : '') + '</td></tr>';
      });
      return h + '</tbody></table>';
    }
    var registrados = saldoesAtivos(o.saldoes);
    var hSaldao = '';
    if (registrados.length) {
      hSaldao = '<div class="rl-secao">SALDÃO EM ANDAMENTO <span class="rl-qtd">(' + registrados.length + ')</span></div>';
      ['interno', 'externo'].forEach(function (local) {
        var lista = registrados.filter(function (s) { return (s.local || 'interno') === local; });
        if (!lista.length) return;
        hSaldao += '<div class="rl-forn">' + e(LOCAIS_SALDAO[local]) + ' (' + lista.length + ')</div>' +
          '<table class="rl-tab"><thead><tr><th class="rl-ok"></th><th class="rl-cod">CÓD</th><th>PRODUTO</th><th class="rl-q">ESTOQUE</th><th class="rl-nf">DESDE</th></tr></thead><tbody>';
        lista.forEach(function (s) {
          var est = estoqueDoSaldao(s, o.catalogo);
          hSaldao += '<tr><td class="rl-ok"><span class="rl-caixa"></span></td><td>' + e(s.codigo || '') + '</td>' +
            '<td>' + e(s.produto || '') + (s.obs ? ' <span class="rl-qtd">· ' + e(s.obs) + '</span>' : '') + (est.zerado ? ' <b>· ZEROU</b>' : '') + '</td>' +
            '<td class="rl-q">' + e(est.atual != null ? fmtQtd(est.atual) + (est.inicial != null ? ' de ' + fmtQtd(est.inicial) : '') : '') + '</td>' +
            '<td class="rl-nf">' + e(s.criadaEm ? App.fmtData(s.criadaEm) : '') + '</td></tr>';
        });
        hSaldao += '</tbody></table>';
      });
    }
    var est = o.estoque || null;
    var hEstoque = !est ? '' :
      secaoEstoque('SALDÃO — PARADO, ESTOQUE ATÉ O MÍNIMO', est.saldao || []) +
      secaoEstoque('PROMOÇÃO — PARADO, ESTOQUE ACIMA DO MÍNIMO', est.promocao || []);

    var retirar = (linhas || []).filter(function (l) { return l.situacao === 'retirar'; });
    var comVermelha = vermelhasPorLinha(linhas, vermelhas);
    var trocar = (linhas || []).filter(function (l) { return l.situacao === 'etiquetar' && comVermelha[l.id]; });
    var etiquetar = (linhas || []).filter(function (l) { return l.situacao === 'etiquetar' && !comVermelha[l.id]; });
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
      (trocar.length ? secao('TROCAR VERMELHA POR AZUL — FATURADO, TINHA VERMELHA NA GÔNDOLA', trocar, '') : '') +
      secao('COLOCAR ETIQUETA AZUL — FATURADO, A CAMINHO', etiquetar, 'Nada para etiquetar.') +
      hv +
      hSaldao +
      hEstoque +
      '</div>';
  }

  var EtiquetasNucleo = {
    SITUACOES: SITUACOES,
    GRUPOS: GRUPOS,
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
    LOCAIS_SALDAO: LOCAIS_SALDAO,
    saldoesAtivos: saldoesAtivos,
    estoqueDoSaldao: estoqueDoSaldao,
    marcadosComSaldao: marcadosComSaldao,
    vermelhasPorLinha: vermelhasPorLinha,
    agrupar: agrupar,
    textoNotas: textoNotas,
    textoEmissao: textoEmissao,
    montarCatalogo: montarCatalogo,
    expandirCatalogo: expandirCatalogo,
    produtoDoCatalogo: produtoDoCatalogo,
    dicaDeFaturamento: dicaDeFaturamento,
    lerPlanilhaEstoque: lerPlanilhaEstoque,
    semelhanca: semelhanca,
    faturadosDoItem: faturadosDoItem,
    sugestoesVermelhas: sugestoesVermelhas,
    vermelhasComEstoque: vermelhasComEstoque,
    htmlRelatorio: htmlRelatorio
  };

  global.EtiquetasNucleo = EtiquetasNucleo;
  if (typeof module === 'object' && module.exports) module.exports = EtiquetasNucleo;
})(typeof window !== 'undefined' ? window : globalThis);
