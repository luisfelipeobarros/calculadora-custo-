/*
  Nucleo do Radar de estoque e compras (aba "Radar" da Calculadora) — 23/10/2026.

  Entrada diaria: o relatorio de vendas do sistema (codigo interno,
  nome, codigo de barras, vendas e estoque do periodo). O radar cruza
  cada produto com:
  - a FICHA da Calculadora (fornecedor, custo, preco), pelo codigo interno;
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

  var PARAMETROS_PADRAO = { periodoDias: 60, coberturaDias: 30, baixoGiroMax: 0, compraMinima: 1, minVendasFeitas: 3 };
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
        if (!it || (it.status || 'negociacao') !== 'pedido') return;
        var cod = String(it.codigo == null ? '' : it.codigo).trim();
        if (!cod) return;
        var qtd = it.quantidadeRecebida != null ? Number(it.quantidadeRecebida) : Number(it.quantidadeEsperada);
        if (!isFinite(qtd)) qtd = 0;
        var em = it.pedidoEm || dataCot || null;
        var c = mapa[cod] || (mapa[cod] = { qtd: 0, em: null, fornecedor: '', cotacoes: 0 });
        c.qtd += qtd;
        c.cotacoes++;
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
      var carteiraQtd = c ? c.qtd : 0;
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
        baixoGiro: estoque > 0 && vendas <= par.baixoGiroMax,
        semFicha: !ficha,
        pedidoFeito: pedidoFeito
      };
      linhas.push({
        codigo: codigo, nome: nome, ean: ean, naoRepor: naoRepor, eanRepetido: eanRepetido, classe: p.k || '',
        vendas: vendas, valor: Number(p.r) || 0, estoque: estoque, transacoes: transacoes, concentrada: concentrada,
        estoqueAnterior: anterior[codigo] != null ? Number(anterior[codigo]) : null,
        mediaDia: mediaDia, coberturaDias: cobertura == null ? null : Math.round(cobertura),
        fornecedor: p.f || (ficha && ficha.fornecedor) || (c && c.fornecedor) || (m && m.faturado && m.faturado.fornecedor) || '',
        custo: custo, custoDe: p.c > 0 ? 'última compra' : (custo != null ? 'ficha' : null),
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
    baixoGiro: { rotulo: 'Baixo giro', flag: 'baixoGiro' },
    semFicha: { rotulo: 'Sem ficha', flag: 'semFicha' },
    pedidoFeito: { rotulo: 'Pedido feito', flag: 'pedidoFeito' },
    todos: { rotulo: 'Todos', flag: null }
  };

  function contar(linhas) {
    var c = { comprar: 0, valorComprar: 0, conferir: 0, chegando: 0, baixoGiro: 0, valorParado: 0, semFicha: 0, pedidoFeito: 0, todos: 0 };
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
      var ca = a.coberturaDias == null ? 1e9 : a.coberturaDias, cb = b.coberturaDias == null ? 1e9 : b.coberturaDias;
      return ca - cb || b.vendas - a.vendas;
    });
  }
  // Comprar, por fornecedor: [{ fornecedor, linhas, valor, itens }]
  function porFornecedor(linhas) {
    var por = {};
    (linhas || []).forEach(function (l) {
      var f = l.fornecedor || 'Sem fornecedor (sem ficha)';
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
        'Situação': [l.flags.comprar ? 'comprar' : '', l.flags.conferir ? 'conferir (venda concentrada)' : '', l.flags.chegando ? 'chegando' : '', l.flags.baixoGiro ? 'baixo giro' : '', l.flags.semFicha ? 'sem ficha' : '', l.flags.pedidoFeito ? 'pedido feito' : '', l.eanRepetido ? 'barras repetido' : ''].filter(Boolean).join(', ')
      };
    });
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
    eansComNcm: eansComNcm
  };

  global.RadarNucleo = RadarNucleo;
  if (typeof module === 'object' && module.exports) module.exports = RadarNucleo;
})(typeof window !== 'undefined' ? window : globalThis);
