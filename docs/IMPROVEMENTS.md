# Koktem Park Hotel — отчёт об обновлении от 25 ноября 2026

В существующий Angular/Django/SQLite проект добавлены личные кабинеты, избранное, подтверждённые отзывы, аудит и уведомления. Исправлена доступность номеров в dashboard. Работа выполнена в текущем репозитории с сохранением существующего клиентского сайта, платежей и административных операций.

**Анализ и исходные проверки**

Git status перед изменениями был чистым. Изучены модели, миграции 0001–0005, SQLite triggers, публичные и административные serializers/views/services/permissions/URLs, Angular routes, guards, HttpClient, session/CSRF, формы отзывов, платежи, словари EN/RU/KK и существующие тесты.

До изменений прошли 91 Django-тест, 48 Angular-тестов и Angular production build. Уже работали поиск, календарь доступности, бронирования, платежи card/prepayment/cash, отзывы, модерация, отчёты и переключение трёх языков. Отсутствовали профиль, избранное, история административных действий и уведомления. Отзывы допускались без проживания. Dashboard исключал из доступных только заселённые комнаты.

**Исправления и поведение**

- Отзыв создаётся только авторизованным владельцем завершённого бронирования этой комнаты. Связь с Booking уникальна. Разные завершённые проживания в одной комнате позволяют оставить отдельные отзывы. Автор и Verified Stay определяются сервером. Подмена booking при редактировании игнорируется.
- Старые отзывы сохранены с пустым booking. Они не получают Verified Stay автоматически. Скрытые отзывы исключены из публичной выдачи и рейтинга.
- Dashboard учитывает интервалы выбранного дня, рабочий статус комнаты и фактическое заселение. Pending сохраняет существующее блокирующее поведение. Checkout исключён из забронированных ночей. Фактически заселённая комната блокируется до операции checkout, включая просроченный выезд.
- Добавлены Reserved Rooms и Out of Service Rooms. Available исключает объединение заблокированных и фактически заселённых комнат. В каждой метрике комнаты считаются по уникальному ID.
- Hotel Date возвращается backend через timezone.localdate() в Asia/Almaty. Dashboard и front desk обновляются раз в минуту. Dashboard перечитывается при открытии и после выбора даты.
- При административной отмене применяется общая логика отмены с обновлением платежей. Существующая формула выручки и отсутствие двойного счёта сохранены.
- Платежи поддерживают Idempotency-Key. Повтор запроса с тем же ключом, пользователем и маршрутом возвращает сохранённый результат. Формы гостя и администратора передают ключ попытки. Отклонённая симулированная оплата сохраняет failed-запись и уведомление.
- Общий профиль гостя и администратора содержит имя/фамилию из User, телефон, фото и язык из UserProfile. Email доступен только для чтения. Изменение permissions через профиль невозможно.
- Фото до 5 MB проверяется декодером Pillow и повторно кодируется в JPEG/PNG/WebP. Дополнительно действует предел 25 мегапикселей. При замене и удалении старый файл удаляется после commit. Есть preview и общий стандартный аватар.
- Security проверяет текущий пароль, подтверждение и Django password validators. Текущая сессия сохраняется с update_session_auth_hash. Остальные сессии теряют доступ при следующем обращении.
- Избранное хранится в SQLite. Повторное добавление идемпотентно. Доступ ограничен текущим пользователем.
- My Bookings переиспользует прежний компонент с категориями All/Upcoming/Current/Completed/Cancelled. Завершённые бронирования ведут к созданию или редактированию отзыва.
- My Reviews показывает собственные отзывы, модерацию и завершённые проживания без отзыва. Payments показывает собственные платежи, статус, номер комнаты и остатки к оплате.
- Preferences использует прежние словари и механизм языка. Язык профиля восстанавливается после входа. Переключение языка в клиентском header сохраняется в профиле авторизованного пользователя. Анонимное переключение сохраняется в браузере.
- Activity Log доступен по hotel.view_auditlog и только для чтения. Есть поиск, фильтры, даты, сортировка от новых к старым и страницы по 25 записей.
- Уведомления сохраняются вместе с операциями в одной транзакции. Уникальный event_key предотвращает повтор события при неизменном статусе. Получатели административных событий выбираются по Django permissions. Список и отметки прочтения ограничены владельцем.
- Колокольчик обновляет данные после успешных записывающих запросов и каждые 30 секунд. Полная история уведомлений имеет страницы по 25 записей. Даты отображаются в Asia/Almaty. Ссылки уведомлений содержат fragment для соответствующей брони, платежа или отзыва.
- Поля ввода и основные сообщения новых страниц переведены на EN/RU/KK через существующую i18n-функцию. Accept-Language и LocaleMiddleware локализуют стандартные сообщения Django/DRF.

