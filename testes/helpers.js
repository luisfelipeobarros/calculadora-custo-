// Testes diretos das funcoes de app-shared.js.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { instalar } = require('./dom-falso.js');

const { window } = instalar([]);
const ctx = vm.createContext(window);
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'app-shared.js'), 'utf8'), ctx, {
  filename: 'app-shared.js'
});
const App = window.App;

let ok = 0, falhas = 0;
function conferir(nome, obtido, esperado) {
  const igual = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (igual) { ok++; }
  else {
    falhas++;
    console.log('  [X] ' + nome + '\n      esperado: ' + JSON.stringify(esperado) +
                '\n      obtido:   ' + JSON.stringify(obtido));
  }
}

// --- escapeHtml: fecha todas as portas de injecao em atributo e texto ---
conferir('escapeHtml aspas duplas', App.escapeHtml('a"b'), 'a&quot;b');
conferir('escapeHtml aspas simples', App.escapeHtml("a'b"), 'a&#39;b');
conferir('escapeHtml tags', App.escapeHtml('<img onerror=x>'), '&lt;img onerror=x&gt;');
conferir('escapeHtml e comercial', App.escapeHtml('a&b'), 'a&amp;b');
conferir('escapeHtml nulo vira vazio', App.escapeHtml(null), '');

// --- safeUrl: so' http/https passam ---
conferir('safeUrl https', App.safeUrl('https://loja.com/p'), 'https://loja.com/p');
conferir('safeUrl bloqueia javascript:', App.safeUrl('javascript:alert(1)'), '');
conferir('safeUrl bloqueia data:', App.safeUrl('data:text/html,<script>x</script>'), '');
conferir('safeUrl bloqueia vbscript:', App.safeUrl('vbscript:msgbox'), '');
conferir('safeUrl com espacos e maiusculas', App.safeUrl('  JavaScript:alert(1)  '), '');
conferir('safeUrl vazio', App.safeUrl(''), '');
conferir('safeUrl nulo', App.safeUrl(null), '');

// --- moeda e porcentagem ---
conferir('brl inteiro', App.brl(1234.5), 'R$ 1.234,50');
conferir('brl zero', App.brl(0), 'R$ 0,00');
conferir('brl nao-numero', App.brl(undefined), '--');
conferir('brl NaN', App.brl(NaN), '--');
conferir('pct padrao 2 casas', App.pct(0.0825), '8,25%');
conferir('pct nulo', App.pct(null), '--');

// --- centavos: o arredondamento que faz os totais fecharem ---
conferir('centavos 0.1+0.2', App.centavos(0.1 + 0.2), 0.3);
conferir('centavos meio centavo pra cima', App.centavos(1.005), 1.01);
conferir('centavos negativo', App.centavos(-2.345), -2.35);
conferir('centavos preserva nulo', App.centavos(null), null);

// --- numeros em formato brasileiro ---
conferir('parseNumeroBR com R$', App.parseNumeroBR('R$ 1.234,56'), 1234.56);
conferir('parseNumeroBR ponto decimal', App.parseNumeroBR('1234.56'), 1234.56);
// Planilha de fornecedor traz "0,325" e "1,500": virgula unica seguida
// de digitos e' decimal, com quantas casas vierem (antes virava 325).
conferir('parseNumeroBR virgula com 3 decimais', App.parseNumeroBR('0,325'), 0.325);
conferir('parseNumeroBR "1,500" e um e meio', App.parseNumeroBR('1,500'), 1.5);
conferir('parseNumeroBR duas virgulas = milhar', App.parseNumeroBR('1,234,567'), 1234567);
// AMBIGUIDADE CONHECIDA (comportamento original, mantido de proposito):
// sem virgula, "1.234" e' lido como 1,234 e nao como mil duzentos e
// trinta e quatro. Nao da' para desfazer sem saber como os fornecedores
// formatam as planilhas — precos quase sempre trazem centavos
// ("1.234,56"), que caem no ramo correto. Ver README.
conferir('parseNumeroBR ponto sem virgula = decimal', App.parseNumeroBR('1.234'), 1.234);
conferir('parseNumeroBR vazio', App.parseNumeroBR(''), null);
conferir('parseNumeroBR nulo', App.parseNumeroBR(null), null);
conferir('parseNumeroBR ja numero', App.parseNumeroBR(9.9), 9.9);
conferir('parseNumeroBR lixo', App.parseNumeroBR('abc'), null);

