# Calculadora de Custo + Controle de Notas

Dois aplicativos de página única que compartilham o mesmo projeto Firebase.

| Arquivo | O que é |
|---|---|
| `index.html` | Custo, impostos, frete, margem, cotações, concorrentes, NF-e emitidas |
| `controle-notas.html` | NF-e a importar, duplicatas, pagamentos, notas canceladas |
| `app-shared.css` | Design system comum aos dois |
| `app-shared.js` | Helpers, login, avisos, roteador — comum aos dois |
| `firestore.rules` | Regras de segurança do banco (**precisa ser publicada**) |
| `testes/` | Verificação automatizada, roda só com Node |

Os quatro primeiros precisam ficar **na mesma pasta**. Se você publica os
aplicativos em algum lugar, suba `app-shared.css`, `app-shared.js`,
`icon-192.png`, `icon-512.png` e os dois `manifest*.json` junto.

### ⚠ Sempre que alterar `app-shared.css` ou `app-shared.js`

O navegador guarda esses dois arquivos em cache. Depois de publicar uma
mudança neles, as máquinas continuam usando a **cópia antiga** por um
tempo — e o sintoma é confuso: o app parece não ter mudado, ou mistura
comportamento novo com antigo.

Por isso os dois HTML referenciam os arquivos com um número de versão:

```html
<link rel="stylesheet" href="app-shared.css?v=2">
<script src="app-shared.js?v=2"></script>
```

**Ao mexer nos arquivos compartilhados, aumente esse número nos dois
HTML.** Trocar `?v=2` por `?v=3` faz cada navegador baixar a versão nova
na hora, sem ninguém precisar limpar cache. O `node testes/executar.js`
reclama se a referência estiver sem `?v=`.

---

## ⚠ Passo obrigatório: fechar o banco

Hoje qualquer pessoa que tenha o arquivo HTML consegue ler e apagar
**todas as notas, duplicatas, cotações e preços de fornecedor**. A
`apiKey` que aparece no código é pública por design — ela identifica o
projeto, não protege nada. Quem protege são as regras do Firestore, e as
atuais estão abertas.

