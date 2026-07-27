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
conferir('somarDias vira o mes', App.somarDias('2026-01-31', 1), '2026-02-01');
conferir('somarDias ano bissexto', App.somarDias('2028-02-28', 1), '2028-02-29');
conferir('somarDias nao bissexto', App.somarDias('2026-02-28', 1), '2026-03-01');
conferir('somarDias negativo (janela da segunda)', App.somarDias('2026-07-27', -2), '2026-07-25');
conferir('somarDias vira o ano', App.somarDias('2026-12-31', 1), '2027-01-01');
conferir('diasEntre', App.diasEntre('2026-01-01', '2026-03-01'), 59);
conferir('diasEntre mesmo dia', App.diasEntre('2026-05-05', '2026-05-05'), 0);

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

console.log('  ' + ok + ' verificacoes passaram' + (falhas ? ', ' + falhas + ' falharam' : ''));
if (falhas) { console.log('  >>> ' + falhas + ' FALHA(S)'); process.exitCode = 1; }
else console.log('  >>> tudo certo');
