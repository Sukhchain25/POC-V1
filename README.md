# POC — Payment Lambda with JOSE Encryption

## Architecture

```
Client (Postman)
      ↓
Payment Lambda (localhost:3000/dev/payment)
      ├── encryption: true  → Token Lambda → Mock Backend (with JOSE encrypted payload)
      └── encryption: false → Mock Backend directly (plain payload)

Mock Backend (Fastify) on localhost:4000
      ├── POST /oauth/token       → Access token generate karta hai
      └── POST /resources/payment → Payment process karta hai
```

---

## Folder Structure

```
poc-project/
├── serverless.yml              ← Lambda config
├── package.json                ← Lambda dependencies
├── lambdas/
│   ├── paymentLambda.js        ← Main Lambda (encryption flag check)
│   └── tokenLambda.js          ← JOSE encrypt + OAuth token fetch
└── mock-backend/
    ├── server.js               ← Fastify server
    ├── package.json
    └── routes/
        ├── auth.js             ← POST /oauth/token
        └── resources.js        ← POST /resources/payment
```

---

## Setup & Run

### Step 1 — Lambda Dependencies Install karo

```bash
cd poc-project
npm install
```

### Step 2 — Mock Backend Dependencies Install karo

```bash
cd mock-backend
npm install
```

### Step 3 — Mock Backend Start karo (Terminal 1)

```bash
cd mock-backend
npm start
# Running on http://localhost:4000
```

### Step 4 — Serverless Offline Start karo (Terminal 2)

```bash
cd poc-project
npx serverless offline start
# Running on http://localhost:3000
```

---

## Testing with Postman

### Test 1 — Encryption = TRUE (JOSE flow)

```
POST http://localhost:3000/dev/payment
Content-Type: application/json

{
  "encryption": true,
  "paymentData": {
    "amount": 5000,
    "currency": "INR",
    "userId": "user123",
    "orderId": "ORD-001"
  }
}
```

**Flow:** Payment Lambda → Token Lambda → OAuth Token fetch → JOSE Sign → Mock Backend verify → Response

---

### Test 2 — Encryption = FALSE (Direct flow)

```
POST http://localhost:3000/dev/payment
Content-Type: application/json

{
  "encryption": false,
  "paymentData": {
    "amount": 5000,
    "currency": "INR",
    "userId": "user123",
    "orderId": "ORD-001"
  }
}
```

**Flow:** Payment Lambda → Mock Backend directly → Response

---

### Test 3 — Mock Backend Health Check

```
GET http://localhost:4000/health
```

---

### Test 4 — Direct OAuth Token (optional)

```
POST http://localhost:4000/oauth/token
Content-Type: application/json

{
  "client_id": "poc-client",
  "client_secret": "poc-secret",
  "grant_type": "client_credentials"
}
```

---

## Technologies Used

| Technology | Purpose |
|---|---|
| Serverless Framework | Lambda local emulation |
| serverless-offline | Local Lambda server (port 3000) |
| Fastify | Mock Backend server (port 4000) |
| @fastify/jwt | OAuth token generation & verification |
| JOSE | Payment data signing/encryption |
| axios | Lambda → Backend HTTP calls |

---

## Ports

| Service | Port |
|---|---|
| Serverless Offline (Lambdas) | 3000 |
| Mock Backend (Fastify) | 4000 |
