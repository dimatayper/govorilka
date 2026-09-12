# Локальный запуск Govorilka

Адрес: http://localhost:8080

`http://127.0.0.1:8080` автоматически перенаправляется на `localhost`, чтобы страница и API использовали один origin. Локальное правило находится в `Caddyfile.local`.

Из каталога `deploy/self-hosting`:

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 api app-proxy gateway
```

Файл `.env` содержит локальные секреты и выбор Compose-файлов, исключён из Git.
`docker-compose.local.yml` собирает API, worker, веб-клиент, админку и статику из текущих исходников. Остальные сервисы используют образы основного Compose.

Остановка с сохранением данных:

```sh
docker compose down
```

Для проверки интерфейса создайте аккаунт через форму регистрации. Отправка почты и CAPTCHA отключены в локальной конфигурации.