// --- toNum: nunca devolve NaN ---
conferir('toNum texto invalido', App.toNum('abc'), 0);
conferir('toNum vazio', App.toNum(''), 0);
conferir('toNum decimal', App.toNum('12.5'), 12.5);

// --- datas: a aritmetica que decide atraso e vencimento ---
conferir('fmtData ISO', App.fmtData('2026-07-27'), '27/07/2026');
conferir('fmtData vazia', App.fmtData(''), '--');

// fmtDataFirestore: Timestamp (toDate), Date, string ISO e nulo — o
// nulo e' o serverTimestamp ainda pendente na leitura local, e virava
// 31/12/1969; a string ISO passava pelo fuso e perdia um dia.
conferir('fmtDataFirestore com Timestamp', App.fmtDataFirestore({ toDate: () => new Date(2026, 8, 14) }), '14/09/2026');
conferir('fmtDataFirestore com Date', App.fmtDataFirestore(new Date(2026, 0, 5)), '05/01/2026');
conferir('fmtDataFirestore com string ISO nao perde um dia', App.fmtDataFirestore('2026-09-14'), '14/09/2026');
conferir('fmtDataFirestore nulo = "-", nao 31/12/1969', App.fmtDataFirestore(null), '-');
conferir('fmtDataFirestore undefined = "-"', App.fmtDataFirestore(undefined), '-');
conferir('fmtDataFirestore com lixo = "-"', App.fmtDataFirestore('abc'), '-');

// iso: data local, sem passar por UTC (23h de Sao Paulo ainda e' hoje).
conferir('iso de Date local', App.iso(new Date(2026, 11, 31, 23, 30)), '2026-12-31');
conferir('iso preenche mes e dia com zero', App.iso(new Date(2026, 0, 2)), '2026-01-02');
// O fallback ESCAPADO: fmtData e' interpolado direto em innerHTML em
// ~10 pontos dos apps — valor fora do padrao nao pode voltar cru.
conferir('fmtData com lixo volta ESCAPADO (fecha o furo de XSS)',
  App.fmtData('<img src=x>'), '&lt;img src=x&gt;');

// --- dinheiro a brasileira (campos de valor grande) ---
// parseNumeroBR mantem "1.234" = 1,234 de proposito (precos unitarios
// de fornecedor); parseDinheiroBR le "1.234" como milhar — e' ele que
// os campos de DINHEIRO usam (o bug corrompia >= 1000 nas assistencias).
conferir('parseDinheiroBR 25.000 = vinte e cinco mil', App.parseDinheiroBR('25.000'), 25000);
conferir('parseDinheiroBR com R$', App.parseDinheiroBR('R$ 2.500.000'), 2500000);
conferir('parseDinheiroBR com centavos nao muda', App.parseDinheiroBR('1.234,56'), 1234.56);
conferir('parseDinheiroBR decimal simples nao muda', App.parseDinheiroBR('64.9'), 64.9);
conferir('parseDinheiroBR nulo', App.parseDinheiroBR(null), null);
conferir('somarDias vira o mes', App.somarDias('2026-01-31', 1), '2026-02-01');
conferir('somarDias ano bissexto', App.somarDias('2028-02-28', 1), '2028-02-29');
conferir('somarDias nao bissexto', App.somarDias('2026-02-28', 1), '2026-03-01');
conferir('somarDias negativo (janela da segunda)', App.somarDias('2026-07-27', -2), '2026-07-25');
conferir('somarDias vira o ano', App.somarDias('2026-12-31', 1), '2027-01-01');
conferir('diasEntre', App.diasEntre('2026-01-01', '2026-03-01'), 59);
conferir('diasEntre mesmo dia', App.diasEntre('2026-05-05', '2026-05-05'), 0);

