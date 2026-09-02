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

// E o confirmar nao pode voltar a aceitar inputDate por engano.
conferir('confirmar nao tem mais inputDate',
  /inputDate/.test(fs.readFileSync(path.resolve(__dirname, '..', 'app-shared.js'), 'utf8')), false);

pendentes
  .reduce((fila, t) => fila.then(t.executar).catch(e => {
    falhas++;
    console.log('  [X] ' + t.nome + ' — explodiu: ' + (e && e.message));
  }), Promise.resolve())
  .then(() => {
    console.log('  ' + ok + ' verificacoes passaram' + (falhas ? ', ' + falhas + ' falharam' : ''));
    if (falhas) { console.log('  >>> ' + falhas + ' FALHA(S)'); process.exitCode = 1; }
    else console.log('  >>> tudo certo');
  });
