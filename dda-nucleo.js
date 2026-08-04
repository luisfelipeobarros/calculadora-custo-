/* ============================================================
   dda-nucleo.js — conferência do DDA (Bradesco) contra as duplicatas.

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
   devolve um relatorio. Quem le o PDF (pdf.js) e quem desenha e' o
   controle-notas.html.

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

  var ESTRATEGIA_PADRAO = 'notaEParcela';
  var REGRAS_DDA = [
    // Cerbras: o documento e' numero interno do cedente, nao a NF-e.
    { cedente: 'cerbras', estrategia: 'valorEVencimento' },
    // Mari: so' o numero da NF-e, sem parcela.
    { cedente: 'mari', estrategia: 'notaSemParcela' }
  ];

  /* ============================================================
     2. Normalizacoes
     ============================================================ */

  // minusculas + sem acento (nomes do PDF vem sem acento, mas os do
  // Firestore podem ter).
  function normalizar(s) {
    return String(s == null ? '' : s).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, ''); // tira os acentos separados pelo NFD
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

  // Formatos vistos no PDF real: '0000049676', '460347/04',
  // '370357-3', '550072-D', '471702 01' — separadores -, / e ESPACO,
  // e letra no fim tambem e' parcela. '1 1626 2' tem DOIS separadores
  // e e' genuinamente ambiguo (nota 1626 parcela 2? outra coisa?):
  // nao casa o regex e volta como ambiguo, sem chute.
  function dividirDocumento(doc) {
    var d = String(doc == null ? '' : doc).trim();
    var m = d.match(/^(\d+)[\/\- ]([0-9A-Za-z]+)$/);
    if (m) return { nota: semZeros(m[1]), parcela: normalizarParcela(m[2]) };
    if (/^\d+$/.test(d)) return { nota: semZeros(d), parcela: null };
    return { ambiguo: true };
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
     4. Casamento boleto <-> duplicata

     Toda resposta diz COMO casou (campo `como`): quem confere
     precisa saber se o "OK" veio de nota+parcela exata ou de um
     desempate por valor — sem isso a tela vira caixa preta e
     ninguem confia nela quando apontar uma fraude de verdade.

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

  function casarNotaEParcela(r, base, doc) {
    var rot = 'nota+parcela';
    var daNota = base.porNota[doc.nota] || [];
    if (!daNota.length) return resultado(rot, { motivo: 'nota ' + doc.nota + ' não está na base carregada' });

    var exatas = daNota.filter(function (d) { return normalizarParcela(d.parcela) === doc.parcela; });
    if (exatas.length === 1) return resultado(rot, { duplicata: exatas[0], como: ['nota+parcela'] });
    if (exatas.length > 1) {
      // Mesmo numero de NF-e pode existir em fornecedores diferentes.
      var porValor = exatas.filter(function (d) { return centavosDe(d.valor) === r.valorCentavos; });
      if (porValor.length === 1) return resultado(rot, { duplicata: porValor[0], como: ['nota+parcela', 'desempate por valor'] });
      return resultado(rot, { ambiguo: true, candidatas: exatas, motivo: 'mais de uma duplicata com essa nota e parcela' });
    }

    // Parcela do boleto em LETRA ('550072-D') e as nossas em numero:
    // nao se converte letra em numero por conta propria — desempata
    // por valor entre as duplicatas da nota, e o `como` registra.
    if (!/^\d+$/.test(doc.parcela)) {
      var porValorL = daNota.filter(function (d) { return centavosDe(d.valor) === r.valorCentavos; });
      if (porValorL.length === 1) return resultado(rot, { duplicata: porValorL[0], como: ['nota', 'parcela em letra — desempate por valor'] });
      return resultado(rot, {
        ambiguo: true, candidatas: daNota,
        motivo: 'parcela em letra ("' + doc.parcela + '") e ' +
          (porValorL.length ? 'mais de uma' : 'nenhuma') + ' duplicata da nota com esse valor'
      });
    }

    return resultado(rot, { candidatas: daNota, motivo: 'a nota existe, mas não tem a parcela ' + doc.parcela });
  }

  function casarNotaSemParcela(r, base, doc, motivoRotulo) {
    var rot = motivoRotulo || 'nota sem parcela';
    var daNota = base.porNota[doc.nota] || [];
    if (!daNota.length) return resultado(rot, { motivo: 'nota ' + doc.nota + ' não está na base carregada' });
    if (daNota.length === 1) return resultado(rot, { duplicata: daNota[0], como: ['nota'] });

    var porValor = daNota.filter(function (d) { return centavosDe(d.valor) === r.valorCentavos; });
    if (porValor.length === 1) return resultado(rot, { duplicata: porValor[0], como: ['nota', 'desempate por valor'] });

    var porVenc = (porValor.length ? porValor : daNota).filter(function (d) { return d.vencimento === r.vencimento; });
    if (porVenc.length === 1) {
      var como = ['nota'];
      if (porValor.length) como.push('desempate por valor');
      como.push('desempate por vencimento');
      return resultado(rot, { duplicata: porVenc[0], como: como });
    }

    return resultado(rot, { ambiguo: true, candidatas: daNota, motivo: 'várias parcelas da nota e nenhum desempate decidiu' });
  }

  function casarValorEVencimento(r, base, regra) {
    var rot = 'valor (regra ' + regra.cedente + ')';
    var re = new RegExp('\\b' + regra.cedente + '\\b');
    // Escopado ao cedente e SO' a ele: com valores repetidos 6x no
    // mesmo vencimento (PDF real), casar por valor na base inteira
    // seria loteria. Só nao pagas: a duplicata ja' quitada do mesmo
    // valor e' de outro ciclo.
    var doCedente = base.duplicatas.filter(function (d) {
      return re.test(normalizar(d.nomeEmitente)) && d.pago !== true;
    });
    if (!doCedente.length) return resultado(rot, { motivo: 'nenhuma duplicata de ' + regra.cedente + ' em aberto na base carregada' });

    // Valor e' a chave forte; vencimento so' DESEMPATA (preferindo o
    // exato). Exigir data igual na entrada faria um boleto com
    // vencimento deslocado um dia cair como "cobranca sem nota" — e
    // alarme falso vermelho e' o que mata a confianca na tela. A
    // diferenca de data do que casou vira o achado de vencimento
    // antecipado, que e' o que ela realmente e'.
    var porValor = doCedente.filter(function (d) { return centavosDe(d.valor) === r.valorCentavos; });
    if (!porValor.length) return resultado(rot, { motivo: 'nenhuma duplicata de ' + regra.cedente + ' com esse valor' });
    if (porValor.length === 1) return resultado(rot, { duplicata: porValor[0], como: ['valor'] });

    var exatas = porValor.filter(function (d) { return d.vencimento === r.vencimento; });
    if (exatas.length === 1) return resultado(rot, { duplicata: exatas[0], como: ['valor', 'desempate por vencimento'] });

    return resultado(rot, { ambiguo: true, candidatas: porValor, motivo: 'mais de uma duplicata de ' + regra.cedente + ' com esse valor' });
  }

  function casar(r, base) {
    var regra = regraDoBoleto(r);
    var estrategia = regra ? regra.estrategia : ESTRATEGIA_PADRAO;

    if (estrategia === 'valorEVencimento') return casarValorEVencimento(r, base, regra);

    var doc = dividirDocumento(r.documento);
    if (doc.ambiguo) {
      return resultado(estrategia === 'notaSemParcela' ? 'nota sem parcela' : 'nota+parcela', {
        ambiguo: true,
        motivo: 'número de documento ambíguo ("' + r.documento + '")'
      });
    }
    if (estrategia === 'notaSemParcela') return casarNotaSemParcela(r, base, doc);
    // Documento sem separador na estrategia padrao: nao ha' parcela
    // para exigir — degrada para o casamento por nota, e o rotulo
    // registra a degradacao.
    if (doc.parcela == null) return casarNotaSemParcela(r, base, doc, 'nota (documento sem parcela)');
    return casarNotaEParcela(r, base, doc);
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
  function situacaoBaixada(s) {
    return /\bpago\b|\bpaga\b|liquidad|baixad/.test(normalizar(s));
  }

  function conferir(registros, ctx) {
    ctx = ctx || {};
    var duplicatas = ctx.duplicatas || [];
    var notasPorChave = ctx.notasPorChave || {};
    var corteJanela = ctx.corteJanela || null; // null = historico completo carregado
    var periodo = ctx.periodo || null;

    var base = prepararBase(duplicatas);
    var linhas = [];
    var usoPorDuplicata = Object.create(null); // id -> [linhas que casaram nela]

    // Nivel 1 de duplicidade: a MESMA linha duas vezes no PDF
    // (documento + beneficiario + valor + vencimento identicos).
    var vistos = Object.create(null);
    registros.forEach(function (r) {
      var chave = [normalizar(r.documento), r.cnpjBeneficiario, r.valorCentavos, r.vencimento].join('|');
      vistos[chave] = (vistos[chave] || 0) + 1;
    });

    registros.forEach(function (r) {
      var casamento = casar(r, base);
      var problemas = [];
      var linha = { registro: r, casamento: casamento, problemas: problemas };
      linhas.push(linha);

      var chaveDup = [normalizar(r.documento), r.cnpjBeneficiario, r.valorCentavos, r.vencimento].join('|');
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
      if (centavosDe(d.valor) !== r.valorCentavos) {
        problemas.push({ tipo: 'valorDivergente', gravidade: GRAVIDADE.VERMELHO,
          texto: 'valor do boleto difere da duplicata' });
      }

      // 4) ja' pago por nos
      if (d.pago === true) {
        problemas.push({ tipo: 'jaPago', gravidade: GRAVIDADE.VERMELHO,
          texto: 'a duplicata já está paga' + (d.dataPagamento ? ' (em ' + App.fmtData(d.dataPagamento) + ')' : '') });
      }

      // banco baixou, nos nao — o inverso do "ja' pago". Nao e'
      // fraude: e' divergencia de controle (alguem pagou e nao
      // marcou). So' aponta; NUNCA marca pago sozinho.
      if (situacaoBaixada(r.situacao) && d.pago !== true) {
        problemas.push({ tipo: 'bancoBaixouNosNao', gravidade: GRAVIDADE.AMARELO,
          texto: 'o banco dá o boleto como "' + r.situacao + '", mas a duplicata não está baixada aqui' });
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

    var resumo = { vermelhos: 0, amarelos: 0, brancos: 0, ok: 0, totalCentavos: 0 };
    linhas.forEach(function (l) {
      resumo.totalCentavos += l.registro.valorCentavos;
      var g = gravidadeDa(l);
      if (g === GRAVIDADE.VERMELHO) resumo.vermelhos++;
      else if (g === GRAVIDADE.AMARELO) resumo.amarelos++;
      else if (g === GRAVIDADE.BRANCO) resumo.brancos++;
      else resumo.ok++;
    });

    return { linhas: linhas, foraDoDda: foraDoDda, resumo: resumo, periodo: periodo, gravidadeDa: gravidadeDa };
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
    dataBrParaIso: dataBrParaIso,
    valorParaCentavos: valorParaCentavos,

    interpretar: interpretar,
    prepararBase: prepararBase,
    casar: casar,
    conferir: conferir
  };

  global.DdaNucleo = DdaNucleo;
  if (typeof module === 'object' && module.exports) module.exports = DdaNucleo;
})(typeof window !== 'undefined' ? window : globalThis);
