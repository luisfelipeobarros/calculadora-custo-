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

  var PainelNucleo = {
    LIMITE_DO_OBJETIVO: LIMITE_DO_OBJETIVO,
    ultimoDiaDoMes: ultimoDiaDoMes,
    diasUteis: diasUteis,
    diasDeTrabalho: diasDeTrabalho,
    resumoDoMes: resumoDoMes
  };

  global.PainelNucleo = PainelNucleo;
  if (typeof module === 'object' && module.exports) module.exports = PainelNucleo;
})(typeof window !== 'undefined' ? window : globalThis);