// somarMeses: a rolagem mensal de vencimento (recorrencia dos
// pagamentos internos e compras do Simulador). Encolhe mes curto em
// vez de transbordar, e o diaFixo faz o 31 VOLTAR a ser 31 depois de
// fevereiro — sem ele o encolhimento seria permanente.
conferir('somarMeses simples', App.somarMeses('2026-08-10', 1), '2026-09-10');
conferir('somarMeses dia 31 encolhe para mes de 30', App.somarMeses('2026-08-31', 1), '2026-09-30');
conferir('somarMeses fevereiro encolhe para 28', App.somarMeses('2026-01-31', 1), '2026-02-28');
conferir('somarMeses fevereiro bissexto vai a 29', App.somarMeses('2028-01-31', 1), '2028-02-29');
conferir('somarMeses NAO transborda (31/01 + 1 nunca e 03/03)',
         App.somarMeses('2026-01-31', 1) < '2026-03-01', true);
conferir('somarMeses vira o ano', App.somarMeses('2026-12-15', 1), '2027-01-15');
conferir('somarMeses varios meses de uma vez', App.somarMeses('2026-01-15', 13), '2027-02-15');
conferir('somarMeses diaFixo devolve o 31 depois do mes curto',
         App.somarMeses('2026-09-30', 1, { diaFixo: 31 }), '2026-10-31');
conferir('somarMeses ultimoDia cai no fim do mes de destino',
         App.somarMeses('2026-01-31', 1, { ultimoDia: true }), '2026-02-28');
conferir('somarMeses ultimoDia em mes de 31', App.somarMeses('2026-02-28', 1, { ultimoDia: true }), '2026-03-31');

// Datas em texto aaaa-mm-dd sao comparaveis alfabeticamente — o app
// depende disso em todos os filtros de vencimento.
conferir('ordem alfabetica = ordem cronologica', ['2026-10-01', '2026-02-01', '2026-01-15'].sort(),
         ['2026-01-15', '2026-02-01', '2026-10-01']);

// --- busca sem acento ---
conferir('normalizarTexto tira acento', App.normalizarTexto('Porcelanato AÇÃO Ônix'), 'porcelanato acao onix');
conferir('normalizarTexto nulo', App.normalizarTexto(null), '');

// --- busca com varios termos (etiquetas) ---
conferir('termosDaBusca: etiquetas + texto em digitacao, normalizados',
  App.termosDaBusca({ _chips: ['132500', ' Cerâmica '], value: ' 185066 ' }), ['132500', 'ceramica', '185066']);
conferir('termosDaBusca: campo sem etiqueta vale o texto', App.termosDaBusca({ value: 'Vetrus' }), ['vetrus']);
conferir('termosDaBusca: tudo vazio = lista vazia', App.termosDaBusca({ _chips: [], value: '  ' }), []);
conferir('termosDaBusca: sem campo = lista vazia', App.termosDaBusca(null), []);
conferir('normalizarTexto acha com acento no termo',
         App.normalizarTexto('CERÂMICA').includes(App.normalizarTexto('ceramica')), true);

// --- usuario simples <-> e-mail que o Firebase exige ---
conferir('usuario simples ganha dominio', App.usuarioParaEmail('Administrativo'),
         'administrativo@' + App.DOMINIO_LOGIN);
conferir('usuario com espacos', App.usuarioParaEmail('  Compras  '),
         'compras@' + App.DOMINIO_LOGIN);
conferir('maiusculas viram minusculas', App.usuarioParaEmail('COMPRAS'),
         'compras@' + App.DOMINIO_LOGIN);
conferir('espaco no meio some', App.usuarioParaEmail('conta bil'),
         'contabil@' + App.DOMINIO_LOGIN);
conferir('e-mail completo passa direto', App.usuarioParaEmail('chefe@empresa.com.br'),
         'chefe@empresa.com.br');
conferir('vazio continua vazio', App.usuarioParaEmail('   '), '');
conferir('volta para exibicao', App.emailParaUsuario('administrativo@' + App.DOMINIO_LOGIN),
         'administrativo');
conferir('e-mail de fora e exibido inteiro', App.emailParaUsuario('chefe@empresa.com.br'),
         'chefe@empresa.com.br');
// Ida e volta tem que fechar, senao a barra de conta mostraria uma coisa
// e o login esperaria outra.
conferir('ida e volta', App.emailParaUsuario(App.usuarioParaEmail('Compras')), 'compras');

