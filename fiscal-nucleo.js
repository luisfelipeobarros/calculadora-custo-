/* ============================================================
   fiscal-nucleo.js — o banco fiscal por NCM + UF de origem.

   Mesmo desenho dos outros nucleos: o UNICO lugar onde as regras
   moram, carregavel com <script src> no navegador e com require()
   nos testes.

   A ideia da aba "NCM & ST": metade do banco NAO se digita —
   DERIVA. Os itensNotas ja' trazem NCM, CFOP, valor e ST paga por
   item; a UF de origem vem da chave de acesso. O agrupamento aqui
   pre-povoa a tela com a REALIDADE observada (como a aba
   Fornecedores faz com prazos), e o cadastro manual vira so' a
   camada oficial que confirma ou corrige.

   Agrupamento por NCM + UF porque e' assim que a regra de ST
   funciona: depende da classificacao fiscal e do estado do
   fornecedor — o mesmo produto de fornecedores diferentes do mesmo
   estado cai na mesma regra.

   Precisa vir DEPOIS de app-shared.js — usa App.classificarCfop e
   App.ufDaChave.
   ============================================================ */
(function (global) {
  'use strict';

  var App = (typeof module === 'object' && module.exports)
    ? require('./app-shared.js')
    : global.App;

  if (!App || !App.classificarCfop) {
    throw new Error('fiscal-nucleo.js precisa de app-shared.js carregado antes.');
  }

  // docsItens: documentos de itensNotas ({chave, nomeEmitente,
  // itens:[{ncm,cfop,vTotal,icmsStValor,descricao}...]}). Devolve um
  // grupo por NCM+UF, ordenado por valor comprado (quem mais pesa no
  // bolso aparece primeiro), com tudo que da' para OBSERVAR:
  // % de ST efetivo (soma ST / soma produtos, em centavos inteiros),
  // contagem por classe de CFOP, fornecedores e produtos envolvidos.
  function agruparFiscal(docsItens) {
    var grupos = Object.create(null);

    (docsItens || []).forEach(function (doc) {
      // 'PE (Pernambuco)' -> 'PE'; chave fora do padrao -> '??' (o
      // grupo aparece, mas a tela nao deixa cadastrar em cima dele).
      var ufRotulo = App.ufDaChave(doc.chave);
      var uf = ufRotulo ? ufRotulo.substring(0, 2) : '??';

      (doc.itens || []).forEach(function (it) {
        var ncm = String(it.ncm == null ? '' : it.ncm).replace(/\D/g, '');
        if (!ncm) ncm = 'sem-ncm';
        var id = ncm + '_' + uf;
        var g = grupos[id];
        if (!g) {
          g = grupos[id] = {
            id: id, ncm: ncm, uf: uf,
            qtdItens: 0, chaves: Object.create(null),
            fornecedores: Object.create(null), produtos: Object.create(null),
            cfops: Object.create(null),
            somaValorCent: 0, somaStCent: 0,
            comSt: 0, semSt: 0, retida: 0, outros: 0
          };
        }
        g.qtdItens++;
        g.somaValorCent += Math.round((it.vTotal || 0) * 100);
        g.somaStCent += Math.round((it.icmsStValor || 0) * 100);
        g.chaves[doc.chave] = true;
        if (doc.nomeEmitente) g.fornecedores[doc.nomeEmitente] = true;
        var desc = String(it.descricao || '').trim();
        if (desc) g.produtos[desc] = true;

        var cfop = String(it.cfop == null ? '' : it.cfop).replace(/\D/g, '');
        if (cfop) g.cfops[cfop] = (g.cfops[cfop] || 0) + 1;
        var cl = App.classificarCfop(cfop);
        if (!cl || !cl.st) g.outros++;
        else if (cl.st === 'venda com ST') g.comSt++;
        else if (cl.st === 'venda sem ST') g.semSt++;
        else g.retida++; // 'ST retida anteriormente (...)'
      });
    });

    return Object.keys(grupos).map(function (k) {
      var g = grupos[k];
      return {
        id: g.id, ncm: g.ncm, uf: g.uf,
        qtdItens: g.qtdItens,
        qtdNotas: Object.keys(g.chaves).length,
        fornecedores: Object.keys(g.fornecedores).sort(),
        produtos: Object.keys(g.produtos).sort(),
        cfops: g.cfops,
        somaValorCent: g.somaValorCent,
        somaStCent: g.somaStCent,
        // null quando nao ha' base — sem valor nao ha' percentual, e
        // null nunca vira zero na tela.
        pctStObservado: g.somaValorCent > 0 ? (g.somaStCent / g.somaValorCent) * 100 : null,
        observado: { comSt: g.comSt, semSt: g.semSt, retida: g.retida, outros: g.outros }
      };
    }).sort(function (a, b) { return b.somaValorCent - a.somaValorCent; });
  }

  // Divergencia CATEGORICA entre o cadastro manual e o observado.
  // O percentual NAO ganha veredito automatico: qualquer tolerancia
  // seria invencao nossa — os dois numeros ficam lado a lado e quem
  // le decide. Sem cadastro (ou sem modalidade) -> null: ausencia de
  // cadastro nao e' divergencia.
  function divergenciaFiscal(grupo, cadastro) {
    if (!cadastro || !cadastro.modalidade) return null;
    var o = grupo.observado;
    var avisos = [];
    if (cadastro.modalidade === 'sem' && (o.comSt > 0 || grupo.somaStCent > 0)) {
      avisos.push('cadastrado como SEM ST, mas há nota com CFOP de venda com ST ou com valor de ST cobrado');
    }
    if (cadastro.modalidade === 'nota' && o.comSt === 0 && grupo.somaStCent === 0 && (o.semSt + o.retida) > 0) {
      avisos.push('cadastrado como ST cobrada na nota, mas nenhuma nota observada trouxe ST');
    }
    if (cadastro.modalidade === 'antecipacao' && o.comSt > 0) {
      avisos.push('cadastrado como antecipação (ST retida anteriormente), mas há nota cobrando ST na própria nota');
    }
    return avisos.length ? avisos : null;
  }

  // A tela so' oferece o formulario de cadastro para grupos cujo id o
  // firestore.rules aceita ([0-9]{2,8}_[A-Z]{2}). Sem esta trava, um
  // item sem NCM (id 'sem-ncm_PE') ou de chave fora do padrao (uf '??')
  // mostrava campos que o Firestore ia rejeitar com permission-denied
  // na hora de salvar — falha silenciosa ate' a primeira nota torta.
  var ID_CADASTRAVEL = /^[0-9]{2,8}_[A-Z]{2}$/;
  function grupoCadastravel(grupo) {
    return !!(grupo && ID_CADASTRAVEL.test(grupo.id));
  }

  var FiscalNucleo = {
    agruparFiscal: agruparFiscal,
    divergenciaFiscal: divergenciaFiscal,
    grupoCadastravel: grupoCadastravel
  };

  global.FiscalNucleo = FiscalNucleo;
  if (typeof module === 'object' && module.exports) module.exports = FiscalNucleo;
})(typeof window !== 'undefined' ? window : globalThis);
