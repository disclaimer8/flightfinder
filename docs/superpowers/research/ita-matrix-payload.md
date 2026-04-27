# ITA Matrix v5 — search payload research

Captured 2026-04-27 against `https://matrix.itasoftware.com/` ("Matrix v5", the current
public ITA Software flight search UI; "Matrix by Google"). Used Playwright MCP to drive a
real round-trip search (LIS→JFK, 2026-05-27 / 2026-06-03, 1 adult, COACH) and intercepted
the underlying XHR via a `XMLHttpRequest.prototype.open/send` hook.

## TL;DR — what changed vs. the spec assumption

The plan referenced `matrix.itasoftware.com/xhr/shop/search`. **That endpoint no longer
exists.** Matrix v5 calls a Google-hosted gRPC-style backend wrapped in a `gapi-batch`
multipart envelope:

- Outer: `POST https://content-alkalimatrix-pa.googleapis.com/batch?...`
  with `Content-Type: text/plain; charset=UTF-8` and a `multipart/mixed` body.
- Inner (single batch entry): `POST /v1/search?key=<API_KEY>&alt=json` carrying a
  JSON object (NOT an "array-in-form-field"). No URL-encoded form layer.

So our `itaMatrixService.js` will not POST to `matrix.itasoftware.com` at all — it must
POST to `content-alkalimatrix-pa.googleapis.com/batch` with a constructed multipart body.

Fixtures:
- Verbatim outer body: `server/src/__tests__/fixtures/ita-matrix-request.json` (`body` field).
- Verbatim outer response (multipart envelope) and pre-parsed inner JSON:
  `server/src/__tests__/fixtures/ita-matrix-response.json` (`raw_multipart_envelope` and
  `inner_json`).

## Endpoint

| Field          | Value                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| URL            | `https://content-alkalimatrix-pa.googleapis.com/batch?%24ct=multipart%2Fmixed%3B%20boundary%3D<boundary>`                              |
| HTTP method    | `POST`                                                                                                                               |
| Outer `Content-Type` | `text/plain; charset=UTF-8` (the `%24ct=...` query param is what tells the server it is multipart; the literal header is text/plain) |
| Inner endpoint | `POST /v1/search?key=AIzaSyBH1mte6BdKzvf0c2mYprkyvfHCRWmfX7g&alt=json`                                                               |
| Inner `Content-Type` | `application/json`                                                                                                              |
| Auth          | The `key=` query param IS the auth (Google public API key, hardcoded in matrix-v5 JS bundle). No cookie required, no `Authorization` header sent. |

The `boundary` token in the URL must equal the boundary used in the body (`--<boundary>`,
`--<boundary>--`). The official client uses `batch<random-int>`; any unique ASCII token
matching `^[a-zA-Z0-9_-]+$` works.

## Headers

### Outer request (sent by the gapi client)

These are the only headers the browser actually attaches; the rest were either set
implicitly by the browser (Accept-Language, Origin, Referer) or are Google client
fingerprinting that is **not validated server-side** based on test runs. Marked
**Required** vs. **Cosmetic** below.

| Header                    | Required? | Value observed                                                  |
| ------------------------- | --------- | --------------------------------------------------------------- |
| `Content-Type`            | yes       | `text/plain; charset=UTF-8`                                     |
| `Referer`                 | likely yes | `https://matrix.itasoftware.com/` (server may CORS-check)      |
| `Origin`                  | likely yes | `https://matrix.itasoftware.com` (set by browser automatically) |
| `User-Agent`              | cosmetic  | full Chrome UA string                                           |
| `sec-ch-ua*`              | cosmetic  | Chrome client-hints                                             |

No CSRF *token*, no `Cookie`, no `Authorization`, no session ID in headers — only the
standard `X-Requested-With: XMLHttpRequest` marker on the inner request (see below).
**Session is per-search**: the `session` and `solutionSet` fields in the JSON response
are required to do follow-up calls (e.g. expanding to a specific itinerary), but the
**initial search call requires no session at all**.