// --- deteccao de permissao negada (dispara o login) ---
conferir('permissao negada por code', App.ehPermissaoNegada({ code: 'permission-denied' }), true);
conferir('permissao negada por mensagem',
         App.ehPermissaoNegada({ message: 'Missing or insufficient permissions.' }), true);
conferir('erro de rede nao e permissao', App.ehPermissaoNegada({ code: 'unavailable' }), false);
conferir('nulo nao e permissao', App.ehPermissaoNegada(null), false);

// --- casaFornecedor: busca sem acento dos dois lados ---
// As buscas de Produtos salvos ja' ignoravam acento; as telas de notas
// nao. Agora todas passam por normalizarTexto, inclusive esta.
conferir('casaFornecedor acha "CERÂMICA" digitando "ceramica"',
         App.casaFornecedor('CERÂMICA BRASILEIRA', 'CERÂMICA BRASILEIRA LTDA', 'ceramica'), true);
conferir('casaFornecedor aceita acento no termo digitado',
         App.casaFornecedor('Ceramica Brasileira', 'CERAMICA LTDA', 'cerâmica'), true);
conferir('casaFornecedor continua achando pelo rotulo da tela',
         App.casaFornecedor('Vetrus (Stela)', 'VETRUS S/A', 'stela'), true);
conferir('casaFornecedor nao casa a toa',
         App.casaFornecedor('Vetrus (Stela)', 'VETRUS S/A', 'pamesa'), false);

// --- notaAImportar: a regra da aba "A importar", usada pelas DUAS ---
// paginas (Controle de Notas e o filtro "so' as nao recebidas" da NF-e
// Emitidas). Se uma tela mostrar uma nota que a outra nao mostra, e'
// aqui que se conserta.
const pendente = { emitida: true, noSistema: false, status: 'ativa', dataEmissao: '2026-08-10' };
conferir('notaAImportar: emitida, ativa e sem entrada no ERP -> a importar',
         App.notaAImportar(pendente), true);
conferir('notaAImportar: ja deu entrada (noSistema) -> nao',
         App.notaAImportar(Object.assign({}, pendente, { noSistema: true })), false);
conferir('notaAImportar: cancelada -> nao',
         App.notaAImportar(Object.assign({}, pendente, { status: 'cancelada' })), false);
conferir('notaAImportar: sem o campo emitida (doc da funcao 2 do Apps Script) -> nao',
         App.notaAImportar({ noSistema: false, dataEmissao: '2026-08-10' }), false);
conferir('notaAImportar: sem status vale como ativa',
         App.notaAImportar({ emitida: true, noSistema: false, dataEmissao: '2026-08-10' }), true);
conferir('notaAImportar: antes do corte -> nao',
         App.notaAImportar(pendente, '2026-09-01'), false);
conferir('notaAImportar: nota ausente (null) -> nao, nunca chute',
         App.notaAImportar(null), false);

// --- confirmar / pedirData: o que a Promise devolve -----------
//
// Estes testes existem por causa de um bug real: alguem acrescentou uma
// opcao `inputDate` ao confirmar() para reaproveita-lo como seletor de
// data. So' que confirmar() termina em `.then(v => v === true)`, entao a
// data escolhida virava `false` e o "Prorrogar vencimento" nao fazia
// NADA — sem erro no console, sem aviso. Nao basta o modal abrir: o
// teste tem que apertar o botao e olhar o valor que volta.
const { achar, acharTodos } = require('./dom-falso.js');

function modalAberto() {
  return achar(window.document.body, el => el.className === 'modal-caixa');
}
function botaoDoModal(texto) {
  return acharTodos(modalAberto(), el => el.tagName === 'BUTTON')
    .find(b => b.textContent === texto);
}
function campoDataDoModal() {
  return achar(modalAberto(), el => el.type === 'date');
}

const pendentes = [];
function assincrono(nome, executar) { pendentes.push({ nome, executar }); }

assincrono('confirmar devolve true no Confirmar', () => {
  const p = App.confirmar({ titulo: 'x', mensagem: 'y' });
  botaoDoModal('Confirmar').disparar('click');
  return p.then(v => conferir('confirmar devolve true no Confirmar', v, true));
});

