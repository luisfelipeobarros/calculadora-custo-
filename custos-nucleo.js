/* ============================================================
   custos-nucleo.js — custo operacional a partir dos lancamentos
   do contador.

   Entrada: as planilhas que a contabilidade ja' produz, uma por
   banco/caixa, no layout de 19 colunas (o MESMO que o app exporta em
   Lancamentos): numero | data | valor | ... | conta | D/C | ... |
   historico | ... | sequencial. Cada lancamento sao duas linhas, a
   perna a debito e a perna a credito.

   O que este arquivo faz, e so' isso:
   1. le a matriz e devolve lancamentos (um por par D/C), com o que
      nao conseguiu ler listado a parte — nunca registro pela metade;
   2. diz a NATUREZA de cada um pelo caminho do dinheiro: credito em
      conta de caixa/banco = saida; debito = entrada; os dois =
      transferencia (que nao e' custo nem receita);
   3. classifica a saida num GRUPO de custo — pela conta contabil e,
      nas contas genericas ("valores a regularizar", "outras
      despesas"), pelo historico;
   4. resume o mes: custo operacional, custo da mercadoria, impostos,
      financeiro, o que ficou sem classificar.

   Regra com NOME DE PESSOA ou de empresa nao mora aqui (repositorio
   publico): vem da configuracao (config/custos, no Firestore), que a
   tela edita. Aqui so' ha' padroes genericos de historico.

   Dinheiro em centavos inteiros, como em todo nucleo.

   Precisa vir DEPOIS de app-shared.js — usa App.emCentavos,
   App.parseDinheiroBR, App.normalizarTexto e App.dataDeCelula.
   ============================================================ */
