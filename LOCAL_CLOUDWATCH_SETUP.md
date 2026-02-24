# Run Locally & Send Logs/Metrics to CloudWatch

This guide shows how to run your lambdas locally (using Serverless Offline) and automatically send logs & metrics to AWS CloudWatch **without deploying any Lambdas**.

---

## Step 1: Create AWS Account & Credentials

### Create AWS Account (if needed)

1. Go to [aws.amazon.com](https://aws.amazon.com) → **Create an AWS Account**
2. Complete setup (takes 5-10 minutes, verify email)

### Create IAM User with limited permissions

1. Go to **AWS Console** → Search for **IAM**
2. **Users** → **Create user** → Name: `poc-local-dev` → **Next**
3. **Attach policies directly** → Search and check:
   - `CloudWatchFullAccess`
   - (Or manually attach: logs:\*, cloudwatch:PutMetricData)
4. **Next** → **Create user**
5. Go back to the user → **Security credentials** tab
6. **Create access key** → Choose **Command Line Interface (CLI)** → **Create**
7. **Download .csv file** or copy:
   - **Access Key ID** (e.g., `AKIA3H5JXYZ...`)
   - **Secret Access Key** (e.g., `nK9qP2rW8vL...`)

---

## Step 2: Install AWS CLI

```bash
# macOS
brew install awscli

# Or download: https://aws.amazon.com/cli/
```

Verify:

```bash
aws --version
```

---

## Step 3: Configure AWS Credentials Locally

```bash
aws configure
```

When prompted, enter:

- **AWS Access Key ID**: (from step 1)
- **AWS Secret Access Key**: (from step 1)
- **Default region name**: `ap-south-1`
- **Default output format**: `json`

Verify it works:

```bash
aws sts get-caller-identity
```

You should see your AWS account info.

---

## Step 4: Install Dependencies

```bash
cd /Users/sukhchain/Downloads/poc-project

npm install
```

This installs:

- `@aws-sdk/client-cloudwatch` (for metrics)
- `@aws-sdk/client-cloudwatch-logs` (for logs) ← newly added
- serverless-offline (for local lambda simulation)

---

## Step 5: Create `.env` file

Create a `.env` file in the project root to enable CloudWatch:

```bash
cat > /Users/sukhchain/Downloads/poc-project/.env << 'EOF'
CLOUDWATCH_ENABLED=true
LOG_LEVEL=INFO
AWS_ENVIRONMENT=local-dev
AWS_REGION=ap-south-1
EOF
```

Or manually create `.env`:

```
CLOUDWATCH_ENABLED=true
LOG_LEVEL=INFO
AWS_ENVIRONMENT=local-dev
AWS_REGION=ap-south-1
```

---

## Step 6: Run Locally

Start serverless offline:

```bash
npm start
```

You should see:

```
Mock Backend (Fastify) started!
URL: http://localhost:4000
...
```

And in another terminal:

```bash
serverless offline start
```

This runs lambdas locally on `http://localhost:3000`

---

## Step 7: Test & Send Logs to CloudWatch

### Test payment lambda (from another terminal):

```bash
curl -X POST http://localhost:3000/dev/payment \
  -H "Content-Type: application/json" \
  -d '{
    "encryption": false,
    "paymentData": {
      "amount": 100,
      "currency": "USD",
      "cardNumber": "4111111111111111"
    }
  }'
```

### Watch output:

- **Local stdout**: You'll see JSON logs printed locally (for debugging)
- **CloudWatch Logs**: Logs are ALSO sent to AWS

---

## Step 8: View Logs in CloudWatch

### Via AWS Console:

1. Go to **AWS Console** → **CloudWatch**
2. **Logs** → **Log groups**
3. Find: `/local/poc-payment-system`
4. Click → you'll see a log stream like `stream-17xxxxx`
5. Expand to see all JSON logs from your local runs

### Via AWS CLI:

```bash
# List log groups
aws logs describe-log-groups --region ap-south-1

# Tail logs in real-time
aws logs tail /local/poc-payment-system --follow --region ap-south-1

# Get last 20 log events
aws logs filter-log-events \
  --log-group-name /local/poc-payment-system \
  --max-items 20 \
  --region ap-south-1
```

---

## Step 9: View Metrics in CloudWatch

### Via AWS Console:

1. **CloudWatch** → **Metrics** → **Namespaces**
2. Find **POC-Payment-System**
3. Browse metrics like:
   - `PaymentSuccess` (Environment: local-dev)
   - `PaymentError`
   - `PaymentDuration`
   - `OAuthTokenFetch`

### Via AWS CLI:

```bash
# List all custom metrics
aws cloudwatch list-metrics \
  --namespace POC-Payment-System \
  --dimensions Name=Environment,Value=local-dev \
  --region ap-south-1

# Get metric statistics (last 1 hour)
aws cloudwatch get-metric-statistics \
  --namespace POC-Payment-System \
  --metric-name PaymentSuccess \
  --dimensions Name=Environment,Value=local-dev \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region ap-south-1
```

---

## Step 10: Create CloudWatch Dashboard

Monitor everything in one place:

1. **CloudWatch** → **Dashboards** → **Create dashboard**
2. Name: `POC-Local-Dev`
3. **Add widget** → **Line chart**
4. Search metric: `PaymentSuccess` → select it
5. Add more widgets:
   - `PaymentError`
   - `PaymentDuration`
   - `TokenLambdaCallSuccess`
   - `TokenLambdaCallError`
6. **Create dashboard** → save

Now you can monitor in real-time while running locally.

---

## How It Works

```
Your Local Machine
┌─────────────────────────────┐
│ npm start                   │  ← Lambda handlers run locally
│ ↓                           │
│ logToCloudWatch("INFO", ...) │  ← Sends to CloudWatch Logs API
│ putMetric("PaymentSuccess")  │  ← Sends to CloudWatch Metrics API
│ ↓                           │
│ AWS Credentials (via CLI)    │  ← Authenticated via .env + aws cli
└─────────────────────────────┘
         ↓ (HTTPS)
    Amazon CloudWatch
    ├── Log Group: /local/poc-payment-system
    └── Namespace: POC-Payment-System
```

---

## Troubleshooting

### "UnrecognizedClientException" or "InvalidSignatureException"

- Check AWS credentials: `aws sts get-caller-identity`
- Verify `.env` has correct `AWS_REGION`
- Ensure IAM user has CloudWatch permissions

### No logs appearing in CloudWatch

- Verify `CLOUDWATCH_ENABLED=true` in `.env`
- Check `LOG_LEVEL` is set to `INFO` or `DEBUG`
- Verify API call succeeded (check local output for `[CW]` messages)

### No metrics appearing

- Ensure `CLOUDWATCH_ENABLED=true`
- Lambda must run and call `putMetric()` successfully
- Check namespace: **POC-Payment-System** (case-sensitive)

### Logs/metrics sent but timestamps are wrong

- Verify your local machine's system clock is correct
- AWS rejects events with timestamps > 2 hours old

### "RequestLimitExceeded"

- You're hitting CloudWatch API rate limits (unlikely on free tier)
- Add delay between API calls or batch them

---

## .env Reference

| Variable             | Value                            | Purpose                                     |
| -------------------- | -------------------------------- | ------------------------------------------- |
| `CLOUDWATCH_ENABLED` | `true`                           | Enable/disable CloudWatch integration       |
| `LOG_LEVEL`          | `INFO`, `WARN`, `ERROR`, `DEBUG` | Filter logs by level                        |
| `AWS_ENVIRONMENT`    | `local-dev`                      | Dimension in metrics to distinguish sources |
| `AWS_REGION`         | `ap-south-1`                     | AWS region for APIs                         |

---

## Next Steps

1. Run a few test requests: `curl` commands above
2. Monitor logs: `aws logs tail /local/poc-payment-system --follow`
3. View metrics: Open CloudWatch dashboard in console
4. Add more custom metrics as needed
5. (Optional) Create CloudWatch alarms for errors

---

## Key Advantages

✅ **No Lambda deployment** — run locally only  
✅ **Full observability** — see logs & metrics in CloudWatch  
✅ **Free tier compliant** — ~10K API calls per month is free  
✅ **Fast iteration** — change code, restart, re-run  
✅ **Production-ready patterns** — same code works when deployed

---

## Costs (Free Tier)

- **CloudWatch Logs**: 5 GB ingestion + 5 GB scans per month (free)
- **CloudWatch Metrics**: 10 custom metrics per month (free)
- **API calls**: 1 million per month (free)

**Your usage**: ~100 logs/run × 100 runs/month = negligible  
**Cost**: ~$0.00/month on free tier
