# cast: план работ (для передачи на реализацию)

## Зачем
Разработчик тестирует веб-приложение, где участвуют несколько людей. Пример: чат вроде WhatsApp Web, где Sam пишет, а Elon получает. Claude должен сам работать в нескольких браузерах, каждый залогинен под своей учёткой, в том числе одновременно. Сейчас это делается вручную: Chrome с `--remote-debugging-port` и CDP-скрипты.

**Как пользуется человек:**
```
/cast:add Sam     → открывается чистый Chrome, человек входит везде, где нужно Sam, и закрывает окно
/cast:add Elon    → то же для Elon
```
После этого Claude при старте знает: «есть браузеры Sam (sam@email.com: localhost:3000, outlook…) и Elon». Он открывает их сам, когда нужно, и тестирует переписку между ними.

## Принятые решения (согласованы с пользователем)
- **Профиль = человек, а не сайт.** Один постоянный профиль настоящего Google Chrome покрывает всё для этого пользователя: Microsoft → SSO в приложение, почта, Teams и так далее.
- `/cast:add <имя>`:
  - Claude спрашивает email и описание, оба можно пропустить. Можно передать сразу: `/cast:add Sam sam@email.com "отправитель"`.
  - Открывается видимый чистый Chrome со страницей-инструкцией: «войдите везде, где нужно; при MFA отметьте «Оставаться в системе»; закройте окно, когда закончите».
  - Сигнал готовности: человек закрыл окно.
  - cast показывает домены, на которые заходили (только домены main-frame навигаций, никаких cookies), и спрашивает подтверждение. Список сохраняется как «сайты» профиля.
- `/cast:login <имя>` открывает тот же профиль. Человек добирает вход, закрывает окно, список сайтов пополняется.
- `/cast:list`, `/cast:remove <имя>`.
- Claude открывает профили **без спроса**. Если сессия протухла (вместо сайта страница входа), Claude **сам не входит**, а просит человека выполнить `/cast:login <имя>`.
- cast **никогда** не вводит и не хранит пароли, не выводит cookies и токены в ответы и логи.
- Окна **всегда видимые**, чтобы программист видел, что происходит. Headless в первой версии нет.
- Импорта существующего профиля (`--from`) нет: профили заводятся заново.
- **Только Linux** в первой версии. macOS и Windows — после рабочего решения.
- Репозиторий `bodpad/cast`. Маркетплейс называется `netmate`. Установка: `/plugin marketplace add bodpad/cast`, затем `/plugin install cast@netmate`. Префикс `claude-` в именах не использовать.
- README предупреждает о приватности: Claude читает то, что видно в профилях, в том числе почту.

### Уровни хранения (как у Claude: local / project / user)
| Уровень | Смысл | Список профилей | Данные Chrome (права 0700) |
|---|---|---|---|
| **local** (по умолчанию) | мой профиль, только в этом проекте | `~/.config/cast/projects/<project-id>.yaml` | `~/.local/share/cast/projects/<project-id>/<имя>/` |
| **project** | командный «слот» (имя и описание, без учёток), коммитится; каждый разработчик заполняет своей учёткой через `/cast:add <имя>` | `.claude/cast.yaml` в репозитории; личная часть (email, сайты) — в local-файле | как у local |
| **user** | мой профиль во всех проектах | `~/.config/cast/profiles.yaml` | `~/.local/share/cast/user/<имя>/` |

- Приоритет при совпадении имён (без учёта регистра): local > project > user.
- `project-id` = `<имя папки>-<8 hex sha256 realpath проекта>`. Проект определяется по `CAST_PROJECT_DIR`, затем `CLAUDE_PROJECT_DIR`, затем cwd.
- Незаполненный project-слот Claude видит с пометкой «не настроен на этой машине, попросите /cast:add <имя>».
- Учитываются `XDG_CONFIG_HOME` и `XDG_DATA_HOME`. Для тестов есть переопределения `CAST_CONFIG_DIR` и `CAST_DATA_DIR`.