### Inner request (inside the multipart envelope)

These headers are sent by gapi on every batched call. They are best treated as
**required-by-server contract** even though we have not bisected which are strictly
needed:

| Inner header                      | Notes                                        |
| --------------------------------- | -------------------------------------------- |
| `x-alkali-application-key: applications/matrix` | Identifies the calling application      |
| `x-alkali-auth-apps-namespace: alkali_v2`       | Auth namespace                          |
| `x-alkali-auth-entities-namespace: alkali_v2`   | Auth namespace                          |
| `X-JavaScript-User-Agent: google-api-javascript-client/1.1.0` | gapi client identifier      |
| `X-Requested-With: XMLHttpRequest`              | Anti-CSRF marker                        |
| `Content-Type: application/json`                | Inner JSON body                         |
| `X-Goog-Encode-Response-If-Executable: base64`  | Anti-XSS for executable responses       |
| `X-ClientDetails: appVersion=...&platform=...&userAgent=...` | UA + platform fingerprint (URL-encoded) |

## Anti-bot token (`bgProgramResponse`) — **MAJOR CAVEAT**

The captured request body contains a field called `bgProgramResponse` (~2 KB base64-ish
blob, see verbatim in the fixture). This is produced by the WAA (Web AppAccess) fingerprint
service — there is a sibling POST observed earlier in the trace:

```
POST https://waa-pa.clients6.google.com/$rpc/google.internal.waa.v1.Waa/Create
```

Matrix v5 calls WAA on page load, gets back a `bgProgramResponse` token, and attaches it
to **every `/v1/search` body**. We do not yet know:

- Whether the server REJECTS searches missing this token
- Whether the same token can be re-used across searches or has a TTL
- How long the token stays valid

**Implication for itaMatrixService.js**: if the server rejects payloads without
`bgProgramResponse`, we cannot blindly hand-craft the body server-side. We will likely
need to either (a) ship a headless-browser warmup that hits matrix.itasoftware.com to
mint a token, or (b) accept that ITA Matrix is unreliable and keep it as a soft fallback.
**This must be tested first** during itaMatrixService implementation: try the search
once with `bgProgramResponse` omitted and once with a stale captured token.

## Outer body (multipart envelope) — verbatim shape

```
--batch<boundary>\r\n
Content-Type: application/http\r\n
Content-Transfer-Encoding: binary\r\n
Content-ID: <batch<boundary>+gapiRequest@googleapis.com>\r\n
\r\n
POST /v1/search?key=<API_KEY>&alt=json\r\n
x-alkali-application-key: applications/matrix\r\n
x-alkali-auth-apps-namespace: alkali_v2\r\n
x-alkali-auth-entities-namespace: alkali_v2\r\n
X-JavaScript-User-Agent: google-api-javascript-client/1.1.0\r\n
X-Requested-With: XMLHttpRequest\r\n
Content-Type: application/json\r\n
X-Goog-Encode-Response-If-Executable: base64\r\n
X-ClientDetails: <urlencoded ua + platform>\r\n
\r\n
<JSON BODY — see below>\r\n
--batch<boundary>--
```

Every line break is `\r\n` (CRLF). No leading newline before the opening `--batch...`.

## Inner JSON body — annotated