**Модели, relationships и constraints**

| Модель | Изменение и целостность |
|---|---|
| Review | Nullable OneToOneField к Booking с PROTECT. Старое ограничение room/user заменено уникальностью booking. clean() проверяет владельца, комнату и checked_out. Существующий check rating 1–5 сохранён. |
| UserProfile | OneToOneField к существующему User, CASCADE. Phone, photo, preferred_language, timestamps. Имена/email остаются в User. Для прежних пользователей профиль создаётся при первом обращении. |
| Favorite | ForeignKey к User и Room с CASCADE, created_at. UniqueConstraint(user, room). |
| AuditLog | Administrator с SET_NULL, action, entity_type, entity_id, description, timestamp. Ссылка на сущность хранится как ID и тип, поэтому удаление сущности сохраняет аудит. Только view permission. |
| Notification | Recipient с CASCADE, translation key, параметры, безопасный внутренний путь, read flag, timestamp. UniqueConstraint(recipient, event_key), индекс по recipient/read/date. |
| PaymentReceipt | User с CASCADE, ключ попытки, маршрут, безопасный сериализованный ответ, HTTP status, timestamp. UniqueConstraint(user, key, path). Данные карты и пароль в receipt не попадают. |

Применены новые миграции `0006_auditlog_favorite_notification_userprofile_and_more` и `0007_paymentreceipt`. Старые миграции не изменялись. Таблица Booking не пересоздавалась.

Сохранены triggers `hotel_booking_no_overlap_insert`, `hotel_booking_no_overlap_update`, `hotel_payment_no_overpay_insert`, `hotel_payment_no_overpay_update`. Сохранены unique room_number, проверки отрицательных цен, дат бронирования, guest_count и PROTECT для истории бронирований.

**API**

Все account endpoints требуют существующую Django session. Все POST/PATCH/DELETE проходят CSRF. Базовый префикс — `/api/`.

| Методы и путь | Назначение |
|---|---|
| GET/PATCH account/profile/ | Собственный профиль и whitelist изменяемых полей |
| POST/DELETE account/profile/photo/ | Multipart photo / удаление фото |
| POST account/password/ | current_password, new_password, confirmation |
| GET account/favorites/ | Комнаты в избранном текущего пользователя |
| POST/DELETE account/favorites/{room_id}/ | Добавление/удаление |
| GET account/reviews/ | Свои отзывы и eligible bookings |
| PATCH/DELETE account/reviews/{review_id}/ | Редактирование/удаление собственного отзыва |
| GET account/payments/?status=... | Свои платежи и остатки по бронированиям |
| GET account/notifications/?page=... | Своя история и unread count |
| POST account/notifications/{id}/read/ | Отметка одного своего уведомления |
| POST account/notifications/read-all/ | Отметка всех своих уведомлений |
| GET hotel-date/ | Серверная дата и timezone |
| GET admin/activity/ | Аудит с q, administrator, action, start, end, page |
| DELETE admin/reviews/{id}/ | Удаление отзыва с view_review + delete_review |
| GET admin/dashboard/?date=YYYY-MM-DD | Доступность на дату и текущая дата отеля |

Изменён POST rooms/{id}/reviews/ — дополнительно требуется booking. GET того же пути возвращает eligible только для текущего пользователя. Публичные отзывы содержат verified_stay. Расширен admin/guests/{id}/ — profile, payments и reviews, причём платежи и отзывы выдаются только при соответствующих permissions.

Для гостевого pay и административного record payment используется заголовок Idempotency-Key. Одинаковый ключ предназначен для повтора той же операции. Для новой операции нужен новый ключ. В API остаются прежние 400/403/404/409/415/429/503 и 402 для отклонённой симулированной оплаты.

**Созданные важные файлы**