## Движок: шлюз над @playwright/mcp (выбран после проверки)
MCP-сервер `cast` на Node/TS. На каждый открытый профиль он запускает дочерний `@playwright/mcp` (stdio, через `@modelcontextprotocol/sdk` Client) с этой папкой профиля. Claude получает **один** набор браузерных инструментов Playwright MCP, к каждому добавлен обязательный параметр `profile`, и вызов проксируется нужному ребёнку. Окно для входа в `/cast:add` и `/cast:login` открывается через библиотеку `playwright-core` той же версии, поэтому флаги запуска Chrome совпадают.

### Итоги проверки (Linux, Chrome 151, @playwright/mcp 0.0.83, 30.09.2026)
Оба варианта, шлюз над Playwright MCP и Vercel agent-browser 0.38.1, прошли три теста в видимом режиме:
1. Sam и Elon открыты одновременно, у каждого свой вход.
2. После закрытия и повторного открытия вход сохранился (cookie с Max-Age).
3. `confirm()` не вешает работу.

Выбран Playwright MCP, потому что для `/cast:add` нужны штатные события: навигации (сбор доменов) и закрытие окна. Кроме того, у него нет функции «сам ввожу пароли», и он легче (около 19 МБ против 114 МБ).

### Грабли, найденные при проверке, обязательно учесть
- **`DISPLAY`:** `StdioClientTransport` по умолчанию передаёт ребёнку урезанное окружение без `DISPLAY`, и Chrome тихо стартует в `--headless`. Передавать `env: { ...process.env }`.
- **Снимки страниц:** Playwright MCP пишет снапшоты в `.playwright-mcp/` в cwd. Передавать `--output-dir ~/.local/share/cast/output/<project-id>/<имя>`, чтобы не мусорить в проекте.
- **Параметр клика:** в 0.0.83 `browser_click` принимает `target` (ref из снапшота или селектор) и `element` (описание); `ref` не используется. Схемы брать у ребёнка динамически, свои не хардкодить.
- **Диалоги:** после клика с диалогом ответ содержит `### Modal state - ["confirm" dialog with message "Sure?"]: can be handled by browser_handle_dialog`. Другие инструменты возвращают ошибку «does not handle the modal state». `browser_handle_dialog {accept:true}` решает. Всё работает штатно, скилл должен об этом сказать.
- **Флаги Chrome:** Playwright запускает Chrome с `--password-store=basic --use-mock-keychain`, поэтому cookies шифруются не системным keyring. Это нормально, но окно входа и работа Claude должны использовать один и тот же движок, иначе профиль не прочитается.
- **Ленивый запуск:** браузер стартует при первом браузерном вызове, а не при запуске ребёнка. Список инструментов можно получить у ребёнка без открытия Chrome.
- **Точка входа:** `@playwright/mcp` не экспортирует `cli.js`. Путь: `dirname(require.resolve('@playwright/mcp/package.json')) + '/cli.js'`, запускать через `process.execPath`.
- Запуск ребёнка: `--browser chrome --user-data-dir <dir> --output-dir <dir>`.

