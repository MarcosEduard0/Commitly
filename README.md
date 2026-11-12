# Commitly: Auto Git Message

Extensão para VS Code que transforma alterações em staging em mensagens de commit personalizadas. A versão 0.2.4 usa Codex CLI, com painel lateral, mensagens em português ou inglês e interface de provedor separada para futuras integrações.

```text
🐛 fix: corrigir validação de credenciais
```

## Instalar e usar

1. Instale o Codex CLI e autentique sua conta seguindo a [documentação oficial](https://learn.chatgpt.com/docs/non-interactive-mode). No Windows, se o PowerShell bloquear `codex.ps1`, use `codex.cmd login`.
2. No VS Code, execute **Extensions: Install from VSIX...** e selecione `artifacts/commitly-0.2.4.vsix`.
3. Abra um repositório e adicione ao staging os arquivos que pretende commitar.
4. Clique no ícone de brilho no painel Controle do Código-Fonte ou execute **Commitly: Gerar mensagem de commit** pela paleta.
5. Revise a mensagem preenchida e faça o commit pelo fluxo normal do VS Code.

O botão de regenerar solicita outra geração com o mesmo prompt e o staging atual. Se houver mensagem preenchida, a extensão pede confirmação antes de substituí-la. Alterações feitas no campo durante a geração são preservadas. Se o staging mudar, a sugestão é descartada e uma nova geração é necessária. Em workspaces com vários repositórios, selecione o repositório quando solicitado.

Durante a geração, o botão de brilho é substituído por **Parar**, na mesma posição da barra. Clique nele ou execute **Commitly: Cancelar geração em andamento** para cancelar. O botão de regenerar permanece visível, desabilitado enquanto o processo está ativo. O progresso aparece discretamente na barra de status, sem notificação no canto inferior direito. Ao concluir, cancelar ou falhar, o botão de gerar retorna.

No Windows, a extensão resolve o executável nativo do pacote npm e o inicia oculto, sem passar pelo launcher JavaScript que pode abrir uma janela de console. A versão 0.1.1 corrige esse comportamento da 0.1.0.

## Configurações

Clique no ícone do **Commitly** na barra lateral ou execute **Commitly: Abrir configurações**. O painel permite escolher o modelo e adicionar informações complementares. As regras de geração são internas, sem exibição ou edição no painel ou nas configurações. O provedor disponível nesta versão é Codex CLI; informe um identificador de modelo disponível na sua conta ou deixe vazio para usar o padrão.

Escolha **Usuário (todos os projetos)** ou uma pasta do workspace e clique em **Salvar configurações**. Configurações de pasta prevalecem sobre as do usuário. A troca de destino descarta edições não salvas. Em workspaces com várias pastas, escolha a pasta correspondente ao repositório desejado.

**Verificar Codex CLI** confere se o programa está instalado e responde com sua versão. Não envia código nem testa autenticação ou acesso ao modelo. Em **Configurações avançadas**, você encontra caminho do executável, limites e timeout. A autenticação continua no próprio CLI, sem solicitar chaves no painel.

Para uma orientação pontual, execute **Commitly: Gerar com instrução adicional**. Ela é acrescentada somente àquela geração e não é salva. Escape cancela a operação. Já as **Instruções complementares** do painel são persistentes e acrescentadas em todas as gerações. Essas orientações são texto para o modelo e não executam comandos no terminal.

| Configuração | Comportamento |
| --- | --- |
| `commitly.provider` | `codex`, única integração disponível nesta versão |
| `commitly.language` | `pt-BR` (Português, padrão) ou `en` (Inglês), para título e corpo |
| `commitly.codex.path` | Executável Codex ou caminho de `codex.js`; vazio detecta pelo PATH |
| `commitly.codex.model` | Modelo opcional; vazio usa o padrão do CLI |
| `commitly.extraInstructions` | Instruções complementares acrescentadas ao prompt em todas as gerações |
| `commitly.timeoutSeconds` | Tempo máximo de geração, padrão 120 segundos |
| `commitly.maxDiffBytes` | Tamanho máximo do diff, padrão 200.000 bytes; não há truncamento silencioso |

Exemplo de personalização em `settings.json`:

```json
{
  "commitly.provider": "codex",
  "commitly.extraInstructions": [
    "Mencionar a tarefa quando seu identificador estiver evidente no diff."
  ]
}
```

Configurações antigas de `commitly.instructions` são ignoradas. Apenas as informações complementares podem ser personalizadas.

No painel, escolha **Idioma da mensagem** e clique em **Salvar configurações** antes da próxima geração. O idioma também pode ser definido por pasta ou para todos os projetos. A seleção altera as regras internas de geração; informações complementares não substituem o idioma escolhido. Identificadores técnicos, emojis e tipos de commit são preservados. O idioma da interface continua em português.

O código verifica formato, correspondência entre tipo e emoji, ausência de escopo e estrutura do corpo. Idioma, infinitivo e fidelidade semântica dependem do modelo e da sua revisão. Títulos acima de 72 caracteres geram aviso, pois esse limite é uma preferência do prompt.

## Dados e execução

O diff completo do staging é enviado ao provedor configurado no Codex CLI. O modelo não roda necessariamente na sua máquina; autenticação, limites e eventuais cobranças seguem sua conta. Verifique o staging antes de usar, inclusive para evitar enviar credenciais ou outros dados sensíveis. Arquivos binários aparecem apenas como indicação de alteração no diff; seu conteúdo não é analisado.

O CLI recebe o prompt por stdin em um diretório temporário, com sandbox `read-only`, sessão efêmera e saída estruturada. A extensão usa `--ignore-user-config` para evitar carregar MCPs, hooks e instruções da configuração pessoal; a autenticação continua vindo do Codex. Configurações pessoais de modelo/provedor e perfis também não são carregadas: selecione o modelo em `commitly.codex.model`. É necessária uma versão recente do CLI que suporte essa opção. O prompt orienta o modelo a não executar ferramentas; isso não constitui uma garantia de isolamento completo do sistema.

O Commitly não executa commit nem altera arquivos ou staging. Os arquivos temporários de esquema e resposta são removidos ao final. Não há telemetria própria nem armazenamento do diff pelo Commitly. Políticas de retenção do serviço e do CLI são independentes.

## Desenvolvimento

```powershell
npm.cmd install
npm.cmd test
npm.cmd run package
```

Pressione **F5** para abrir o Extension Development Host. Na nova janela, abra um repositório de teste e execute o comando do Commitly.

Os testes automatizados usam Git real para verificar isolamento do staging e um CLI simulado para validar o adaptador, argumentos, stdin e limpeza temporária. Testes com APIs simuladas do VS Code verificam salvamento por pasta/usuário, validação de entradas, instruções extras, cancelamento e preservação de edições. Eles não comprovam autenticação, resposta real do modelo ou interação visual no VS Code.

Para homologar manualmente: gere com um arquivo staged e outro não staged; cancele uma geração; edite a mensagem durante a geração; altere o staging durante a geração; teste regeneração e seleção entre repositórios. Confirme que apenas a sugestão válida preenche o campo e que o commit continua sendo uma ação manual.

No painel lateral, confira tema claro/escuro, navegação por teclado e largura estreita. Salve informações complementares para uma pasta, reabra o painel, confirme os valores e gere uma mensagem; teste também o destino usuário. Confirme a ausência de campos para visualizar ou editar o prompt base. Verifique se a instrução pontual não é reutilizada numa geração comum.

O publisher configurado para publicação no Marketplace é `MarcosEduardo`.
