# Handoff: FlightFinder Design System

## Overview

Дизайн-система для FlightFinder — продукта поиска авиарейсов с фильтрацией по типу самолёта, бортовому номеру и оператору. Пакет содержит токены (цвета, типографика, радиусы, тени), брендинг (логотип E «Arc + Plane»), web UI Kit и набор флагманских компонентов (boarding pass, route map, price calendar, iconography).

## About the Design Files

Файлы в этом бандле — **дизайн-референсы в HTML**. Это прототипы, показывающие желаемый внешний вид и поведение, **не production-код для копирования напрямую**. Задача — воссоздать эти дизайны в существующем кодбейсе FlightFinder (React + Vite, CSS Modules / plain CSS), используя его устоявшиеся паттерны и компоненты. CSS-токены в `colors_and_type.css` совместимы с `client/src/index.css` существующего проекта и могут быть перенесены как есть.

## Fidelity

**High-fidelity (hifi)** — финальные цвета, типографика, отступы и взаимодействия. Разработчик должен воспроизвести UI пиксель-в-пиксель в существующих компонентах React-проекта.

## Design Tokens

Перенести в `client/src/index.css` (или подключить `colors_and_type.css` целиком).

### Цвета
- **Primary (indigo)**: `--primary: #6366f1`, `--primary-dark: #4f46e5`, `--primary-light: #eef2ff`, `--primary-ring: rgba(99,102,241,0.18)`
- **Navy (chrome)**: `--navy: #0c1427`, `--navy-2: #152040`
- **Surfaces**: `--bg: #f8fafc`, `--card: #ffffff`, `--border: #e2e8f0`, `--border-light: #f1f5f9`
- **Text**: `--text: #0f172a`, `--text-2: #475569`, `--text-3: #94a3b8`
- **Semantic**: green `#10b981`, orange `#f59e0b`, red `#ef4444` (+ соответствующие `-bg` фоны)
- **Safety severity**: `--sev-fatal` (red), `--sev-hull` (orange), `--sev-incident` (text-3)

### Типографика
- **UI / headings**: `Geist` (через Google Fonts, weights 400/500/600/700) — fallback `system-ui`
- **Mono (IATA, цены, eyebrows)**: `Geist Mono` (400/500/600)
- **Editorial display**: `Newsreader` (italic для редакционных моментов)
- Все три семейства поддерживают кириллицу — русская версия выглядит так же чисто
- Headings используют `--font-ui` (sans), не serif. Newsreader — opt-in через `.display-serif`

### Радиусы
`--r-sm: 6px`, `--r: 10px`, `--r-lg: 14px`, `--r-xl: 20px`, `--r-pill: 999px`

### Тени
`--shadow-sm`, `--shadow`, `--shadow-md`, `--shadow-lg` — стандартный Tailwind-стиль (см. `colors_and_type.css`).

### Spacing
4-px шаг: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64.

## Brand

- **Логотип** — вариант E «Arc + Plane»: пунктирная маршрутная дуга (`#0c1427`) с двумя точками-узлами и индиговым (`#6366f1`) силуэтом самолёта top-view в апогее.
- **Использование**:
  - На светлых фонах — основной знак (`assets/logo/mark-arc.svg`)
  - На тёмных фонах (navy header) — **знак не используется**, только вордмарк «Flight Finder» (Geist 600, второе слово — 400 с opacity 0.7)
  - Фавикон — `assets/logo/favicon.svg` (32×32, navy подложка, белая дуга, индиговый самолёт)
  - Горизонтальный лок-ап — `assets/logo/lockup-horizontal.svg`
- **Название**: пишем раздельно — «Flight Finder» (старое слитное «FlightFinder» в коде допустимо в идентификаторах).

## Components

### Site Header
Sticky navbar на navy (`--navy`), padding 12px 24px, gap между nav items 24px. Слева — wordmark «Flight Finder». Справа — Sign in pill (rgba(255,255,255,0.06), border 1px rgba(255,255,255,0.1), radius `--r`).

### Search Form
Hero-блок с табами (One-way / Round trip / Multi-city) — pill-чипы 8×16, radius `--r-pill`. Под ним строка из 4 полей: From, To, Date, Passengers. Каждое поле `min-height: 44px`, white card, radius `--r`. CTA «Search flights» — primary indigo, 13px 20px, radius `--r`, min-height 44px.