(function (global) {
  'use strict';

  var App = (typeof module === 'object' && module.exports)
    ? require('./app-shared.js')
    : global.App;

  if (!App || !App.emCentavos || !App.dataDeCelula) {
    throw new Error('custos-nucleo.js precisa de app-shared.js carregado antes.');
  }

  /* ============================================================
     1. Tipos e grupos

     O TIPO diz para que serve o numero; o GRUPO e' a linha do
     relatorio. "Custo operacional" e' a soma do tipo `operacional` —
     o que a loja gasta para existir, venda ou nao venda. Mercadoria,
     frete de compra e o ICMS de fronteira (ST que nao vem cobrada na
     nota) sao custo do PRODUTO: ja' entram no preco pela Calculadora
     e nao podem contar de novo como custo fixo.
     ============================================================ */

  var TIPOS = {
    operacional:   'Custo operacional',
    cmv:           'Custo da mercadoria',
    imposto:       'Impostos',
    financeiro:    'Despesas financeiras',
    financiamento: 'Empréstimos e parcelamentos',
    socios:        'Sócios',
    receita:       'Recebimentos e devoluções',
    pendente:      'A classificar'
  };

  var GRUPOS = {
    pessoal:        { nome: 'Pessoal (folha, encargos, benefícios)', tipo: 'operacional' },
    extras:         { nome: 'Extras e diárias',                       tipo: 'operacional' },
    frete_entrega:  { nome: 'Frete de entrega',                       tipo: 'operacional' },
    ocupacao:       { nome: 'Ocupação (energia, água, aluguéis)',     tipo: 'operacional' },
    combustivel:    { nome: 'Combustível e gás',                      tipo: 'operacional' },
    servicos:       { nome: 'Serviços de terceiros',                  tipo: 'operacional' },
    consumo:        { nome: 'Material de uso e consumo',              tipo: 'operacional' },
    cartao:         { nome: 'Cartão de crédito',                      tipo: 'operacional' },
    outras:         { nome: 'Outras despesas',                        tipo: 'operacional' },
    mercadoria:     { nome: 'Fornecedores de mercadoria',             tipo: 'cmv' },
    frete_compra:   { nome: 'Frete de compra',                        tipo: 'cmv' },
    icms_fronteira: { nome: 'ICMS de fronteira (ST fora da nota)',    tipo: 'cmv' },
    impostos:       { nome: 'Impostos e parcelamentos de tributo',    tipo: 'imposto' },
    financeiras:    { nome: 'Tarifas, juros, IOF e seguros de operação', tipo: 'financeiro' },
    emprestimos:    { nome: 'Empréstimos, giro e parcelamentos',      tipo: 'financiamento' },
    aplicacoes:     { nome: 'Aplicações e resgates',                  tipo: 'financiamento' },
    socios:         { nome: 'Retiradas e distribuição a sócios',      tipo: 'socios' },
    recebimentos:   { nome: 'Recebimentos de clientes e cartões',     tipo: 'receita' },
    devolucao_cliente: { nome: 'Devoluções a clientes',               tipo: 'receita' },
    a_classificar:  { nome: 'A classificar',                          tipo: 'pendente' }
  };

  // Conta contabil -> grupo. Exata primeiro; depois o prefixo MAIS
  // LONGO que casar. Os codigos sao os do plano de contas do contador
  // (os mesmos do cadastro de categorias do app).
  var GRUPO_POR_CONTA = {
    '2.1.1.1.0001': 'mercadoria',
    '2.1.1.1.0002': 'servicos',       // fornecedor de servicos (frete sai pelo historico)
    '2.1.1.1.0003': 'frete_compra',   // fretes a pagar: CT-e e cheque de transportadora
    '2.1.1.1.0004': 'consumo',
    '2.1.3.1.0001': 'icms_fronteira',
    '1.1.2.4.0003': 'pessoal',        // adiantamento quinzenal
    '1.1.2.4.0004': 'pessoal',        // adiantamento de ferias
    '1.1.2.4.0005': 'pessoal',        // adiantamento de 13o
    '4.2.1.1.0002': 'pessoal',        // ajuda de custo
    '4.2.1.1.0006': 'pessoal',        // GRRF / rescisorio
    '4.2.1.1.0009': 'ocupacao',       // aluguel de maquina
    '4.2.1.1.0010': 'pessoal',        // vale transporte
    '4.2.1.1.0011': 'pessoal',        // plano de saude
    '4.2.1.1.0012': 'pessoal',        // seguro de vida
    '4.2.1.1.0014': 'pessoal',        // alimentacao
    '4.2.1.1.0021': 'frete_entrega',  // frete PF pago na hora (entrega)
    '4.2.1.1.0022': 'frete_compra',   // frete PJ
    '4.2.1.1.0024': 'combustivel',
    '4.2.1.1.0026': 'servicos',
    '4.2.1.1.0031': 'pessoal',        // sindicato
    '4.2.1.1.0034': 'ocupacao',       // energia
    '4.2.1.1.0036': 'ocupacao',       // agua
    '4.2.1.1.0037': 'consumo',
    '4.2.1.1.0041': 'ocupacao',       // conservacao e reforma
    '4.2.1.1.0042': 'outras',
    '4.2.1.1.0044': 'cartao'
  };
  var GRUPO_POR_PREFIXO = [
    ['2.1.4.', 'pessoal'],       // salarios, FGTS, ferias, 13o, rescisao, pensao
    ['2.1.3.', 'impostos'],
    ['2.4.3.', 'socios'],        // distribuicao de lucro
    ['4.2.4.', 'financeiras'],
    ['4.1.',   'mercadoria'],    // custos (embalagem, insumo de venda)
    ['4.2.',   'outras'],
    ['1.1.2.1.', 'recebimentos'],
    ['3.',     'recebimentos']   // rendimentos e juros recebidos
  ];

  // Contas GENERICAS: o codigo nao diz o que foi pago, entao o
  // historico decide antes da conta.
  var CONTAS_GENERICAS = { '1.1.2.4.0001': true, '4.2.1.1.0042': true, '2.1.1.1.0002': true };

  // Padroes genericos de historico (ja' normalizado: minusculas, sem
  // acento), so' para as contas genericas. NENHUM nome de pessoa ou
  // de empresa aqui — esses vem da configuracao.
  var REGRAS_HISTORICO = [
    { re: /devolucao (de |a |ao |para )?cliente/, grupo: 'devolucao_cliente' },
    { re: /devolucao de fornecedor/,              grupo: 'mercadoria' },
    { re: /\b(juros|multa|mora|iof|encargos?)\b/, grupo: 'financeiras' },
    { re: /seguro de operacao/,                   grupo: 'financeiras' },
    // "parcelam": a contabilidade abrevia ("PARCIAL PARCELAM 12/36").
    { re: /parcelam|emprestimo|capital de giro|\bgiro\b|giropre|renegocia|liquidacao/, grupo: 'emprestimos' },
    { re: /aplicac|resgate|\bcdb\b|rend\.? ?aplic/, grupo: 'aplicacoes' },
    { re: /venda cancelada/,                      grupo: 'devolucao_cliente' },
    { re: /\bipva\b|\biptu\b|\bdarf\b|\bdae\b/,   grupo: 'impostos' },
    { re: /\baluguel\b/,                         grupo: 'ocupacao' },
    { re: /\bfrete\b|\bcte\b|ct-e/,               grupo: 'frete_compra' },
    { re: /advogad|juridic|honorario/,            grupo: 'servicos' },
    { re: /contab|contador/,                      grupo: 'servicos' },
    { re: /marketing|publicidade|agencia/,        grupo: 'servicos' },
    { re: /seguranca|vigilancia/,                 grupo: 'servicos' },
    { re: /eletricista|serralheiro|pedreiro|pintor|encanador|manutenc|\bservicos?\b/, grupo: 'servicos' },
    { re: /\bextra\b|\bdiaria\b/,                 grupo: 'extras' }
  ];

  /* ============================================================
     2. Leitura do layout de 19 colunas
     ============================================================ */

  var COL = { numero: 0, data: 1, valor: 2, conta: 5, dc: 6, historico: 11, sequencial: 18 };

  function texto(v) { return v == null ? '' : String(v).trim(); }

  function centavosDaCelula(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? App.emCentavos(v) : null;
    var n = App.parseDinheiroBR(v);
    return n == null ? null : App.emCentavos(n);
  }

  // matriz: linhas da planilha (sheet_to_json com header:1). arquivo:
  // nome do arquivo, que vai junto em cada lancamento (o numero do
  // contador se REPETE entre arquivos — nao identifica nada sozinho).
  function lerLayoutContador(matriz, arquivo) {
    var lancamentos = [], problemas = [];
    // Pernas com conta e D/C mas SEM data e SEM valor: sobra do mes
    // anterior na planilha que a contabilidade reaproveita como modelo e
    // ainda nao preencheu. Contadas, nao listadas uma a uma — o agosto
    // real, ainda em fechamento, tinha 404.
    var linhasDeModelo = 0;
    var grupo = null;

    function fechar() {
      if (!grupo) return;
      var g = grupo; grupo = null;
      var deb = g.linhas.filter(function (l) { return l.dc === 'D'; });
      var cre = g.linhas.filter(function (l) { return l.dc === 'C'; });
      var ref = g.linhas[0];
      var onde = (arquivo ? arquivo + ', ' : '') + 'linha ' + ref.linha + ' (nº ' + g.numero + ')';
      if (deb.length !== 1 || cre.length !== 1) {
        problemas.push({ tipo: 'pernas', linha: ref.linha, texto: onde + ': esperava uma perna a débito e uma a crédito, veio ' + deb.length + ' D e ' + cre.length + ' C — "' + ref.historico + '"' });
        return;
      }
      if (!ref.data && ref.valorCentavos == null) { linhasDeModelo += g.linhas.length; return; }
      if (!ref.data) { problemas.push({ tipo: 'semData', linha: ref.linha, texto: onde + ': sem data — "' + ref.historico + '"' }); return; }
      if (ref.valorCentavos == null || !(ref.valorCentavos > 0)) {
        problemas.push({ tipo: 'semValor', linha: ref.linha, texto: onde + ': sem valor — "' + ref.historico + '"' }); return;
      }
      if (deb[0].valorCentavos !== cre[0].valorCentavos) {
        problemas.push({ tipo: 'valoresDiferentes', linha: ref.linha, texto: onde + ': débito e crédito com valores diferentes — "' + ref.historico + '"' }); return;
      }
      lancamentos.push({
        arquivo: arquivo || null,
        numero: g.numero,
        sequencial: texto(deb[0].sequencial) || null,
        data: ref.data,
        mes: ref.data.substring(0, 7),
        valorCentavos: ref.valorCentavos,
        contaDebito: deb[0].conta,
        contaCredito: cre[0].conta,
        historico: ref.historico
      });
    }

    (matriz || []).forEach(function (r, i) {
      r = r || [];
      var conta = texto(r[COL.conta]);
      var dc = texto(r[COL.dc]).toUpperCase();
      if (!conta && !dc) return; // linha em branco ou rodape
      if (!/^\d+(\.\d+)+$/.test(conta) || (dc !== 'D' && dc !== 'C')) {
        var cheia = r.some(function (c) { return texto(c) !== ''; });
        fechar(); // o grupo aberto termina aqui: os problemas saem na ordem do arquivo
        if (cheia) problemas.push({ tipo: 'linhaEstranha', linha: i + 1, texto: (arquivo ? arquivo + ', ' : '') + 'linha ' + (i + 1) + ': não parece uma perna de lançamento (conta "' + conta + '", D/C "' + dc + '")' });
        return;
      }
      var numero = texto(r[COL.numero]);
      if (!grupo || grupo.numero !== numero) { fechar(); grupo = { numero: numero, linhas: [] }; }
      grupo.linhas.push({
        linha: i + 1, conta: conta, dc: dc,
        data: App.dataDeCelula(r[COL.data]),
        valorCentavos: centavosDaCelula(r[COL.valor]),
        historico: texto(r[COL.historico]).replace(/\s+/g, ' '),
        sequencial: r[COL.sequencial]
      });
    });
    fechar();

    // Arquivo que nao rendeu NADA e so' tem "linha estranha" e' outro
    // formato (relacao de notas de servico): os avisos seriam ruido.
    if (!lancamentos.length && !linhasDeModelo && problemas.every(function (p) { return p.tipo === 'linhaEstranha'; })) problemas = [];
    return { lancamentos: lancamentos, problemas: problemas, linhasDeModelo: linhasDeModelo };
  }

  // Varios arquivos de uma vez. Copia do mesmo arquivo ("BANCO (1).XLS")
  // e' descartada pelo CONTEUDO (mesmos ids), e arquivo que nao rende
  // lancamento nenhum (folha por funcionario, relacao de notas de
  // servico — documentos de apoio, em outro formato) e' listado como
  // ignorado em vez de sumir.
  function juntarLeituras(leituras) {
    var vistos = Object.create(null);
    var lancamentos = [], problemas = [], ignorados = [], linhasDeModelo = 0;
    (leituras || []).forEach(function (r) {
      var nome = r.arquivo || '?';
      linhasDeModelo += r.linhasDeModelo || 0;
      problemas = problemas.concat(r.problemas || []);
      if (!r.lancamentos || !r.lancamentos.length) {
        ignorados.push({ arquivo: nome, motivo: r.linhasDeModelo ? 'só linhas de modelo, sem data nem valor'
          : ((r.problemas && r.problemas.length) ? 'nenhum lançamento válido' : 'outro formato (documento de apoio)') });
        return;
      }
      var novos = r.lancamentos.filter(function (l) {
        var id = idImportado(l);
        if (vistos[id]) return false;
        vistos[id] = true;
        return true;
      });
      if (!novos.length) ignorados.push({ arquivo: nome, motivo: 'cópia de outro arquivo do lote' });
      lancamentos = lancamentos.concat(novos);
    });
    return { lancamentos: lancamentos, problemas: problemas, ignorados: ignorados, linhasDeModelo: linhasDeModelo };
  }

  // Id deterministico para gravar: reimportar nao duplica, nem com o
  // arquivo renomeado. O numero do contador se REPETE entre arquivos,
  // por isso entram o sequencial, a data, o valor e as duas contas — o
  // nome do arquivo fica de fora de proposito.
  function idImportado(l) {
    var base = [l.numero, l.sequencial, l.data, l.valorCentavos, l.contaDebito, l.contaCredito].join('|');
    var h = 5381;
    for (var i = 0; i < base.length; i++) h = ((h * 33) ^ base.charCodeAt(i)) >>> 0;
    return 'imp_' + l.mes + '_' + h.toString(36) + '_' + String(l.valorCentavos);
  }

  /* ============================================================
     3. Natureza e classificacao
     ============================================================ */

  // Caixa, bancos e contas vinculadas: tudo sob 1.1.1.
  function ehCaixa(conta) { return /^1\.1\.1\./.test(String(conta || '')); }

  function natureza(l) {
    var d = ehCaixa(l.contaDebito), c = ehCaixa(l.contaCredito);
    if (d && c) return 'transferencia';
    if (c) return 'saida';
    if (d) return 'entrada';
    return 'outro';
  }

  function grupoDaConta(conta, porConta) {
    conta = String(conta || '');
    if (porConta && porConta[conta] && GRUPOS[porConta[conta]]) return porConta[conta];
    if (GRUPO_POR_CONTA[conta]) return GRUPO_POR_CONTA[conta];
    var melhor = null;
    GRUPO_POR_PREFIXO.forEach(function (p) {
      if (conta.indexOf(p[0]) === 0 && (!melhor || p[0].length > melhor[0].length)) melhor = p;
    });
    return melhor ? melhor[1] : null;
  }

  // config (vem de config/custos): { porConta: {conta: grupo},
  // regras: [{ contem: 'texto', grupo: 'id' }] }. As regras da
  // configuracao valem para QUALQUER conta e vencem tudo, menos a
  // escolha feita a mao no proprio lancamento (l.grupoCusto).
  function classificar(l, config) {
    config = config || {};
    var nat = natureza(l);
    if (nat === 'transferencia' || nat === 'outro') {
      return { natureza: nat, grupo: null, tipo: null, conta: null, sinal: 0, como: nat };
    }
    // A conta que explica o dinheiro e' a que NAO e' caixa.
    var conta = nat === 'saida' ? l.contaDebito : l.contaCredito;
    var hist = App.normalizarTexto(l.historico || '');
    var grupo = null, como = null;

    if (l.grupoCusto && GRUPOS[l.grupoCusto]) { grupo = l.grupoCusto; como = 'escolhido no lançamento'; }

    if (!grupo) {
      var regras = config.regras || [];
      for (var i = 0; i < regras.length && !grupo; i++) {
        var alvo = App.normalizarTexto(regras[i].contem || '');
        if (alvo && hist.indexOf(alvo) !== -1 && GRUPOS[regras[i].grupo]) { grupo = regras[i].grupo; como = 'regra "' + regras[i].contem + '"'; }
      }
    }
    if (!grupo && CONTAS_GENERICAS[conta]) {
      for (var j = 0; j < REGRAS_HISTORICO.length && !grupo; j++) {
        if (REGRAS_HISTORICO[j].re.test(hist)) { grupo = REGRAS_HISTORICO[j].grupo; como = 'histórico'; }
      }
    }
    if (!grupo) {
      // "Valores a regularizar" sem padrao reconhecido NAO herda grupo
      // nenhum: e' exatamente o que precisa de gente olhando.
      if (conta === '1.1.2.4.0001') { grupo = 'a_classificar'; como = 'conta genérica sem regra'; }
      else {
        grupo = grupoDaConta(conta, config.porConta);
        como = grupo ? 'conta ' + conta : 'conta sem grupo';
        if (!grupo) grupo = 'a_classificar';
      }
    }
    // Entrada numa conta de custo e' estorno: abate o grupo.
    return { natureza: nat, grupo: grupo, tipo: GRUPOS[grupo].tipo, conta: conta, sinal: nat === 'saida' ? 1 : -1, como: como };
  }

  /* ============================================================
     4. Resumo do mes
     ============================================================ */

  function resumoDoMes(lancamentos, config) {
    var grupos = {}, tipos = {}, pendentes = [];
    var transferencias = 0, entradas = 0, saidas = 0;
    Object.keys(TIPOS).forEach(function (t) { tipos[t] = 0; });

    (lancamentos || []).forEach(function (l) {
      var c = classificar(l, config);
      if (c.natureza === 'transferencia') { transferencias += l.valorCentavos; return; }
      if (c.natureza === 'outro') return;
      if (c.natureza === 'saida') saidas += l.valorCentavos; else entradas += l.valorCentavos;

      // Custo: saida soma, entrada (estorno) abate. Receita e' o
      // contrario: a entrada soma e a saida (devolucao ao cliente) abate.
      var valor = (c.tipo === 'receita' ? -c.sinal : c.sinal) * l.valorCentavos;
      var g = grupos[c.grupo] = grupos[c.grupo] || { id: c.grupo, nome: GRUPOS[c.grupo].nome, tipo: c.tipo, totalCentavos: 0, qtd: 0, contas: {} };
      g.totalCentavos += valor; g.qtd++;
      var ct = g.contas[c.conta] = g.contas[c.conta] || { totalCentavos: 0, qtd: 0 };
      ct.totalCentavos += valor; ct.qtd++;
      tipos[c.tipo] += valor;
      if (c.grupo === 'a_classificar') pendentes.push(l);
    });

    var lista = Object.keys(grupos).map(function (k) { return grupos[k]; })
      .sort(function (a, b) { return Math.abs(b.totalCentavos) - Math.abs(a.totalCentavos); });

    return {
      grupos: lista,
      tipos: tipos,
      custoOperacionalCentavos: tipos.operacional,
      pendentes: pendentes,
      pendenteCentavos: tipos.pendente,
      saidasCentavos: saidas,
      entradasCentavos: entradas,
      transferenciasCentavos: transferencias
    };
  }

  // Custo operacional como fracao do faturamento — o numero que a
  // Calculadora precisa para formar preco com custo fixo de verdade.
  // Sem faturamento: null, nunca zero nem infinito.
  function percentualDoFaturamento(custoCentavos, faturamentoReais) {
    if (custoCentavos == null || faturamentoReais == null || !(faturamentoReais > 0)) return null;
    return custoCentavos / App.emCentavos(faturamentoReais);
  }

  var CustosNucleo = {
    TIPOS: TIPOS,
    GRUPOS: GRUPOS,
    lerLayoutContador: lerLayoutContador,
    juntarLeituras: juntarLeituras,
    idImportado: idImportado,
    ehCaixa: ehCaixa,
    natureza: natureza,
    classificar: classificar,
    resumoDoMes: resumoDoMes,
    percentualDoFaturamento: percentualDoFaturamento
  };

  global.CustosNucleo = CustosNucleo;
  if (typeof module === 'object' && module.exports) module.exports = CustosNucleo;
})(typeof window !== 'undefined' ? window : globalThis);