## Факты о плагинах Claude Code (проверено по code.claude.com 29.09.2026)
- `.claude-plugin/marketplace.json`: `{ "name": "netmate", "owner": {...}, "description": "...", "plugins": [{ "name": "cast", "source": "./", "description": "..." }] }`. Установочный id — `<plugin>@<marketplace name>`.
- `.claude-plugin/plugin.json`: `{ "name": "cast", ... }`. Все компоненты получают префикс `cast:`.
- Слэш-команды пишутся скиллами (`commands/` — устаревший формат): `skills/<имя>/SKILL.md` превращается в `/cast:<имя>`. Frontmatter: `description`, `argument-hint`, `disable-model-invocation: true` (только человек), `allowed-tools`. Аргументы: `$ARGUMENTS`, `$0`, `$1` (нумерация с 0).
- MCP: `.mcp.json` в корне плагина, `{"mcpServers":{"cast":{"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/dist/src/mcp.js"],"env":{"CAST_PROJECT_DIR":"${CLAUDE_PROJECT_DIR}"}}}}`. Инструменты получат имена `mcp__plugin_cast_cast__<tool>`.
- Хуки: `hooks/hooks.json`. Вывод stdout хука SessionStart попадает в контекст Claude.
- Зависимости: при установке из маркетплейса Claude Code выполняет `npm ci --ignore-scripts` в кэше плагина, если есть `package.json` и `package-lock.json` (таймаут 60 с). При `--plugin-dir` (локальная разработка) этого нет, нужен ручной `npm install`. `dist/` коммитится, чтобы не было шага сборки. `devDependencies` держать минимальными: тесты на `node:test`, без vitest.
- Проверка: `claude plugin validate --strict .`
- `@netmate/cast` в npm свободно (публикация отложена).

## Структура репозитория
```
.claude-plugin/marketplace.json
.claude-plugin/plugin.json
.mcp.json
hooks/hooks.json                 # SessionStart → node ${CLAUDE_PLUGIN_ROOT}/dist/src/cli.js list --brief
skills/add/SKILL.md              # /cast:add     (disable-model-invocation: true)
skills/login/SKILL.md            # /cast:login   (disable-model-invocation: true)
skills/list/SKILL.md             # /cast:list
skills/remove/SKILL.md           # /cast:remove  (disable-model-invocation: true)
skills/cast/SKILL.md             # для Claude: как работать с профилями
src/paths.ts                     # ✅ написан: каталоги, project-id
src/registry.ts                  # ✅ написан (черновик: типы проходят, тестов нет): три уровня, слияние, zod + yaml
src/login-window.ts              # окно входа: launchPersistentContext, сбор доменов, ожидание закрытия
src/gateway.ts                   # дочерние @playwright/mcp, прокси инструментов
src/mcp.ts                       # MCP-сервер cast
src/cli.ts                       # list --brief для хука
test/*.test.ts                   # node:test
dist/                            # tsc-вывод, коммитится
package.json, tsconfig.json      # ✅ созданы, npm install выполнен; TS 7 требует "types": ["node"] (уже добавлено)
PLAN.md, README.md
```

## Детали реализации

### src/login-window.ts
- `openLoginWindow(dir, opts)`: `mkdir(dir, {recursive, mode: 0o700})`, затем `chromium.launchPersistentContext(dir, { channel: 'chrome', headless: false, viewport: null })`.
- Первая вкладка — страница-инструкция (`data:` или `setContent`) с именем профиля и текстом из «Принятых решений». Для `/cast:login` дополнительно открыть вкладки с уже известными сайтами.
- Сбор доменов: `context.on('page')` и существующие страницы, `page.on('framenavigated', f => f === page.mainFrame() && http(s) → host)`. Порт сохранять, `localhost:3000` значим.
- Ждать `context.on('close')`, то есть закрытия окна человеком. Таймаут около 30 минут, по нему закрыть и сообщить.
- Если профиль сейчас открыт в шлюзе этого же процесса, сначала закрыть его там.
- Для тестов: опция, которая отдаёт `context` наружу, чтобы тест сам «походил» и закрыл окно. Скрытая переменная `CAST_TEST_HEADLESS=1` включает headless только в тестах.

### src/gateway.ts
- `Gateway`: `Map<profileName, { client, transport }>`.
- `open(profile)` запускает ребёнка (`env: {...process.env}`, флаги выше).
- `close(profile)`, `closeAll()`: вызвать `browser_close`, затем `client.close()`.
- `toolDefs()`: один раз поднять временного ребёнка без профиля (Chrome не стартует), взять `listTools`, закрыть. В схему каждого инструмента добавить `profile: {type:'string', description:'cast profile name, see cast_list'}` в `required`. Исключить `browser_close` (вместо него `cast_close`) и `browser_install`, если он есть.
- `call(profile, tool, args)`: профиль не открыт → открыть автоматически. Ребёнок упал → понятная ошибка «откройте заново». Ответ ребёнка передать как есть.
- Завершение: на `SIGTERM`/`SIGINT` и конец stdin — `closeAll()`.

