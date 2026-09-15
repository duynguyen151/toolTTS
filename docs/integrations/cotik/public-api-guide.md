# COTIK Public API Guide

Last updated: 2026-08-21

This guide is for external systems (ERP, fulfillment partners, internal scripts) that need to read data from COTIK or push tracking numbers **without using the web UI**. It only covers existing endpoints — nothing here is a new API.

Scope:

- Read orders
- Read finance data already synced into COTIK: **statements** and **payments**
- Update tracking numbers for orders
- Update product price / stock (same as the UI "Edit Custom" action)

> **Data source note:** all read endpoints return data that COTIK has **already synced** from TikTok Shop into its own database. They do not call TikTok live. Freshness depends on COTIK's sync schedule / the "Sync" buttons in the UI.

---

## 1. Base URL and authentication

| Item | Value |
|---|---|
| Base URL | `https://cotik.app/api` |
| Auth header | `al-token: <token>` |
| Content type | `application/json` |

### 1.1 Where to get the token

1. Log in to COTIK.
2. Go to **Account Settings** (`/accounts`) → **Profile details**.
3. Copy the value of the **Token extension** field.

The token is the login token (JWT) of the account you are logged in with.

### 1.2 Token lifetime and revocation

- Valid for **1 year** from the login that produced it.
- Logging in again does **not** invalidate previously issued tokens.
- A token becomes invalid when:
  - the account **changes its password** (this is how you rotate/revoke a leaked token),
  - the account email is changed,
  - the account is blocked, or
  - the account's COTIK subscription expires.

### 1.3 Recommended: use a dedicated Staff account

The token carries the **full permissions** of the account that generated it. Do **not** share the owner account token with third parties.

Instead:

1. Owner goes to **Users & Staff** (`/users-staff`) and creates a staff user with team role **Staff**.
2. Log in as that staff user, copy its **Token extension**.
3. Give that token to the integration.

A Staff token can read orders, read payments, and update tracking numbers, but cannot manage the owner account. Data is automatically scoped to the owner's shops — no shop/owner id is required in requests.

> Team role **Fulfill** cannot read `/payment-tiktok`. Use role **Staff** for full read access described here.

---

## 2. Response format (important)

Every endpoint returns **HTTP 200**, even on errors. The real status is inside the body:

```json
{
  "status": 200,
  "message": "",
  "data": { ... }
}
```

```json
{
  "status": 400,
  "message": "No token, authorization denied",
  "data": []
}
```

Always check `body.status`, not the HTTP status code.

**One exception:** when you exceed the per-token rate limit (§7.1) the server answers **HTTP 429** with `body.status = 429` and a `Retry-After` header. Handle both HTTP 429 and `body.status === 429` the same way — wait and retry.

Common `status: 400` messages:

| Message | Meaning |
|---|---|
| `No token, authorization denied` | Missing `al-token` header |
| `Token is not valid! #hctak-esimorp` | Malformed/expired token |
| `The token has expired!` | Password/email changed after token was issued — get a new token |
| `This account has been block!` | Account blocked |
| `Your service has expired! Please Upgrade!` | Subscription expired |
| `You do not have permission to take action!` | Team role lacks the permission |
| `Please connect shop to use the action!` | Owner account has no connected shop |

Rate limit: 2,500 requests/second per IP. Exceeding it blocks the IP for 1 hour. Normal integrations will never hit this.

---

## 3. Orders

### 3.1 List / search orders

```
GET /api/order/list
```

Permission: `GET_ORDER`

