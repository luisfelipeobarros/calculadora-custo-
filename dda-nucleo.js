/* ============================================================
   dda-nucleo.js — conferência do DDA contra as duplicatas.

   Duas entradas, um so' registro: o PDF do Bradesco (secao 3, por
   posicao no texto) e a planilha .xlsx do Safra (secao 3b, por rotulo
   de coluna). Tudo que vem depois — casamento, conferencia, lista do
   que pode ser baixado em lote — nao sabe de onde o boleto veio.

   Terceira entrada, opcional: o EXTRATO do Bradesco (secao 3c). Ele
   nao casa com duplicata nenhuma (nao traz numero de documento); ele
   se apoia no boleto que o DDA ja' casou e diz QUANDO e QUANTO saiu
   da conta (secao 4b) — e' o que da' data real e juros a' baixa.

   Mesmo desenho do calculo-nucleo.js: o UNICO lugar onde as regras
   de leitura e casamento moram, carregavel com <script src> no
   navegador e com require() nos testes — o teste exercita o codigo
   que roda na tela, nao uma copia.

   Tudo aqui e' DETERMINISTICO: posicao + regex + inteiros em
   centavos. Nenhuma IA em nenhuma etapa — a tela existe para pegar
   valor adulterado em centavos, e um modelo que alucina um digito
   nao erra alto: devolve um numero plausivel e carimba a fraude
   como "conferida". Regex que nao casa manda a linha para o bloco
   "nao consegui ler". Falhar alto e' a caracteristica principal.

   Este arquivo NAO escreve nada em lugar nenhum: recebe dados,
   devolve um relatorio. Quem le o PDF (pdf.js), quem abre a planilha
   (SheetJS), quem desenha e quem grava a baixa e' o controle-notas.html.

   Precisa vir DEPOIS de app-shared.js — usa App.linhasDePdf.
   ============================================================ */
