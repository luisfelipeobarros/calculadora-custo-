/* ============================================================
   painel-nucleo.js — as contas do Painel de metas da Calculadora.

   Mesmo desenho do calculo-nucleo.js: o UNICO lugar onde as regras
   moram, carregavel com <script src> no navegador e com require()
   nos testes. A tela so' formata e grava; a conta e' toda daqui.

   As regras (combinadas com quem usa a planilha que este painel
   substitui):

   - Dia de trabalho = qualquer dia MENOS domingo e MENOS feriado
     cadastrado no mes. Sabado e' dia normal.
   - Limite de pagamento = 60% do objetivo de vendas do mes.
   - A previsao do mes corrente parte do faturado acumulado ate um
     dia D (lancado a mao), tira a media por dia util decorrido e
     projeta sobre os dias uteis que FALTAM. Sem dias decorridos nao
     ha' media — e a previsao fica em branco em vez de inventada.

   Precisa vir DEPOIS de app-shared.js — usa App.centavos e
   App.somarDias.
   ============================================================ */
(function (global) {
  'use strict';

  var App = (typeof module === 'object' && module.exports)
    ? require('./app-shared.js')
    : global.App;

  if (!App || !App.centavos) {
    throw new Error('painel-nucleo.js precisa de app-shared.js carregado antes.');
  }

  var centavos = App.centavos;
  var somarDias = App.somarDias;

  // O 60% fica SO' aqui. Se um dia a politica mudar, muda-se este
  // numero e a coluna, o total e o teste andam juntos.
  var LIMITE_DO_OBJETIVO = 0.60;

  // 'aaaa-mm' -> 'aaaa-mm-dd' do ultimo dia (fevereiro, bissexto e
  // tudo o mais por conta do Date).
  function ultimoDiaDoMes(mes) {
    var ano = Number(mes.substring(0, 4));
    var m = Number(mes.substring(5, 7));
    return mes + '-' + String(new Date(ano, m, 0).getDate()).padStart(2, '0');
  }

  function ehDomingo(iso) {
    return new Date(iso + 'T12:00:00').getDay() === 0;
  }

  // Dias uteis no intervalo FECHADO [ini, fim]: sem domingos e sem os
  // feriados da lista. Feriado que cai num domingo nao desconta duas
  // vezes — o dia ja' esta' fora por ser domingo.
  function diasUteis(ini, fim, feriados) {
    if (!ini || !fim || ini > fim) return 0;
    var feriado = Object.create(null);
    (feriados || []).forEach(function (f) { feriado[f] = true; });
    var n = 0;
    for (var d = ini; d <= fim; d = somarDias(d, 1)) {
      if (!ehDomingo(d) && !feriado[d]) n++;
    }
    return n;
  }

  function diasDeTrabalho(mes, feriados) {
    return diasUteis(mes + '-01', ultimoDiaDoMes(mes), feriados);
  }

  // Tudo que a linha do mes mostra, a partir do que foi digitado
  // (objetivo, feriados, faturamento {acumulado, ate}) e do que veio
  // do Firestore (aPagar, em reais). Campo sem dado sai null — a tela
  // mostra vazio; null nunca vira zero, porque zero e' uma afirmacao.
  function resumoDoMes(entrada, hoje) {
    var mes = entrada.mes;
    var objetivo = entrada.objetivo == null ? null : entrada.objetivo;
    var feriados = entrada.feriados || [];
    var fat = entrada.faturamento && entrada.faturamento.acumulado != null
      ? entrada.faturamento : null;
    var aPagar = entrada.aPagar == null ? null : entrada.aPagar;

    var iniMes = mes + '-01';
    var fimMes = ultimoDiaDoMes(mes);
    var mesDeHoje = String(hoje).substring(0, 7);
    var estado = mes < mesDeHoje ? 'fechado' : (mes === mesDeHoje ? 'corrente' : 'futuro');

    var diasTrabalho = diasUteis(iniMes, fimMes, feriados);
    var limite = objetivo == null ? null : centavos(objetivo * LIMITE_DO_OBJETIVO);
    var disponivel = (limite != null && aPagar != null) ? centavos(limite - aPagar) : null;

    var vendas = fat ? fat.acumulado : null;
    var diarioPrevisto = (objetivo != null && diasTrabalho > 0)
      ? centavos(objetivo / diasTrabalho) : null;

    // "ate" fora do mes nao pode inflar a media: acima do fim vale o
    // fim (mes completo); abaixo do inicio nao ha' dia decorrido.
    var ate = fat && fat.ate ? (fat.ate > fimMes ? fimMes : fat.ate) : null;
    var decorridos = (ate && ate >= iniMes) ? diasUteis(iniMes, ate, feriados) : 0;
    var mesCompleto = estado === 'fechado' || ate === fimMes;

    // No mes andando, comparar as vendas parciais com o objetivo do
    // MES INTEIRO diria "estamos 90% abaixo" todo dia 04. O objetivo
    // COMPARAVEL e' proporcional aos dias uteis decorridos ate a data
    // do lancamento; em mes completo, e' o proprio objetivo. Zero dia
    // decorrido -> comparavel zero -> diferenca em branco, nunca
    // "-100%" no primeiro dia.
    var objetivoComparavel = null;
    if (objetivo != null) {
      objetivoComparavel = (mesCompleto || diasTrabalho === 0)
        ? objetivo
        : centavos(objetivo * decorridos / diasTrabalho);
    }
    var difPct = (vendas != null && objetivoComparavel > 0)
      ? vendas / objetivoComparavel - 1 : null;

    var diarioRealizado = null;
    if (vendas != null) {
      // Mes fechado: o acumulado e' o total do mes, divide pelos dias
      // de trabalho (a conta da planilha). Mes andando: divide so'
      // pelos dias uteis ja' decorridos, senao a media cai a cada dia.
      if (mesCompleto) diarioRealizado = diasTrabalho > 0 ? centavos(vendas / diasTrabalho) : null;
      else diarioRealizado = decorridos > 0 ? centavos(vendas / decorridos) : null;
    }

    var previsao = null;
    if (estado === 'corrente' && fat) {
      var restantes = ate ? diasUteis(somarDias(ate, 1), fimMes, feriados) : diasTrabalho;
      var media = decorridos > 0 ? vendas / decorridos : null;
      previsao = {
        decorridos: decorridos,
        restantes: restantes,
        media: media == null ? null : centavos(media),
        // Sem media nao ha' previsao — comeco de mes mostra so' o
        // necessario por dia, sem inventar projecao de amostra vazia.
        prevista: media == null ? null : centavos(vendas + media * restantes),
        necessarioPorDia: objetivo == null ? null
          : vendas >= objetivo ? 0
          : restantes > 0 ? centavos((objetivo - vendas) / restantes)
          : null
      };
    }

    return {
      mes: mes,
      estado: estado,
      diasTrabalho: diasTrabalho,
      limite: limite,
      disponivel: disponivel,
      vendas: vendas,
      objetivoComparavel: objetivoComparavel,
      difPct: difPct,
      diarioPrevisto: diarioPrevisto,
      diarioRealizado: diarioRealizado,
      previsao: previsao
    };
  }

  /* ============================================================
     Projecao anual e comparacao com o ano anterior

     A fonte do historico e' o proprio app: as vendas mes a mes de
     cada ano lancadas na tabela de metas (metasMensais). O total do
     ano anterior, o crescimento ate agora e a sazonalidade saem TODOS
     dali — nenhum numero de faturamento fica escrito em codigo (o
     repositorio e' publico; o Firestore fica atras de login).
     ============================================================ */

  function pad2(m) { return String(m).padStart(2, '0'); }

  // Vendas lancadas de um mes ('aaaa-mm') no mapa de metas — null
  // quando nao ha lancamento (nunca zero: zero e' uma afirmacao).
  function vendasDoMes(metas, mes) {
    var d = (metas || {})[mes];
    return (d && d.faturamento && d.faturamento.acumulado != null)
      ? d.faturamento.acumulado : null;
  }

  // Total vendido de um ano. So' vale com os DOZE meses lancados —
  // total parcial rotulado de "faturamento do ano" seria mentira
  // silenciosa. Faltou mes, devolve null e a tela diz o que falta.
  function totalAnualVendas(metas, ano) {
    var total = 0;
    for (var m = 1; m <= 12; m++) {
      var v = vendasDoMes(metas, ano + '-' + pad2(m));
      if (v == null) return null;
      total += v;
    }
    return centavos(total);
  }

  // Acumulado dos meses FECHADOS do ano contra os MESMOS meses do ano
  // anterior — crescimento de fato contra fato, sem meta e sem
  // projecao. O mes corrente (parcial) fica de fora: parcial contra
  // mes cheio diria a coisa errada. So' entram meses com lancamento
  // nos DOIS anos, e a resposta diz o intervalo usado.
  function crescimentoAteAgora(metas, ano, hoje) {
    var mesDeHoje = String(hoje).substring(0, 7);
    var atual = 0, anterior = 0, meses = [];
    for (var m = 1; m <= 12; m++) {
      var mes = ano + '-' + pad2(m);
      if (mes >= mesDeHoje) break;
      var v = vendasDoMes(metas, mes);
      var va = vendasDoMes(metas, (ano - 1) + '-' + pad2(m));
      if (v == null || va == null) continue;
      atual += v; anterior += va; meses.push(m);
    }
    if (!meses.length || !(anterior > 0)) return null;
    return {
      atual: centavos(atual), anterior: centavos(anterior),
      pct: atual / anterior - 1,
      deMes: meses[0], ateMes: meses[meses.length - 1]
    };
  }

  // "No ritmo atual": projecao pela SAZONALIDADE historica. O peso de
  // cada mes no ano (media de ate 4 anos anteriores COMPLETOS) diz
  // quanto do ano costuma estar vendido ate aqui; a projecao e' o
  // vendido nos meses fechados dividido pelo peso acumulado deles.
  // Sem ano-base completo ou sem mes fechado lancado -> null.
  function projecaoSazonal(metas, ano, hoje) {
    var pesos = null, anosBase = [];
    for (var a = ano - 1; a >= ano - 4; a--) {
      var tot = totalAnualVendas(metas, a);
      if (tot == null || !(tot > 0)) continue;
      anosBase.push(a);
      if (!pesos) pesos = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (var m = 1; m <= 12; m++) {
        pesos[m - 1] += vendasDoMes(metas, a + '-' + pad2(m)) / tot;
      }
    }
    if (!pesos) return null;
    for (var i = 0; i < 12; i++) pesos[i] /= anosBase.length;

    var mesDeHoje = String(hoje).substring(0, 7);
    var vendido = 0, pesoAcum = 0, mesesUsados = 0;
    for (var m2 = 1; m2 <= 12; m2++) {
      var mes = ano + '-' + pad2(m2);
      if (mes >= mesDeHoje) break;
      var v = vendasDoMes(metas, mes);
      // Mes fechado sem lancamento sai da conta INTEIRO (do vendido e
      // do peso): a proporcao continua honesta.
      if (v == null) continue;
      vendido += v; pesoAcum += pesos[m2 - 1]; mesesUsados++;
    }
    if (!mesesUsados || !(pesoAcum > 0)) return null;
    return {
      total: centavos(vendido / pesoAcum),
      mesesUsados: mesesUsados,
      anosBase: anosBase.slice().reverse()
    };
  }

  // A projecao do ano, composta por tres fatias (regra combinada em
  // 21/08/2026):
  //   - meses FECHADOS entram pelas vendas realizadas;
  //   - o mes CORRENTE entra pela previsao de fim de mes (media por
  //     dia util x dias restantes); sem previsao ainda, cai para as
  //     vendas parciais e, sem lancamento nenhum, para o objetivo —
  //     e a resposta DIZ qual fonte usou (fonte), nada e' silencioso;
  //   - meses FUTUROS entram pelo objetivo ("vamos bater a meta").
  // Mes fechado sem vendas lancadas e futuro sem objetivo NAO viram
  // zero mudo: saem contados nas listas proprias, para a tela avisar
  // que a projecao esta' incompleta.
  function projecaoAnual(entradas, hoje) {
    var realizado = 0, futuros = 0;
    var corrente = null;
    var fechadosSemVendas = [], futurosSemObjetivo = [];

    (entradas || []).forEach(function (e) {
      var r = resumoDoMes(e, hoje);
      if (r.estado === 'fechado') {
        if (r.vendas == null) fechadosSemVendas.push(e.mes);
        else realizado += r.vendas;
      } else if (r.estado === 'corrente') {
        var prevista = (r.previsao && r.previsao.prevista != null) ? r.previsao.prevista : null;
        if (prevista != null) corrente = { mes: e.mes, valor: prevista, fonte: 'previsao' };
        else if (r.vendas != null) corrente = { mes: e.mes, valor: r.vendas, fonte: 'vendas' };
        else if (e.objetivo != null) corrente = { mes: e.mes, valor: e.objetivo, fonte: 'objetivo' };
        else corrente = { mes: e.mes, valor: 0, fonte: null };
      } else {
        if (e.objetivo == null) futurosSemObjetivo.push(e.mes);
        else futuros += e.objetivo;
      }
    });

    return {
      realizado: centavos(realizado),
      corrente: corrente,
      futuros: centavos(futuros),
      total: centavos(realizado + (corrente ? corrente.valor : 0) + futuros),
      fechadosSemVendas: fechadosSemVendas,
      futurosSemObjetivo: futurosSemObjetivo
    };
  }

  // O "A pagar real" de um mes dividido pelas SEMANAS DE PAGAMENTO
  // (sabado a sexta — a mesma regra do filtro "Pgto semana"). Cada
  // semana soma SO os vencimentos do proprio mes: a soma das semanas
  // fecha exatamente com o total do mes, e a semana que cruza a
  // virada aparece nos dois meses, cada um com a sua parte (marcada
  // com parcial:true).
  //
  // porDia: { 'aaaa-mm-dd': valor } — vencimentos ja somados por dia.
  function semanasDoMes(porDia, mes) {
    var iniMes = mes + '-01', fimMes = ultimoDiaDoMes(mes);
    var dow = new Date(iniMes + 'T12:00:00').getDay(); // 0=dom ... 6=sab
    var sab = somarDias(iniMes, -((dow + 1) % 7));     // sabado da semana do dia 1
    var semanas = [];
    for (var s = sab; s <= fimMes; s = somarDias(s, 7)) {
      var fimSem = somarDias(s, 6);
      var de = s < iniMes ? iniMes : s;
      var ate = fimSem > fimMes ? fimMes : fimSem;
      var valor = 0;
      for (var d = de; d <= ate; d = somarDias(d, 1)) {
        valor += (porDia && porDia[d]) || 0;
      }
      semanas.push({
        ini: s, fim: fimSem,
        valor: centavos(valor),
        parcial: s < iniMes || fimSem > fimMes
      });
    }
    return semanas;
  }

  // total / ano anterior - 1. Null quando falta um dos lados — sem
  // numero do ano anterior nao existe crescimento, nem "0%".
  function crescimentoAnual(total, faturamentoAnterior) {
    if (total == null || faturamentoAnterior == null || !(faturamentoAnterior > 0)) return null;
    return total / faturamentoAnterior - 1;
  }

  var PainelNucleo = {
    LIMITE_DO_OBJETIVO: LIMITE_DO_OBJETIVO,
    ultimoDiaDoMes: ultimoDiaDoMes,
    diasUteis: diasUteis,
    diasDeTrabalho: diasDeTrabalho,
    resumoDoMes: resumoDoMes,
    projecaoAnual: projecaoAnual,
    crescimentoAnual: crescimentoAnual,
    vendasDoMes: vendasDoMes,
    totalAnualVendas: totalAnualVendas,
    crescimentoAteAgora: crescimentoAteAgora,
    projecaoSazonal: projecaoSazonal,
    semanasDoMes: semanasDoMes
  };

  global.PainelNucleo = PainelNucleo;
  if (typeof module === 'object' && module.exports) module.exports = PainelNucleo;
})(typeof window !== 'undefined' ? window : globalThis);