| Query param | Type | Description |
|---|---|---|
| `page` | int | Page number, starts at 1 (required) |
| `sizeperpage` | int | Page size (required) |
| `search` | string | Matches TikTok order id (`apiOrderId`), tracking number, recipient name, product name/SKU. Comma-separate multiple order ids or tracking numbers |
| `filter2` | string | Comma-separated COTIK shop `_id` values |
| `filter3` | string | Comma-separated TikTok order status (see enum below) |
| `filter4` | string | Comma-separated COTIK work status (`order_status`), plus special values `overdue`, `ship_late` |
| `filter5` | string | Comma-separated staff note values |
| `filter8` | string | Shipping type: `SELLER` or `TIKTOK` |
| `filter9`, `filter10` | number | Order create time range, **milliseconds** since epoch (both required together) |
| `filter11`, `filter12` | number | Order update time range, **milliseconds** since epoch (both required together) |

Orders are sorted by `create_time` descending.

**Look up a single order by TikTok order id:**

```bash
curl "https://cotik.app/api/order/list?page=1&sizeperpage=1&search=576461234567890123" \
  -H "al-token: $COTIK_TOKEN"
```

**Orders created in a date range, awaiting shipment:**

```bash
curl "https://cotik.app/api/order/list?page=1&sizeperpage=100&filter3=AWAITING_SHIPMENT&filter9=1755734400000&filter10=1756339200000" \
  -H "al-token: $COTIK_TOKEN"
```

**Response:**

```json
{
  "status": 200,
  "message": "",
  "data": {
    "listorders": [
      {
        "_id": "66c1f0...",
        "apiOrderId": "576461234567890123",
        "status": "AWAITING_SHIPMENT",
        "order_status": "new",
        "shipping_type": "SELLER",
        "tracking_number": "",
        "create_time": 1724140800,
        "update_time": 1724141000,
        "recipient_address": { "name": "...", "address_line1": "...", "city": "...", "state": "...", "postal_code": "...", "region_code": "US", "phone_number": "..." },
        "line_items": [
          { "id": "5776...", "product_id": "1729...", "product_name": "...", "sku_id": "1729...", "sku_name": "...", "seller_sku": "...", "sale_price": "19.99", "currency": "USD" }
        ],
        "payment": { "currency": "USD", "total_amount": "19.99", "sub_total": "19.99", "shipping_fee": "0.00" },
        "shops": { "_id": "66b0...", "name": "My Shop", "code": "SHOP01", "note": "" },
        "buyer_message": "",
        "tts_sla_time": 1724400000,
        "rts_sla_time": 1724400000,
        "delivery_time": 0,
        "cancel_time": 0,
        "est_amount": 0,
        "base_cost": 0,
        "design": {},
        "printer": {},
        "is_sample_order": false,
        "is_replacement_order": false
      }
    ],
    "totalsize": 1
  }
}
```

Notes:

- `create_time`, `update_time`, `*_sla_time`, `delivery_time`, `cancel_time` are **seconds** (TikTok format). Query filters `filter9–12` are **milliseconds**.
- `recipient_address`, `line_items`, `payment`, `packages` are TikTok Shop API objects stored as-is.
- `shops.{_id,name,code}` is the COTIK shop the order belongs to. Use `shops._id` for `filter2` (orders) and `shops` (statements/payments).
- Some internal fulfillment fields (`design`, `printer`, `mockup`, `line_print`, `shipping_label`, …) are included and can be ignored.

### 3.2 Enums

**TikTok order status (`status`, filter `filter3`)**

`UNPAID`, `ON_HOLD`, `AWAITING_SHIPMENT`, `AWAITING_COLLECTION`, `IN_TRANSIT`, `DELIVERED`, `COMPLETED`, `CANCELLED`

**COTIK work status (`order_status`, filter `filter4`)**

`new`, `processing`, `working`, `worked`, `cancel`, `warehouse_out`, `produced`, `scan`, `media`, `done`

**Shipping type (`shipping_type`, filter `filter8`)**

- `SELLER` — seller ships with own label; tracking must be pushed (see §5).
- `TIKTOK` — TikTok Shipping label; tracking cannot be changed via COTIK.

---

## 4. Finance (synced data only)

Both endpoints read data that COTIK has already synced from TikTok. Time filters are **milliseconds** since epoch.