| Файл | Ответственность |
|---|---|
| backend/api/account_serializers.py | Whitelist профиля, password payload, собственные отзывы, сериализация общего профиля |
| backend/api/account_urls.py | Маршруты личного кабинета |
| backend/api/account_views.py | Профиль, безопасные фото, пароль, избранное, история отзывов/платежей, уведомления и audit pagination |
| backend/api/events.py | Контекст администратора, атомарность записывающих HTTP операций, сигналы аудита и уведомлений |
| backend/api/idempotency.py | Атомарная обработка ключа повторной оплаты |
| backend/api/test_expansion.py | 17 проверок новых правил и защиты данных |
| backend/hotel/migrations/0006_*.py | Новые модели и связь Review–Booking |
| backend/hotel/migrations/0007_paymentreceipt.py | Хранение результатов повторных платёжных запросов |
| frontend/src/app/core/member.ts | Типы и клиент API личного кабинета, общее состояние профиля |
| frontend/src/app/core/i18n-member.ts | Новые сообщения EN/RU/KK, дополнение прежних словарей |
| frontend/src/app/features/member/layout.ts | Единое меню кабинета и выход |
| frontend/src/app/features/member/member.routes.ts | Защищённые account routes с переиспользованием My Bookings |
| frontend/src/app/features/member/profile.ts | Общие формы Profile/Security/Preferences гостя и администратора |
| frontend/src/app/features/member/history.ts и history.html | Favorites/Reviews/Payments/Notifications |
| frontend/src/app/features/member/member.spec.ts | 8 Angular-проверок новых форм и интеграции |
| frontend/src/app/features/admin/activity.ts | Read-only аудит с фильтрами и pagination |
| frontend/src/app/shared/avatar.ts | Общий аватар и fallback |
| frontend/src/app/shared/favorite.ts | Кнопка избранного с серверным сохранением |
| frontend/src/app/shared/notifications.ts | Колокольчик, polling и отметки прочтения |

**Изменённые важные файлы**

| Файлы | Что изменено |
|---|---|
| backend/hotel/models.py, apps.py, admin.py | Новые модели/constraints, регистрация сигналов, readonly аудит в Django Admin |
| backend/config/settings.py | EventContextMiddleware, LocaleMiddleware и разрешение Idempotency-Key/Accept-Language в CORS |
| backend/api/services.py | Verified review creation; платежные изменения через save(), чтобы создавать события |
| backend/api/serializers.py | Booking ID для отзыва и вычисляемый Verified Stay |
| backend/api/views.py, urls.py | Eligibility и подключение account/date/activity маршрутов |
| backend/api/management_stats.py | Доступность на дату, уникальные reserved и out-of-service rooms |
| backend/api/management_views.py, management_urls.py | Выбор даты, guest detail, delete review, единая отмена и idempotent record payment |
| backend/api/management_permissions.py | View audit и delete review capabilities |
| backend/api/test_reviews.py | Ожидания старого режима без проживания заменены новыми правилами; публичные рейтинги и модерация сохранены |
| frontend/src/app/core/api.ts | Новые типы отзывов, ключ оплаты, событие успешных изменений, опциональный build define HOTEL_API_URL для изолированной QA |
| frontend/src/app/core/auth.ts | Разрешён безопасный returnUrl в account routes |
| frontend/src/app/core/i18n.ts | Дополнение существующих таблиц новыми ключами |
| frontend/src/app/app.routes.ts, app.ts | Подключение account area; переход к загруженной сущности по notification fragment |
| frontend/src/app/layouts/site.ts и site.html | Профиль/аватар, колокольчик, восстановление языка и сохранение переключения языка |
| frontend/src/app/shared/room-card.ts | Кнопка избранного |
| frontend/src/app/shared/feedback-form.ts | Eligible completed bookings и выбор проживания |
| frontend/src/app/shared/language-switcher.ts | Событие выбора языка для сохранения в профиле |
| frontend/src/app/features/room-detail.ts и room-detail.html | Избранное, eligibility и Verified Stay |
| frontend/src/app/features/bookings.ts и bookings.html | Категории и переход к отзывам |
| frontend/src/app/features/payment.ts | Ключ одной попытки оплаты |
| frontend/src/app/features/admin/admin-api.ts | Типы профиля гостя, audit capabilities и dashboard date |
| frontend/src/app/features/admin/admin-layout.ts, admin.routes.ts | Профиль администратора, уведомления, audit navigation и routes |
| frontend/src/app/features/admin/admin-overview.ts | Метрики, выбор даты и polling |
| frontend/src/app/features/admin/admin-desk.ts, admin-reservations.ts | Повторное чтение серверной даты, polling front desk и payment receipt key |
| frontend/src/app/features/admin/admin-guests.ts | Фото, телефон, дата регистрации, платежи и отзывы гостя |
| frontend/src/app/features/admin/admin-reviews.ts | Permission-controlled удаление с подтверждением |
| frontend/src/app/features/admin/admin.spec.ts, features/customer.spec.ts, shared/feedback-form.spec.ts | Регрессионные fixtures и ожидания нового поведения |
| frontend/src/styles.scss | Responsive account layout, avatar, favorites, notification dropdown |
| .gitignore | Локальные backup-файлы исключены из Git |
| README.md, backend/API.md | Запуск, новые возможности, маршруты и ограничения |

