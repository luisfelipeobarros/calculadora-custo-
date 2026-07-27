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

---

## ⚠ Passo obrigatório: fechar o banco

Hoje qualquer pessoa que tenha o arquivo HTML consegue ler e apagar
**todas as notas, duplicatas, cotações e preços de fornecedor**. A
`apiKey` que aparece no código é pública por design — ela identifica o
projeto, não protege nada. Quem protege são as regras do Firestore, e as
atuais estão abertas.

Faça isto no [Firebase Console](https://console.firebase.google.com/):

1. **Authentication → Sign-in method →** ative **E-mail/senha**.
2. **Authentication → Users → Add user:** crie uma conta para cada pessoa
   que usa os aplicativos.
3. **Firestore Database → Rules:** cole o conteúdo de `firestore.rules` e
   clique em **Publicar**.

**Você pode publicar as regras sem parar o trabalho de ninguém.** Os apps
tentam funcionar normalmente; na primeira operação que o Firestore
recusar, eles abrem a caixa de login sozinhos e refazem a operação depois
que você entra. Não tem como ficar trancado para fora no meio da
migração.

Depois de entrar, o botão **Sair** fica no canto superior direito, ao
lado dos botões de tela.

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
var DATA_CORTE_CARGA      = '2024-01-01'; // até onde o app baixa notas
```

`DATA_CORTE_CARGA` é bem mais antigo de propósito: as duplicatas em
aberto precisam achar a nota de origem. Quando uma duplicata aponta para
uma nota anterior a esse corte, a coluna "Recebido" mostra `—` em vez de
afirmar "NÃO" sem ter como saber.

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
