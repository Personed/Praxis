# Remoção de conta, provedor Modus e créditos

Revisão de 8 de novembro de 2026.

O aplicativo usa modelos locais ou provedores externos configurados pelo usuário. Não há
login de conta Modus, assinatura, saldo de créditos ou checkout no aplicativo.

## Componentes e dependências

A busca de referências cobriu o código do desktop, os contratos compartilhados, o site,
os scripts npm e os workflows. O renderer contém 149 arquivos TSX de produção. A compilação
e a verificação de tipos validam suas dependências; os testes específicos verificam o
comportamento das superfícies afetadas. Não foi feita uma inspeção visual manual de cada tela.

| Área | Resultado da revisão |
| --- | --- |
| App, sidebar e configurações | Sem inicialização de conta ou cobrança; navegação sem Conta. |
| Seletores de modelos em configurações, agentes e compositor | Agrupamento alfabético por provedor; catálogo antigo do provedor Modus não gera opções utilizáveis. |
| Conversas e modelo padrão | Seleções antigas são preservadas como indisponíveis; o compositor bloqueia envio até escolher outro modelo. |
| Automações e runtime | Sem dependência de planos ou bloqueios por créditos; o serviço de modelos rejeita IDs legados antes de enviar requisições. |
| Provedores externos e integrações | Chaves e OAuth próprios desses serviços permanecem disponíveis. |
| IPC, preload e contratos | Sem APIs de conta/cobrança ou campos de plano, desbloqueio e créditos. |
| Backend gerenciado | Removidos serviços de autenticação, cobrança, router, migrações, funções e testes exclusivos dessas funcionalidades. |
| Dependências e empacotamento | Removidos Supabase JS, protocolo de retorno de conta/cobrança e variáveis de build correspondentes. |
| Site e documentação | Removidas páginas de preços e retornos de login/pagamento; links internos e descrições de fluxo de dados atualizados. |

Os componentes de arquivos, fontes, preview, diff, Git, terminal, processos, navegador,
grupos, planejamento, inspector e atualizações não apresentaram referências às funcionalidades
removidas na busca. Permanecem cobertos pela verificação de tipos e pela compilação geral.

## Compatibilidade e limites

A remoção altera o código do projeto. Não apaga o perfil local, as conversas ou as credenciais
dos provedores externos e não modifica serviços ou assinaturas remotos. IDs `modus/...`
permanecem reconhecidos apenas para impedir sua reutilização e explicar a indisponibilidade.
Relatórios históricos de arquitetura podem mencionar o backend anterior.

Os logs das verificações ficam em `artifacts/account-removal-*.log` (ignorados pelo Git).
O lint global do repositório apresenta erros de formatação, incluindo finais de linha CRLF;
os arquivos principais alterados também são verificados separadamente.

Resultados finais:

- 37 arquivos de teste direcionados: **378 testes passaram**.
- TypeScript: passou.
- Build Electron/Vite de main, preload e renderer: passou.
- Lint dos 11 arquivos principais: sem erros; dois avisos de non-null assertion já existentes.
- Links internos do site: nenhum destino ausente.
- Revisão independente: corrigidas referências antigas à tela Conta e ao servidor de modelos.
- A suíte global não passou: apresentou falhas em outras áreas e foi interrompida após deixar
  de avançar nos testes WASI. Três falhas foram reproduzidas isoladamente em arquivos sem
  alterações: separadores de caminho no Windows, caminho de componente com barra invertida
  e formatação numérica dependente do locale. A suíte global não deve ser considerada aprovada.