Faça isto no [Firebase Console](https://console.firebase.google.com/):

1. **Authentication → Sign-in method →** ative **E-mail/senha**.
2. **Authentication → Users → Add user:** crie um usuário para cada
   função (veja a tabela abaixo).
3. **Firestore Database → Rules:** cole o conteúdo de `firestore.rules` e
   clique em **Publicar**.

### Usuários: cadastre com domínio, entre sem ele

O Firebase exige formato de e-mail, mas **ninguém precisa digitar
domínio**. Cadastre assim no Console:

| No Console, cadastre | Na tela de login, digite |
|---|---|
| `administrativo@calculadora.local` | `Administrativo` |
| `compras@calculadora.local` | `Compras` |
| `financeiro@calculadora.local` | `Financeiro` |

O app completa o `@calculadora.local` sozinho, e não faz diferença
maiúscula ou minúscula. Não precisa ser e-mail de verdade — o Firebase
não envia nada nem confirma nada. A senha tem mínimo de 6 caracteres.

Para usar o domínio real da empresa, troque `DOMINIO_LOGIN` no começo de
`app-shared.js` — e cadastre os usuários com esse mesmo domínio.

Crie **um usuário por função ou pessoa**, nunca um compartilhado: assim
você desativa o acesso de quem sai sem trocar a senha de todo mundo.

### Como fica no dia a dia

O login é **obrigatório na entrada**: sem entrar, os aplicativos não
mostram nenhum dado. A caixa não fecha com Esc nem clicando fora.

A opção **"Manter conectado neste computador"** vem marcada. Com ela, as
máquinas do escritório entram uma vez e continuam entrando sozinhas, para
sempre, até alguém clicar em **Sair**. Desmarque em computador
compartilhado ou emprestado: aí a sessão morre ao fechar o navegador.

O botão **Sair** fica no canto superior direito, ao lado dos botões de
tela, junto do nome de quem está conectado.

**Você pode publicar as regras sem parar o trabalho de ninguém.** Quem
já estiver com a sessão salva nem percebe; quem não estiver vê a caixa de
login. Se a sessão expirar no meio do uso, o app reabre o login e refaz
sozinho a operação que falhou.

### O que as regras permitem

- `notas`, `duplicatas`, `itensNotas` — o navegador **lê**, mas só pode
  alterar os campos de controle (`pago`, `status`, `previsaoEntrega`,
  `noSistema`…). Criar e apagar nota fica proibido pelo navegador. O
  Apps Script usa conta de serviço e ignora estas regras, então a
  importação de XML continua igual.
- `produtos`, `cotacoes`, `concorrentes` — leitura e escrita livres para
  quem está autenticado.
- Qualquer outra coleção: bloqueada.

---

## O preço de venda mora em um lugar só

O preço de venda de um produto fica em **Produtos salvos**
(`produtos/{nome}`, campo `venda`). Não existe outra cópia.

Isso vale para as três telas onde ele aparece:

| Tela | O que faz com o preço |
|---|---|
| Calculadora / Produtos salvos | Lê e grava — é a fonte |
| Cotação, card "3. Adicionar produtos" | Chega preenchido com o preço do produto; o que você digitar passa a valer em Produtos salvos |
| Histórico e Pesquisar concorrentes | Só leem |

**Antes** o mesmo número era guardado duas vezes: em `produtos.venda` e
em `cotacoes.itens[].precoVenda`. Alterar um não alterava o outro, então
a mesma peça podia aparecer a R$ 90 no histórico e a R$ 110 na
Calculadora, sem nada dizendo qual dos dois valia.

Duas consequências de a fonte ser única, que valem saber:

- A coluna **Venda** do Histórico mostra o preço de **hoje**, não uma
  foto do dia da cotação. Trocar o preço em Produtos salvos muda a
  coluna e a margem em todas as cotações daquele produto.
- **Apagar o campo Venda na cotação não apaga o preço do produto.**
  Tirar o preço de um produto é decisão da tela de Produtos salvos —
  uma cotação não mexe no catálogo por omissão.

Salvar a cotação grava os preços digitados em Produtos salvos e diz
quantos foram (`"Cotação salva no histórico. 3 preços de venda gravados
em Produtos salvos."`). Produto que ainda não existia nasce com a
configuração de custo que está na tela do modo em lote; produto que já
existe tem **só** o preço trocado — frete, impostos e o resto da ficha
dele ficam como estavam.

As cotações salvas antes dessa unificação ainda têm o `precoVenda`
gravado no item. Ele continua sendo lido quando o produto não tem preço
em Produtos salvos, para nada sumir da tela, mas nada volta a escrever
ali.

---

## Rodando os testes

```bash
node testes/executar.js
```

Não precisa instalar nada. São seis etapas, em quatro frentes:

1. **Núcleo de cálculo** — compara a fórmula atual com a original em
   200 mil casos aleatórios. É a rede de proteção contra mexer nas
   alíquotas sem perceber. Também confere que a coluna TOTAL fecha com
   a soma das linhas e que o preço sugerido atinge a margem pedida.
2. **Estrutura dos dois HTML** — sintaxe dos scripts, tags balanceadas,
   ids duplicados, `$()` apontando para id inexistente, `label for=`
   órfão, arquivo referenciado que sumiu.
3. **Carga em DOM simulado** — executa os scripts de verdade e pega
   referência quebrada em tempo de carga.
4. **Helpers** — 49 verificações em `app-shared.js` (escape de HTML,
   bloqueio de `javascript:`, aritmética de datas, arredondamento).

Rode antes de publicar qualquer alteração.

---

## Onde mexer em cada coisa

**Alíquotas de imposto** — `index.html`, objeto `TRIBUTOS`,
logo no começo do bloco de cálculo:

```js
const TRIBUTOS = {
  pisCofins:  0.0925,
  icmsDebito: 0.205,
  irpj:       0.25,
  csll:       0.09
};
```

É o **único** lugar. Antes esses números estavam escritos à mão em duas
funções diferentes; se alguém mudasse só uma, a margem exibida e o preço
sugerido passariam a discordar sem erro nenhum. Agora `computeCalc` e
`precoParaMargem` saem os dois da mesma decomposição
(`custo = C0 + k × venda`).

**Metas de margem** (mínimo 4%, aceitável 8%, ideal 13%) — array `metas`
dentro de `calcular()`.

**Quanto de histórico o Controle de Notas baixa** — `controle-notas.html`:

```js
var DATA_CORTE_IMPORTACAO = '2026-01-01'; // o que conta como "a importar"
var MESES_HISTORICO       = 12;           // janela padrão de carga
var MESES_FOLGA_NOTAS     = 6;            // notas vêm com folga extra
```

O app baixa as duplicatas que vencem nos últimos 12 meses, e as notas
dos últimos 18. A folga existe porque a nota é emitida **antes** de a
parcela vencer: sem ela, o app não saberia dizer se a duplicata foi
recebida ou se a nota foi cancelada. Quando mesmo assim a nota de origem
está fora da janela, a coluna "Recebido" mostra `—` em vez de afirmar
"NÃO" sem ter como saber.

Duas coisas nunca são cortadas pela janela, porque some justamente o que
importa:

- **Notas canceladas** de qualquer época (consulta própria).
- **Duplicatas sem data de vencimento** — as que ninguém acha depois.

O selo **"últimos 12 meses"** aparece na barra de cima, ao lado do
contador, junto com o botão **"carregar histórico completo"**, que refaz
a carga sem corte nenhum quando você precisar consultar algo antigo.

**Lojas pesquisadas** — textarea na aba Concorrentes; o padrão está na
constante `LOJAS_PADRAO`.

**Modelos do Gemini** — bloco `<script type="module">`, constantes
`MODELO_EXTRATOR`, `MODELO_PESQUISA`, `MODELO_FORMATADOR`.

---

## Endereços das telas

As telas agora ficam no endereço, então dá para recarregar a página sem
voltar ao início e para mandar um link já aberto na tela certa:

- `controle-notas.html#Pagamentos`, `#Importar`, `#Canceladas`, `#Painel`
- `index.html#Historico`, `#Cotacao`, `#Concorrentes`,
  `#Produtos`, `#Notas`, `#Frete`, `#Sync`

As telas de comparação e de pesquisa em lote dependem de um pedido
selecionado, então caem na tela inicial se você abrir o link direto.

---

## Ponto em aberto, para você decidir

**Como ler "1.234" numa planilha de fornecedor.** A função
`parseNumeroBR` lê `"1.234,56"` como 1234,56 (certo) e `"1.234"` como
**1,234** — não como mil duzentos e trinta e quatro. Esse é o
comportamento original, mantido de propósito: não dá para adivinhar sem
ver como os seus fornecedores formatam as planilhas. Preços quase sempre
vêm com centavos e caem no caso certo; o risco é uma **quantidade**
escrita com ponto de milhar e sem casas decimais.

Se você confirmar que nenhum fornecedor usa três casas decimais em preço
unitário, dá para tratar `"1.234"` como 1234 com segurança — é uma linha.

---

## Notas técnicas

- Os dois SDKs do Firebase convivem na calculadora: `compat` v10.14 para
  o Firestore e o modular v12.15 (carregado sob demanda) para o Gemini,
  que só existe na versão modular. Unificar exigiria transformar o script
  principal em módulo ESM, o que quebraria a abertura por `file://`.
  Ficou como está de propósito.
- O cache local do Firestore (`enablePersistence`) fica ligado: a segunda
  visita abre na hora e o app continua útil sem internet. Ele falha de
  propósito quando há outra aba aberta — não é erro, o app segue sem cache.
- O Controle de Notas usa `onSnapshot` em vez de `get()`: a tela se
  atualiza sozinha quando o Apps Script importa algo, e as visitas
  seguintes só pagam pelos documentos que mudaram.
- O widget de sugestão de busca do Google roda dentro de um `<iframe
  sandbox>`. É HTML de fora, e o Google exige exibi-lo — mas ele não
  precisa (nem deve) ter acesso ao Firestore nem ao resto da página.