```jsonc
{
  // List of "summarizers" — the server returns each requested aggregate alongside
  // the solutions. For our use case we only need "solutionList", but the server may
  // require the full list (untested). Safe to copy verbatim.
  "summarizers": [
    "carrierStopMatrix",
    "currencyNotice",
    "solutionList",            // <-- the actual itineraries land in the response under this key
    "itineraryPriceSlider",
    "itineraryCarrierList",
    "itineraryDepartureTimeRanges",
    "itineraryArrivalTimeRanges",
    "durationSliderItinerary",
    "itineraryOrigins",
    "itineraryDestinations",
    "itineraryStopCountList",
    "warningsItinerary"
  ],

  "inputs": {
    "filter": {},                         // empty object = no client-side filters applied
    "page":   { "current": 1, "size": 25 }, // pagination — server returned 25 of solutionCount=500
    "pax":    { "adults": 1 },            // passenger mix; other keys: seniors, youths, children, lapInfants, seatInfants
    "slices": [
      {
        "origins":      ["LIS"],          // IATA codes; supports multi-airport
        "destinations": ["JFK"],
        "date":         "2026-05-27",     // YYYY-MM-DD, **local to origin airport**
        "dateModifier": { "minus": 0, "plus": 0 }, // ±N days flex search; 0/0 == exact date
        "isArrivalDate": false,           // false = "depart on date"; true = "arrive by date"
        "filter":       { "warnings": { "values": [] } },
        "selected":     false             // multi-step booking flag; always false on first call
      },
      {
        "origins":      ["JFK"],          // round-trip = second slice with reversed pair
        "destinations": ["LIS"],
        "date":         "2026-06-03",
        "dateModifier": { "minus": 0, "plus": 0 },
        "isArrivalDate": false,
        "filter":       { "warnings": { "values": [] } },
        "selected":     false
      }
    ],
    "firstDayOfWeek":      "SUNDAY",      // UI hint — likely cosmetic
    "internalUser":        false,
    "sliceIndex":          0,             // which slice we are on; 0 = first call of the search
    "sorts":               "default",     // alternatives: "price", "duration", "departure", "arrival" (untested)
    "cabin":               "COACH",       // also: PREMIUM_COACH, BUSINESS, FIRST
    "maxLegsRelativeToMin": 1,            // map of "Up to N extra stops" UI control (1 = "up to 1 extra")
    "changeOfAirport":     true,          // "Allow airport changes" checkbox
    "checkAvailability":   true           // "Only show flights with available seats" checkbox
  },

  "summarizerSet":       "wholeTrip",     // "wholeTrip" | "slice" — controls aggregate scope
  "name":                "specificDatesSlice", // request-name tag, used for telemetry on the server side
  "bgProgramResponse":   "<base64-ish blob, see anti-bot section above>"
}
```

### Field cheat-sheet (search → JSON)

| User input          | JSON path                                  | Format                          |
| ------------------- | ------------------------------------------ | ------------------------------- |
| Origin              | `inputs.slices[i].origins[]`               | IATA[] (LIS, JFK, ...)          |
| Destination         | `inputs.slices[i].destinations[]`          | IATA[]                          |
| Departure date      | `inputs.slices[i].date`                    | `YYYY-MM-DD` (origin local)     |
| Round-trip return   | `inputs.slices[1].date` (second slice)     | `YYYY-MM-DD`                    |
| Adults              | `inputs.pax.adults`                        | int                             |
| Cabin               | `inputs.cabin`                             | enum string                     |
| Page size           | `inputs.page.size`                         | int (25 default; max untested)  |
| Stops control       | `inputs.maxLegsRelativeToMin`              | 0 = nonstop only, 1 = up to 1 extra, etc. |

For one-way: pass a single slice. For multi-city: pass N slices in order.

## Response shape

The HTTP layer is multipart with one inner `application/json` body. After stripping the
envelope, top-level keys:

```
id                  string  — request ID (echo)
session             string  — session token; pass back in follow-up calls (untested)
solutionCount       int     — total available (500 for our LIS-JFK query)
solutionSet         string  — opaque token identifying this result set
solutionList        object  — {pages, solutions[], minPrice, solutionCount}
carrierStopMatrix   object  — aggregate: {columns: carriers[], rows: stop-counts[]}
currencyNotice      object  — {ext:{price:"EUR590.00"}} — currency hint
durationSliderItinerary list — [{groups:[{label:{start,end}, minPrice}]}] per slice
itineraryArrivalTimeRanges list — per-slice histogram
itineraryCarrierList     object  — carriers + minPrice per carrier
itineraryDepartureTimeRanges list — per-slice histogram
itineraryDestinations    list   — destination airports + minPrice (multi-airport searches)
itineraryOrigins         list   — origin airports + minPrice
itineraryPriceSlider    object  — {groups:[{label:{start,end}}], minPrice, maxPrice}
itineraryStopCountList  object  — {groups:[{label:0|1|2..., minPrice}]}
warningsItinerary       list    — overnight / long-layover / risky-connection groups
```

### Price fields — which one is "the" price?

Each solution carries **four** price-shaped fields and they do **not** all match. Verified
across **all 25 solutions** in the captured fixture:

| Field                          | Example     | Meaning                                                |
| ------------------------------ | ----------- | ------------------------------------------------------ |
| `displayTotal`                 | `EUR589.94` | The price the user pays. **Canonical.**                |
| `ext.totalPrice`               | `EUR589.94` | Same value as `displayTotal` (verified for all 25).    |
| `pricings[0].displayPrice`     | `EUR589.94` | Same value as `displayTotal` (verified for all 25).    |
| `ext.price`                    | `EUR590.00` | **DIFFERENT** — appears to be a rounded-up "from" price. Do NOT use as the user-facing total. |

`ext.pricePerMile` is a derived metric (e.g. `"EUR0.0606372046"`) and is not a total.

**Recommendation for `itaMatrixService.parse()`:** read **`displayTotal`** as the canonical
price field. `ext.totalPrice` and `pricings[0].displayPrice` are equivalent fallbacks.
**Never** read `ext.price` as the user-facing total — it is rounded up by ~$0.06–$1.00 and
will surface to users as a wrong amount.

(If a future capture shows these three "canonical" fields disagreeing on any solution,
that is a new known-unknown to add to the list at the bottom.)

### `solutionList.solutions[i]` — the itineraries

```jsonc
{
  "id":               "GZt8nIGEXF9UqLqFtrksf0001",   // opaque id; pass back to fetch fare details
  "displayTotal":     "EUR589.94",                   // <-- THE PRICE; string with 3-letter currency prefix + decimal value
  "passengerCount":   1,
  "ext":              { /* extension fields, e.g. dominantCarrier */ },
  "pricings": [                                      // may be 1 or more if multi-fare
    {
      "displayPrice": "EUR589.94",
      "ext":          { "pax": { "adults": 1 } }
    }
  ],
  "itinerary": {
    "ext":            { "dominantCarrier": { "code": "UA", "shortName": "United" } },
    "carriers":       [ { "code": "UA", "shortName": "United" }, ... ],
    "singleCarrier":  { /* nullable */ },
    "distance":       { "units": "MI", "value": 9730 }, // object — `units` is self-documenting (always "MI" in our capture); `value` is integer
    "slices": [
      {
        "origin":      { "code": "LIS", "name": "Lisbon" },
        "destination": { "code": "JFK", "name": "New York John F Kennedy International" },
        "departure":   "2026-05-27T05:05+01:00",     // **local time + offset**, ISO-8601 with TZ offset
        "arrival":     "2026-05-27T13:35-04:00",     // local at destination + offset
        "duration":    810,                          // **minutes**, integer
        "flights":     [ "UA9159", "UA8841" ],       // flight numbers in order
        "stops":       [ { "code": "FRA", "name": "Frankfurt International" } ], // [] for nonstop
        "cabins":      [ "COACH" ],                  // per-segment cabin
        "segments": [
          { "pricings": [ { "paxCount": 1 } ] },     // one entry per flight in `flights[]`
          { "pricings": [ { "paxCount": 1 } ] }
        ],
        "ext":         { /* slice-level warnings, e.g. {"warnings":{"types":["OVERNIGHT"], "overnight":true}} */ }
      }
      // ... slice[1] for return
    ]
  }
}
```