**Распределение по ролям команды**

| Роль | Файлы и результат |
|---|---|
| Systems Analysis & Requirements | docs/IMPROVEMENTS.md, README.md, backend/API.md. Исходный анализ, правила, API-контракты, сценарии ручной проверки и ограничения. |
| Data & Database | backend/hotel/models.py; migrations/0006_*.py и 0007_paymentreceipt.py; account_views.py; management_stats.py; services.py; events.py; idempotency.py; test_expansion.py; test_reviews.py. Добавлены 5 моделей и OneToOne Review–Booking, unique constraints и notification index. ORM-запросы ограничены владельцем; статистика использует интервалы и distinct room IDs. Связанные записи, аудит, уведомления и receipts создаются в transactions. Старые triggers проверены и сохранены. Тесты проверяют FK/уникальность/ownership/платежи/сохранение истории; реальная SQLite проверена по snapshot, integrity_check и foreign_key_check. |
| Application & Development | frontend/features/member/*, core/member.ts, shared/avatar.ts, favorite.ts, notifications.ts; account_views/serializers/urls; изменения customer/admin компонентов. Реальные формы и история из Django. |
| Architecture & Security | events.py, idempotency.py, management_permissions.py, account serializers/views, settings.py, core/auth.ts, member routes. CSRF, sessions, object ownership, password hashing, upload validation, permissions, readonly audit. |
| Testing | backend/api/test_expansion.py, test_reviews.py; frontend/features/member/member.spec.ts и обновлённые customer/admin/feedback specs. Автоматические и браузерные проверки. |
| Analytics & Integration | management_stats.py, admin-overview.ts, admin-desk.ts, admin-reservations.ts, admin-api.ts, core/api.ts, backend/API.md. Метрики реальной SQLite, hotel date, polling и повторные платёжные запросы. |

**Сохранение данных и резервная копия**

Перед миграциями через SQLite backup API создана локальная копия `backend/backups/before-expansion-20261125-203635.sqlite3` и snapshot исходных строк. Каталог исключён из Git.

| Таблица | До | После |
|---|---|---|
| auth_user | 3 | 3 |
| hotel_room | 9 | 9 |
| hotel_booking | 4 | 4 |
| hotel_review | 1 | 1 |
| hotel_payment | 2 | 2 |

Все исходные строки и значения прежних столбцов сравнены и совпали. Допускается только расширение схемы и запись применённых миграций/новых permissions. SQLite integrity_check вернул ok, foreign_key_check не нашёл нарушений.

**Результаты проверки**

Итоговый backend suite — 100 тестов. Итоговый frontend suite — 56 тестов в 10 файлах. Angular production build завершён успешно. Django check не выявил проблем; makemigrations --check --dry-run не выявил изменений без миграций.

Браузерные проверки выполнены на временной копии SQLite, отдельных тестовых аккаунтах, frontend 4201 и backend 8001, поскольку в окружении уже был запущен другой backend на 8000. Проверены вход, профиль после reload, сохранённое избранное, отзыв завершённого проживания с Verified Stay, сохранение языка, уведомления, dashboard, audit после добавления комнаты и mobile profile без горизонтальной прокрутки. Изменения из QA не попадали в исходную базу.

**Запуск**

В первом PowerShell-терминале из корня проекта:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py runserver
```

Во втором:

```powershell
cd frontend
npm.cmd ci
npm.cmd start
```

Клиентский сайт — http://localhost:4200/. Кабинет — /account/profile. Администратор — /admin/login. Django Admin — http://localhost:8000/admin/.

Первый администратор создаётся командой `manage.py createsuperuser` с уникальным email. Для существующего staff account назначьте необходимые hotel permissions. Для Activity Log требуется `hotel.view_auditlog`. Профиль не позволяет изменять роли.

**Ручная проверка**

1. Войти обычным гостем, открыть My Profile, изменить имя и телефон, сохранить и перезагрузить страницу.
2. Загрузить JPEG/PNG/WebP до 5 MB, проверить preview, сохранить, заменить и удалить фото. Отправить текстовый файл как .jpg и проверить отказ.
3. В Preferences выбрать RU или KK, выйти и войти повторно. Убедиться в восстановлении выбранного языка. Анонимно проверить переключатель языка.
4. Сохранить комнату сердечком. Проверить Favorites после reload и повторного входа; убрать сердечко.
5. Открыть комнату без завершённого проживания. Форма отзыва недоступна. Для тестового завершённого бронирования открыть My Reviews, выбрать Write a Review, отправить отзыв, увидеть Verified Stay.
6. Повторить POST для того же booking, проверить отказ. С другого аккаунта проверить отказ редактирования и удаления. Владелец может изменить или удалить собственный отзыв.
7. Администратором скрыть отзыв, проверить исчезновение из публичного списка и рейтинга, затем восстановить. Удаление доступно только с delete_review и подтверждением.
8. Проверить собственные Payments, фильтр статусов и остатки к оплате. Платежи другого пользователя недоступны. Для повторной HTTP попытки оплаты использовать одинаковый Idempotency-Key.
9. Создать бронь на сегодня, затем открыть dashboard. Available уменьшается, Reserved увеличивается. Проверить будущую дату, отмену, maintenance и checkout.
10. Создать/изменить номер и перейти в Activity Log. Проверить администратора, поиск, даты и страницы. Гость получает отказ в API аудита.
11. Проверить Guest Details у staff с view_user/view_booking, затем наличие payment/review sections согласно permissions.
12. Создать или отменить тестовую бронь, подтвердить её администратором, выполнить check-in/out с корректными датами. Проверить новые уведомления, unread count, read/read-all и ссылку на историю.
13. На тестовом аккаунте сменить пароль. Текущая сессия сохраняется, другая сессия теряет доступ. Проверить неверный текущий пароль и несовпадающее подтверждение.
14. Повторить поиск/фильтры, календарь, создание и отмену брони, платежи card/prepayment/cash, contact form, room CRUD и отчёты.

Для ручных операций с бронированиями и платежами рекомендуется использовать отдельные тестовые аккаунты и копию SQLite.

**Принятые решения и ограничения**

- Старые отзывы остаются неподтверждёнными, поскольку доказанная связь с Booking отсутствует.
- Фактическая текущая заселённость имеет приоритет над запланированным checkout. Историческое физическое присутствие не восстанавливается без отдельного журнала проживаний. Выбранная дата фильтрует запланированные бронирования.
- Сохраняется прежняя модель операционной выручки и текущего inventory denominator в отчётах. Платежи остаются симулированными.
- Уведомления создаются для новых событий после установки, без ретроспективной рассылки по старым данным. События прямых SQL/QuerySet.update обходят Django signals; серверные операции заменены на save() там, где нужны события.
- Idempotency-Key обеспечивает повтор одной HTTP операции. Новый ключ означает новую попытку; сохраняются проверки остатка и SQL-защита от переплаты.
- SQLite остаётся базой с одним writer. При конкуренции API может вернуть 503; безопасный повтор оплаты использует прежний ключ.
- Поддерживаются существующие EN/RU/KK. Произвольный пользовательский текст отзывов, описания номеров и технические коды сущностей не переводятся автоматически. Неизвестные backend validation messages сохраняют исходный текст.
- Безопасное изменение email с подтверждением не добавлялось; email в профиле read-only.
- Обновление не создаёт commit или push. Развёртывание не выполнялось.


**Полный реестр созданных и изменённых файлов**

| Файл | Изменение | Основная роль |
|---|---|---|
| .gitignore | Изменён | Application & Development |
| README.md | Изменён | Systems Analysis & Requirements |
| backend/API.md | Изменён | Systems Analysis & Requirements |
| backend/api/account_serializers.py | Создан | Application & Development |
| backend/api/account_urls.py | Создан | Application & Development |
| backend/api/account_views.py | Создан | Data & Database; Architecture & Security |
| backend/api/events.py | Создан | Data & Database; Architecture & Security |
| backend/api/idempotency.py | Создан | Data & Database; Architecture & Security |
| backend/api/management_permissions.py | Изменён | Architecture & Security |
| backend/api/management_stats.py | Изменён | Analytics & Integration |
| backend/api/management_urls.py | Изменён | Application & Development |
| backend/api/management_views.py | Изменён | Application & Development |
| backend/api/serializers.py | Изменён | Application & Development |
| backend/api/services.py | Изменён | Data & Database; Architecture & Security |
| backend/api/test_expansion.py | Создан | Testing |
| backend/api/test_reviews.py | Изменён | Testing |
| backend/api/urls.py | Изменён | Application & Development |
| backend/api/views.py | Изменён | Application & Development |
| backend/config/settings.py | Изменён | Architecture & Security |
| backend/hotel/admin.py | Изменён | Application & Development |
| backend/hotel/apps.py | Изменён | Data & Database |
| backend/hotel/migrations/0006_auditlog_favorite_notification_userprofile_and_more.py | Создан | Data & Database |
| backend/hotel/migrations/0007_paymentreceipt.py | Создан | Data & Database |
| backend/hotel/models.py | Изменён | Data & Database |
| docs/IMPROVEMENTS.md | Создан | Systems Analysis & Requirements |
| frontend/src/app/app.routes.ts | Изменён | Application & Development |
| frontend/src/app/app.ts | Изменён | Application & Development |
| frontend/src/app/core/api.ts | Изменён | Analytics & Integration |
| frontend/src/app/core/auth.ts | Изменён | Architecture & Security |
| frontend/src/app/core/i18n-member.ts | Создан | Application & Development |
| frontend/src/app/core/i18n.ts | Изменён | Application & Development |
| frontend/src/app/core/member.ts | Создан | Application & Development |
| frontend/src/app/features/admin/activity.ts | Создан | Application & Development |
| frontend/src/app/features/admin/admin-api.ts | Изменён | Analytics & Integration |
| frontend/src/app/features/admin/admin-desk.ts | Изменён | Application & Development |
| frontend/src/app/features/admin/admin-guests.ts | Изменён | Application & Development |
| frontend/src/app/features/admin/admin-layout.ts | Изменён | Application & Development |
| frontend/src/app/features/admin/admin-overview.ts | Изменён | Analytics & Integration |
| frontend/src/app/features/admin/admin-payments.ts | Изменён | Application & Development |
| frontend/src/app/features/admin/admin-reservations.ts | Изменён | Application & Development |
| frontend/src/app/features/admin/admin-reviews.ts | Изменён | Application & Development |
| frontend/src/app/features/admin/admin.routes.ts | Изменён | Application & Development |
| frontend/src/app/features/admin/admin.spec.ts | Изменён | Testing |
| frontend/src/app/features/admin/reservation-table.ts | Изменён | Application & Development |
| frontend/src/app/features/bookings.html | Изменён | Application & Development |
| frontend/src/app/features/bookings.ts | Изменён | Application & Development |
| frontend/src/app/features/customer.spec.ts | Изменён | Testing |
| frontend/src/app/features/member/history.html | Создан | Application & Development |
| frontend/src/app/features/member/history.ts | Создан | Application & Development |
| frontend/src/app/features/member/layout.ts | Создан | Application & Development |
| frontend/src/app/features/member/member.routes.ts | Создан | Application & Development |
| frontend/src/app/features/member/member.spec.ts | Создан | Testing |
| frontend/src/app/features/member/profile.ts | Создан | Application & Development |
| frontend/src/app/features/payment.ts | Изменён | Application & Development |
| frontend/src/app/features/room-detail.html | Изменён | Application & Development |
| frontend/src/app/features/room-detail.ts | Изменён | Application & Development |
| frontend/src/app/layouts/site.html | Изменён | Application & Development |
| frontend/src/app/layouts/site.ts | Изменён | Application & Development |
| frontend/src/app/shared/avatar.ts | Создан | Application & Development |
| frontend/src/app/shared/favorite.ts | Создан | Application & Development |
| frontend/src/app/shared/feedback-form.spec.ts | Изменён | Testing |
| frontend/src/app/shared/feedback-form.ts | Изменён | Application & Development |
| frontend/src/app/shared/language-switcher.ts | Изменён | Application & Development |
| frontend/src/app/shared/notifications.ts | Создан | Application & Development |
| frontend/src/app/shared/room-card.ts | Изменён | Application & Development |
| frontend/src/styles.scss | Изменён | Application & Development |