### 4.1 Statements

```
GET /api/statements/
```

Permission: any logged-in account.

| Query param | Type | Description |
|---|---|---|
| `page` | int | Default 1 |
| `sizeperpage` | int | Default 50 |
| `search` | string | Matches statement title, TikTok statement id, or an order id contained in the statement |
| `dateStart`, `dateEnd` | number | Filter by `statement_time`, milliseconds (both required together) |
| `shops` | string | Comma-separated COTIK shop `_id` |
| `status` | string | `payment_status`: `PAID`, `PROCESSING`, `FAILED` |

```bash
curl "https://cotik.app/api/statements/?page=1&sizeperpage=50&dateStart=1753977600000&dateEnd=1756655999000&status=PAID" \
  -H "al-token: $COTIK_TOKEN"
```

**Response:**

```json
{
  "status": 200,
  "message": "",
  "data": {
    "statements": [
      {
        "_id": "66c2...",
        "apiStatementId": "7400000000000000001",
        "statement_time": 1724198400000,
        "currency": "USD",
        "revenue_amount": "1250.00",
        "fee_amount": "-120.50",
        "adjustment_amount": "0.00",
        "shipping_cost_amount": "-80.00",
        "net_sales_amount": "1049.50",
        "settlement_amount": "1049.50",
        "payment_id": "7400000000000000099",
        "payment_status": "PAID",
        "shopId": "66b0...",
        "order_ids": ["576461234567890123", "576461234567890124"],
        "paymenttiktoks": { "_id": "66c3...", "bank_account": "****1234" }
      }
    ],
    "totalsize": 1,
    "list_shop": [ { "_id": "66b0...", "name": "My Shop", "code": "SHOP01" } ]
  }
}
```

- `statement_time` is **milliseconds**.
- Amount fields are strings from TikTok (signed decimals).
- `order_ids` lists TikTok order ids included in the statement — use it to join with `/api/order/list?search=`.
- `shopId` is the COTIK shop `_id`; `list_shop` (all your shops) is handy for discovering those ids.
- `paymenttiktoks` is the linked payout (only `bank_account`); full payout data is in §4.2 via `payment_id` ↔ `id`.

### 4.2 Payments (bank payouts)

```
GET /api/payment-tiktok/
```

Permission: `GET_PAYMENT_TIKTOK` (owner, Staff, Shop Manager — **not** Fulfill role).

| Query param | Type | Description |
|---|---|---|
| `page` | int | Required |
| `sizeperpage` | int | Required |
| `search` | string | Matches TikTok payment id or bank account |
| `dateStart`, `dateEnd` | number | Filter by `create_time`, milliseconds (both required together) |
| `shops` | string | Comma-separated COTIK shop `_id` |
| `status` | string | `PAID`, `PROCESSING`, `FAILED` |

```bash
curl "https://cotik.app/api/payment-tiktok/?page=1&sizeperpage=50&status=PAID" \
  -H "al-token: $COTIK_TOKEN"
```

**Response:**

```json
{
  "status": 200,
  "message": "",
  "data": {
    "paymenttiktoks": [
      {
        "_id": "66c3...",
        "id": "7400000000000000099",
        "status": "PAID",
        "amount": { "currency": "USD", "value": "1049.50" },
        "settlement_amount": { "currency": "USD", "value": "1049.50" },
        "reserve_amount": { "currency": "USD", "value": "0.00" },
        "payment_amount_before_exchange": { "currency": "USD", "value": "1049.50" },
        "exchange_rate": "1",
        "bank_account": "****1234",
        "create_time": 1724198400000,
        "paid_time": 1724284800000,
        "shop_id": "66b0..."
      }
    ],
    "totalsize": 1
  }
}
```

- `create_time`, `paid_time` are **milliseconds**.
- `id` is the TikTok payment id and matches `payment_id` on statements.
- `shop_id` is the COTIK shop `_id` (same values as `list_shop[]._id` from §4.1).