### Flight Card
Белая карточка radius `--r-lg`, padding 20px 24px, shadow `--shadow-sm`. Структура: airline logo + name (слева), times + IATA codes (центр, IATA — `--font-mono` 28px), price (справа, 28px 700). На hover — `--shadow-md`.

### Filter Chips
Inline-flex с gap 8px, padding 6px 12px, radius 18px, border 1px `--border`. min-height 36px. Active state — фон `--primary-light`, color `--primary-dark`, border `--primary`.

### Boarding Pass (флагман)
Скевоморфный тикет, grid 1fr auto 280px:
- **Main** — IATA-коды 44px Geist, маршрутная дуга между ними (индиго), 6 meta-ячеек (passenger / flight / date / gate / boarding / seat)
- **Perforation** — настоящие выемки сверху/снизу (radial-gradient + ::before/::after), pseudo-stitching между ними
- **Stub** — фон `--bg`, мини-IATA + стрелка, штрих-код (48 баров псевдослучайной ширины 1–4px, высота 56px), PNR в моно
- Файл: `ui_kits/web/BoardingPass.jsx` + `BoardingPass.css`

### Route Map
Leaflet + Carto dark tiles (`dark_nolabels` + `dark_only_labels` 35% opacity). Great-circle arcs (сферическая интерполяция, 80 сегментов) с тройной обводкой для glow-эффекта: glow `--primary` 12% (weight+6) → mid 22% (+3) → core `#a5b4fc` 95%. Hub-маркер — индиговая точка 14px с `box-shadow: 0 0 0 8px rgba(99,102,241,0.25), 0 0 24px rgba(99,102,241,0.6)`. Glass-overlay сверху-слева (backdrop-filter blur 8px). Файл: `preview/route-map.html`.

### Price Calendar
14-дневный bar chart под date picker'ом. Высота бара 25–100% по дельте `(p - min) / (max - min)`. Цветовые корзины через перцентили 33/67: low (green), mid (orange), high (red). Ribbon «↓ Cheapest» поверх минимума. Клик → подсказка считает экономию vs cheapest. Файл: `preview/price-calendar.html`.

### Iconography
Inline SVG, **Lucide-style**: 24×24 grid, stroke 2px, round caps + joins, fill none, color `currentColor`. Никакой иконочной библиотеки — иконки прямо в JSX. Каталог из ~20 ключевых иконок: search, plane, map-pin, calendar, clock, filter, sort, user, bookmark, shield, eye, check, alert-circle, x, chevron-right, arrow-right, globe, sliders, heart, external-link. Файл: `preview/iconography.html`.

## Files

```
design_handoff_flightfinder/
├── README.md                          ← this file
├── colors_and_type.css                ← all design tokens
├── assets/
│   └── logo/
│       ├── mark-arc.svg               ← primary mark (light bg only)
│       ├── favicon.svg                ← 32×32 favicon
│       └── lockup-horizontal.svg      ← horizontal lockup
├── ui_kits/web/
│   ├── styles.css                     ← component styles
│   ├── index.html                     ← live kit page
│   ├── SiteHeader.jsx
│   ├── SiteFooter.jsx
│   ├── SearchForm.jsx
│   ├── FlightCard.jsx
│   ├── FilterChip.jsx
│   ├── BoardingPass.jsx               ← boarding pass component
│   ├── BoardingPass.css
│   └── Primitives.jsx
└── preview/
    ├── boarding-pass.html
    ├── route-map.html
    ├── price-calendar.html
    └── iconography.html
```

## Implementation Notes

- Кодбейс FlightFinder уже использует CSS custom properties в `client/src/index.css`. Большинство токенов в `colors_and_type.css` уже там — главное обновить:
  - `--font-display` → `'Newsreader'`
  - `--font-ui` → `'Geist'`
  - `--font-mono` → `'Geist Mono'`
  - Добавить `@import` Google Fonts в `index.css`
- Логотип в `SiteHeader.jsx` — текущий векторный самолёт нужно **убрать** (на navy он теряется), оставить только wordmark.
- Knob: индиго `--primary` или navy для primary CTA? В этой системе primary CTA = indigo, navy — для шапки/футера/гербовых поверхностей.
- Newsreader — opt-in класс `.display-serif`, не дефолт.