### src/mcp.ts — инструменты сервера cast
- `cast_list()`: профили — имя, уровень, email, описание, сайты, ready, открыт ли сейчас.
- `cast_open(profile, url?)` и `cast_close(profile)`.
- `cast_add(name, email?, description?, scope?)`: блокирует до закрытия окна, возвращает домены. В описании инструмента: «ONLY when the user explicitly asked (/cast:add); a human must log in».
- `cast_login(name)`: то же для существующего профиля, возвращает новые домены.
- `cast_set_sites(name, sites[])` и `cast_remove(name)`; `remove` удаляет запись и папку профиля.
- Проксированные `browser_*` с обязательным `profile`.
- Ошибки `RegistryError` отдавать текстом с `isError: true`.

### src/cli.ts
`list --brief` печатает компактный блок для контекста, если профили есть, иначе ничего. Пример:
```
cast: browser users available (open with cast_open / browser_* tools with profile=<name>):
- Sam (local) sam@email.com — sender. Sites: localhost:3000, outlook.office.com
- sender (project) — NOT set up on this machine: ask the user to run /cast:add sender
```

### Скиллы
- `add`, `login`, `list`, `remove` — тонкие инструкции Claude. `add`: разобрать `$ARGUMENTS`; если нет email или описания, одним коротким вопросом спросить оба (можно пропустить); сказать человеку, что сейчас откроется окно; вызвать `cast_add`; показать домены и спросить, какие оставить; вызвать `cast_set_sites`.
- `cast` (вызывается моделью):
  - выбор профиля по имени и описанию;
  - сценарий на двух людях: открыть оба, действие в одном, проверка в другом, в том числе в почте;
  - диалоги через `browser_handle_dialog`;
  - сессия протухла → не входить, попросить `/cast:login <имя>`;
  - никогда не вводить пароли и не вызывать `cast_add`/`cast_login` по своей инициативе;
  - закрывать профили в конце (`cast_close`).

## Проверка
- `npm test`, то есть `tsc` и `node --test`.
  - **unit:** слияние уровней и приоритет, заполнение project-слота, поиск без учёта регистра, валидация имени, стабильность project-id, права 0700 на папке профиля.
  - **интеграция** (`CAST_TEST_HEADLESS=1`, реальный Chrome): локальный http-сервер с `/login?user=X` (ставит cookie с Max-Age) и кнопкой `confirm()` (готовый пример — в разделе «Итоги проверки»):
    - `openLoginWindow` собирает домены и завершается по закрытию окна;
    - шлюз открывает два профиля одновременно, у каждого свой пользователь;
    - `confirm()` решается через `browser_handle_dialog`;
    - после close и open вход сохраняется;
    - вывод `cast_list` и `browser_*` не содержит значения cookie.
- `claude plugin validate --strict .`
- **Ручной e2e:**
  1. `claude --plugin-dir .` → `/cast:add Sam`, `/cast:add Elon` на локальной тестовой странице.
  2. Перезапуск Claude Code, затем «проверь, что Elon видит сообщение Sam»: оба окна открываются залогиненными.
  3. Удалить cookie у Sam: Claude просит `/cast:login Sam`.

## Отложено (этап улучшений, обсудить в конце)
- Один профиль в двух сессиях Claude: lock и сообщение «Sam уже открыт в другой сессии Claude». Сейчас Chrome просто откажется открыть занятую папку, эту ошибку надо хотя бы понятно передать.
- Автоопределение входа и протухания (правило по URL или селектору), `/cast:check`, профиль `clean` для тестов регистрации.
- macOS и Windows, headless как опция, TOTP через keychain, запись видео или GIF, публикация в npm (`@netmate/cast`) и в каталог Anthropic.