assincrono('confirmar devolve false no Cancelar', () => {
  const p = App.confirmar({ titulo: 'x', mensagem: 'y' });
  botaoDoModal('Cancelar').disparar('click');
  return p.then(v => conferir('confirmar devolve false no Cancelar', v, false));
});

assincrono('pedirData devolve a data escolhida', () => {
  const p = App.pedirData({ titulo: 'Prorrogar', mensagem: 'Nova data:', confirmar: 'Prorrogar' });
  campoDataDoModal().value = '2026-09-15';
  botaoDoModal('Prorrogar').disparar('click');
  return p.then(v => conferir('pedirData devolve a data escolhida', v, '2026-09-15'));
});

assincrono('pedirData devolve null no Cancelar', () => {
  const p = App.pedirData({ titulo: 'Prorrogar', mensagem: 'Nova data:' });
  botaoDoModal('Cancelar').disparar('click');
  return p.then(v => conferir('pedirData devolve null no Cancelar', v, null));
});

// Sem data escolhida o modal NAO fecha: fechar aqui gravaria '' no
// vencimento de todo mundo que estivesse selecionado.
assincrono('pedirData nao fecha com o campo vazio', () => {
  let resolveu = false;
  const p = App.pedirData({ titulo: 'Prorrogar', mensagem: 'Nova data:' });
  p.then(() => { resolveu = true; });
  const caixa = modalAberto();
  botaoDoModal('Confirmar').disparar('click');
  return Promise.resolve().then(() => {
    conferir('pedirData nao fecha com o campo vazio', resolveu, false);
    conferir('e avisa o que falta',
      achar(caixa, el => el.className === 'modal-erro').textContent, 'Escolha uma data.');
    botaoDoModal('Cancelar').disparar('click');
    return p;
  });
});

// pedirTexto: cancelar devolve null; confirmar devolve o texto — e
// confirmar VAZIO devolve '' (limpar a observacao e' resposta valida,
// diferente de cancelar). Quem chama testa `!== null`.
function campoTextoDoModal() {
  return achar(modalAberto(), el => el.type === 'text');
}

assincrono('pedirTexto devolve o texto digitado', () => {
  const p = App.pedirTexto({ titulo: 'Observação', mensagem: 'x', confirmar: 'Salvar' });
  campoTextoDoModal().value = '  acordo com o fornecedor  ';
  botaoDoModal('Salvar').disparar('click');
  return p.then(v => conferir('pedirTexto devolve o texto digitado (sem espacos das pontas)',
    v, 'acordo com o fornecedor'));
});

assincrono('pedirTexto devolve null no Cancelar', () => {
  const p = App.pedirTexto({ titulo: 'Observação', mensagem: 'x' });
  campoTextoDoModal().value = 'digitei mas desisti';
  botaoDoModal('Cancelar').disparar('click');
  return p.then(v => conferir('pedirTexto devolve null no Cancelar', v, null));
});

assincrono('pedirTexto confirmado em branco devolve "" (limpar), nao null', () => {
  const p = App.pedirTexto({ titulo: 'Observação', mensagem: 'x' });
  botaoDoModal('Confirmar').disparar('click');
  return p.then(v => conferir('pedirTexto confirmado em branco devolve "" (limpar), nao null', v, ''));
});

// --- leitura economica: cache do navegador + so' o que mudou ---
//
// Firestore de mentira: uma lista "servidor" e uma lista "cache". Toda
// leitura do servidor ALIMENTA o cache (como o SDK faz) e fica
// registrada em `log`, que e' o que os testes conferem: quantos
// documentos cada caminho pagou.
function firestoreFalso(servidor, cache, log) {
  const doc = (x) => ({ id: x.id, data: () => x.dados });
  const valor = (v) => (v && v.toMillis ? v.toMillis() : v);
  function consulta(filtros) {
    return {
      where(campo, op, v) { return consulta(filtros.concat([[campo, op, v]])); },
      get(opts) {
        const deCache = !!(opts && opts.source === 'cache');
        if (deCache && cache === null) return Promise.reject(new Error('sem cache'));
        const lista = (deCache ? cache : servidor).filter(x => filtros.every(([c, op, v]) => {
          const a = valor(x.dados[c]), b = valor(v);
          if (a == null) return false;
          return op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : op === '<=' ? a <= b : a === b;
        }));
        log.push((deCache ? 'cache' : 'servidor') + ':' + lista.length);
        if (!deCache && cache) lista.forEach(x => {
          const i = cache.findIndex(y => y.id === x.id);
          if (i === -1) cache.push(x); else cache[i] = x;
        });
        return Promise.resolve({ size: lista.length, forEach: (fn) => lista.map(doc).forEach(fn) });
      }
    };
  }
  return consulta([]);
}
const carimbo = (ms) => ({ toMillis: () => ms });
const HORA = 3600000;
function armazenamentoFalso() {
  const m = {};
  return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, removeItem: k => { delete m[k]; } };
}
const ids = (r) => r.docs.map(d => d.id).sort().join(',');