### Units & conventions

- **Price**: string of the form `"<ISO-currency-code><decimal>"`, e.g. `"EUR589.94"`,
  `"USD1092.00"`. The numeric part is **major units with two decimals** (NOT minor units —
  no division by 100 needed). Currency is whatever the user picked (default EUR for an
  EU-detected client; an explicit `currency` field on the request is supported but not
  exercised here). Parser must `match(/^([A-Z]{3})([\d.]+)$/)`.
- **Datetimes**: ISO-8601 with the **local TZ offset baked in**, e.g.
  `2026-05-27T05:05+01:00`. NOT UTC. Different segments in the same slice can have
  different offsets (origin TZ vs destination TZ).
- **Duration**: integer minutes.
- **Distance**: object `{ "units": "MI", "value": <integer> }`. `units` is self-documenting
  (observed value `"MI"` for all 25 solutions in our capture); `value` is the integer total
  for the whole itinerary. Parser must read `distance.value` and respect `distance.units`,
  not assume miles.
- **Flights**: `"<carrier-IATA><number>"` strings, e.g. `"UA9159"`. May be a code-share
  (no obvious flag in the response — the actual operating carrier requires a follow-up
  call to fare details, untested).

## Known unknowns

1. **`bgProgramResponse` requirement** — must we mint a fresh token per request? Per
   minute? Per session? Per IP? Untested. Mark as a **must-validate-first** item for
   the itaMatrixService implementation.
2. **Page size cap** — we asked for 25 and got 25; the server reports `solutionCount: 500`.
   Have not tested `page.size` > 25. Likely capped at 50 or 100.
3. **Response gzip** — outer response has `content-encoding: gzip` but `responseText`
   was already decoded by XHR; production callers using `node-fetch` should set
   `Accept-Encoding: gzip` and let the runtime decompress.
4. **Sort options** — `"sorts": "default"` works; other strings (`"price"`,
   `"duration"`) are guesses based on the UI but not exercised.
5. **`sliceIndex`** — sent as 0 on first call. Is it advanced for round-trip on a
   second call? The Matrix UI does in fact issue a follow-up search when the user picks
   an outbound and asks for return options; we did not capture that flow.
6. **Operating-carrier metadata** — `flights[]` shows the marketing carrier. To resolve
   the operator, the UI fires a per-itinerary fare-detail call (out of scope for this task).
7. **Currency selection** — the captured search returned EUR (sales city auto-detected as
   Portugal). To force USD/GBP, the request likely accepts a top-level `salesCity` /
   `currency` field; **not exercised here**.
8. **API key rotation** — the inner-URL `key=AIzaSyBH...` is the public Google API key
   shipped in matrix-v5 JS bundle. It can rotate at any time. itaMatrixService should
   either (a) hardcode + monitor for 401s, or (b) scrape it from the matrix-v5 JS at
   warmup time.
9. **TLS / Cloudflare-style anti-bot** — none observed during the capture; the search
   succeeded on the first try without solving any challenge.

## Reproducing this capture

```bash
# 1. Drive Matrix v5 in Playwright MCP browser:
#    navigate https://matrix.itasoftware.com/
#    fill origin=LIS, destination=JFK, dates=today+30 / today+37, 1 adult
# 2. Before clicking Search, inject this hook on `window`:
#       see _scripts/capture-ita-xhr-hook.js (not shipped in repo)
#    or run via browser_evaluate the snippet that monkey-patches
#    XMLHttpRequest.prototype.open/send to record any
#    `content-alkalimatrix-pa.googleapis.com/batch` body + responseText.
# 3. Click Search. Wait ~5 s for results page to render.
# 4. Read window.__capturedSearchResponses[0] (request body, response text).
# 5. Inner JSON sits between the inner `\r\n\r\n` and the closing `--batch_X` of the
#    response multipart envelope.
```