(function (global) {
  'use strict';

  var App = (typeof module === 'object' && module.exports)
    ? require('./app-shared.js')
    : global.App;

  if (!App || !App.linhasDePdf) {
    throw new Error('dda-nucleo.js precisa de app-shared.js carregado antes.');
  }

  /* ============================================================
     1. Regras por fornecedor (cedente)

     Cada fornecedor preenche o "numero do documento" do boleto de
     um jeito. O padrao e' NF-e + parcela; quem foge disso entra
     aqui, UMA LINHA por fornecedor — mesmo desenho do
     REGRAS_FORNECEDOR do app-shared.js. O resto do codigo so'
     consulta esta tabela; acrescentar o proximo fornecedor nao pode
     exigir mexer em estrategia nenhuma.

     A regra e' reconhecida pelo BENEFICIARIO do boleto (CNPJ, se
     informado aqui; senao palavra inteira no nome). Quando o
     beneficiario e' fundo/securitizadora — 22 dos 36 boletos do PDF
     real — nenhuma regra casa e vale a estrategia padrao, buscando
     em TODA a base carregada: o fornecedor de verdade e' o que a
     duplicata encontrada disser.
     ============================================================ */

  var ESTRATEGIA_PADRAO = 'nota+valor+vencimento';
  var REGRAS_DDA = [
    // Cerbras: o documento e' numero interno do cedente, nao a NF-e —
    // a nota nao tem como ser o eixo, entao vale o valor escopado ao
    // cedente. E' a UNICA excecao; fornecedor que so' numera a parcela
    // do seu jeito (Mari sem parcela, Formigres em letra) nao precisa
    // de regra: a estrategia padrao ignora a parcela.
    { cedente: 'cerbras', estrategia: 'valorEVencimento' }
  ];

  /* ============================================================
     2. Normalizacoes
     ============================================================ */

  // minusculas + sem acento (nomes do PDF vem sem acento, mas os do
  // Firestore podem ter).
  function normalizar(s) {
    return String(s == null ? '' : s).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // tira os acentos separados pelo NFD
  }

  // O Bradesco imprime CNPJ com 15 digitos (um zero a mais na
  // frente: 004.226.489/0001-75). Sem descartar esse zero, NENHUMA
  // comparacao de CNPJ casa.
  function normalizarCnpj(s) {
    var d = String(s == null ? '' : s).replace(/\D/g, '');
    if (d.length === 15 && d.charAt(0) === '0') d = d.slice(1);
    return d;
  }

  // '0000049676' -> '49676'; zeros a esquerda existem no DDA (Mari) e
  // nao existem no numeroNota do Firestore. Vale para os dois lados.
  function semZeros(s) {
    return String(s == null ? '' : s).replace(/^0+(?=.)/, '');
  }

  // '001' -> '1', '04' -> '4', 'd' -> 'D'. Letra e numero NAO se
  // convertem um no outro aqui — quem decide o que fazer com
  // parcela-letra e' a estrategia (desempate por valor, registrado).
  function normalizarParcela(s) {
    return semZeros(String(s == null ? '' : s).trim()).toUpperCase();
  }

  // Formatos vistos nos arquivos reais (PDF do Bradesco e planilha do
  // Safra, 30 dias):
  //   '0000049676'   so' a nota
  //   '460347/04', '370357-3', '471702 01', '48074.1'   nota + parcela
  //   '550072-D', '018923 B'   parcela em LETRA (A = 1a, B = 2a...)
  //   '1666488B H'   Formigres: nota, parcela B, e o H e' a ULTIMA
  //                  parcela (8 parcelas = H) — o H se descarta
  //   '000341713C', '000221609B'   nota colada na letra da parcela
  //   '1715506STI', '2018849GNR'   nota + sigla do cedente, sem parcela
  //   '470970/02/', '44536-'   separador sobrando no fim
  //   '7359   P1'   espacos repetidos
  // '1 1656 2' e '454802 5 3' tem DOIS separadores e sao genuinamente
  // ambiguos (serie? nota? parcela?): voltam como ambiguo, sem chute,
  // e o casamento cai no ultimo recurso por valor+vencimento.
  function dividirDocumento(doc) {
    var d = String(doc == null ? '' : doc).trim()
      .replace(/\s+/g, ' ')
      .replace(/[\/\-. ]+$/, ''); // separador sobrando no fim
    var m = d.match(/^(\d+)[\/\-. ]([0-9A-Za-z]+)$/);
    if (m) return { nota: semZeros(m[1]), parcela: normalizarParcela(m[2]) };
    if (/^\d+$/.test(d)) return { nota: semZeros(d), parcela: null };
    // nota + letra da parcela, colada ou nao, com ou sem a letra da
    // ultima parcela depois ('1666488B H', '000341713C', '885579A A')
    m = d.match(/^(\d+)([A-Za-z])( [A-Za-z])?$/);
    if (m) return { nota: semZeros(m[1]), parcela: normalizarParcela(m[2]) };
    // nota + sigla (2 a 4 letras) colada: sem parcela
    m = d.match(/^(\d+)[A-Za-z]{2,4}$/);
    if (m) return { nota: semZeros(m[1]), parcela: null };
    return { ambiguo: true };
  }

  // 'A' -> 1, 'B' -> 2 ... 'Z' -> 26. Fornecedores que numeram a
  // parcela em letra (Formigres, Norcola, Caracol, Zagonel...): a
  // letra e' a posicao da parcela. So' letra UNICA; 'ST', 'ICM', 'P1'
  // nao sao parcela e devolvem null.
  function parcelaDaLetra(p) {
    var t = String(p == null ? '' : p).trim().toUpperCase();
    if (!/^[A-Z]$/.test(t)) return null;
    return String(t.charCodeAt(0) - 64);
  }

  function dataBrParaIso(s) {
    var m = String(s == null ? '' : s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? (m[3] + '-' + m[2] + '-' + m[1]) : null;
  }

  // '33.383,97' (ou 'R$ 33.383,97') -> 3338397, inteiro. Nunca passa
  // por float: 0.1 + 0.2 !== 0.3 viraria falso positivo de valor
  // divergente. Formato fora do padrao brasileiro devolve null — e
  // null derruba o registro para o bloco de ilegiveis, nao vira zero.
  function valorParaCentavos(v) {
    if (typeof v === 'number') return Math.round(v * 100);
    var t = String(v == null ? '' : v).replace(/^R\$\s*/, '').trim();
    if (!/^(\d{1,3}(\.\d{3})*|\d+),\d{2}$/.test(t)) return null;
    return parseInt(t.replace(/\./g, '').replace(',', ''), 10);
  }

  // Centavos de uma duplicata do Firestore (valor em reais, numero).
  function centavosDe(valor) {
    return Math.round((valor || 0) * 100);
  }

  // Ate' 10 centavos e' arredondamento, nao divergencia (pedido de
  // 14/09/2026: boleto de 4.940,76 contra duplicata de 4.940,73). Vale
  // em TODO lugar que compara valor — casamento, extrato e relatorio.
  var TOLERANCIA_CENTAVOS = 10;
  function valorBate(a, b) {
    return a != null && b != null && Math.abs(a - b) <= TOLERANCIA_CENTAVOS;
  }

  /* ============================================================
     3. Leitura do PDF ja' extraido (paginas de itens {texto,x,y})

     A ordem sequencial do content stream MENTE (a coluna "Situacao"
     vem em blocos separados; 2 registros quebram entre paginas).
     Tudo se ancora em posicao:

     - linhas por y dentro de cada pagina (App.linhasDePdf);
     - registro comeca na LINHA DE NOMES (pagador + beneficiario),
       que e' sempre a primeira do bloco — conferido no PDF real,
       inclusive nos dois registros que atravessam pagina. Ancorar
       na data da esquerda falharia justamente neles: a linha de
       nomes fica no pe' de uma pagina e as datas no topo da outra;
     - dentro do registro, cada celula e' classificada por COLUNA +
       FORMATO, nunca pela posicao da linha: no topo de pagina o
       Bradesco funde em uma linha celulas que normalmente ocupam
       tres (vencimento + CNPJs + valor no mesmo y, pagina 3 do
       arquivo real).
     ============================================================ */

  // Fronteiras entre colunas, em pontos. Medidas do PDF real:
  // rotulos em x=40/181/351/530, dados em x=40/188/359/530.
  var COLUNAS = { fimDatas: 150, fimPagador: 335, fimBeneficiario: 505 };

  function colunaDe(x) {
    if (x < COLUNAS.fimDatas) return 'datas';
    if (x < COLUNAS.fimPagador) return 'pagador';
    if (x < COLUNAS.fimBeneficiario) return 'beneficiario';
    return 'valor';
  }

  var RE_CNPJ_PDF = /^\d{2,3}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
  var RE_DATA_BR = /^\d{2}\/\d{2}\/\d{4}$/;
  var RE_BANCO = /^\d{3} - /;

  // Cabecalho da tabela: a partir de qualquer um destes rotulos, a
  // linha e tudo ACIMA dela e' cabecalho do relatorio (titulo, dados
  // da consulta), nao registro.
  var RE_CABECALHO = /numero de documento|debito e limite de pagamento|pagador, cpf\/cnpj|beneficiario, cpf\/cnpj/;
  // Rodape institucional (so' na ultima pagina): daquela linha para
  // baixo nao ha' mais registro.
  var RE_RODAPE = /^sac - servico|alo bradesco|^ouvidoria\b/;

  function textoDaLinha(l) {
    return l.celulas.map(function (c) { return c.texto; }).join(' ');
  }

  // Linha de nomes = celula de pagador E de beneficiario que nao sao
  // CNPJ, banco, data nem valor. E' o que separa um registro do
  // seguinte; as demais linhas do bloco tem CNPJ/banco/data nessas
  // colunas e nunca passam neste teste.
  function ehLinhaDeNomes(l) {
    var pag = null, ben = null;
    l.celulas.forEach(function (c) {
      var col = colunaDe(c.x);
      if (col === 'pagador' && !pag) pag = c.texto;
      if (col === 'beneficiario' && !ben) ben = c.texto;
    });
    if (!pag || !ben) return false;
    var naoEhNome = function (t) {
      return RE_CNPJ_PDF.test(t) || RE_DATA_BR.test(t) || RE_BANCO.test(t) || /^R\$/.test(t);
    };
    return !naoEhNome(pag) && !naoEhNome(ben);
  }

  // Junta as linhas de um bloco num registro, classificando celula a
  // celula. Devolve { ok, registro } ou { ok:false, motivo } — bloco
  // fora da forma NUNCA vira registro parcial em silencio: foi assim
  // que o parse sequencial engoliu o CARMELO FIOR.
  function montarRegistro(linhas) {
    var r = {
      pagador: null, cnpjPagador: null, documento: null,
      beneficiario: null, cnpjBeneficiario: null, banco: null,
      valorCentavos: null, situacao: null
    };
    var datas = [];
    var problemas = [];

    function um(campo, valor, rotulo) {
      if (r[campo] != null) problemas.push('mais de um(a) ' + rotulo);
      else r[campo] = valor;
    }

    linhas.forEach(function (l, idx) {
      l.celulas.forEach(function (c) {
        var col = colunaDe(c.x);
        var t = c.texto;
        if (idx === 0) {
          // linha de nomes (a ancora): so' nomes, por definicao
          if (col === 'pagador') um('pagador', t, 'pagador');
          else if (col === 'beneficiario') um('beneficiario', t, 'beneficiario');
          else problemas.push('celula inesperada na linha de nomes: "' + t + '"');
          return;
        }
        if (col === 'datas') {
          if (RE_DATA_BR.test(t)) datas.push(t);
          else um('situacao', t, 'situacao');
        } else if (col === 'pagador') {
          if (RE_CNPJ_PDF.test(t)) um('cnpjPagador', t, 'CNPJ de pagador');
          else um('documento', t, 'numero de documento');
        } else if (col === 'beneficiario') {
          if (RE_CNPJ_PDF.test(t)) um('cnpjBeneficiario', t, 'CNPJ de beneficiario');
          else if (RE_BANCO.test(t)) um('banco', t, 'banco');
          else problemas.push('celula inesperada na coluna do beneficiario: "' + t + '"');
        } else {
          if (t === 'R$') return; // o "R$" solto, quando nao gruda no numero
          var cent = valorParaCentavos(t);
          if (cent == null) problemas.push('valor ilegivel: "' + t + '"');
          else um('valorCentavos', cent, 'valor');
        }
      });
    });

    // Forma exigida. A situacao NAO entra: registro sem situacao e'
    // valido, mas sinalizado (semSituacao) — a coluna vem em blocos
    // separados no stream e, se um dia ela nao casar pelo y, o certo
    // e' avisar, nunca assumir "A PAGAR".
    if (datas.length !== 2) problemas.push(datas.length + ' data(s) na coluna de vencimento (esperava 2)');
    ['pagador', 'cnpjPagador', 'documento', 'beneficiario', 'cnpjBeneficiario', 'banco'].forEach(function (campo) {
      if (r[campo] == null) problemas.push('sem ' + campo);
    });
    if (r.valorCentavos == null) problemas.push('sem valor');

    if (problemas.length) return { ok: false, motivo: problemas.join('; ') };

    return {
      ok: true,
      registro: {
        // As duas datas sao diferentes e o vencimento e' a PRIMEIRA
        // (a de cima); a segunda e' o limite de pagamento, que pode
        // estar a dez anos. A ordem por y garante a primeira em cima
        // mesmo quando o registro atravessa pagina.
        vencimento: dataBrParaIso(datas[0]),
        limite: dataBrParaIso(datas[1]),
        pagador: r.pagador,
        cnpjPagador: normalizarCnpj(r.cnpjPagador),
        documento: r.documento,
        beneficiario: r.beneficiario,
        cnpjBeneficiario: normalizarCnpj(r.cnpjBeneficiario),
        banco: r.banco,
        valorCentavos: r.valorCentavos,
        situacao: r.situacao,
        semSituacao: r.situacao == null
      }
    };
  }

  // paginas: [[{texto,x,y}, ...], ...] — uma lista de itens por
  // pagina, direto do getTextContent() (ou de fixture, nos testes).
  function interpretar(paginas) {
    var periodo = null;
    var linhas = [];

    (paginas || []).forEach(function (itens) {
      var ls = App.linhasDePdf(itens);

      // Fronteiras da pagina: cabecalho (e tudo acima) e rodape (e
      // tudo abaixo). Por POSICAO a partir de marcadores conhecidos,
      // nao por lista de todos os textos possiveis — assim um
      // beneficiario chamado "ATENDIMENTO LTDA" nao some por engano.
      var yCabecalho = null, yRodape = null;
      ls.forEach(function (l) {
        var txt = normalizar(textoDaLinha(l));
        if (RE_CABECALHO.test(txt) && (yCabecalho === null || l.y < yCabecalho)) yCabecalho = l.y;
        if (RE_RODAPE.test(txt) && (yRodape === null || l.y > yRodape)) yRodape = l.y;
        // O periodo da consulta ("Data de Vencimento: X ate Y") vive
        // no cabecalho; sem ele o check de "titulo nosso fora do DDA"
        // nao tem como saber o que DEVIA estar no PDF.
        if (!periodo) {
          var m = txt.match(/data de vencimento:?\s*(\d{2}\/\d{2}\/\d{4})\s*ate\s*(\d{2}\/\d{2}\/\d{4})/);
          if (m) periodo = { ini: dataBrParaIso(m[1]), fim: dataBrParaIso(m[2]) };
        }
      });

      ls.forEach(function (l) {
        if (yCabecalho !== null && l.y >= yCabecalho - 0.5) return;
        if (yRodape !== null && l.y <= yRodape + 0.5) return;
        linhas.push(l);
      });
    });

    // Segmenta no fluxo continuo (os 2 registros do PDF real que
    // atravessam pagina dependem disso) e monta cada bloco.
    var registros = [], ilegiveis = [];
    var bloco = null;

    function fecharBloco() {
      if (!bloco) return;
      var m = montarRegistro(bloco);
      if (m.ok) registros.push(m.registro);
      else ilegiveis.push({
        texto: bloco.map(textoDaLinha).join('\n'),
        motivo: m.motivo
      });
      bloco = null;
    }

    linhas.forEach(function (l) {
      if (ehLinhaDeNomes(l)) { fecharBloco(); bloco = [l]; }
      else if (bloco) bloco.push(l);
      else ilegiveis.push({ texto: textoDaLinha(l), motivo: 'linha antes do primeiro registro' });
    });
    fecharBloco();

    return { periodo: periodo, registros: registros, ilegiveis: ilegiveis };
  }

  /* ============================================================
     3b. Leitura da planilha do DDA (Safra, .xlsx)

     A planilha ja' vem em celulas: nao ha' posicao para adivinhar.
     O que se ancora e' o ROTULO de cada coluna (a linha de cabecalho
     e' a primeira que tem Vencimento + Nº documento + Beneficiario +
     Nominal, onde quer que esteja — o Safra poe titulo, CNPJ,
     periodo e um resumo antes dela). Linha que nao tem vencimento,
     valor ou beneficiario legiveis vai para "nao consegui ler",
     nunca vira registro pela metade.

     O que a planilha traz a mais que o PDF do Bradesco, e o registro
     carrega: o BENEFICIARIO FINAL (o fornecedor de verdade quando o
     boleto e' de fundo/securitizadora), o NOSSO NUMERO do boleto e o
     VALOR A PAGAR ao lado do nominal. O que ela NAO traz: o CNPJ do
     beneficiario (fica vazio; as regras por cedente casam pelo nome).
     ============================================================ */

  // Rotulos aceitos por coluna, ja' normalizados (minusculas, sem
  // acento). Os quatro primeiros sao obrigatorios para reconhecer o
  // cabecalho; o resto e' opcional.
  var COLUNAS_PLANILHA = {
    vencimento: /^vencimento$/,
    documento: /^n.{0,2}\s*documento$/,
    beneficiario: /^beneficiario$/,
    nominal: /^(valor )?nominal/,
    valorTotal: /^valor (total|a pagar)/,
    situacao: /^situacao$/,
    nossoNumero: /^nosso numero$/,
    beneficiarioFinal: /^beneficiario final$/,
    banco: /^banco$/,
    pagador: /^(empresa|pagador)$/,
    cnpjPagador: /^cnpj/
  };
  var OBRIGATORIAS_PLANILHA = ['vencimento', 'documento', 'beneficiario', 'nominal'];
  // A primeira exportacao real de 30 dias veio com exatamente 500
  // linhas (15/08 a 25/08) e o cabecalho dizendo "ate' 14/09"; a
  // segunda, do mesmo periodo, veio inteira (1.253). O corte existe e
  // nao e' fixo — o que se detecta e' o SINTOMA: os boletos param
  // varios dias antes do fim que o cabecalho promete.
  var FOLGA_CORTE_DIAS = 3;

  function celulaTexto(v) {
    if (v == null) return '';
    if (v instanceof Date) return isNaN(v) ? '' : dataDaCelula(v);
    return String(v).trim();
  }

  // Data como o SheetJS entrega: Date (cellDates), serial do Excel
  // (numero), 'dd/mm/aaaa' ou ISO. Qualquer outra coisa: null.
  function dataDaCelula(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) {
      if (isNaN(v)) return null;
      var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
      return v.getFullYear() + '-' + p2(v.getMonth() + 1) + '-' + p2(v.getDate());
    }
    if (typeof v === 'number') {
      if (v < 20000 || v > 80000) return null; // serial plausivel: 1954..2119
      var d = new Date(Math.round((v - 25569) * 86400000));
      return d.toISOString().slice(0, 10);
    }
    var t = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
    return dataBrParaIso(t);
  }

  // linhas: matriz de celulas (sheet_to_json com header:1), qualquer
  // planilha do Safra — a primeira aba, como o app abre.
  function interpretarPlanilha(linhas) {
    linhas = linhas || [];
    var cab = null, iCab = -1, periodo = null;

    for (var i = 0; i < linhas.length && !cab; i++) {
      var mapa = {};
      (linhas[i] || []).forEach(function (c, j) {
        var t = normalizar(celulaTexto(c));
        Object.keys(COLUNAS_PLANILHA).forEach(function (k) {
          if (mapa[k] == null && COLUNAS_PLANILHA[k].test(t)) mapa[k] = j;
        });
      });
      var completa = OBRIGATORIAS_PLANILHA.every(function (k) { return mapa[k] != null; });
      if (completa) { cab = mapa; iCab = i; }
    }

    // O periodo ("Período: 14/09/2026 até 14/09/2026") vive acima do
    // cabecalho. Sem ele, o check de "titulo nosso fora do DDA" e'
    // pulado — igual ao PDF.
    var limite = iCab === -1 ? linhas.length : iCab;
    for (i = 0; i < limite && !periodo; i++) {
      (linhas[i] || []).forEach(function (c) {
        if (periodo) return;
        var m = normalizar(celulaTexto(c)).match(/periodo:?\s*(\d{2}\/\d{2}\/\d{4})\s*(?:ate|a|-)\s*(\d{2}\/\d{2}\/\d{4})/);
        if (m) periodo = { ini: dataBrParaIso(m[1]), fim: dataBrParaIso(m[2]) };
      });
    }

    if (!cab) {
      return {
        periodo: periodo, registros: [], origem: 'planilha',
        ilegiveis: [{ texto: '(planilha inteira)', motivo: 'não achei a linha de cabeçalho (Vencimento, Nº documento, Beneficiário, Nominal)' }]
      };
    }

    var registros = [], ilegiveis = [];
    for (i = iCab + 1; i < linhas.length; i++) {
      var l = linhas[i] || [];
      var textos = l.map(celulaTexto);
      if (!textos.some(function (t) { return t !== ''; })) continue; // linha em branco
      // Linha de total no rodape ("Total", "Totais"): nao e' boleto.
      var primeira = textos.filter(function (t) { return t !== ''; })[0];
      if (/^tota(l|is)\b/.test(normalizar(primeira))) continue;

      var celula = function (k) { return cab[k] == null ? null : l[cab[k]]; };
      var problemas = [];
      var venc = dataDaCelula(celula('vencimento'));
      if (!venc) problemas.push('vencimento ilegível: "' + celulaTexto(celula('vencimento')) + '"');
      var nominal = valorParaCentavos(celula('nominal'));
      if (nominal == null) problemas.push('valor nominal ilegível: "' + celulaTexto(celula('nominal')) + '"');
      var ben = celulaTexto(celula('beneficiario'));
      if (!ben) problemas.push('sem beneficiário');
      if (problemas.length) {
        ilegiveis.push({ texto: textos.filter(Boolean).join(' | '), motivo: problemas.join('; ') });
        continue;
      }

      // Documento vazio EXISTE na planilha real (cedente que nao
      // preenche): registro valido; o casamento cai no valor +
      // vencimento, e a tela diz que foi assim.
      var total = cab.valorTotal != null ? valorParaCentavos(celula('valorTotal')) : null;
      var situacao = celulaTexto(celula('situacao')) || null;
      registros.push({
        vencimento: venc,
        limite: null,
        pagador: celulaTexto(celula('pagador')) || null,
        cnpjPagador: normalizarCnpj(celula('cnpjPagador')),
        documento: celulaTexto(celula('documento')),
        beneficiario: ben,
        beneficiarioFinal: celulaTexto(celula('beneficiarioFinal')) || null,
        cnpjBeneficiario: '',
        banco: celulaTexto(celula('banco')) || null,
        nossoNumero: celulaTexto(celula('nossoNumero')) || null,
        valorCentavos: nominal,
        valorAPagarCentavos: total,
        situacao: situacao,
        semSituacao: situacao == null
      });
    }

    // Exportacao cortada: o cabecalho diz "ate' dia X", mas os boletos
    // param dias antes. Detectado, o periodo encolhe ate' o ultimo
    // vencimento lido (senao o check 8 acusaria "sem boleto" tudo que
    // ficou fora do corte) e a tela avisa para exportar de novo.
    var aviso = null;
    if (periodo && registros.length) {
      var ultimo = registros.reduce(function (m, r) { return r.vencimento > m ? r.vencimento : m; }, '');
      var faltam = Math.round((new Date(periodo.fim + 'T00:00:00Z') - new Date(ultimo + 'T00:00:00Z')) / 86400000);
      if (faltam >= FOLGA_CORTE_DIAS) {
        aviso = 'os boletos lidos vão só até ' + App.fmtData(ultimo) + ', mas o cabeçalho diz até ' +
          App.fmtData(periodo.fim) + ' (' + registros.length + ' linhas). Se a exportação foi cortada, ' +
          'exporte de novo num período menor; a conferência abaixo vale só até ' + App.fmtData(ultimo) + '.';
        periodo = { ini: periodo.ini, fim: ultimo, cortado: true };
      }
    }

    return { periodo: periodo, registros: registros, ilegiveis: ilegiveis, origem: 'planilha', aviso: aviso };
  }

  /* ============================================================
     3c. Leitura do extrato do Bradesco (.xls, Net Empresa)

     Cada pagina exportada e' um arquivo: Data | Lancamento | Dcto. |
     Credito | Debito | Saldo, valores em texto "1.234,56" (debito com
     sinal negativo). O arquivo repete, no fim, um bloco "Ultimos
     Lancamentos" (igual em todas as paginas) e os saldos do Invest
     Facil (cabecalho diferente, sem coluna de debito — ignorado).
     Aceita varias matrizes de uma vez e descarta a repeticao pela
     chave data + dcto + historico + valor.
     ============================================================ */

  var COLUNAS_EXTRATO = {
    data: /^data$/, historico: /^lancamento$/, dcto: /^dcto/,
    credito: /^credito/, debito: /^debito/, saldo: /^saldo/
  };
  var OBRIGATORIAS_EXTRATO = ['data', 'historico', 'debito'];

  // "-1.530,34" -> 153034 (o sinal fica por conta da coluna).
  function centavosDoExtrato(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Math.abs(Math.round(v * 100));
    return valorParaCentavos(String(v).trim().replace(/^-\s*/, ''));
  }

  // O que a linha e', pelo historico. So' o que a fase 1 precisa:
  // boleto (PAGTO ELETRON COBRANCA + cedente) e PIX enviado; o resto
  // fica rotulado para a conferencia de caixa (fase 2).
  function classificarLancamento(historico, ehCredito) {
    var h = String(historico == null ? '' : historico).replace(/\s+/g, ' ').trim();
    var m;
    if (/^SALDO/i.test(h)) return { tipo: 'saldo', contraparte: null };
    if ((m = h.match(/^PAGTO ELETRON COBRANCA\s*(.*)$/i))) return { tipo: 'boleto', contraparte: m[1].trim() || null };
    if ((m = h.match(/^PIX (?:ENVIADO|QR CODE \w+) DES:\s*(.*?)(?:\s+\d{2}\/\d{2})?$/i))) return { tipo: 'pix', contraparte: m[1].trim() || null };
    return { tipo: ehCredito ? 'credito' : 'outro', contraparte: null };
  }

  function interpretarExtrato(arquivos) {
    // Uma matriz so' ou uma lista de matrizes (as paginas).
    var lista = (arquivos && arquivos.length && Array.isArray(arquivos[0]) && Array.isArray(arquivos[0][0]))
      ? arquivos : [arquivos || []];
    var vistos = Object.create(null);
    var lancamentos = [], ilegiveis = [];

    lista.forEach(function (linhas, iArq) {
      var cab = null;
      (linhas || []).forEach(function (l) {
        l = l || [];
        var textos = l.map(celulaTexto);
        if (!textos.some(function (t) { return t !== ''; })) return;

        // Cabecalho de secao: reconhecido pelos rotulos, onde estiver.
        var mapa = {};
        textos.forEach(function (t, j) {
          var n = normalizar(t);
          Object.keys(COLUNAS_EXTRATO).forEach(function (k) {
            if (mapa[k] == null && COLUNAS_EXTRATO[k].test(n)) mapa[k] = j;
          });
        });
        if (OBRIGATORIAS_EXTRATO.every(function (k) { return mapa[k] != null; })) { cab = mapa; return; }
        if (!cab) return;

        var primeira = textos.filter(function (t) { return t !== ''; })[0];
        if (/^tota(l|is)\b/.test(normalizar(primeira))) { cab = null; return; } // fim da secao

        var celula = function (k) { return cab[k] == null ? null : l[cab[k]]; };
        var historico = celulaTexto(celula('historico'));
        var credito = centavosDoExtrato(celula('credito'));
        var debito = centavosDoExtrato(celula('debito'));
        var cls = classificarLancamento(historico, credito != null && credito > 0);
        if (cls.tipo === 'saldo') return; // "SALDO ANTERIOR" (com ou sem data) nao e' movimento
        var data = dataDaCelula(celula('data'));
        if (!data) {
          ilegiveis.push({ arquivo: iArq + 1, texto: textos.filter(Boolean).join(' | '), motivo: 'data ilegível' });
          return;
        }
        if (cls.tipo !== 'saldo' && credito == null && debito == null) {
          ilegiveis.push({ arquivo: iArq + 1, texto: textos.filter(Boolean).join(' | '), motivo: 'sem crédito nem débito legível' });
          return;
        }
        var lanc = {
          data: data,
          historico: historico,
          dcto: celulaTexto(celula('dcto')) || null,
          creditoCentavos: credito || 0,
          debitoCentavos: debito || 0,
          saldoCentavos: centavosDoExtrato(celula('saldo')),
          tipo: cls.tipo,
          contraparte: cls.contraparte,
          arquivo: iArq + 1
        };
        // Repeticao entre paginas (bloco "Ultimos Lancamentos"): fora.
        var chave = [lanc.data, lanc.dcto, normalizar(lanc.historico), lanc.creditoCentavos, lanc.debitoCentavos].join('|');
        if (vistos[chave]) return;
        vistos[chave] = true;
        lancamentos.push(lanc);
      });
    });

    lancamentos.sort(function (a, b) { return a.data < b.data ? -1 : (a.data > b.data ? 1 : 0); });
    var periodo = lancamentos.length
      ? { ini: lancamentos[0].data, fim: lancamentos[lancamentos.length - 1].data }
      : null;
    return { lancamentos: lancamentos, ilegiveis: ilegiveis, periodo: periodo, arquivos: lista.length, origem: 'extrato' };
  }

  /* ============================================================
     4. Casamento boleto <-> duplicata

     A NOTA e' o eixo (regra de 14/09/2026): o numero de documento do
     boleto aponta a NF-e, e dentro dela VALOR e VENCIMENTO decidem.
     A parcela do boleto NAO manda — fornecedor que comeca a contar da
     segunda, que numera em letra ou do seu jeito nao atrapalha. Ela
     so' desempata e, no fim, e' o que permite acusar o valor
     adulterado: boleto cujo valor nao bate com NENHUMA parcela da
     nota casa pela parcela e sai vermelho, em vez de sumir como
     "cobranca sem nota" sem dizer qual duplicata ele imitava.

     Toda resposta diz COMO casou (campo `como`): quem confere
     precisa saber se o "OK" veio de nota+valor+vencimento exatos ou
     de um desempate — sem isso a tela vira caixa preta e ninguem
     confia nela quando apontar uma fraude de verdade.

     Ambiguidade NUNCA vira escolha: devolve ambiguo=true com as
     candidatas, e o relatorio marca indeterminado.
     ============================================================ */

  function prepararBase(duplicatas) {
    var porNota = Object.create(null);
    (duplicatas || []).forEach(function (d) {
      var n = semZeros(d.numeroNota);
      if (!n) return;
      (porNota[n] = porNota[n] || []).push(d);
    });
    return { duplicatas: duplicatas || [], porNota: porNota };
  }

  function regraDoBoleto(r) {
    for (var i = 0; i < REGRAS_DDA.length; i++) {
      var rg = REGRAS_DDA[i];
      if (rg.cnpjs && rg.cnpjs.indexOf(r.cnpjBeneficiario) !== -1) return rg;
      // Palavra INTEIRA no nome truncado (~32 chars): "mari" tem que
      // casar "MARI" mas nao "MARIA CERAMICAS".
      if (new RegExp('\\b' + rg.cedente + '\\b').test(normalizar(r.beneficiario))) return rg;
    }
    return null;
  }

  function resultado(estrategia, extra) {
    var base = { estrategia: estrategia, duplicata: null, candidatas: [], como: [], ambiguo: false, motivo: null };
    Object.keys(extra || {}).forEach(function (k) { base[k] = extra[k]; });
    return base;
  }

  // A parcela do boleto bate com a nossa? Numero contra numero ('01'
  // = '1') ou letra como posicao ('B' = '2').
  function parcelaCasa(d, parcelaBoleto) {
    if (parcelaBoleto == null) return false;
    var nossa = normalizarParcela(d.parcela);
    if (nossa === parcelaBoleto) return true;
    var pos = parcelaDaLetra(parcelaBoleto);
    return pos != null && nossa === pos;
  }

  // Varias candidatas iguais: a parcela do boleto desempata, se
  // apontar exatamente uma. Senao, ambiguo com todas mostradas.
  function desempatarPelaParcela(cands, doc, comoBase, motivo) {
    var pela = cands.filter(function (d) { return parcelaCasa(d, doc.parcela); });
    if (pela.length === 1) {
      return resultado(ESTRATEGIA_PADRAO, { duplicata: pela[0], como: comoBase.concat(['desempate pela parcela']) });
    }
    return resultado(ESTRATEGIA_PADRAO, { ambiguo: true, candidatas: cands, motivo: motivo });
  }

  function casarNaNota(r, base, doc) {
    var rot = ESTRATEGIA_PADRAO;
    var daNota = base.porNota[doc.nota] || [];
    if (!daNota.length) return resultado(rot, { motivo: 'nota ' + doc.nota + ' não está na base carregada' });

    // 1) valor E vencimento iguais
    var porValor = daNota.filter(function (d) { return valorBate(centavosDe(d.valor), r.valorCentavos); });
    var exatas = porValor.filter(function (d) { return d.vencimento === r.vencimento; });
    if (exatas.length === 1) return resultado(rot, { duplicata: exatas[0], como: ['nota', 'valor', 'vencimento'] });
    if (exatas.length > 1) {
      return desempatarPelaParcela(exatas, doc, ['nota', 'valor', 'vencimento'],
        'mais de uma parcela da nota com esse valor e vencimento');
    }

    // 2) so' o valor — o vencimento diferente vira o achado de
    // antecipacao (check 7), nao derruba o casamento.
    if (porValor.length === 1) return resultado(rot, { duplicata: porValor[0], como: ['nota', 'valor', 'vencimento diferente'] });
    if (porValor.length > 1) {
      return desempatarPelaParcela(porValor, doc, ['nota', 'valor'],
        'mais de uma parcela da nota com esse valor e nenhuma com esse vencimento');
    }

    // 3) nenhuma parcela da nota tem esse valor. Se a parcela do
    // boleto existe, casa por ela — e a conferencia acusa o valor
    // divergente (vermelho). E' o alarme de valor adulterado.
    var pela = daNota.filter(function (d) { return parcelaCasa(d, doc.parcela); });
    if (pela.length === 1) return resultado(rot, { duplicata: pela[0], como: ['nota', 'parcela', 'valor NÃO bate'] });

    // 4) a nota existe e nada bate: divergencia de verdade, com as
    // parcelas mostradas. NAO cai no ultimo recurso — a nota e' o eixo.
    return resultado(rot, {
      candidatas: daNota,
      motivo: 'a nota existe, mas nenhuma parcela tem esse valor' +
        (doc.parcela != null ? ' nem a parcela ' + doc.parcela : '')
    });
  }

  function casarValorEVencimento(r, base, regra) {
    var rot = 'valor (regra ' + regra.cedente + ')';
    var re = new RegExp('\\b' + regra.cedente + '\\b');
    // Escopado ao cedente e SO' a ele: com valores repetidos 6x no
    // mesmo vencimento (PDF real), casar por valor na base inteira
    // seria loteria. Paga tambem entra (caso real de 14/09/2026: o
    // boleto PAGO da Cerbras ja' baixado aqui caia como "cobranca sem
    // nota"): quem decide o que fazer com duplicata paga e' a
    // conferencia, que ve os dois lados concordando. Entre varias, a
    // unica em aberto desempata — e o `como` registra.
    var doCedente = base.duplicatas.filter(function (d) {
      return re.test(normalizar(d.nomeEmitente));
    });
    if (!doCedente.length) return resultado(rot, { motivo: 'nenhuma duplicata de ' + regra.cedente + ' na base carregada' });

    // Valor e' a chave forte; vencimento so' DESEMPATA (preferindo o
    // exato). Exigir data igual na entrada faria um boleto com
    // vencimento deslocado um dia cair como "cobranca sem nota" — e
    // alarme falso vermelho e' o que mata a confianca na tela. A
    // diferenca de data do que casou vira o achado de vencimento
    // antecipado, que e' o que ela realmente e'.
    var porValor = doCedente.filter(function (d) { return valorBate(centavosDe(d.valor), r.valorCentavos); });
    if (!porValor.length) return resultado(rot, { motivo: 'nenhuma duplicata de ' + regra.cedente + ' com esse valor' });
    if (porValor.length === 1) return resultado(rot, { duplicata: porValor[0], como: ['valor'] });

    var exatas = porValor.filter(function (d) { return d.vencimento === r.vencimento; });
    if (exatas.length === 1) return resultado(rot, { duplicata: exatas[0], como: ['valor', 'desempate por vencimento'] });

    var abertas = (exatas.length ? exatas : porValor).filter(function (d) { return d.pago !== true; });
    if (abertas.length === 1) {
      return resultado(rot, { duplicata: abertas[0], como: ['valor'].concat(exatas.length ? ['vencimento'] : []).concat(['desempate: única em aberto']) });
    }

    return resultado(rot, { ambiguo: true, candidatas: porValor, motivo: 'mais de uma duplicata de ' + regra.cedente + ' com esse valor' });
  }

  // Ultimo recurso, quando o documento nao leva a lugar nenhum
  // (vazio, ambiguo, ou nota que nao esta na base): valor E
  // vencimento EXATOS, na base inteira. So' vale se sobrar UMA
  // duplicata — com seis boletos da mesma securitizadora de R$
  // 2.199,86 no mesmo dia (planilha real do Safra), qualquer coisa
  // menos que isso e' loteria e fica ambiguo. Paga tambem entra: a
  // reimportacao do DDA de ontem precisa reencontrar o que ja' foi
  // baixado, senao vira "cobranca sem nota" no dia seguinte. Entre
  // varias, a unica em aberto desempata — e o `como` registra.
  function casarValorEVencimentoGeral(r, base, rotulo, motivo) {
    if (!r.vencimento || r.valorCentavos == null) return null;
    var cands = base.duplicatas.filter(function (d) {
      return d.vencimento === r.vencimento && valorBate(centavosDe(d.valor), r.valorCentavos);
    });
    if (!cands.length) return null;
    if (cands.length === 1) return resultado(rotulo, { duplicata: cands[0], como: ['valor+vencimento únicos na base'], motivo: motivo });
    var abertas = cands.filter(function (d) { return d.pago !== true; });
    if (abertas.length === 1) {
      return resultado(rotulo, { duplicata: abertas[0], como: ['valor+vencimento', 'desempate: única em aberto'], motivo: motivo });
    }
    return resultado(rotulo, {
      ambiguo: true, candidatas: cands,
      motivo: motivo + '; ' + cands.length + ' duplicatas com esse valor e vencimento'
    });
  }

  function casar(r, base) {
    var regra = regraDoBoleto(r);
    if (regra && regra.estrategia === 'valorEVencimento') return casarValorEVencimento(r, base, regra);

    var doc = dividirDocumento(r.documento);
    if (doc.ambiguo) {
      var motivo = String(r.documento || '').trim()
        ? 'número de documento ambíguo ("' + r.documento + '")'
        : 'boleto sem número de documento';
      return casarValorEVencimentoGeral(r, base, ESTRATEGIA_PADRAO, motivo) ||
        resultado(ESTRATEGIA_PADRAO, { ambiguo: true, motivo: motivo });
    }

    var res = casarNaNota(r, base, doc);
    // Nota fora da base (e so' nesse caso — nota que existe sem par e'
    // divergencia de verdade): tenta o ultimo recurso, com o `como`
    // dizendo por onde.
    if (!res.duplicata && !res.ambiguo && !res.candidatas.length) {
      return casarValorEVencimentoGeral(r, base, res.estrategia, res.motivo) || res;
    }
    return res;
  }

  /* ============================================================
     4b. Extrato <-> boleto: quando e quanto saiu da conta

     O extrato e o DDA falam do mesmo CEDENTE ("PAGTO ELETRON COBRANCA
     CSMJ SECURITIZADORA" x beneficiario "CSMJ SECURITIZADORA S.A."),
     entao o debito se procura por VALOR e DATA perto do vencimento,
     com o nome so' confirmando (o extrato corta em ~34 letras e
     abrevia: "KARINA PISOS REV CERAM"). Cada debito serve a UM boleto:
     seis boletos da CSMJ de R$ 2.199,86 no mesmo dia consomem seis
     debitos iguais, e o setimo boleto fica "sem debito".

     Tres passadas, na ordem, cada uma so' com os debitos que a
     anterior nao consumiu — senao o "juros" de um boleto roubaria o
     debito exato de outro (visto no extrato real):
       1. valor exato + cedente conferido;
       2. valor exato sem o cedente conferir (o Bradesco as vezes
          imprime "PAG COBRANCA NET EMPRESA" ou nada no lugar do nome);
       3. juros: mesmo cedente, acima do nominal ate' JUROS_MAXIMO,
          depois do vencimento, e so' se sobrar um.
     Boleto recorrente (mesmo valor toda semana) tem varios debitos
     iguais na janela: vale o da DATA MAIS PROXIMA do vencimento, com
     empate para o lado de depois. O que casar da' a' baixa a data real
     e o valor pago; o que nao casar cai no vencimento e no valor da
     duplicata, avisado.
     ============================================================ */

  var JANELA_EXTRATO = { antes: 5, depois: 20 }; // dias em volta do vencimento
  var JUROS_MAXIMO = 0.10;                        // 10% acima do nominal

  function somarDias(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  var SUFIXO_NOME = /^(ltda|sa|s|a|me|epp|eireli|cia|e|de|do|da|dos|das|s\/a)$/;
  function palavrasDoNome(s) {
    return normalizar(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
      .filter(function (p) { return p && !SUFIXO_NOME.test(p); });
  }
  // Primeiras duas palavras iguais (ou a unica, quando um dos lados so'
  // tem uma): "CERAMICA FORMIGRES" bate com "CERAMICA FORMIGRES LTDA."
  // e nao com "CERAMICA CAPRI".
  function nomesCompativeis(a, b) {
    var pa = palavrasDoNome(a), pb = palavrasDoNome(b);
    if (!pa.length || !pb.length) return false;
    if (pa[0] !== pb[0]) return false;
    if (pa.length < 2 || pb.length < 2) return true;
    return pa[1] === pb[1];
  }

  function diasEntre(a, b) {
    return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  }

  // registros: boletos (os PAGOS sao os que interessam); lancamentos:
  // do interpretarExtrato. Devolve um Map registro -> resultado.
  function casarExtrato(registros, lancamentos) {
    var debitos = (lancamentos || []).filter(function (l) { return l.tipo === 'boleto' && l.debitoCentavos > 0; });
    var usado = [];
    var porRegistro = new Map();

    // Ordem estavel: vencimento, depois valor — para que dois boletos
    // iguais consumam debitos na mesma ordem em qualquer maquina.
    var pagos = registros.filter(function (r) { return situacaoPaga(r.situacao) && r.vencimento && r.valorCentavos != null; })
      .sort(function (a, b) { return (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0) || (a.valorCentavos - b.valorCentavos); });

    function livresNaJanela(r) {
      var ini = somarDias(r.vencimento, -JANELA_EXTRATO.antes);
      var fim = somarDias(r.vencimento, JANELA_EXTRATO.depois);
      var lista = [];
      debitos.forEach(function (l, i) {
        if (!usado[i] && l.data >= ini && l.data <= fim) lista.push({ i: i, l: l });
      });
      return lista;
    }

    // Entre candidatos iguais, o da data mais proxima do vencimento
    // (empate: o de depois). Devolve o escolhido e quantos havia nesse dia.
    function maisProximo(cands, venc) {
      cands.sort(function (a, b) {
        var da = diasEntre(venc, a.l.data), db = diasEntre(venc, b.l.data);
        return (Math.abs(da) - Math.abs(db)) || (db - da) || (a.i - b.i);
      });
      var c = cands[0];
      var noDia = cands.filter(function (x) { return x.l.data === c.l.data; }).length;
      return { c: c, noDia: noDia };
    }

    function comoDaData(venc, data) {
      var d = diasEntre(venc, data);
      if (d === 0) return 'data = vencimento';
      return 'data ' + Math.abs(d) + ' dia' + (Math.abs(d) === 1 ? '' : 's') + (d > 0 ? ' depois' : ' antes') + ' do vencimento';
    }

    // Passadas 1 e 2: valor exato (com o cedente conferido, depois sem)
    [true, false].forEach(function (exigirNome) {
      pagos.forEach(function (r) {
        if (porRegistro.has(r)) return;
        var cands = livresNaJanela(r).filter(function (c) {
          return valorBate(c.l.debitoCentavos, r.valorCentavos) &&
            (!exigirNome || nomesCompativeis(c.l.contraparte, r.beneficiario));
        });
        if (!cands.length) return;
        var esc = maisProximo(cands, r.vencimento);
        usado[esc.c.i] = true;
        porRegistro.set(r, {
          lancamento: esc.c.l, data: esc.c.l.data, valorPagoCentavos: esc.c.l.debitoCentavos, jurosCentavos: 0,
          nomeConferido: exigirNome,
          como: ['valor', comoDaData(r.vencimento, esc.c.l.data), exigirNome ? 'cedente' : 'cedente NÃO conferido']
            .concat(esc.noDia > 1 ? ['um de ' + esc.noDia + ' iguais no dia'] : [])
        });
      });
    });

    // Passada 3: juros, so' com o que sobrou
    pagos.forEach(function (r) {
      if (porRegistro.has(r)) return;
      var teto = Math.round(r.valorCentavos * (1 + JUROS_MAXIMO));
      var comJuros = livresNaJanela(r).filter(function (c) {
        return c.l.data >= r.vencimento && c.l.debitoCentavos > r.valorCentavos + TOLERANCIA_CENTAVOS && c.l.debitoCentavos <= teto &&
          nomesCompativeis(c.l.contraparte, r.beneficiario);
      });
      if (comJuros.length === 1) {
        var cj = comJuros[0];
        usado[cj.i] = true;
        porRegistro.set(r, {
          lancamento: cj.l, data: cj.l.data, valorPagoCentavos: cj.l.debitoCentavos,
          jurosCentavos: cj.l.debitoCentavos - r.valorCentavos, nomeConferido: true,
          como: ['cedente', 'valor acima do nominal (juros)', comoDaData(r.vencimento, cj.l.data)]
        });
        return;
      }
      var ini = somarDias(r.vencimento, -JANELA_EXTRATO.antes);
      var fim = somarDias(r.vencimento, JANELA_EXTRATO.depois);
      porRegistro.set(r, {
        motivo: comJuros.length > 1
          ? comJuros.length + ' débitos do cedente acima do nominal na janela — não dá para escolher'
          : 'nenhum débito livre desse valor entre ' + App.fmtData(ini) + ' e ' + App.fmtData(fim)
      });
    });

    var usados = usado.filter(Boolean).length;
    return { porRegistro: porRegistro, resumo: { debitos: debitos.length, usados: usados, boletosPagos: pagos.length } };
  }

  /* ============================================================
     5. Conferencia (o relatorio)

     Gravidade: 3 = vermelho (fraude possivel), 2 = amarelo (acao
     nossa), 1 = branco (indeterminado/informativo), 0 = conferiu.
     "Fora da janela de carga" NUNCA e' vermelho: um titulo que so'
     nao foi baixado nao e' cobranca sem nota — e' "nao sei".
     Zero e' uma afirmacao; ausencia de dado nao e'.
     ============================================================ */

  var GRAVIDADE = { VERMELHO: 3, AMARELO: 2, BRANCO: 1, OK: 0 };

  function idDe(d) {
    return d.id || (d.chaveAcesso + '_' + d.parcela);
  }

  // Banco ja' deu o titulo como quitado? ("A PAGAR" contem "pagar",
  // nao "pago" — a palavra inteira evita a confusao.)
  function situacaoPaga(s) {
    return /\bpago\b|\bpaga\b|liquidad/.test(normalizar(s));
  }
  // "BAIXADO" na planilha do Safra NAO e' "pago": e' o boleto que saiu
  // do DDA — pago por outro canal, ou cancelado pelo cedente (valor a
  // pagar zero). As duas situacoes recebem avisos diferentes e so' a
  // paga entra na lista do que pode ser baixado em lote.
  function situacaoBaixada(s) {
    return /baixad/.test(normalizar(s));
  }

  function conferir(registros, ctx) {
    ctx = ctx || {};
    var duplicatas = ctx.duplicatas || [];
    var notasPorChave = ctx.notasPorChave || {};
    var corteJanela = ctx.corteJanela || null; // null = historico completo carregado
    var periodo = ctx.periodo || null;
    // Extrato (opcional): data e valor reais para os boletos pagos.
    var extrato = ctx.extrato ? casarExtrato(registros, ctx.extrato) : null;

    var base = prepararBase(duplicatas);
    var linhas = [];
    var usoPorDuplicata = Object.create(null); // id -> [linhas que casaram nela]

    // Nivel 1 de duplicidade: a MESMA linha duas vezes no PDF
    // (documento + beneficiario + valor + vencimento identicos).
    // (A planilha do Safra nao traz o CNPJ do beneficiario: o nome
    // entra no lugar, senao dois cedentes com o mesmo documento e valor
    // virariam "duplicidade".)
    var chaveDuplicidade = function (r) {
      return [normalizar(r.documento), r.cnpjBeneficiario || normalizar(r.beneficiario), r.valorCentavos, r.vencimento].join('|');
    };
    var vistos = Object.create(null);
    registros.forEach(function (r) {
      var chave = chaveDuplicidade(r);
      vistos[chave] = (vistos[chave] || 0) + 1;
    });

    registros.forEach(function (r) {
      var casamento = casar(r, base);
      var problemas = [];
      var linha = { registro: r, casamento: casamento, problemas: problemas, extrato: null };
      linhas.push(linha);

      if (extrato && extrato.porRegistro.has(r)) {
        var ex = extrato.porRegistro.get(r);
        linha.extrato = ex;
        if (!ex.lancamento) {
          problemas.push({ tipo: 'semDebitoNoExtrato', gravidade: GRAVIDADE.BRANCO,
            texto: 'não achei o débito deste boleto no extrato (' + ex.motivo + ') — a baixa usa o vencimento e o valor da duplicata' });
        } else {
          if (ex.jurosCentavos > 0) {
            problemas.push({ tipo: 'jurosNoExtrato', gravidade: GRAVIDADE.BRANCO,
              texto: 'saiu da conta em ' + App.fmtData(ex.data) + ' com ' + App.brl(ex.valorPagoCentavos / 100) +
                ' — juros de ' + App.brl(ex.jurosCentavos / 100) + ' (vira lançamento de juros na baixa)' });
          }
          if (!ex.nomeConferido) {
            problemas.push({ tipo: 'debitoCedenteDiferente', gravidade: GRAVIDADE.BRANCO,
              texto: 'o débito do extrato bate em valor e data, mas o nome do cedente não confere ("' +
                (ex.lancamento.contraparte || '?') + '") — confira antes de baixar' });
          }
        }
      }

      var chaveDup = chaveDuplicidade(r);
      if (vistos[chaveDup] > 1) {
        problemas.push({ tipo: 'duplicidadeNoPdf', gravidade: GRAVIDADE.VERMELHO,
          texto: 'este boleto aparece ' + vistos[chaveDup] + '× no DDA' });
      }

      if (r.semSituacao) {
        problemas.push({ tipo: 'semSituacao', gravidade: GRAVIDADE.BRANCO,
          texto: 'o PDF não trouxe a situação deste boleto' });
      }

      var d = casamento.duplicata;
      if (!d) {
        if (casamento.ambiguo) {
          problemas.push({ tipo: 'ambiguo', gravidade: GRAVIDADE.BRANCO,
            texto: 'casamento ambíguo: ' + casamento.motivo });
        } else if (corteJanela && r.vencimento && r.vencimento < corteJanela) {
          // A janela padrao so' baixa duplicatas com vencimento nos
          // ultimos MESES_HISTORICO meses. O que vence antes do corte
          // pode existir sem ter sido carregado.
          problemas.push({ tipo: 'foraDaJanela', gravidade: GRAVIDADE.BRANCO,
            texto: 'não casou, mas o vencimento está fora da janela carregada — ' +
              'carregue o histórico completo antes de concluir qualquer coisa' });
        } else {
          problemas.push({ tipo: 'cobrancaSemNota', gravidade: GRAVIDADE.VERMELHO,
            texto: 'nenhuma duplicata corresponde a este boleto' +
              (casamento.motivo ? ' (' + casamento.motivo + ')' : '') });
        }
        return;
      }

      (usoPorDuplicata[idDe(d)] = usoPorDuplicata[idDe(d)] || []).push(linha);

      // 1) valor divergente — a fraude mais sutil. Comparacao em
      // centavos inteiros, sempre.
      if (!valorBate(centavosDe(d.valor), r.valorCentavos)) {
        problemas.push({ tipo: 'valorDivergente', gravidade: GRAVIDADE.VERMELHO,
          texto: 'valor do boleto difere da duplicata' });
      }

      // 4) ja' pago por nos — e o banco AINDA cobra. Se o banco tambem
      // da' como pago, os dois lados concordam e nao ha' o que apontar
      // (e' o que a reimportacao do DDA de ontem produz).
      if (d.pago === true && !situacaoPaga(r.situacao) && !situacaoBaixada(r.situacao)) {
        problemas.push({ tipo: 'jaPago', gravidade: GRAVIDADE.VERMELHO,
          texto: 'a duplicata já está paga' + (d.dataPagamento ? ' (em ' + App.fmtData(d.dataPagamento) + ')' : '') });
      }

      // banco baixou, nos nao — o inverso do "ja' pago". Nao e'
      // fraude: e' divergencia de controle (alguem pagou e nao
      // marcou). Aponta e OFERECE a baixa em lote (lista baixaveis);
      // nunca marca pago sozinho.
      if (situacaoPaga(r.situacao) && d.pago !== true) {
        problemas.push({ tipo: 'bancoBaixouNosNao', gravidade: GRAVIDADE.AMARELO,
          texto: 'o banco dá o boleto como "' + r.situacao + '", mas a duplicata não está baixada aqui' });
      } else if (situacaoBaixada(r.situacao) && d.pago !== true) {
        // BAIXADO sem pagamento registrado aqui: o cedente tirou o
        // boleto do DDA. Ou foi pago por outro canal, ou cancelado, ou
        // — o caso que custa caro — o titulo esta' a caminho de
        // cartorio/Serasa. Por isso o aviso pede contato, e o boleto
        // NUNCA entra no lote.
        problemas.push({ tipo: 'baixadoNoBanco', gravidade: GRAVIDADE.AMARELO,
          texto: 'o banco dá o boleto como "' + r.situacao + '" e não há pagamento registrado aqui — ' +
            'pago por outro canal, cancelado pelo cedente ou título a caminho de cartório/Serasa: ' +
            'confira com o fornecedor (não entra no lote)' });
      }

      // Valor a pagar diferente do nominal (so' a planilha traz os
      // dois): juros ou desconto embutidos no boleto. Informativo —
      // o que se compara com a duplicata e' sempre o nominal. Zero
      // nao conta: pago e baixado vem com "a pagar" zerado.
      if (r.valorAPagarCentavos != null && r.valorAPagarCentavos > 0 && !valorBate(r.valorAPagarCentavos, r.valorCentavos)) {
        problemas.push({ tipo: 'valorAPagarDiferente', gravidade: GRAVIDADE.BRANCO,
          texto: 'o valor a pagar do boleto difere do nominal (juros ou desconto embutidos)' });
      }

      // 5/6) nota de origem. Sem a nota carregada nao se AFIRMA nada
      // sobre cancelamento ou recebimento — mesma regra da janela.
      var nota = notasPorChave[d.chaveAcesso];
      if (nota) {
        if (nota.status === 'cancelada') {
          problemas.push({ tipo: 'notaCancelada', gravidade: GRAVIDADE.VERMELHO,
            texto: 'a nota de origem está CANCELADA' });
        } else if (nota.noSistema !== true) {
          problemas.push({ tipo: 'materialNaoRecebido', gravidade: GRAVIDADE.AMARELO,
            texto: 'a nota existe mas não deu entrada no ERP — caso de prorrogar' });
        }
      } else {
        problemas.push({ tipo: 'notaNaoCarregada', gravidade: GRAVIDADE.BRANCO,
          texto: 'nota de origem fora da carga — cancelamento e recebimento não conferidos' });
      }

      // 7) vencimento antecipado — cumulativo com o valor divergente.
      if (!d.vencimento) {
        problemas.push({ tipo: 'duplicataSemVencimento', gravidade: GRAVIDADE.BRANCO,
          texto: 'a duplicata não tem vencimento registrado — comparação de datas impossível' });
      } else if (r.vencimento && r.vencimento < d.vencimento) {
        problemas.push({ tipo: 'vencimentoAntecipado', gravidade: GRAVIDADE.AMARELO,
          texto: 'o boleto vence ' + App.fmtData(r.vencimento) + ', antes do nosso ' + App.fmtData(d.vencimento) });
      }
    });

    // Nivel 2 de duplicidade: dois boletos apontando para a MESMA
    // duplicata. E' o que pega o caso do fundo: o fornecedor cede o
    // titulo, o fundo registra o boleto e o fornecedor registra
    // tambem — beneficiarios diferentes, cobranca dobrada. Sai de
    // graca depois do casamento.
    Object.keys(usoPorDuplicata).forEach(function (id) {
      var uso = usoPorDuplicata[id];
      if (uso.length < 2) return;
      uso.forEach(function (linha) {
        linha.problemas.push({ tipo: 'duplicidadeDeDuplicata', gravidade: GRAVIDADE.VERMELHO,
          texto: uso.length + ' boletos do DDA casam com esta MESMA duplicata — cobrança dobrada?' });
      });
    });

    // 8) titulos nossos, no periodo do DDA, sem boleto — informativo
    // (⚪): fornecedor que cobra por PIX/deposito nunca aparece no
    // DDA e cairia aqui toda vez. Sem o periodo do cabecalho nao ha'
    // como saber o que DEVIA estar no PDF, entao a lista nem e' feita.
    var foraDoDda = [];
    if (periodo && periodo.ini && periodo.fim) {
      var casadas = Object.create(null);
      linhas.forEach(function (l) {
        if (l.casamento.duplicata) casadas[idDe(l.casamento.duplicata)] = true;
      });
      foraDoDda = duplicatas.filter(function (d) {
        if (d.pago === true || casadas[idDe(d)]) return false;
        if (!d.vencimento || d.vencimento < periodo.ini || d.vencimento > periodo.fim) return false;
        var nota = notasPorChave[d.chaveAcesso];
        return !(nota && nota.status === 'cancelada');
      });
    }

    function gravidadeDa(linha) {
      return linha.problemas.reduce(function (m, p) { return Math.max(m, p.gravidade); }, GRAVIDADE.OK);
    }

    // Vermelho primeiro; dentro da gravidade, maior valor primeiro.
    linhas.sort(function (a, b) {
      return (gravidadeDa(b) - gravidadeDa(a)) || (b.registro.valorCentavos - a.registro.valorCentavos);
    });

    // O que pode ser baixado em lote: banco diz pago, aqui em aberto,
    // e NENHUM vermelho na linha (valor divergente, nota cancelada,
    // cobranca dobrada... nada disso se marca pago no automatico).
    var baixaveis = linhas.filter(function (l) {
      return l.casamento.duplicata && gravidadeDa(l) < GRAVIDADE.VERMELHO &&
        l.problemas.some(function (p) { return p.tipo === 'bancoBaixouNosNao'; });
    });

    var resumo = { vermelhos: 0, amarelos: 0, brancos: 0, ok: 0, totalCentavos: 0 };
    linhas.forEach(function (l) {
      resumo.totalCentavos += l.registro.valorCentavos;
      var g = gravidadeDa(l);
      if (g === GRAVIDADE.VERMELHO) resumo.vermelhos++;
      else if (g === GRAVIDADE.AMARELO) resumo.amarelos++;
      else if (g === GRAVIDADE.BRANCO) resumo.brancos++;
      else resumo.ok++;
    });

    return {
      linhas: linhas, foraDoDda: foraDoDda, baixaveis: baixaveis, resumo: resumo, periodo: periodo,
      extrato: extrato ? extrato.resumo : null, gravidadeDa: gravidadeDa
    };
  }

  /* ============================================================
     Exporta
     ============================================================ */

  var DdaNucleo = {
    ESTRATEGIA_PADRAO: ESTRATEGIA_PADRAO,
    REGRAS_DDA: REGRAS_DDA,
    GRAVIDADE: GRAVIDADE,

    normalizarCnpj: normalizarCnpj,
    semZeros: semZeros,
    normalizarParcela: normalizarParcela,
    dividirDocumento: dividirDocumento,
    parcelaDaLetra: parcelaDaLetra,
    parcelaCasa: parcelaCasa,
    dataBrParaIso: dataBrParaIso,
    valorParaCentavos: valorParaCentavos,
    TOLERANCIA_CENTAVOS: TOLERANCIA_CENTAVOS,
    valorBate: valorBate,

    situacaoPaga: situacaoPaga,
    situacaoBaixada: situacaoBaixada,

    interpretar: interpretar,
    interpretarPlanilha: interpretarPlanilha,
    interpretarExtrato: interpretarExtrato,
    classificarLancamento: classificarLancamento,
    nomesCompativeis: nomesCompativeis,
    casarExtrato: casarExtrato,
    prepararBase: prepararBase,
    casar: casar,
    conferir: conferir
  };

  global.DdaNucleo = DdaNucleo;
  if (typeof module === 'object' && module.exports) module.exports = DdaNucleo;
})(typeof window !== 'undefined' ? window : globalThis);