assincrono('lerComDelta: completa na primeira vez, delta depois, e completa de novo na duvida', async () => {
  const servidor = [
    { id: 'a', dados: { v: 1, atualizadoEm: carimbo(10 * HORA) } },
    { id: 'b', dados: { v: 1, atualizadoEm: carimbo(20 * HORA) } },
    { id: 'c', dados: { v: 1 } } // ficha antiga, sem carimbo
  ];
  const cache = [], log = [], arm = armazenamentoFalso();
  const ler = (extra) => App.lerComDelta(Object.assign({
    consulta: firestoreFalso(servidor, cache, log), campo: 'atualizadoEm', chave: 'k', hoje: '2026-10-05',
    versao: 0, armazenamento: arm, deMillis: carimbo
  }, extra));

  const r1 = await ler();
  conferir('delta: primeira leitura e completa e paga tudo', [r1.modo, r1.lidasNoServidor, ids(r1)], ['completa', 3, 'a,b,c']);

  log.length = 0;
  const r2 = await ler();
  conferir('delta: segunda leitura vem do cache e paga so o que esta na folga do ultimo carimbo',
    [r2.modo, r2.lidasNoServidor, ids(r2), log], ['delta', 1, 'a,b,c', ['cache:3', 'servidor:1']]);

  // Outra maquina alterou "a" e criou "d".
  servidor[0] = { id: 'a', dados: { v: 2, atualizadoEm: carimbo(30 * HORA) } };
  servidor.push({ id: 'd', dados: { v: 1, atualizadoEm: carimbo(31 * HORA) } });
  const r3 = await ler();
  // 3 leituras: as duas novidades + "b", que estava dentro da folga do ultimo carimbo.
  conferir('delta: traz a ficha alterada e a nova, com o valor NOVO',
    [r3.modo, r3.lidasNoServidor, ids(r3), r3.docs.find(d => d.id === 'a').data().v], ['delta', 3, 'a,b,c,d', 2]);
  conferir('delta: o controle avanca para o ultimo carimbo visto', [JSON.parse(arm.m.k).ultima, JSON.parse(arm.m.k).qtd], [31 * HORA, 4]);

  const r4 = await ler({ hoje: '2026-10-06' });
  conferir('delta: primeira leitura de outro dia e completa', [r4.modo, r4.motivo], ['completa', 'renovação diária']);
  const r5 = await ler({ hoje: '2026-10-06', versao: 1 });
  conferir('delta: contador de exclusao diferente = completa', [r5.modo, r5.motivo], ['completa', 'houve exclusão em outra máquina']);

  // O navegador limpou parte do cache: menos documentos do que o controle diz.
  cache.splice(0, 2);
  const r6 = await ler({ hoje: '2026-10-06', versao: 1 });
  conferir('delta: cache menor que o esperado = completa (nunca lista pela metade)', [r6.modo, r6.motivo, ids(r6)], ['completa', 'cache do navegador incompleto', 'a,b,c,d']);

  // Exclusao feita AQUI: some do cache local, e o controle e ajustado
  // para a propria maquina nao pagar uma leitura inteira por isso.
  servidor.splice(servidor.findIndex(x => x.id === 'd'), 1);
  cache.splice(cache.findIndex(x => x.id === 'd'), 1);
  App.ajustarLeitura('k', (m) => { m.qtd -= 1; m.versao += 1; }, arm);
  const r7 = await ler({ hoje: '2026-10-06', versao: 2 });
  conferir('delta: depois de excluir aqui e ajustar o controle, continua em delta', [r7.modo, ids(r7)], ['delta', 'a,b,c']);

  App.esquecerLeitura('k', arm);
  const r8 = await ler({ hoje: '2026-10-06', versao: 2 });
  conferir('delta: controle apagado = completa', r8.modo, 'completa');
});

