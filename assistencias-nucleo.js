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
  var TIPOS_SOLUCAO = ['Troca', 'Devolução (dinheiro)', 'Crédito na Loja',
    'Abatimento do pedido', 'Assistência da fábrica', 'Outro'];

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
    var emAberto = 0, custoMes = 0, liquidoMes = 0;
    (lista || []).forEach(function (a) {
      if (a.status !== 'Resolvida') emAberto++;
      if ((a.dataAbertura || '').substring(0, 7) === mes) {
        custoMes += a.custoLoja || 0;
        liquidoMes += (a.custoLoja || 0) - (a.ressarcimentoFabrica || 0);
      }
    });
    return {
      emAberto: emAberto,
      custoMes: App.centavos(custoMes),
      liquidoMes: App.centavos(liquidoMes)
    };
  }

  // f: { status, causa, de, ate, termo }. Vazio = não filtra. A busca
  // por texto procura em cliente E sequência, sem acento.
  function filtrarAssistencias(lista, f) {
    var o = f || {};
    var termo = App.normalizarTexto(o.termo || '');
    return (lista || []).filter(function (a) {
      if (o.status && a.status !== o.status) return false;
      if (o.causa && a.causa !== o.causa) return false;
      if (o.de && (a.dataAbertura || '') < o.de) return false;
      if (o.ate && (a.dataAbertura || '') > o.ate) return false;
      if (termo &&
          App.normalizarTexto(a.cliente).indexOf(termo) === -1 &&
          App.normalizarTexto(a.sequencia).indexOf(termo) === -1) return false;
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
  // que ja foi salvo. Este par separa/junta para a tela e a
  // exportacao; lixo (objeto sem img, tipos estranhos) e' ignorado.
  function separarFotos(fotos) {
    var problema = [], termo = [];
    (fotos || []).forEach(function (f) {
      if (f && typeof f === 'object' && f.termo === true) {
        if (typeof f.img === 'string' && f.img) termo.push(f.img);
      } else if (typeof f === 'string' && f) {
        problema.push(f);
      }
    });
    return { problema: problema, termo: termo };
  }
  function juntarFotos(problema, termo) {
    return (problema || []).concat((termo || []).map(function (img) {
      return { termo: true, img: img };
    }));
  }

  function linhasExcel(lista) {
    return (lista || []).map(function (a) {
      var fotos = separarFotos(a.fotos);
      return {
        'Sequência': a.sequencia || '',
        'Abertura': a.dataAbertura || '',
        'Cliente': a.cliente || '',
        'Código': a.codigo || '',
        'Produto': a.produto || '',
        'Tonalidade': a.tonalidade || '',
        'Qtd': a.quantidade != null ? a.quantidade : '',
        'Valor (R$)': a.valor != null ? a.valor : '',
        'NF venda': a.nfVenda || '',
        'Problema': a.problema || '',
        'Causa': a.causa || '',
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

  var AssistenciasNucleo = {
    STATUS: STATUS,
    CAUSAS: CAUSAS,
    TIPOS_SOLUCAO: TIPOS_SOLUCAO,
    classeStatus: classeStatus,
    resumoAssistencias: resumoAssistencias,
    filtrarAssistencias: filtrarAssistencias,
    ordenarAssistencias: ordenarAssistencias,
    sequenciaDuplicada: sequenciaDuplicada,
    separarFotos: separarFotos,
    juntarFotos: juntarFotos,
    linhasExcel: linhasExcel
  };

  global.AssistenciasNucleo = AssistenciasNucleo;
  if (typeof module === 'object' && module.exports) module.exports = AssistenciasNucleo;
})(typeof window !== 'undefined' ? window : globalThis);
