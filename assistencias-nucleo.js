/* ============================================================
   assistencias-nucleo.js — regras do app de Assistências e
   Reclamações (assistencias.html, usado pelos gerentes de vendas).

   Mesmo desenho dos outros núcleos: o ÚNICO lugar onde as regras
   moram, carregável com <script src> no navegador e com require()
   nos testes. A tela só formata, fotografa e grava; a conta é daqui.

   O que mora aqui:
   - as listas de status, causa e tipo de solução (a tela monta os
     selects a partir delas — mudar aqui muda filtro, formulário e
     exportação juntos) e a cor do badge de cada status;
   - o resumo dos cartões (em aberto, custo da loja no mês corrente
     e custo líquido = custo - ressarcimento da fábrica);
   - o filtro da lista (status, causa, período e busca por cliente
     ou sequência) e a ordenação (mais recentes primeiro);
   - o aviso de sequência duplicada (aviso, NUNCA trava: reabertura
     legítima existe no Shop9);
   - as linhas da exportação para Excel.

   Precisa vir DEPOIS de app-shared.js — usa App.normalizarTexto e
   App.centavos.
   ============================================================ */
(function (global) {
  'use strict';

  var App = (typeof module === 'object' && module.exports)
    ? require('./app-shared.js')
    : global.App;

  if (!App || !App.normalizarTexto) {
    throw new Error('assistencias-nucleo.js precisa de app-shared.js carregado antes.');
  }

  var STATUS = ['Aberta', 'Em análise', 'Aguardando fábrica', 'Resolvida'];
  var CAUSAS = ['Defeito de fabricação', 'Entrega errada', 'Quebra no transporte',
    'Erro do cliente', 'Desistência', 'Outro'];
  // "Troca" virou duas (pedido de 07/10/2026): reposicao do MESMO
  // produto, ou troca por produto DIFERENTE — nesta a ficha guarda
  // tambem o que o cliente leva (itensNovos). Documento antigo com
  // "Troca" continua valendo como reposicao.
  var REPOSICAO = 'Reposição (mesmo produto)';
  var TROCA_NOVO = 'Troca por produto novo';
  var TIPOS_SOLUCAO = [REPOSICAO, TROCA_NOVO, 'Devolução (dinheiro)', 'Crédito na Loja',
    'Abatimento do pedido', 'Assistência da fábrica', 'Outro'];
  /* ============================================================
     Avarias (07/10/2026)

     Perda de mercadoria sem cliente envolvido: quebra no carregamento,
     no manuseio do estoque, na entrega, defeito de fabrica. Mora na
     MESMA colecao das assistencias, marcada com tipo: 'avaria' e ja'
     resolvida — nada novo nas regras do Firestore, e a lista, a
     planilha e o custo do mes servem de graca. O valor da perda vai
     em custoLoja, o mesmo campo das assistencias.
     ============================================================ */
  var MOTIVOS_AVARIA = ['Carregamento', 'Manuseio no estoque', 'Entrega', 'Defeito de fábrica', 'Outro'];
  function ehAvaria(a) { return !!a && a.tipo === 'avaria'; }

  function ehTrocaPorNovo(tipo) { return App.normalizarTexto(tipo || '') === App.normalizarTexto(TROCA_NOVO); }

  /* ============================================================
     Produtos da ocorrencia

     Uma assistencia pode ter mais de um produto (pedido de
     07/10/2026): a ficha grava "itens" [{ codigo, produto, tonalidade,
     quantidade }]. Documento antigo tem um produto so', nos campos
     soltos (codigo/produto/tonalidade/quantidade) — e' lido do mesmo
     jeito. Na troca por produto novo, "itensNovos" e' o que o cliente
     leva, no mesmo formato.
     ============================================================ */

  function itemLimpo(it) {
    it = it || {};
    var q = it.quantidade;
    return {
      codigo: String(it.codigo == null ? '' : it.codigo).trim(),
      produto: String(it.produto == null ? '' : it.produto).trim(),
      tonalidade: String(it.tonalidade == null ? '' : it.tonalidade).trim(),
      quantidade: (q == null || q === '' || isNaN(Number(q))) ? null : Number(q)
    };
  }
  function itemVazio(it) { return !it.codigo && !it.produto && !it.tonalidade && it.quantidade == null; }

  function produtosDaFicha(a) {
    a = a || {};
    var lista = Array.isArray(a.itens) ? a.itens
      : (a.produto || a.codigo || a.tonalidade || a.quantidade != null)
        ? [{ codigo: a.codigo, produto: a.produto, tonalidade: a.tonalidade, quantidade: a.quantidade }]
        : [];
    return lista.map(itemLimpo).filter(function (it) { return !itemVazio(it); });
  }
  function produtosNovos(a) {
    a = a || {};
    if (!ehTrocaPorNovo(a.tipoSolucao) || !Array.isArray(a.itensNovos)) return [];
    return a.itensNovos.map(itemLimpo).filter(function (it) { return !itemVazio(it); });
  }

  function fmtQuantidade(q) {
    return q == null ? '' : Number(q).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  }
  // "4455 Piso 46x46 (ton. B2) × 12,5" — lista e planilha.
  function textoDoItem(it) {
    var partes = [it.codigo, it.produto].filter(Boolean).join(' ');
    if (it.tonalidade) partes += ' (ton. ' + it.tonalidade + ')';
    if (it.quantidade != null) partes += ' × ' + fmtQuantidade(it.quantidade);
    return partes;
  }
  function resumoProdutos(itens) {
    return (itens || []).map(textoDoItem).filter(Boolean).join('; ');
  }

  // Badge: aberta = vermelho, em análise = amarelo, aguardando
  // fábrica = azul, resolvida = verde (classes no CSS da página).
  var CLASSE_STATUS = {
    'Aberta': 'st-aberta',
    'Em análise': 'st-analise',
    'Aguardando fábrica': 'st-fabrica',
    'Resolvida': 'st-resolvida'
  };
  function classeStatus(status) {
    // Status desconhecido (documento antigo, digitação) cai no
    // vermelho: melhor gritar do que parecer resolvido.
    return CLASSE_STATUS[status] || 'st-aberta';
  }

  // Cartões do topo. "Em aberto" = tudo que NÃO está resolvido (é o
  // que precisa de ação); os custos são do MÊS CORRENTE, pela data de
  // abertura. Campo de dinheiro vazio soma zero — ausência de custo
  // lançado é custo nenhum, aqui não há "zero inventado".
  function resumoAssistencias(lista, hoje) {
    var mes = String(hoje).substring(0, 7);
    var emAberto = 0, custoMes = 0, liquidoMes = 0, avariasMes = 0, avariasQtdMes = 0;
    (lista || []).forEach(function (a) {
      var doMes = (a.dataAbertura || '').substring(0, 7) === mes;
      // Avaria e' perda, nao atendimento: conta a parte, nunca em "em aberto".
      if (ehAvaria(a)) {
        if (doMes) { avariasMes += a.custoLoja || 0; avariasQtdMes++; }
        return;
      }
      if (a.status !== 'Resolvida') emAberto++;
      if (doMes) {
        custoMes += a.custoLoja || 0;
        liquidoMes += (a.custoLoja || 0) - (a.ressarcimentoFabrica || 0);
      }
    });
    return {
      emAberto: emAberto,
      custoMes: App.centavos(custoMes),
      liquidoMes: App.centavos(liquidoMes),
      avariasMes: App.centavos(avariasMes),
      avariasQtdMes: avariasQtdMes
    };
  }

  // f: { tipo, status, causa, de, ate, termo }. Vazio = não filtra. A
  // busca por texto procura em cliente, sequência, produtos e motivo,
  // sem acento. tipo 'avaria' lista SO' as avarias (e ignora o status);
  // qualquer outro valor lista so' as assistências.
  function filtrarAssistencias(lista, f) {
    var o = f || {};
    var termo = App.normalizarTexto(o.termo || '');
    var soAvarias = o.tipo === 'avaria';
    return (lista || []).filter(function (a) {
      if (ehAvaria(a) !== soAvarias) return false;
      if (!soAvarias && o.status && a.status !== o.status) return false;
      if (o.causa && a.causa !== o.causa) return false;
      if (o.de && (a.dataAbertura || '') < o.de) return false;
      if (o.ate && (a.dataAbertura || '') > o.ate) return false;
      if (termo &&
          App.normalizarTexto(a.cliente).indexOf(termo) === -1 &&
          App.normalizarTexto(a.sequencia).indexOf(termo) === -1 &&
          App.normalizarTexto(a.motivo).indexOf(termo) === -1 &&
          App.normalizarTexto(resumoProdutos(produtosDaFicha(a))).indexOf(termo) === -1) return false;
      return true;
    });
  }

  function ordenarAssistencias(lista) {
    return (lista || []).slice().sort(function (a, b) {
      return String(b.dataAbertura || '').localeCompare(String(a.dataAbertura || '')) ||
        String(b.sequencia || '').localeCompare(String(a.sequencia || ''), 'pt-BR', { numeric: true });
    });
  }

  // Mesma sequência em OUTRO documento. É aviso com confirmação,
  // nunca trava: uma assistência pode ser legitimamente reaberta com
  // a mesma sequência do Shop9.
  function sequenciaDuplicada(lista, sequencia, idAtual) {
    var seq = String(sequencia == null ? '' : sequencia).trim();
    if (!seq) return false;
    return (lista || []).some(function (a) {
      return a.id !== idAtual && String(a.sequencia || '').trim() === seq;
    });
  }

  // As fotos do problema e o TERMO DE ACORDO escaneado dividem o
  // MESMO campo `fotos` do documento (decisao de 02/09/2026: nada
  // novo no Firestore). O termo entra como { termo: true, img } e a
  // foto do problema continua string pura — compatibilidade com tudo
  // que ja foi salvo.
  //
  // Entrada em formato DESCONHECIDO vai para `outros` e o juntar a
  // devolve intacta: como a ficha regrava o array inteiro, "ignorar"
  // na leitura seria APAGAR na gravacao (auditoria de 02/09/2026).
  // So' null/undefined/'' morrem de verdade. E `fotos` que nem array
  // seja nao derruba a lista — vira vazio.
  function separarFotos(fotos) {
    var problema = [], termo = [], outros = [];
    if (!Array.isArray(fotos)) fotos = [];
    fotos.forEach(function (f) {
      if (f && typeof f === 'object' && f.termo === true &&
          typeof f.img === 'string' && f.img) {
        termo.push(f.img);
      } else if (typeof f === 'string' && f) {
        problema.push(f);
      } else if (f != null && f !== '') {
        outros.push(f);
      }
    });
    return { problema: problema, termo: termo, outros: outros };
  }
  function juntarFotos(problema, termo, outros) {
    return (problema || []).concat(
      (termo || []).map(function (img) { return { termo: true, img: img }; }),
      outros || []);
  }

  // Dinheiro digitado a brasileira: "25.000" sem virgula e' vinte e
  // cinco mil. A leitura errada (parseNumeroBR) corrompia valores
  // >= 1000 a cada salvamento da ficha. A regra canonica mora no
  // app-shared (App.parseDinheiroBR) — este e' so' o atalho local.
  function parseDinheiroBR(v) { return App.parseDinheiroBR(v); }

  function linhasExcel(lista) {
    return (lista || []).map(function (a) {
      var fotos = separarFotos(a.fotos);
      // Varios produtos numa celula so', separados por "; " (uma linha
      // por assistencia, como a planilha sempre foi).
      var itens = produtosDaFicha(a);
      var coluna = function (campo) {
        return itens.map(function (it) { return it[campo] == null ? '' : it[campo]; }).join('; ');
      };
      return {
        'Tipo': ehAvaria(a) ? 'Avaria' : 'Assistência',
        'Sequência': a.sequencia || '',
        'Abertura': a.dataAbertura || '',
        'Cliente': a.cliente || '',
        'Código': coluna('codigo'),
        'Produto': coluna('produto'),
        'Tonalidade': coluna('tonalidade'),
        'Qtd': itens.length === 1 ? (itens[0].quantidade != null ? itens[0].quantidade : '') : coluna('quantidade'),
        'Produto novo (troca)': resumoProdutos(produtosNovos(a)),
        'Valor (R$)': a.valor != null ? a.valor : '',
        'NF venda': a.nfVenda || '',
        'Problema': a.problema || '',
        'Causa': a.causa || '',
        'Motivo da avaria': a.motivo || '',
        'Observação': a.obs || '',
        'Status': a.status || '',
        'Tipo de solução': a.tipoSolucao || '',
        'Solução': a.solucao || '',
        'Custo loja (R$)': a.custoLoja != null ? a.custoLoja : '',
        'Ressarcimento fábrica (R$)': a.ressarcimentoFabrica != null ? a.ressarcimentoFabrica : '',
        // Líquido só quando algum dos dois lados existe — linha sem
        // dinheiro nenhum sai em branco, não "0".
        'Custo líquido (R$)': (a.custoLoja != null || a.ressarcimentoFabrica != null)
          ? App.centavos((a.custoLoja || 0) - (a.ressarcimentoFabrica || 0)) : '',
        'Resolução': a.dataResolucao || '',
        'Responsável': a.responsavel || '',
        'Fotos': fotos.problema.length,
        'Termo de acordo': fotos.termo.length ? 'sim' : ''
      };
    });
  }

  /* ============================================================
     Ordem de entrega de material (impressao da ocorrencia)

     O mesmo formulario de papel que a loja ja' usa (pedido de
     03/10/2026): cabecalho do cliente, "produtos a ser entregue",
     "produto devolvido", descricao da ocorrencia e as assinaturas.
     Tudo que a ficha tem vem preenchido — cliente, endereco, CNPJ/CPF,
     telefone, nota, data da nota e data da entrega da venda (campos
     criados em 05/10/2026 para a ordem sair completa). Para a caneta
     ficam so' a data da troca/entrega e as assinaturas.

     Qual tabela recebe o produto depende do TIPO DE SOLUCAO:
     reposicao (ou "Troca" antiga) entrega e recolhe o mesmo produto;
     troca por produto novo recolhe o da ficha e entrega o que o
     cliente leva; devolucao e credito so' recolhem; nos outros casos
     (ou sem solucao definida) nada e' entregue — a ordem nao inventa
     uma entrega que ninguem decidiu. A tabela "produtos a ser
     entregue" so' e' impressa quando ha' o que entregar (pedido de
     07/10/2026); a de "produto devolvido" sai sempre, como no papel.
     ============================================================ */

  var LINHAS_DA_TABELA = 6;   // como no formulario de papel
  var LINHAS_DA_OCORRENCIA = 5;
  var EM_BRANCO = '____/____/______';   // data para preencher a mao

  function linhaDaOrdem(it) {
    return {
      codigo: it.codigo,
      descricao: it.produto + (it.tonalidade ? ' — tonalidade ' + it.tonalidade : ''),
      quantidade: fmtQuantidade(it.quantidade)
    };
  }
  function itensDaOrdem(a) {
    a = a || {};
    var devolver = produtosDaFicha(a).map(linhaDaOrdem);
    var t = App.normalizarTexto(a.tipoSolucao || '');
    if (!devolver.length) return { entregar: [], devolver: [] };
    if (ehTrocaPorNovo(a.tipoSolucao)) return { entregar: produtosNovos(a).map(linhaDaOrdem), devolver: devolver };
    if (t.indexOf('reposicao') === 0 || t.indexOf('troca') === 0) return { entregar: devolver.slice(), devolver: devolver };
    if (t.indexOf('devolucao') === 0 || t.indexOf('credito') === 0) return { entregar: [], devolver: devolver };
    // Abatimento, assistencia da fabrica, outro, sem solucao: o produto
    // fica com o cliente — nada e' entregue nem recolhido.
    return { entregar: [], devolver: [] };
  }

  // HTML pronto para o papel. Todo dado da ficha passa por escapeHtml.
  function htmlOrdemEntrega(a, opcoes) {
    a = a || {};
    var o = opcoes || {};
    var e = App.escapeHtml;
    var itens = itensDaOrdem(a);

    function linha(rotulo, valor, classe) {
      return '<div class="oe-linha' + (classe ? ' ' + classe : '') + '"><span class="oe-r">' + e(rotulo) + '</span>' +
        '<span class="oe-v">' + e(valor == null ? '' : String(valor)) + '</span></div>';
    }
    function tabela(titulo, lista) {
      var h = '<div class="oe-secao">' + e(titulo) + '</div><table class="oe-tab"><thead><tr>' +
        '<th class="oe-cod">CÓD</th><th>DISCRIMINAÇÃO</th><th class="oe-qtd">QTDA</th></tr></thead><tbody>';
      for (var i = 0; i < Math.max(LINHAS_DA_TABELA, lista.length); i++) {
        var it = lista[i] || { codigo: '', descricao: '', quantidade: '' };
        h += '<tr><td>' + e(it.codigo) + '</td><td>' + e(it.descricao) + '</td><td class="oe-qtd">' + e(it.quantidade) + '</td></tr>';
      }
      return h + '</tbody></table>' + linha('OBS.', '');
    }

    // Texto da ocorrencia: problema, causa e solucao, cada um numa linha;
    // o resto das linhas fica em branco para completar a mao.
    var textos = [];
    if (a.problema) textos.push(String(a.problema));
    if (a.causa) textos.push('Causa: ' + a.causa);
    if (a.tipoSolucao || a.solucao) textos.push('Solução: ' + [a.tipoSolucao, a.solucao].filter(Boolean).join(' — '));
    var ocorrencia = textos.map(function (t) { return '<div class="oe-pauta oe-texto">' + e(t) + '</div>'; }).join('');
    for (var k = textos.length; k < LINHAS_DA_OCORRENCIA; k++) ocorrencia += '<div class="oe-pauta"></div>';

    var ref = [a.nfVenda ? 'NF ' + a.nfVenda : '', a.sequencia ? 'seq. ' + a.sequencia : ''].filter(Boolean).join(' · ');

    return '<div class="oe">' +
      '<div class="oe-loja">' + e(o.loja || 'LOJÃO DA CONSTRUÇÃO') + '</div>' +
      '<div class="oe-titulo">ORDEM DE ENTREGA DE MATERIAL</div>' +
      '<div class="oe-ref">' + (a.sequencia ? 'Assistência nº ' + e(a.sequencia) : 'Assistência') +
        (a.dataAbertura ? ' · aberta em ' + e(App.fmtData(a.dataAbertura)) : '') + '</div>' +
      linha('CLIENTE:', a.cliente) +
      linha('ENDEREÇO:', a.endereco) +
      '<div class="oe-dupla">' + linha('CNPJ/CPF:', a.documento) + linha('FONE:', a.telefone) + '</div>' +
      linha('NOTA FISCAL NR OU NR DO PEDIDO:', ref) +
      '<div class="oe-dupla">' + linha('DATA DA NOTA FISCAL:', a.dataNota ? App.fmtData(a.dataNota) : EM_BRANCO, 'oe-curta') +
        linha('ENTREGA:', a.dataEntrega ? App.fmtData(a.dataEntrega) : EM_BRANCO, 'oe-curta') + '</div>' +
      (itens.entregar.length ? tabela('PRODUTOS A SER ENTREGUE', itens.entregar) : '') +
      tabela('PRODUTO DEVOLVIDO', itens.devolver) +
      '<div class="oe-secao">DISCRIMINAÇÃO DA OCORRÊNCIA</div>' + ocorrencia +
      '<div class="oe-assina">' +
        linha('DATA DA TROCA / ENTREGA:', EM_BRANCO, 'oe-curta') +
        linha('RESPONSÁVEL PELA OCORRÊNCIA:', a.responsavel) +
        linha('RESPONSÁVEL PELA ENTREGA:', '') +
        linha('VISTO DO CLIENTE OU RESPONSÁVEL:', '') +
      '</div></div>';
  }

  var AssistenciasNucleo = {
    STATUS: STATUS,
    CAUSAS: CAUSAS,
    TIPOS_SOLUCAO: TIPOS_SOLUCAO,
    MOTIVOS_AVARIA: MOTIVOS_AVARIA,
    ehAvaria: ehAvaria,
    REPOSICAO: REPOSICAO,
    TROCA_NOVO: TROCA_NOVO,
    ehTrocaPorNovo: ehTrocaPorNovo,
    produtosDaFicha: produtosDaFicha,
    produtosNovos: produtosNovos,
    resumoProdutos: resumoProdutos,
    classeStatus: classeStatus,
    resumoAssistencias: resumoAssistencias,
    filtrarAssistencias: filtrarAssistencias,
    ordenarAssistencias: ordenarAssistencias,
    sequenciaDuplicada: sequenciaDuplicada,
    separarFotos: separarFotos,
    juntarFotos: juntarFotos,
    parseDinheiroBR: parseDinheiroBR,
    linhasExcel: linhasExcel,
    itensDaOrdem: itensDaOrdem,
    htmlOrdemEntrega: htmlOrdemEntrega
  };

  global.AssistenciasNucleo = AssistenciasNucleo;
  if (typeof module === 'object' && module.exports) module.exports = AssistenciasNucleo;
})(typeof window !== 'undefined' ? window : globalThis);