assincrono('lerComDelta: navegador sem cache cai na leitura completa', async () => {
  const servidor = [{ id: 'a', dados: { atualizadoEm: carimbo(HORA) } }];
  const arm = armazenamentoFalso(), log = [];
  const o = { campo: 'atualizadoEm', chave: 'k', hoje: '2026-10-05', armazenamento: arm, deMillis: carimbo };
  await App.lerComDelta(Object.assign({ consulta: firestoreFalso(servidor, [], log) }, o));
  const r = await App.lerComDelta(Object.assign({ consulta: firestoreFalso(servidor, null, log) }, o));
  conferir('delta: erro ao ler o cache = completa', [r.modo, r.motivo, ids(r)], ['completa', 'cache do navegador indisponível', 'a']);
  const semLS = await App.lerComDelta(Object.assign({ consulta: firestoreFalso(servidor, [], log) }, o, { armazenamento: null }));
  conferir('delta: sem localStorage, sempre completa', semLS.modo, 'completa');
});

assincrono('lerComDelta: consulta com filtro proprio usa a colecao pura no delta e filtra o que chega', async () => {
  const servidor = [
    { id: 'p1', dados: { codigo: '10', data: carimbo(10 * HORA) } },
    { id: 's1', dados: { data: carimbo(11 * HORA) } } // pesquisa sem codigo: fora da consulta
  ];
  const cache = [], log = [], arm = armazenamentoFalso();
  const col = firestoreFalso(servidor, cache, log);
  const o = { consulta: col.where('codigo', '>=', ''), delta: col, aceita: d => !!d.data().codigo,
    campo: 'data', chave: 'c', hoje: '2026-10-05', armazenamento: arm, deMillis: carimbo };
  const r1 = await App.lerComDelta(o);
  conferir('delta com filtro: a completa respeita a consulta', ids(r1), 'p1');
  servidor.push({ id: 'p2', dados: { codigo: '11', data: carimbo(12 * HORA) } }, { id: 's2', dados: { data: carimbo(13 * HORA) } });
  const r2 = await App.lerComDelta(o);
  conferir('delta com filtro: o que chega sem codigo e descartado, mas o carimbo avanca',
    [r2.modo, ids(r2), JSON.parse(arm.m.c).ultima], ['delta', 'p1,p2', 13 * HORA]);
});

