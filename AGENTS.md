# AGENTS.md — klenwriter-editor

- Repo: `github.com/artemklen/klenwriter-editor`, default `main`; для эпика OPS-625 ветка `ops-625`.
- Локальный pre-send gate и точные команды: [CONTRIBUTING.md](CONTRIBUTING.md), разделы «Чистая сборка» и «Локальный pre-send gate (OPS-625)». Выполнять на exact SHA и записывать команды/результаты/окружение.
- CI (`.github/workflows/spike.yml`) — build-only: `npm ci --ignore-scripts` и `npm run build`. Rust/npm/Playwright/check tests в CI не запускаются.
- Недоступное локальное окружение — blocker в Linear, не silent skip и не возврат тестов в CI.
- Тесты и assertions не удалять и не ослаблять; новых тестов ради галочки не добавлять.
- Push/PR после локальной проверки; merge — только после независимого exact-SHA review.
