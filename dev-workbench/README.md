# RED / Foundry v12 Workbench

Отдельная среда для разработки модулей Cyberpunk RED. Не переписывает Agent, нетраннинг и игровые данные. Подготовлено 29.09.2026.

## Запуск без домашнего компьютера

На GitHub выбери ветку `dev/foundry-workbench-20260929` в репозитории `Defaulter444/night-city-agent`, затем **Code → Codespaces → Create codespace**. Проверь ветку перед созданием. Личный Codespace создаётся в аккаунте GitHub; окончательное действие, авторизация и возможные расходы остаются под твоим контролем.

Конфигурация `.devcontainer/devcontainer.json` открывает `dev-workbench` и выполняет `node tools.mjs setup --ai --browser`. Скрипт устанавливает npm-зависимости, три CLI, два MCP-сервера и Chromium. Он НЕ входит в аккаунты, не покупает подписки, не создаёт Foundry-сервер и не сбрасывает лимиты.

Если настройка прервалась, открой терминал в `dev-workbench`, выполни `npm run setup`, затем `npm run doctor`.
Запусти `npm run dev`, открой **Ports → 5173**. Сохраняй порт **Private**, не Public.
Для режима без пакетов: `node tools.mjs serve`, порт **4173**.

## Запуск дома

Установи Git, Node.js 22.12+ и VS Code. Клонируй указанную ветку или распакуй комплект, открой папку `dev-workbench` в VS Code.

```sh
npm run setup
npm run doctor
npm run dev
```

Dev Container дополнительно требует Docker на домашней машине. При обычном запуске через Node Docker не нужен. На Linux для Chromium могут потребоваться системные библиотеки; `npx playwright install --with-deps chromium` устанавливает их с системными правами. Облачный контейнер выполняет этот этап при создании.

## Работа моделей

Из терминала **dev-workbench**:

```sh
npm run codex
npm run gemini
npm run claude
```

Первый вход завершаешь ты: ChatGPT / Google / Anthropic. Наличие CLI не равно подписке или доступу к конкретной модели. Не вставляй пароли, сессионные cookie или API-ключи в чат/репозиторий. Для Codex в headless-среде используй предложенный CLI device-login, если он доступен для аккаунта; для остальных следуй официальному входу. Модели выбираются в самом агенте: в конфигурацию не вшиты предположительные названия моделей.

`AGENTS.md`, `CLAUDE.md`, `GEMINI.md` задают границы работы. MCP-конфигурации используют локальный stdio, не внешний HTTP-порт. Подтверждение доверия проекту/MCP выполняет пользователь. Playwright включён в конфигурации Codex и Gemini. В Claude/VS Code доступны также Chrome DevTools; подключать оба одновременно необязательно. CLI запускай из `dev-workbench`, чтобы относительные пути MCP разрешались правильно. Chrome DevTools MCP официально поддерживает Chrome/Chrome for Testing; стенд по умолчанию передаёт ему Chromium Playwright, совместимость которого не гарантирована. Для поддерживаемого браузера установи Chrome отдельно и задай `FWB_CHROME_PATH` с полным путём. Интеграция MCP в этой поставке не запускалась.

## Что внутри

| Слой | Подготовлено |
|---|---|
| Редактор | Dev Container и задачи VS Code; Copilot — рекомендация расширения, не купленная подписка |
| Агенты | Установщик Codex, Gemini CLI, Claude Code; отдельных ключей в комплекте нет |
| Интерфейс | Vite, автономный HTML/CSS/WAAPI-стенд, Anime.js и Lucide в зависимостях |
| Проверка | ESLint, Node unit tests, Vitest, Playwright desktop/narrow, browser MCP |
| Репозитории | Безопасное клонирование пяти публичных репозиториев в `repos/` |
| Foundry | Статический аудит манифеста и интеграционный checklist; сам Foundry не включён |

```sh
npm run check
npm run repos
npm run audit:module -- ../
npm run audit:module -- repos/cpr-netrunning
```

Клонирование не исполняет скрипты из репозиториев и не изменяет уже существующие копии. `repos/` исключён из Git. Сначала прочитай инструкции конкретного модуля, затем создай в его копии отдельную рабочую ветку. Встроенные тесты проверяют стенд, а не все твои модули.

## Визуальные инструменты и дополнительные компоненты

**Penpot:** https://design.penpot.app — облачный редактор макетов. Открывай отдельно; аккаунт не создавался и платный тариф не включался. Экспорт SVG/PNG храни в своей папке дизайна, не в базе Foundry.

**Krita:** https://krita.org — настольный редактор графики. В headless Codespace графический Krita не установлен. Для рисования используй его дома; это не зависимость модулей.

**Copilot:** https://github.com/features/copilot — расширение VS Code можно поставить из рекомендаций; вход и доступный тариф определяются GitHub. Установка не покупает подписку.

**Sequencer:** https://foundryvtt.com/packages/sequencer — отдельный модуль для Canvas. Устанавливается только в лицензированный тестовый Foundry, строго в совместимой с v12 версии. Rive намеренно не включён: не нужен для этой среды.

## Версии, стоимость и безопасность

Версии основных npm-зависимостей ограничены совместимыми major/minor-диапазонами в package.json. При первой установке создаётся `package-lock.json`; повторная настройка использует `npm ci`. CLI/MCP при первой установке разрешаются из официальных npm-пакетов и фиксируются в `.tools/package-lock.json`; повторная настройка не обновляет их автоматически. Полностью воспроизводимая установка между разными машинами требует сохранить и проверить оба lockfile — они ещё не созданы в этой подготовке.

Ни подписки, ни платный API не подключались. У Codespaces есть квоты вычислений и хранения; сверяй тариф/бюджет в GitHub Billing и останавливай среду после работы. Остановленная среда всё ещё занимает хранилище. Удаление Codespace удаляет незапушенные файлы, поэтому сначала сохрани изменения. Не запускай ненужные агенты постоянно.

Для облегчения первоначальной установки автоматический `npm audit` отключён; перед рабочим использованием выполни `npm audit` и `npm --prefix .tools audit`, оцени уязвимости. Не применяй `audit fix --force` без проверки.

**Лимиты ChatGPT/Claude/Gemini эта среда не меняет.** Расширения, MCP и клонирование репозиториев не обходят квоты.

## Проверка этой поставки

Смотри `VERIFICATION.md`. Проверки в контейнере подготовки и запуск реального Codespace — разные этапы. Если тест не выполнялся, он не отмечен пройденным.

## Основные источники

- Codex CLI: https://developers.openai.com/codex/cli
- Gemini CLI: https://geminicli.com/docs/get-started/installation/
- Claude Code: https://code.claude.com/docs/en/setup
- Playwright MCP: https://github.com/microsoft/playwright-mcp
- Chrome DevTools MCP: https://github.com/ChromeDevTools/chrome-devtools-mcp
- Dev Containers: https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/adding-a-dev-container-configuration/introduction-to-dev-containers
- Codespaces billing: https://docs.github.com/en/billing/concepts/product-billing/github-codespaces
- Foundry v12 API: https://foundryvtt.com/api/v12/
