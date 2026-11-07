# Поиск по AST-индексу для DSH

[English](<README.md>) · [Основной проект ast-index](https://github.com/defendend/Claude-ast-index-search)

Нативный DSH/Cordis bundle для **[ast-index автора defendend](https://github.com/defendend/Claude-ast-index-search)**. Поиск и индексацию выполняет оригинальный Rust CLI; этот репозиторий добавляет ограниченный инструмент `ast_index` для агента DSH.

**Поисковый движок — работа основного проекта.** Это независимая интеграция, не официальный релиз ast-index или DSH. Rust-код, бинарники, Claude hooks и upstream skills не включены. См. [атрибуцию](<THIRD_PARTY_NOTICES.md>) и [MIT-лицензию](<LICENSE>).

## Требования и установка

- DSH 0.2.2-rc.1 или совместимая 0.2.x; проверена 0.2.2-rc.1.
- Отдельно установленный ast-index **3.56.0**, доступный PATH процесса DSH.
- POSIX/Bash/`env`: проверена macOS, для Linux предусмотрен CI; native Windows/PowerShell этим релизом не поддерживается.
- Для разработки — Bun 1.4.4; Node 26.7.0 оставлен для проверки совместимости. Для загрузки плагина отдельный Bun не нужен.

Сначала установите CLI по [инструкции основного проекта](https://github.com/defendend/Claude-ast-index-search#installation). При наличии Rust toolchain можно использовать:

```bash
cargo install ast-index --version 3.56.0 --locked
ast-index --version
git clone https://github.com/pnpwin/dsh-ast-index.git
```

Клонируйте в постоянный каталог. Попросите агента DSH установить bundle из абсолютного пути к этому каталогу штатным `plugin_manager install_bundle` и проверить поиск символа. Пример вызова инструмента агента:

```json
{"action":"install_bundle","target":"/absolute/path/to/dsh-ast-index"}
```

Замените пример реальным абсолютным путём. Изменения действуют на весь текущий профиль DSH. Локальный каталог устанавливается как link: не перемещайте его после установки. Архив bundle также доступен в [GitHub Releases](https://github.com/pnpwin/dsh-ast-index/releases). В npm пакет не публиковался.

Если установлен предыдущий локальный прототип или другой плагин с инструментом `ast_index`, сначала отключите его в DSH Plugins: две регистрации имени могут конфликтовать.

В [patch](<cordis.patch.yml>) используется переносимое `executable: ast-index`. Если DSH Desktop не видит PATH терминала, перед установкой укажите здесь абсолютный путь, возвращённый `command -v ast-index`. Настройку уже установленного плагина меняйте штатными механизмами DSH, не переписывая профиль из кода плагина.

## Использование

```json
{"action":"symbol","query":"PaymentService","content":true}
{"action":"outline","query":"src/payments.ts","project":"my-app"}
{"action":"refs","query":"PaymentService","inFile":"src/","limit":10}
{"action":"explore","query":"payment retry","limit":3}
```

Также доступны `search`, `implementations`, `map`, `stats`. `project` — внутри workspace сеанса, по умолчанию текущий каталог. `limit` — 1–50 на секцию, default 10; explore — не более 6 файлов. `maxChars` — 500–24000, default 6000 символов плюс короткий заголовок. Усечение явно обозначено.

AST полезен для неизвестной структуры, определений и границ функций. Для строк/комментариев и точного текстового поиска используйте grep. Перед редактированием прочитайте актуальный исходник обычным read DSH, чтобы сохранить защиту от stale versions.

## Безопасность и ограничения

- Только перечисленные команды: нет SQL, произвольного shell, установки CLI, watchers или управления внешними roots.
- Политика sandbox и отмена передаются сервисам DSH. В read-only инструмент отказывает: cache требует записи.
- Перед запросом выполняется полный foreground rebuild: это обходит коллизию mtime-секунды + размер upstream, но добавляет CPU/I/O и задержку. При известных ошибках или reported failed subprojects нет выдачи старого результата.
- Отдельный cache `.dsh-ast-index` внутри workspace, GC отключён. При необходимости добавьте cache в gitignore сами; плагин этого не делает.
- CLI получает минимальное окружение без credentials/test hooks/DB/VCS overrides. Прогресс скрыт, но предупреждения и пропуски видимы.
- Это **не read-sandbox**: upstream roots/include/package symlinks могут читать внешние деревья. Используйте доверенные проекты. File cap не ограничивает абсолютно все сканеры upstream.
- Ссылки — кандидаты, не полный compiler-resolved call graph. Нулевой результат не доказывает отсутствия кода. Строки, динамические вызовы, неподдержанная конструкция, ignored/generated/minified файлы могут не попасть в ответ.
- Full rebuild и чтение body не являются атомарным snapshot при параллельных правках. Timeout subprocess — 110 секунд; на больших репозиториях ограничивайте project.
- Полная перестройка может быть медленнее grep. Универсальная экономия токенов не обещается. Методика: [evaluation](<docs/evaluation.md>).
- Bun используется для dev-тестов, а не для перевода всего DSH на Bun. Host выполняет переносимую JS-обёртку и вызывает Rust CLI; отдельный Node/Bun subprocess на каждый запрос не запускается.

## Структура исходников

Код плагина находится в `src/`: DSH загружает [src/index.js](<src/index.js>) через export package, реализация инструмента — в [src/runtime.js](<src/runtime.js>). В корне остаются документация, Git-метаданные и необходимые для обнаружения/отображения manifest, Loader patch и иконка. Каталоги `test/`, `locale/`, `scripts/`, `docs/` и `.github/` не перемещаются. Тесты и проверка архива запрещают появление исходников и лишних файлов в корне.

## Проверки и упаковка

Из source checkout, с установленным CLI:

```bash
bun run test
bun run test:node
bun run pack:check
bun run pack
```

Для другого CLI: `AST_INDEX_BIN=/absolute/path/to/ast-index bun run test`. Реальный CLI-тест при отсутствии бинарника падает, а не пропускается. Runtime npm-зависимостей и lifecycle/install scripts нет. `pack` создаёт архив в `dist/`; tests/CI/dev scripts доступны в исходном GitHub-репозитории и не нужны установленному runtime.

## Отключение и обновление

DSH Plugins → `@pnpwin/dsh-ast-index` → disable/remove. Исходники и cache при этом не удаляются. Замена загруженного JS runtime может потребовать перезапуска; ориентируйтесь на ответ менеджера.

CLI/parser issues — в [основной проект](https://github.com/defendend/Claude-ast-index-search/issues), проблемы DSH-интеграции — [сюда](https://github.com/pnpwin/dsh-ast-index/issues).
