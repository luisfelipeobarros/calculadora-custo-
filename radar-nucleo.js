/*
  Nucleo do Radar de estoque e compras (aba "Radar" da Calculadora) — 23/10/2026.

  Entrada diaria: o relatorio de vendas do sistema (codigo interno,
  nome, codigo de barras, vendas e estoque do periodo). O radar cruza
  cada produto com:
  - o cadastro de Produtos salvos da Calculadora (preco de venda; custo e
    fornecedor so' quando o relatorio nao traz), pelo codigo interno;
  - a CARTEIRA: itens de cotacao com status "pedido", pelo codigo interno;
  - o FATURADO e o RECEBIDO: itens das NF-e emitidas, pelo codigo de
    barras (o mesmo elo do app de Etiquetas);
  e sugere a compra: media diaria x dias de cobertura, menos o que ha'
  em estoque, em carteira e faturado.

  Puro: recebe documentos e devolve linhas, contagens e o resumo a
  gravar. Nada de Firebase aqui.
*/
(function (global) {
  'use strict';

  var App = (typeof module === 'object' && module.exports)
    ? require('./app-shared.js')
    : global.App;
  if (!App || !App.normalizarTexto) {
    throw new Error('radar-nucleo.js precisa de app-shared.js carregado antes.');
  }
  var norm = App.normalizarTexto;
  function soDigitos(v) { return String(v == null ? '' : v).replace(/[^0-9]/g, ''); }
  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var n = App.parseNumeroBR(String(v));
    return n == null || isNaN(n) ? null : n;
  }

  var PARAMETROS_PADRAO = { periodoDias: 60, coberturaDias: 30, baixoGiroMax: 0, compraMinima: 1, minVendasFeitas: 3, pedidoVelhoDias: 60 };
  // Classes do sistema que o app de Etiquetas controla (piso ceramico,
  // revestimento ceramico, porcelanato) — a coluna Ordem_Classe do relatorio.
  var CLASSES_PISOS = ['10000', '10016', '10002'];
  var DIAS_PEDIDO_FEITO = 60; // marca manual "pedido feito" expira depois disto

  /* ------------------------------------------------------------
     1. Leitura do relatorio de vendas
     ------------------------------------------------------------ */
  // Dois relatorios do sistema: o de vendas (codigo, nome, barras, vendas,
  // valor, estoque) e o "Produtos a Comprar" (o mesmo, mais fornecedor,
  // classe, periodo, ultima compra, custo e numero de vendas feitas).
  var COLUNAS = {
    codigo: /^codigo( do)? produto$|^codigo$/, nome: /^nome( do)? produto$|^nome$|^produto$|^descricao/,
    ean: /^codigo (de )?barras/, vendas: /^vendas$|^qtd(\.|e)? vendida|^quantidade vendida/,
    valor: /^valor( vendido| total)?$/, estoque: /^estoque/,
    fornecedor: /^fornecedor/, classe: /^ordem[ _]?classe|^classe$/,
    dataInicial: /^data[ _]?inicial/, dataFinal: /^data[ _]?final/,
    ultCompraQtd: /^qtde?\.? ?ult\.? ?compra/, ultCompra: /^ult\.? ?compra/,
    custo: /^c\.? ?nf-?e|^custo|^preco (de )?compra/, transacoes: /^qtd\.? ?vendas feitas|^vendas feitas|^transacoes/
  };

  // matriz: linhas da planilha. Devolve { itens, problemas }.
  function lerPlanilhaVendas(matriz) {
    var linhas = Array.isArray(matriz) ? matriz : [];
    var cab = -1, pos = {};
    for (var i = 0; i < Math.min(linhas.length, 30) && cab === -1; i++) {
      var p = {};
      (linhas[i] || []).forEach(function (celula, j) {
        var rot = norm(celula).trim();
        Object.keys(COLUNAS).forEach(function (k) { if (p[k] == null && COLUNAS[k].test(rot)) p[k] = j; });
      });
      if (p.codigo != null && p.nome != null && p.estoque != null && p.vendas != null) { cab = i; pos = p; }
    }
    if (cab === -1) return { itens: [], problemas: ['Não achei o cabeçalho (Código Produto, Nome Produto, Vendas, Estoque) — é o relatório de vendas do sistema?'] };
    var itens = [], problemas = [];
    if (pos.ean == null) problemas.push('coluna "Código Barras" não encontrada: sem ela o radar não casa com as notas emitidas');
    var celula = function (linha, k) { return pos[k] == null ? null : linha[pos[k]]; };
    var texto = function (v) { return String(v == null ? '' : v).trim(); };
    var completo = pos.fornecedor != null; // relatorio "Produtos a Comprar"
    var periodo = null;
    linhas.slice(cab + 1).forEach(function (linha, idx) {
      if (!linha || celula(linha, 'codigo') == null || celula(linha, 'codigo') === '') return;
      var nome = texto(celula(linha, 'nome'));
      var vendas = num(celula(linha, 'vendas')), estoque = num(celula(linha, 'estoque'));
      if (vendas == null || estoque == null) {
        problemas.push('linha ' + (cab + idx + 2) + ': vendas ou estoque ilegível (' + nome + ')');
        return;
      }
      if (!periodo && pos.dataInicial != null && pos.dataFinal != null) {
        var ini = App.dataDeCelula(celula(linha, 'dataInicial')), fim = App.dataDeCelula(celula(linha, 'dataFinal'));
        if (ini && fim) periodo = { ini: ini, fim: fim, dias: App.diasEntre(ini, fim) + 1 };
      }
      var it = {
        codigo: texto(celula(linha, 'codigo')),
        nome: nome,
        naoRepor: /^\*/.test(nome),
        ean: soDigitos(celula(linha, 'ean')),
        vendas: vendas,
        valor: num(celula(linha, 'valor')) || 0,
        estoque: estoque
      };
      if (completo) {
        it.fornecedor = texto(celula(linha, 'fornecedor'));
        it.classe = soDigitos(celula(linha, 'classe'));
        it.custo = num(celula(linha, 'custo'));
        it.transacoes = pos.transacoes != null ? (num(celula(linha, 'transacoes')) || 0) : null;
        var uc = App.dataDeCelula(celula(linha, 'ultCompra'));
        it.ultimaCompra = uc ? { em: uc, qtd: num(celula(linha, 'ultCompraQtd')), preco: it.custo } : null;
      }
      itens.push(it);
    });
    if (completo && !periodo) problemas.push('colunas Data_Inicial/Data_Final sem data legível: o período fica o configurado');
    return { itens: itens, problemas: problemas, periodo: periodo, completo: completo };
  }

  // Documento compacto a gravar (config/radarVendas). `atual` e' o
  // documento anterior: o estoque dele vira "anterior" para mostrar a
  // variacao entre uma importacao e outra.
  // periodo: { ini, fim, dias } do relatorio completo (vence periodoDias).
  function resumoVendas(itens, hoje, periodoDias, atual, periodo) {
    var produtos = {}, anterior = {};
    (itens || []).forEach(function (it) {
      var p = { n: it.nome, e: it.ean || '', v: it.vendas, r: it.valor, q: it.estoque };
      if (it.fornecedor) p.f = it.fornecedor;
      if (it.classe) p.k = it.classe;
      if (it.custo != null) p.c = it.custo;
      if (it.transacoes != null) p.t = it.transacoes;
      if (it.ultimaCompra) { p.ud = it.ultimaCompra.em; if (it.ultimaCompra.qtd != null) p.uq = it.ultimaCompra.qtd; }
      produtos[it.codigo] = p;
    });
    var antes = (atual && atual.produtos) || {};
    Object.keys(antes).forEach(function (c) { if (antes[c] && antes[c].q != null) anterior[c] = antes[c].q; });
    return {
      produtos: produtos, qtd: Object.keys(produtos).length, importadoEm: hoje,
      periodoDias: (periodo && periodo.dias) || periodoDias || PARAMETROS_PADRAO.periodoDias,
      periodoIni: (periodo && periodo.ini) || null, periodoFim: (periodo && periodo.fim) || null,
      anterior: anterior, anteriorEm: (atual && atual.importadoEm) || null
    };
  }

  // O Firestore limita cada documento a 1 MB e o relatorio inteiro
  // passa de 1,5 MB: o resumo vai em partes — config/radarVendas (meta +
  // estoque anterior) e config/radarVendas_p1..pN (os produtos). E cada
  // parte vai como TEXTO JSON num campo so': um mapa com milhares de
  // produtos estoura o limite de 40 mil entradas de indice por documento
  // ("too many index entries"), e texto nao e' indexado por dentro.
  var BYTES_POR_PARTE = 700000;
  function dividirResumo(doc, maxBytes) {
    var limite = maxBytes || BYTES_POR_PARTE;
    var partes = [], atual = {}, bytes = 0;
    Object.keys(doc.produtos || {}).forEach(function (codigo) {
      var b = JSON.stringify(doc.produtos[codigo]).length + codigo.length + 6;
      if (bytes + b > limite && Object.keys(atual).length) { partes.push(atual); atual = {}; bytes = 0; }
      atual[codigo] = doc.produtos[codigo];
      bytes += b;
    });
    if (Object.keys(atual).length || !partes.length) partes.push(atual);
    var meta = Object.assign({}, doc);
    delete meta.produtos;
    meta.partes = partes.length;
    // O estoque anterior tambem vira texto (9 mil chaves indexadas e' quase o limite).
    meta.anteriorJson = JSON.stringify(doc.anterior || {});
    delete meta.anterior;
    return { meta: meta, partes: partes.map(function (p) { return { json: JSON.stringify(p) }; }) };
  }
  function juntarResumo(meta, partes) {
    var produtos = {};
    (partes || []).forEach(function (p) {
      if (!p) return;
      if (typeof p.json === 'string') Object.assign(produtos, JSON.parse(p.json));
      else Object.assign(produtos, p.produtos || p);
    });
    var m = Object.assign({}, meta || {}, { produtos: produtos });
    if (typeof m.anteriorJson === 'string') { m.anterior = JSON.parse(m.anteriorJson); delete m.anteriorJson; }
    return m;
  }

  /* ------------------------------------------------------------
     2. Carteira (cotacoes) e movimentos (notas emitidas)
     ------------------------------------------------------------ */
  function dataISO(v) {
    if (!v) return null;
    if (typeof v === 'string') return v.length >= 10 ? v.slice(0, 10) : null;
    var d = typeof v.toDate === 'function' ? v.toDate() : (v instanceof Date ? v : null);
    return d && !isNaN(d.getTime()) ? App.iso(d) : null;
  }

  // Itens de cotacao com status "pedido": { codigo: { qtd, em, fornecedor, cotacoes } }
  // `em` e' a data em que o item virou pedido (pedidoEm); cotacao antiga
  // sem isso usa a data da cotacao.
  function carteira(cotacoes) {
    var mapa = {};
    (cotacoes || []).forEach(function (d) {
      var dataCot = dataISO(d && d.data);
      (d && d.itens || []).forEach(function (it) {
        if (!it) return;
        var st = it.status || 'negociacao';
        // Pedido inteiro, ou o que faltou faturar num pedido parcial.
        var qtd;
        if (st === 'pedido') qtd = it.quantidadeRecebida != null ? Number(it.quantidadeRecebida) : Number(it.quantidadeEsperada);
        else if (st === 'transito' && it.parcial && it.parcial.pedido > it.parcial.faturado) qtd = it.parcial.pedido - it.parcial.faturado;
        else return;
        var cod = String(it.codigo == null ? '' : it.codigo).trim();
        if (!cod) return;
        if (!isFinite(qtd)) qtd = 0;
        var em = it.pedidoEm || dataCot || null;
        var c = mapa[cod] || (mapa[cod] = { qtd: 0, em: null, fornecedor: '', cotacoes: 0, ids: [] });
        c.qtd += qtd;
        c.cotacoes++;
        if (d.id && c.ids.indexOf(d.id) < 0) c.ids.push(d.id);
        if (em && (!c.em || em > c.em)) { c.em = em; c.fornecedor = d.fornecedor || c.fornecedor; }
      });
    });
    return mapa;
  }

  // Itens das NF-e, por codigo de barras:
  // { ean: { faturado: { qtd, em, fornecedor, numero }, recebido: { qtd, em, fornecedor, numero }, ncm } }
  // faturado = notas ainda sem entrada no ERP (soma; data da mais recente);
  // recebido = a ultima nota que deu entrada (noSistemaEm ou o dia do carimbo).
  function movimentos(itensDocs, notasPorChave) {
    var mapa = {};
    (itensDocs || []).forEach(function (doc) {
      if (!doc) return;
      var nota = (notasPorChave || {})[doc.chave] || null;
      if (nota && (nota.status || 'ativa') === 'cancelada') return;
      var recebida = !!(nota && nota.noSistema === true);
      var recebidaEm = recebida ? (nota.noSistemaEm || dataISO(nota.alteradoEm) || null) : null;
      (doc.itens || []).forEach(function (it) {
        var ean = soDigitos(it && it.ean);
        if (!ean) return;
        var m = mapa[ean] || (mapa[ean] = { faturado: null, recebido: null, ncm: soDigitos(it.ncm) });
        var qtd = Number(it.qtd) || 0;
        if (!recebida) {
          if (!m.faturado) m.faturado = { qtd: 0, em: null, fornecedor: '', numero: '' };
          m.faturado.qtd += qtd;
          if (doc.dataEmissao && (!m.faturado.em || doc.dataEmissao > m.faturado.em)) {
            m.faturado.em = doc.dataEmissao; m.faturado.fornecedor = doc.nomeEmitente || ''; m.faturado.numero = doc.numero == null ? '' : String(doc.numero);
          }
        } else {
          var em = recebidaEm || doc.dataEmissao || null;
          if (!m.recebido || (em && (!m.recebido.em || em > m.recebido.em))) {
            m.recebido = { qtd: qtd, em: em, fornecedor: doc.nomeEmitente || '', numero: doc.numero == null ? '' : String(doc.numero) };
          }
        }
      });
    });
    return mapa;
  }

  /* ------------------------------------------------------------
     3. O radar em si
     ------------------------------------------------------------ */
  // o: { produtos (doc.produtos), anterior, periodoDias, fichas {codigo: {fornecedor, custo, venda}},
  //      carteira, movimentos, parametros, pedidos {codigo: {qtd, em, ref}}, hoje }
  function calcularRadar(o) {
    o = o || {};
    var par = Object.assign({}, PARAMETROS_PADRAO, o.parametros || {});
    var periodo = Number(o.periodoDias) > 0 ? Number(o.periodoDias) : par.periodoDias;
    var fichas = o.fichas || {}, cart = o.carteira || {}, mov = o.movimentos || {}, pedidos = o.pedidos || {};
    var anterior = o.anterior || {};
    // Codigo de barras repetido em mais de um produto: a nota nao diz de
    // qual deles e' — nao se atribui faturado/recebido a nenhum, e a
    // linha avisa para corrigir o cadastro.
    var usoEan = {};
    Object.keys(o.produtos || {}).forEach(function (codigo) {
      var e = soDigitos((o.produtos[codigo] || {}).e);
      if (e) usoEan[e] = (usoEan[e] || 0) + 1;
    });
    var linhas = [];
    Object.keys(o.produtos || {}).forEach(function (codigo) {
      var p = o.produtos[codigo] || {};
      var nome = p.n || '';
      var ean = soDigitos(p.e);
      var eanRepetido = !!(ean && usoEan[ean] > 1);
      var vendas = Number(p.v) || 0, estoque = Number(p.q) || 0;
      var mediaDia = vendas / periodo;
      var cobertura = mediaDia > 0 ? estoque / mediaDia : null; // null = sem venda no periodo
      var ficha = fichas[codigo] || null;
      // Custo: o da ultima compra (relatorio) vale mais que o da ficha.
      var custo = p.c > 0 ? Number(p.c) : (ficha && ficha.custo > 0 ? ficha.custo : null);
      var c = cart[codigo] || null;
      var m = (ean && !eanRepetido && mov[ean]) || null;
      var transacoes = p.t == null ? null : Number(p.t);
      // Venda concentrada: muita quantidade em poucas vendas (um pedido
      // grande) nao e' giro — a sugestao fica para conferir, fora da soma.
      var concentrada = transacoes != null && vendas > 0 && transacoes < par.minVendasFeitas;
      // Carteira so' conta enquanto e' pedido vivo: com recebimento DEPOIS
      // da data do pedido ela foi entregue; com nota faturada depois dele
      // o pedido virou a nota (ja' conta no faturado, nao soma duas vezes);
      // sem nota por mais de pedidoVelhoDias e' cotacao que ficou como
      // "pedido" e ninguem atualizou. Nos tres casos nao desconta da compra.
      if (c) {
        c = Object.assign({}, c);
        c.entregue = !!(m && m.recebido && m.recebido.em && c.em && m.recebido.em >= c.em);
        c.faturada = !c.entregue && !!(m && m.faturado && m.faturado.em && c.em && m.faturado.em >= c.em);
        c.dias = c.em && o.hoje ? App.diasEntre(c.em, o.hoje) : null;
        c.velho = !c.entregue && !c.faturada && c.dias != null && c.dias > par.pedidoVelhoDias;
      }
      var carteiraQtd = c && !c.entregue && !c.faturada && !c.velho ? c.qtd : 0;
      var faturadoQtd = m && m.faturado ? m.faturado.qtd : 0;
      var naoRepor = /^\*/.test(nome);
      var alvo = mediaDia * par.coberturaDias;
      var falta = alvo - estoque - carteiraQtd - faturadoQtd;
      var sugestao = (!naoRepor && falta > 0) ? Math.ceil(falta) : 0;
      if (sugestao > 0 && sugestao < par.compraMinima) sugestao = 0;
      // "Pedido feito" marcado a mao: sai da fila por DIAS_PEDIDO_FEITO dias,
      // ou ate' o pedido aparecer na carteira/nas notas.
      var pf = pedidos[codigo] || null;
      var pedidoFeito = !!(pf && pf.em && o.hoje && App.diasEntre(pf.em, o.hoje) <= DIAS_PEDIDO_FEITO && !(carteiraQtd > 0 || faturadoQtd > 0));
      var flags = {
        comprar: sugestao > 0 && !pedidoFeito && !concentrada,
        conferir: sugestao > 0 && !pedidoFeito && concentrada,
        chegando: carteiraQtd > 0 || faturadoQtd > 0,
        carteira: carteiraQtd > 0,
        faturado: faturadoQtd > 0,
        baixoGiro: estoque > 0 && vendas <= par.baixoGiroMax,
        // Pedido sem nota ha' mais que pedidoVelhoDias: confere um a um
        // no sistema e atualiza a cotacao (recebido ou cancelado).
        pedidoAntigo: !!(c && c.velho),
        pedidoFeito: pedidoFeito
      };
      linhas.push({
        codigo: codigo, nome: nome, ean: ean, naoRepor: naoRepor, eanRepetido: eanRepetido, classe: p.k || '',
        vendas: vendas, valor: Number(p.r) || 0, estoque: estoque, transacoes: transacoes, concentrada: concentrada,
        estoqueAnterior: anterior[codigo] != null ? Number(anterior[codigo]) : null,
        mediaDia: mediaDia, coberturaDias: cobertura == null ? null : Math.round(cobertura),
        fornecedor: p.f || (ficha && ficha.fornecedor) || (c && c.fornecedor) || (m && m.faturado && m.faturado.fornecedor) || '',
        custo: custo, custoDe: p.c > 0 ? 'última compra' : (custo != null ? 'cadastro' : null),
        venda: ficha && ficha.venda > 0 ? ficha.venda : null,
        ultimaCompra: p.ud ? { em: p.ud, qtd: p.uq == null ? null : Number(p.uq), preco: p.c > 0 ? Number(p.c) : null } : null,
        carteira: c, faturado: m && m.faturado || null, recebido: m && m.recebido || null,
        sugestao: sugestao, valorSugestao: custo != null ? App.centavos(sugestao * custo) : null,
        valorParado: custo != null ? App.centavos(estoque * custo) : null,
        pedido: pf, flags: flags
      });
    });
    return linhas;
  }

  var ABAS = {
    comprar: { rotulo: 'Comprar', flag: 'comprar' },
    conferir: { rotulo: 'Conferir', flag: 'conferir' },
    chegando: { rotulo: 'Chegando', flag: 'chegando' },
    carteira: { rotulo: 'Em carteira', flag: 'carteira' },
    faturado: { rotulo: 'Faturado', flag: 'faturado' },
    baixoGiro: { rotulo: 'Baixo giro', flag: 'baixoGiro' },
    pedidoAntigo: { rotulo: 'Pedido antigo', flag: 'pedidoAntigo' },
    pedidoFeito: { rotulo: 'Pedido feito', flag: 'pedidoFeito' },
    todos: { rotulo: 'Todos', flag: null }
  };

  function contar(linhas) {
    var c = { comprar: 0, valorComprar: 0, conferir: 0, chegando: 0, carteira: 0, faturado: 0, baixoGiro: 0, valorParado: 0, pedidoAntigo: 0, pedidoFeito: 0, todos: 0 };
    (linhas || []).forEach(function (l) {
      c.todos++;
      Object.keys(l.flags).forEach(function (f) { if (l.flags[f] && c[f] != null) c[f]++; });
      if (l.flags.comprar && l.valorSugestao != null) c.valorComprar += l.valorSugestao;
      if (l.flags.baixoGiro && l.valorParado != null) c.valorParado += l.valorParado;
    });
    c.valorComprar = App.centavos(c.valorComprar);
    c.valorParado = App.centavos(c.valorParado);
    return c;
  }

  function casaTermo(l, termo) {
    var t = norm(termo);
    if (!t) return true;
    return norm([l.nome, l.codigo, l.ean, l.fornecedor].join(' ')).indexOf(t) !== -1;
  }
  // f: { aba, termos, fornecedor }
  function filtrar(linhas, f) {
    var o = f || {};
    var flag = (ABAS[o.aba] || ABAS.todos).flag;
    var termos = (o.termos || []).filter(Boolean);
    return (linhas || []).filter(function (l) {
      if (flag && !l.flags[flag]) return false;
      if (o.fornecedor && l.fornecedor !== o.fornecedor) return false;
      if (termos.length && !termos.some(function (t) { return casaTermo(l, t); })) return false;
      return true;
    });
  }
  // Comprar: maior valor primeiro; baixo giro: maior valor parado; o resto: menor cobertura.
  function ordenar(linhas, aba) {
    return (linhas || []).slice().sort(function (a, b) {
      if (aba === 'comprar' || aba === 'conferir') return (b.valorSugestao || 0) - (a.valorSugestao || 0) || b.sugestao - a.sugestao;
      if (aba === 'baixoGiro') return (b.valorParado || 0) - (a.valorParado || 0) || b.estoque - a.estoque;
      if (aba === 'pedidoAntigo') return ((a.carteira && a.carteira.em) || '') < ((b.carteira && b.carteira.em) || '') ? -1 : 1;
      var ca = a.coberturaDias == null ? 1e9 : a.coberturaDias, cb = b.coberturaDias == null ? 1e9 : b.coberturaDias;
      return ca - cb || b.vendas - a.vendas;
    });
  }
  // Comprar, por fornecedor: [{ fornecedor, linhas, valor, itens }]
  function porFornecedor(linhas) {
    var por = {};
    (linhas || []).forEach(function (l) {
      var f = l.fornecedor || 'Sem fornecedor';
      var g = por[f] || (por[f] = { fornecedor: f, linhas: [], valor: 0, itens: 0 });
      g.linhas.push(l); g.itens++; g.valor += l.valorSugestao || 0;
    });
    return Object.keys(por).map(function (k) { por[k].valor = App.centavos(por[k].valor); return por[k]; })
      .sort(function (a, b) { return b.valor - a.valor || b.itens - a.itens; });
  }

  function linhasExcel(linhas) {
    return (linhas || []).map(function (l) {
      return {
        'Código': l.codigo, 'Produto': l.nome, 'Código de barras': l.ean, 'Fornecedor': l.fornecedor,
        'Vendas no período': l.vendas, 'Vendas feitas': l.transacoes == null ? '' : l.transacoes, 'Média/dia': Math.round(l.mediaDia * 100) / 100,
        'Última compra': l.ultimaCompra ? l.ultimaCompra.em : '', 'Qtd últ. compra': l.ultimaCompra && l.ultimaCompra.qtd != null ? l.ultimaCompra.qtd : '',
        'Estoque': l.estoque, 'Estoque anterior': l.estoqueAnterior == null ? '' : l.estoqueAnterior,
        'Cobertura (dias)': l.coberturaDias == null ? '' : l.coberturaDias,
        'Em carteira': l.carteira ? l.carteira.qtd : 0, 'Pedido em': l.carteira && l.carteira.em ? l.carteira.em : '',
        'Faturado': l.faturado ? l.faturado.qtd : 0, 'Faturado em': l.faturado && l.faturado.em ? l.faturado.em : '',
        'Recebido em': l.recebido && l.recebido.em ? l.recebido.em : '', 'Qtd recebida': l.recebido ? l.recebido.qtd : '',
        'Sugestão': l.sugestao, 'Custo unit.': l.custo == null ? '' : l.custo, 'Valor sugerido': l.valorSugestao == null ? '' : l.valorSugestao,
        'Situação': [l.flags.comprar ? 'comprar' : '', l.flags.conferir ? 'conferir (venda concentrada)' : '', l.flags.chegando ? 'chegando' : '', l.flags.baixoGiro ? 'baixo giro' : '', l.flags.pedidoAntigo ? 'pedido antigo (sem nota)' : '', l.flags.pedidoFeito ? 'pedido feito' : '', l.eanRepetido ? 'barras repetido' : ''].filter(Boolean).join(', ')
      };
    });
  }

  /* ------------------------------------------------------------
     3b. Cotacao x NF-e: faturado e recebido sem ninguem clicar

     Depois do pedido, a nota do fornecedor chega; o app casa cada item
     da cotacao com o item da nota e avanca o status sozinho:
       pedido -> transito (faturado, data da emissao)
              -> recebido (a nota entrou no ERP, noSistemaEm)
     Chaves, na ordem de confianca:
       1. codigo do fornecedor da cotacao (o que veio no PDF dele) = cProd;
       2. codigo de barras (codigo interno -> barras pelo relatorio do radar);
       3. nome muito parecido, so' quando e' unico dentro da nota.
     So' notas de fornecedor compativel e emitidas a partir do pedido.
     O status nunca anda para tras.
     ------------------------------------------------------------ */
  var ORDEM_STATUS = { negociacao: 0, pedido: 1, transito: 2, recebido: 3 };
  var SUFIXO_NOME = /^(ltda|sa|s|a|me|epp|eireli|cia|e|de|do|da|dos|das|ind|industria|comercio|com)$/;
  function palavrasDoNome(s) {
    return norm(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function (p) { return p && !SUFIXO_NOME.test(p); });
  }
  // Primeiras duas palavras iguais (ou a unica): "CERAMICA FORMIGRES" bate
  // com "CERAMICA FORMIGRES LTDA." e nao com "CERAMICA CAPRI".
  function nomesCompativeis(a, b) {
    var pa = palavrasDoNome(a), pb = palavrasDoNome(b);
    if (!pa.length || !pb.length) return false;
    if (pa[0] !== pb[0]) return false;
    if (pa.length < 2 || pb.length < 2) return true;
    return pa[1] === pb[1];
  }
  function palavras(s) {
    var t = norm(s).replace(/[^a-z0-9]+/g, ' ').trim();
    return t ? t.split(' ').filter(function (w) { return w.length >= 3; }) : [];
  }
  // Mesma regra do Etiquetas: referencia (4+ digitos) e tamanho (NNxNN) do
  // nome da cotacao tem que existir na descricao da nota; corte 0,75.
  function semelhancaNomes(a, b) {
    var pa = palavras(a), pb = palavras(b);
    if (!pa.length || !pb.length) return 0;
    var set = new Set(pb), comum = 0;
    var chave = pa.filter(function (w) { return /^[0-9]{4,}$/.test(w) || /^[0-9]+x[0-9]+/.test(w); });
    if (chave.length && !chave.every(function (w) { return set.has(w); })) return 0;
    pa.forEach(function (w) { if (set.has(w)) comum++; });
    return comum / Math.min(pa.length, pb.length);
  }
  function codigoNorm(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

  // cotacao: { fornecedor, data, itens, chavesNfe }; itensDocs: notas com itens
  // (chave, numero, dataEmissao, nomeEmitente, itens [{codigo, ean, descricao, qtd}]);
  // notasPorChave: estado (noSistema, noSistemaEm, alteradoEm, status);
  // eanPorCodigo: codigo interno -> barras. Devolve { itens, chavesNfe, mudou }.
  function casarCotacaoComNotas(cotacao, itensDocs, notasPorChave, eanPorCodigo, hoje) {
    var d = cotacao || {};
    var itens = (d.itens || []).map(function (it) { return Object.assign({}, it); });
    var chaves = (d.chavesNfe || []).slice();
    var vinculadas = new Set(chaves);
    var dataCot = dataISO(d.data);
    var mudou = false;
    var desde = null; // notas emitidas a partir do pedido (com folga de 3 dias)
    itens.forEach(function (it) { if (it.pedidoEm && (!desde || it.pedidoEm < desde)) desde = it.pedidoEm; });
    desde = desde || dataCot;
    if (desde) desde = App.somarDias(desde, -3);

    var candidatas = (itensDocs || []).filter(function (doc) {
      if (!doc || !doc.chave) return false;
      var nota = (notasPorChave || {})[doc.chave] || null;
      if (nota && (nota.status || 'ativa') === 'cancelada') return false;
      if (vinculadas.has(doc.chave)) return true;
      if (!nomesCompativeis(d.fornecedor, doc.nomeEmitente)) return false;
      return !desde || !doc.dataEmissao || doc.dataEmissao >= desde;
    }).sort(function (a, b) {
      // Vinculada primeiro; depois a mais recente.
      return (vinculadas.has(b.chave) - vinculadas.has(a.chave)) || String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || ''));
    });

    itens.forEach(function (it, idx) {
      if ((it.status || 'negociacao') === 'recebido' && it.chaveNfe && !it.parcial) return; // ja' fechado
      var codForn = codigoNorm(it.codigoRecebido);
      var ean = soDigitos(eanPorCodigo && eanPorCodigo[String(it.codigo == null ? '' : it.codigo).trim()]);
      // TODAS as notas que casam: o pedido pode vir em mais de uma
      // (faturamento parcial), e so' fecha quando a soma cobre a quantidade.
      var achados = [];
      candidatas.forEach(function (doc) {
        var lista = doc.itens || [];
        var porCodigo = codForn ? lista.filter(function (x) { return codigoNorm(x && x.codigo) === codForn; }) : [];
        var porEan = (!porCodigo.length && ean) ? lista.filter(function (x) { return soDigitos(x && x.ean) === ean; }) : [];
        var porNome = (!porCodigo.length && !porEan.length) ? lista.filter(function (x) { return semelhancaNomes(it.produto, x && x.descricao) >= 0.75; }) : [];
        var item = porCodigo[0] || porEan[0] || (porNome.length === 1 ? porNome[0] : null);
        if (!item) return;
        var nota = (notasPorChave || {})[doc.chave] || null;
        var recebida = !!(nota && nota.noSistema === true);
        achados.push({
          doc: doc, item: item, por: porCodigo.length ? 'código do fornecedor' : porEan.length ? 'código de barras' : 'nome',
          recebida: recebida,
          recebidaEm: recebida ? (nota.noSistemaEm || dataISO(nota.alteradoEm) || doc.dataEmissao || hoje || null) : null
        });
      });
      if (!achados.length) return;
      var ultimo = achados[0]; // candidatas ja' vem da mais recente para a mais antiga
      var qtdNfe = achados.reduce(function (s, a) { return s + (Number(a.item.qtd) || 0); }, 0);
      var qtdPedida = it.quantidadeRecebida != null ? Number(it.quantidadeRecebida) : Number(it.quantidadeEsperada);
      var parcial = (qtdPedida > 0 && qtdNfe > 0 && qtdNfe < qtdPedida - 0.001) ? { faturado: qtdNfe, pedido: qtdPedida } : null;
      var todasRecebidas = achados.every(function (a) { return a.recebida; });
      var novoStatus = (todasRecebidas && !parcial) ? 'recebido' : 'transito';
      var atual = it.status || 'negociacao';
      var recebidas = achados.filter(function (a) { return a.recebida; });
      var ultimaRecebida = recebidas.reduce(function (m, a) { return (!m || (a.recebidaEm || '') > (m.recebidaEm || '')) ? a : m; }, null);
      var precoNfe = ultimo.item.vUnit != null ? Number(ultimo.item.vUnit) : null;
      var campos = {
        chaveNfe: ultimo.doc.chave,
        numeroNfe: ultimo.doc.numero == null ? '' : String(ultimo.doc.numero),
        notasNfe: achados.map(function (a) { return { chave: a.doc.chave, numero: a.doc.numero == null ? '' : String(a.doc.numero), em: a.doc.dataEmissao || null, qtd: Number(a.item.qtd) || 0, recebida: a.recebida }; }),
        qtdNfe: qtdNfe || null,
        parcial: parcial,
        precoNfe: precoNfe != null && isFinite(precoNfe) ? precoNfe : null,
        casadoPor: ultimo.por,
        faturadoEm: ultimo.doc.dataEmissao || it.faturadoEm || null,
        recebidoEm: ultimaRecebida ? ultimaRecebida.recebidaEm : (it.recebidoEm || null)
      };
      if (ORDEM_STATUS[novoStatus] > (ORDEM_STATUS[atual] || 0)) campos.status = novoStatus;
      if (!it.pedidoEm && campos.status) campos.pedidoEm = it.pedidoEm || dataCot || null;
      Object.keys(campos).forEach(function (k) {
        if (campos[k] == null && it[k] == null) return;
        if (JSON.stringify(it[k] == null ? null : it[k]) !== JSON.stringify(campos[k] == null ? null : campos[k])) { it[k] = campos[k]; mudou = true; }
      });
      achados.forEach(function (a) {
        if (!vinculadas.has(a.doc.chave)) { vinculadas.add(a.doc.chave); chaves.push(a.doc.chave); mudou = true; }
      });
    });
    return { itens: itens, chavesNfe: chaves, mudou: mudou };
  }

  // Diferenca do preco da nota contra o cotado (recebido na cotacao, ou o
  // esperado): > 0 subiu. null quando falta um dos dois.
  function diferencaPrecoNfe(it) {
    var cotado = it && it.precoRecebido != null ? Number(it.precoRecebido) : (it && it.precoEsperado != null ? Number(it.precoEsperado) : null);
    if (!it || it.precoNfe == null || !(cotado > 0)) return null;
    return it.precoNfe / cotado - 1;
  }
  // Selos do cabecalho da cotacao no Historico.
  // { semNota: { itens, dias } | null, parciais, precoAcima, precoAbaixo }
  function alertasDaCotacao(cotacao, hoje, diasSemNota) {
    var limite = diasSemNota || 60;
    var r = { semNota: null, parciais: 0, precoAcima: 0, precoAbaixo: 0 };
    var dataCot = dataISO(cotacao && cotacao.data);
    var maisVelho = 0, semNota = 0;
    ((cotacao && cotacao.itens) || []).forEach(function (it) {
      if (!it) return;
      if ((it.status || 'negociacao') === 'pedido' && !it.chaveNfe) {
        var em = it.pedidoEm || dataCot;
        var dias = em && hoje ? App.diasEntre(em, hoje) : 0;
        if (dias > limite) { semNota++; if (dias > maisVelho) maisVelho = dias; }
      }
      if (it.parcial) r.parciais++;
      var dif = diferencaPrecoNfe(it);
      if (dif != null && dif > 0.005) r.precoAcima++;
      if (dif != null && dif < -0.005) r.precoAbaixo++;
    });
    if (semNota) r.semNota = { itens: semNota, dias: maisVelho };
    return r;
  }

  // Botao "Pedido feito" na cotacao: tudo que ainda esta' em negociacao
  // vira pedido, com a data. Devolve os itens novos (ou null se nada mudou).
  function pedidoFeitoNaCotacao(cotacao, hoje) {
    var mudou = false;
    var itens = ((cotacao && cotacao.itens) || []).map(function (it) {
      var c = Object.assign({}, it);
      if ((c.status || 'negociacao') === 'negociacao') { c.status = 'pedido'; c.pedidoEm = hoje; mudou = true; }
      else if (c.status === 'pedido' && !c.pedidoEm) { c.pedidoEm = hoje; mudou = true; }
      return c;
    });
    return mudou ? itens : null;
  }

  /* ------------------------------------------------------------
     4. Etiquetas de carona: estoque dos pisos no catalogo
     ------------------------------------------------------------ */
  // Produto e' piso se ja' esta' no catalogo do Etiquetas (vindo do
  // Estoque-Grade, sem amostras/lojinha) OU se aparece em nota com NCM
  // 6907, casado pelo codigo de barras. Devolve o catalogo novo.
  // ... OU se a classe do relatorio e' uma das de piso (CLASSES_PISOS).
  function pisosParaEtiquetas(itensVendas, catalogoDoc, eansNcm6907, hoje) {
    var porCodigo = Object.assign({}, (catalogoDoc && catalogoDoc.porCodigo) || {});
    var eans = eansNcm6907 instanceof Set ? eansNcm6907 : new Set(eansNcm6907 || []);
    var atualizados = 0, novos = 0;
    (itensVendas || []).forEach(function (it) {
      var atual = porCodigo[it.codigo];
      if (atual) {
        porCodigo[it.codigo] = { n: atual.n || it.nome, e: atual.e || it.ean || '', q: it.estoque };
        atualizados++;
      } else if ((it.classe && CLASSES_PISOS.indexOf(it.classe) !== -1) || (it.ean && eans.has(it.ean))) {
        porCodigo[it.codigo] = { n: it.nome, e: it.ean || '', q: it.estoque };
        novos++;
      }
    });
    return { doc: { porCodigo: porCodigo, geradoEm: hoje, qtd: Object.keys(porCodigo).length }, atualizados: atualizados, novos: novos };
  }
  function eansComNcm(itensDocs, prefixos) {
    var set = new Set();
    var pref = prefixos || ['6907'];
    (itensDocs || []).forEach(function (doc) {
      (doc && doc.itens || []).forEach(function (it) {
        var ncm = soDigitos(it && it.ncm), ean = soDigitos(it && it.ean);
        if (ean && pref.some(function (p) { return ncm.indexOf(p) === 0; })) set.add(ean);
      });
    });
    return set;
  }

  var RadarNucleo = {
    PARAMETROS_PADRAO: PARAMETROS_PADRAO,
    CLASSES_PISOS: CLASSES_PISOS,
    DIAS_PEDIDO_FEITO: DIAS_PEDIDO_FEITO,
    ABAS: ABAS,
    lerPlanilhaVendas: lerPlanilhaVendas,
    resumoVendas: resumoVendas,
    dividirResumo: dividirResumo,
    juntarResumo: juntarResumo,
    carteira: carteira,
    movimentos: movimentos,
    calcularRadar: calcularRadar,
    contar: contar,
    filtrar: filtrar,
    ordenar: ordenar,
    porFornecedor: porFornecedor,
    linhasExcel: linhasExcel,
    pisosParaEtiquetas: pisosParaEtiquetas,
    nomesCompativeis: nomesCompativeis,
    casarCotacaoComNotas: casarCotacaoComNotas,
    diferencaPrecoNfe: diferencaPrecoNfe,
    alertasDaCotacao: alertasDaCotacao,
    pedidoFeitoNaCotacao: pedidoFeitoNaCotacao,
    eansComNcm: eansComNcm
  };

  global.RadarNucleo = RadarNucleo;
  if (typeof module === 'object' && module.exports) module.exports = RadarNucleo;
})(typeof window !== 'undefined' ? window : globalThis);