assincrono('lerFaixaComCache: passado do cache, recente do servidor, completa a cada 7 dias', async () => {
  const servidor = [
    { id: 'jan', dados: { vencimento: '2026-01-10', valor: 1 } },
    { id: 'jun', dados: { vencimento: '2026-06-10', valor: 1 } },
    { id: 'set', dados: { vencimento: '2026-09-20', valor: 1 } },
    { id: 'out', dados: { vencimento: '2026-10-02', valor: 1 } },
    { id: 'antes', dados: { vencimento: '2025-12-31', valor: 1 } } // fora da faixa
  ];
  const cache = [], log = [], arm = armazenamentoFalso();
  const ler = (extra) => App.lerFaixaComCache(Object.assign({
    col: firestoreFalso(servidor, cache, log), campo: 'vencimento', ini: '2026-01-01', corte: '2026-08-06',
    chave: 'f', hoje: '2026-10-05', armazenamento: arm
  }, extra));

  const r1 = await ler();
  conferir('faixa: primeira leitura e completa', [r1.modo, r1.lidasNoServidor, ids(r1)], ['completa', 4, 'jan,jun,out,set']);

  log.length = 0;
  const r2 = await ler({ hoje: '2026-10-06' });
  conferir('faixa: no dia seguinte, so os recentes pagam leitura; servidor ANTES do cache',
    [r2.modo, r2.lidasNoServidor, ids(r2), log], ['parcial', 2, 'jan,jun,out,set', ['servidor:2', 'cache:2']]);

  // "jun" foi prorrogado para outubro em outra maquina: chega pelo
  // servidor e NAO pode aparecer duas vezes nem com a data velha.
  servidor[1] = { id: 'jun', dados: { vencimento: '2026-10-20', valor: 1 } };
  const r3 = await ler({ hoje: '2026-10-06' });
  conferir('faixa: documento que mudou de data entra uma vez so, com a data nova',
    [ids(r3), r3.docs.find(d => d.id === 'jun').data().vencimento, r3.lidasNoServidor], ['jan,jun,out,set', '2026-10-20', 3]);

  const r4 = await ler({ hoje: '2026-10-12' });
  conferir('faixa: depois de 7 dias, completa', [r4.modo, r4.motivo], ['completa', 'renovação a cada 7 dias']);
  const r5 = await ler({ hoje: '2026-10-13', forcar: true });
  conferir('faixa: recarga pedida = completa', [r5.modo, r5.motivo], ['completa', 'recarga pedida']);
  const r6 = await ler({ hoje: '2026-10-13', ini: '2025-01-01' });
  conferir('faixa: periodo diferente do guardado = completa', [r6.modo, ids(r6)], ['completa', 'antes,jan,jun,out,set']);

  cache.splice(cache.findIndex(x => x.id === 'jan'), 1);
  const r7 = await ler({ hoje: '2026-10-14', ini: '2025-01-01' });
  conferir('faixa: cache menor que o esperado = completa', [r7.modo, r7.motivo, ids(r7)], ['completa', 'cache do navegador incompleto', 'antes,jan,jun,out,set']);

  const semCache = await App.lerFaixaComCache({ col: firestoreFalso(servidor, null, log), campo: 'vencimento', ini: '2025-01-01',
    corte: '2026-08-06', chave: 'f', hoje: '2026-10-14', armazenamento: arm });
  conferir('faixa: erro ao ler o cache = completa', [semCache.modo, semCache.motivo], ['completa', 'cache do navegador indisponível']);
});

assincrono('lerFaixaComCache: faixa com fim; ano passado inteiro nao paga leitura nenhuma', async () => {
  const servidor = [
    { id: 'a', dados: { vencimento: '2025-03-10' } }, { id: 'b', dados: { vencimento: '2025-11-10' } },
    { id: 'c', dados: { vencimento: '2026-07-10' } } // depois do fim
  ];
  const cache = [], log = [], arm = armazenamentoFalso();
  const o = { col: firestoreFalso(servidor, cache, log), campo: 'vencimento', ini: '2025-01-01', fim: '2026-06-30',
    corte: '2026-08-06', chave: 'p', hoje: '2026-10-05', armazenamento: arm };
  const r1 = await App.lerFaixaComCache(o);
  conferir('faixa com fim: a completa respeita o fim', ids(r1), 'a,b');
  log.length = 0;
  const r2 = await App.lerFaixaComCache(Object.assign({}, o, { hoje: '2026-10-06' }));
  conferir('faixa com fim antes do corte: tudo do cache, zero leitura no servidor',
    [r2.modo, r2.lidasNoServidor, ids(r2), log], ['parcial', 0, 'a,b', ['cache:2']]);
});

// E o confirmar nao pode voltar a aceitar inputDate por engano.
conferir('confirmar nao tem mais inputDate',
  /inputDate/.test(fs.readFileSync(path.resolve(__dirname, '..', 'app-shared.js'), 'utf8')), false);

// Modal que nunca resolve a promessa deixaria a fila parada e o
// processo sairia com 0: o codigo de saida comeca em 1 e so' vira 0
// quando o ultimo .then de fato rodou.
process.exitCode = 1;
pendentes
  .reduce((fila, t) => fila.then(t.executar).catch(e => {
    falhas++;
    console.log('  [X] ' + t.nome + ' — explodiu: ' + (e && e.message));
  }), Promise.resolve())
  .then(() => {
    console.log('  ' + ok + ' verificacoes passaram' + (falhas ? ', ' + falhas + ' falharam' : ''));
    if (falhas) { console.log('  >>> ' + falhas + ' FALHA(S)'); process.exitCode = 1; }
    else { console.log('  >>> tudo certo'); process.exitCode = 0; }
  });