---

## 5. Update tracking numbers

```
POST /api/order/import-tracking-v2
```

Permission: `UPDATE_TRACKING_NUMBER`

Use this to push a tracking number for one or many orders by **TikTok order id**. COTIK will:

1. Find the order (must belong to your account/team).
2. Call TikTok Shop to mark the package as shipped (or update the tracking if one already exists).
3. Store the tracking number and set the order's work status to `worked`.

### 5.1 Request

```json
{
  "list": [
    { "apiOrderId": "576461234567890123", "tracking_number": "9400111899223345678901", "provider": "7117858858072016686" },
    { "apiOrderId": "576461234567890124", "tracking_number": "UUS1234567890", "provider": "7352738314622863120" }
  ]
}
```

| Field | Required | Description |
|---|---|---|
| `apiOrderId` | yes | TikTok order id. For a **split** order, use `"<orderId>_<packageId>"` (package id from the order's `split_order.packages[].id`) |
| `tracking_number` | yes | Carrier tracking number |
| `provider` | yes for `SELLER` shipping | TikTok `shipping_provider_id` — see table in §5.4 |

```bash
curl -X POST "https://cotik.app/api/order/import-tracking-v2" \
  -H "al-token: $COTIK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"list":[{"apiOrderId":"576461234567890123","tracking_number":"9400111899223345678901","provider":"7117858858072016686"}]}'
```

### 5.2 Response — read `logUpdate`!

The endpoint returns `status: 200` and `"Import tracking successfully!"` **even if some or all orders failed**. Per-order failures are listed in `data.logUpdate`. An empty `logUpdate` means every order succeeded.

```json
{
  "status": 200,
  "message": "Import tracking successfully!",
  "data": {
    "logUpdate": [
      { "apiOrderId": "576461234567890124", "status": "Order not found or change order status to working before change!" }
    ]
  }
}
```

| `logUpdate[].status` | Meaning / fix |
|---|---|
| `Order not found or change order status to working before change!` | Order id not found under your account, or its work status is not eligible (see §5.3) |
| `Shipping provider does not exist` | Order has no delivery option — cannot ship via API |
| `Shop not found` / `App not found` | Shop disconnected from COTIK |
| `Mark Shipping Failed` | TikTok rejected the mark-as-shipped call (wrong provider id, invalid tracking format, order not in AWAITING_SHIPMENT, …) |
| `Update package shipping info failed` | TikTok rejected the tracking update for an order that already had a different tracking number |

### 5.3 Eligibility rules

An order is updated only if:

- `shipping_type` is `SELLER` (orders using TikTok Shipping labels are skipped), and
- `order_status` is `new` or `working`, **or** `worked` (re-update with a new tracking).

If the same tracking number is sent again, COTIK just re-saves it (no TikTok call).

### 5.4 Shipping provider ids (`provider`)

Values are TikTok Shop `shipping_provider_id`. Pick the one matching the carrier of the tracking number.

**US**

| Provider id | Carrier |
|---|---|
| `7117858858072016686` | USPS |
| `7117859084333745966` | UPS |
| `7129720299146184490` | FedEx |
| `7213986298535610158` | DHL express |
| `7220301902846625579` | DHL eCommerce |
| `7248600717110282027` | Amazon Logistics |
| `7352738314622863120` | UniUni |
| `7352739623900022544` | Gofo Express |
| `7132708441138677550` | LaserShip |
| `7132721393761781550` | OnTrac |
| `7212612330725574442` | Veho |
| `7212609771327719211` | OSM Worldwide |
| `7212611208266909483` | TForce |
| `7212608507307099946` | Better Trucks |
| `7049196166784747269` | Asendia US |
| `7011400463266350850` | Yanwen |
| `7254084300713232174` | AxleHire |
| `7254085043432195882` | Lone Star Overnight |
| `7260759364112221953` | Deliver-it |
| `7260760118063531777` | GLS US |
| `7443961280932611847` | GLS USA |
| `7260761851384825602` | Spee-Dee Delivery |
| `7260762638932510466` | Wizmo |
| `7325327335803406082` | Speedx |
| `7347979279965095682` | First Mile |
| `7352734302007723792` | DoorDash |
| `7352739982978582289` | ACI Logistix |
| `7372092091192575761` | GPS |
| `7403621511082280721` | Weee |
| `7459702458671974152` | Cirro |
| `7468802168162617094` | PiggyShip |
| `7475569110803908358` | Western Post |
| `7475848549314332421` | DeliverDirect |
| `7482927909624088338` | Cainiao US |
| `7482929018279298834` | Tusk Logisitics |
| `7443957391328020232` | Ceva Logistics |
| `7443960654106461959` | Pilot Freight Services |
| `7443960918918039303` | Mainfreight |
| `7443962159819654919` | Freightquote by C.H. Robinson |
| `7443962761375123207` | Tazmanian Freight Systems |
| `7443963002103006984` | Metropolitan |
| `7443963103403837192` | ABF Freight |
| `7443963680233899783` | Saia Inc. |
| `7443963761360111378` | Daylight Transport |
| `7443963984505472776` | Day & Ross Freight |
| `7443964819356518162` | Southeastern Freight Lines |
| `7443965081018189576` | Roadrunner Freight |
| `7443965216620021522` | Dayton Freight Lines |
| `7443965284153165586` | Fastfrate Group |
| `7443965466114033416` | CrossCountry Freight Solutions |
| `7443965673564276487` | PS Logistics |
| `7443965834688464658` | JP Express |
| `7443966039123035911` | Tax-Air |
| `7443966093628344071` | Oak Harbor Freight Lines |
| `7443967306838836999` | DHL Heavyweight |
| `7443967395145729810` | UPS Heavyweight |
| `7443971189820622610` | XPO |
| `7443972065616463623` | Estes Express Lines |
| `7443972524611733256` | R+L Carriers |
| `7443972918754674450` | Central Transport |
| `7443973316697655048` | Averitt Express |
| `7443973716947502855` | Pitt Ohio |
| `7443974197195310866` | AAA Cooper Transportation |
| `7443974531196143368` | A. Duie Pyle |
| `7444679050045425415` | Old Dominion Freight Line USA |

**UK / EU**

| Provider id | Carrier |
|---|---|
| `6599541761693270018` | EVRi |
| `6639580521074524161` | DHL UK |
| `6641219975896514562` | Yodel UK |
| `6649195729745887233` | UK Mail |
| `6657598289359323137` | DPD UK |
| `6658174162568658945` | DX Delivery |
| `6671794738251726849` | Royal Mail |
| `6699476450581430274` | Parcel Force |
| `6760565269699084290` | APC Overnight |
| `6760727669580627970` | Panther UK |
| `7265220402182358786` | Amazon Logistics UK |
| `7038796963025782530` | DHL Paket |
| `7073406403947267841` | La Poste |
| `7038794268994963202` | Colissimo |
| `7038794025851160321` | Colis Privé |

---

## 6. Update product price / stock

This mirrors the **Edit Custom** button on the Products (TikTok) page. Three calls: find the product, resolve its shop/app ids, then push the new price or stock. Each `edit-data` call updates **one product** (all of its SKUs) and writes straight to TikTok Shop.

Permissions: `GET_PRODUCT` (list), `UPDATE_PRODUCT` (detail, find-group-product, edit-data). Staff role has all three.

### 6.1 List products

```
GET /api/product-tiktok/
```

| Query param | Type | Description |
|---|---|---|
| `page`, `sizeperpage` | int | Required |
| `search` | string | Matches title, `product_sku`, TikTok product id (`apiProductId`), description, `skus.seller_sku` |
| `status` | string | `apiStatus` filter. **Defaults to `ACTIVATE` when omitted**; pass `status=` (empty) for all. Values: `ACTIVATE`, `PENDING`, `FREEZE`, `SELLER_DEACTIVATED`, `FAILED`, `DELETED` |
| `shops` | string | Comma-separated COTIK shop `_id` |
| `dateStart`, `dateEnd` | number | ms; filters `updated_at` by default, or `created_at` when `option_date=created_at` |
| `sort_by`, `sort_order` | string | e.g. `sort_by=updated_at&sort_order=desc` |

```bash
curl "https://cotik.app/api/product-tiktok/?page=1&sizeperpage=50&search=MYSKU-001" \
  -H "al-token: $COTIK_TOKEN"
```

Response `data.productTikToks[]` (+ `totalsize`) — key fields:

```json
{
  "_id": "66d0...",
  "apiProductId": "1729123456789012345",
  "shopId": "66b0...",
  "title": "Funny Cat T-Shirt",
  "price": "19.99",
  "quantity": 120,
  "product_sku": "MYSKU-001",
  "apiStatus": "ACTIVATE",
  "shops": { "_id": "66b0...", "name": "My Shop", "code": "SHOP01" },
  "updated_at": "2026-08-20T10:00:00.000Z"
}
```

`_id` is the COTIK product id used by the next two calls.

### 6.2 (Optional) Product detail with SKUs

```
GET /api/product-tiktok/detail/<_id>
```

Re-syncs the product from TikTok and returns `data.product` including `skus[]` (`id`, `seller_sku`, `price`, `quantity`, `list_price`, `sales_attributes`). Use it when you need current per-SKU values before applying a formula.

### 6.3 Resolve shop / app ids

```
POST /api/product-tiktok/find-group-product
```

```json
{ "products_selected": ["66d0...", "66d1..."] }
```

Response `data` groups the products by app and shop — these are the `appId` / `shopId` / `product` values required by `edit-data`:

```json
{
  "status": 200,
  "message": "Success!",
  "data": [
    {
      "app": { "_id": "65f0..." },
      "shops": [
        { "_id": "66b0...", "products": [ { "_id": "66d0...", "apiProductId": "1729123456789012345" } ] }
      ]
    }
  ]
}
```

### 6.4 Push the change

```
POST /api/product-tiktok/edit-data
```

| Field | Required | Description |
|---|---|---|
| `appId` | yes | `app._id` from 6.3 |
| `shopId` | yes | `shops[]._id` from 6.3 |
| `product` | yes | `{ "_id": "...", "apiProductId": "..." }` from 6.3 (`apiProductId` is mandatory) |
| `kind` | yes | `"custom"` |
| `field` | yes | `"price"` or `"stock"` |
| `mode` | yes | `"fixed"` or `"formula"` |
| `value` | when `mode=fixed` | Number. Price in shop currency (e.g. `19.99`); stock as integer |
| `formula` | when `mode=formula` | Expression over `current` (see 6.5) |
| `warehouse_type` | no | Stock only. `"default"` (default) = shop's default sales warehouse; `"change"` = all sales warehouses |

The change is applied to **every SKU** of the product.

**Fixed price:**

```bash
curl -X POST "https://cotik.app/api/product-tiktok/edit-data" \
  -H "al-token: $COTIK_TOKEN" -H "Content-Type: application/json" \
  -d '{"appId":"65f0...","shopId":"66b0...","product":{"_id":"66d0...","apiProductId":"1729123456789012345"},"kind":"custom","field":"price","mode":"fixed","value":24.99}'
```

**Stock +10% via formula, all warehouses:**

```bash
curl -X POST "https://cotik.app/api/product-tiktok/edit-data" \
  -H "al-token: $COTIK_TOKEN" -H "Content-Type: application/json" \
  -d '{"appId":"65f0...","shopId":"66b0...","product":{"_id":"66d0...","apiProductId":"1729123456789012345"},"kind":"custom","field":"stock","mode":"formula","formula":"current * 1.1","warehouse_type":"change"}'
```

**Responses**

| `status` | `message` | Meaning |
|---|---|---|
| 200 | `Edit success!` | TikTok accepted the update |
| 400 | `Please fill in all fields!` | Missing `shopId` / `appId` / `product` / `kind` |
| 400 | `Not Found Data Edit` | Missing/invalid `field`, `mode`, or `formula` |
| 400 | `Not found product!` / `Not found shop!` | Ids don't belong to your account, or `appId` doesn't match the shop |
| 400 | `Warehouse not found` | Shop has no sales warehouse synced |
| 400 | `Edit Failed Formula!` | Formula rejected (see 6.5) |
| 400 | *(TikTok error text)* or `Edit Failed!` | TikTok rejected the value (e.g. price below minimum) |

### 6.5 Formula rules

- Only these characters are allowed: digits, `+ - * / ( ) .`, `%`, and the variable `current`.
- `current` = the SKU's present value (price or quantity). Evaluated **per SKU**.
- `%` means `/100`: `(current*10)%` = `current*0.1`; so "+10%" is `current + (current*10)%` or simply `current * 1.1`.
- Result is rounded to 2 decimals (stock is then truncated to an integer).
- A SKU whose current value is not numeric, or whose result is not finite, is left unchanged.

Examples: `current * 1.1` (+10%), `current - 2` (−2), `current * 0.9` (−10%), `(current + 5) * 1.05`.

---

## 7. Usage limits and best practices

Every write endpoint calls TikTok Shop on your behalf and TikTok applies **app-level** rate limits shared by all shops, so abusive traffic can throttle other sellers. COTIK therefore enforces a per-token limit on the endpoints in this guide, and reserves the right to revoke a token (see §1.2).

### 7.1 Enforced rate limits

Limits are counted **per token** (your staff token has its own bucket; the web UI session using the same token shares it) over a rolling **60-second** window.

| Bucket | Endpoints | Limit |
|---|---|---|
| **Read** | `GET /api/order/list`, `GET /api/statements/`, `GET /api/payment-tiktok/`, `GET /api/product-tiktok/`, `POST /api/product-tiktok/find-group-product` | **300 requests / minute** |
| **Write** | `POST /api/order/import-tracking-v2`, `POST /api/product-tiktok/edit-data`, `GET /api/product-tiktok/detail/:_id` | **150 requests / minute** |

Every response carries the current state of your bucket:

```
RateLimit-Limit: 300
RateLimit-Remaining: 287
RateLimit-Reset: 42        ← seconds until the window resets
```

When the limit is exceeded the request is **not processed** and you get:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 42

{ "status": 429, "message": "Too many requests. Limit is 300 requests per 60s for this token. Retry after 42s.", "data": [] }
```

Wait `Retry-After` seconds (or until `RateLimit-Reset`) and retry. Repeated 429s are a sign to slow your loop down, not to add parallelism.

### 7.2 Recommended pace (well under the hard limits)

| Area | Guideline |
|---|---|
| Overall | ≤ **2 requests/second** sustained, ≤ **60 requests/minute** per token |
| Concurrency | 1 request in flight per token; do not fan out in parallel |
| Page size | Orders ≤ 100, statements/payments ≤ 100, products ≤ 100 |
| Polling | Poll for new orders/finance no more often than every **5 minutes**; use date filters (below) instead of full scans |
| `import-tracking-v2` | ≤ **50 orders per call**, 1 call at a time (one call = one request, regardless of list size) |
| `edit-data` | Sequential, ≥ **500 ms** between calls (this is what the UI does) |
| `detail/:id` | Triggers a live TikTok sync — call only when you really need per-SKU values, never in a loop over all products |

### 7.3 Poll incrementally, don't re-download

- Orders: use `filter11`/`filter12` (update time, ms) with the timestamp of your last successful poll, e.g. "everything updated in the last 10 minutes". Only fall back to `filter9`/`filter10` (create time) for initial backfill.
- Statements / payments: use `dateStart`/`dateEnd` on a sliding window (e.g. last 3 days); statements rarely change after creation.
- Products: `dateStart`/`dateEnd` (default `updated_at`) to pick up only changed products.
- Always paginate to the end (`totalsize`) before moving the window forward.

### 7.4 Retries and idempotency

| Endpoint | Safe to retry? | Notes |
|---|---|---|
| All `GET` | Yes | Retry with exponential backoff (1s, 2s, 4s…), max 3 attempts |
| `import-tracking-v2` | Yes | Same tracking number twice → just re-saved. Check `logUpdate` before retrying only the failed ids |
| `edit-data` `mode=fixed` | Yes | Idempotent (same value) |
| `edit-data` `mode=formula` | **No** | Each call re-applies the formula to the *current* value — a blind retry of `current * 1.1` raises the price twice. On timeout, read the product back (`detail/:id`) before deciding to retry |

- Treat `body.status === 400` with `"An error occurred! #hctak"` as transient (retry with backoff); treat other 400 messages as permanent (fix the request).
- Do not retry on `The token has expired!`, `This account has been block!`, `Your service has expired!` — fetch a new token / contact the account owner.

### 7.5 Operational hygiene

- One **dedicated staff account per integration** (see §1.3) so a misbehaving client can be revoked without affecting others.
- Send a descriptive `User-Agent` (e.g. `acme-erp/1.2`) so traffic can be identified in logs.
- Cache shop ids / app ids from `find-group-product` — they don't change.
- Log the `message` and `data.logUpdate` you receive; they are the only diagnostics available.

---

## 8. Typical integration flow

```
1. GET  /api/order/list?filter3=AWAITING_SHIPMENT&filter8=SELLER&page=1&sizeperpage=100
        → fulfil orders externally
2. POST /api/order/import-tracking-v2 {list:[{apiOrderId, tracking_number, provider}]}
        → inspect data.logUpdate, retry/fix failures
3. GET  /api/order/list?search=<apiOrderId>
        → confirm tracking_number / status
4. GET  /api/statements/?dateStart&dateEnd   and   GET /api/payment-tiktok/?dateStart&dateEnd
        → reconcile finance
5. GET  /api/product-tiktok/?search=<sku>  →  POST /api/product-tiktok/find-group-product
        →  POST /api/product-tiktok/edit-data {kind:"custom", field:"price"|"stock", mode, value|formula}
        → repricing / stock sync
```

## 9. Quick reference

| Purpose | Method & path | Permission | Rate bucket |
|---|---|---|---|
| List / search orders | `GET /api/order/list` | `GET_ORDER` | Read (300/min) |
| Statements (synced) | `GET /api/statements/` | logged-in | Read (300/min) |
| Payments (synced) | `GET /api/payment-tiktok/` | `GET_PAYMENT_TIKTOK` | Read (300/min) |
| Push tracking numbers | `POST /api/order/import-tracking-v2` | `UPDATE_TRACKING_NUMBER` | Write (150/min) |
| List products | `GET /api/product-tiktok/` | `GET_PRODUCT` | Read (300/min) |
| Product detail + SKUs | `GET /api/product-tiktok/detail/:_id` | `UPDATE_PRODUCT` | Write (150/min) |
| Resolve app/shop ids | `POST /api/product-tiktok/find-group-product` | `UPDATE_PRODUCT` | Read (300/min) |
| Update price / stock | `POST /api/product-tiktok/edit-data` | `UPDATE_PRODUCT` | Write (150/min) |

All requests: header `al-token`, JSON body, check `body.status` (and HTTP 429 for rate limiting).
