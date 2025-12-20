## AWS Demo Setup (Pythagoras)

Region: **us-east-1**

### Resources created

- **S3 bucket**: `pythagoras-demo-457631991261-20251220011041`
- **DynamoDB tables**:
  - `pythagoras_knowledge_state`
  - `pythagoras_tutor_questions`

### Required environment variables (Vercel / local)

- **AWS_REGION**: `us-east-1`
- **BEDROCK_CHAT_MODEL_ID**: *(the Bedrock model ID you enabled in Bedrock → Model access)*
- **DDB_KNOWLEDGE_TABLE**: `pythagoras_knowledge_state`
- **DDB_QUESTIONS_TABLE**: `pythagoras_tutor_questions`
- **S3_DEMO_BUCKET**: `pythagoras-demo-457631991261-20251220011041`

### Endpoints

- `POST /api/tutor/mcq` body: `{ "topic": "derivatives", "level": 2 }`
  - Returns: `{ question_id, question, choices[] }`
- `POST /api/tutor/answer` body: `{ "question_id": "...", "chosenId": "A" }`
  - Returns correctness + updated DynamoDB knowledge state (and mirrors to Supabase for the existing UI).
- `GET /api/tutor/state`

### Notes

- The tutor stores the **correct answer server-side** in DynamoDB, so the frontend can safely render clickable choices.
- Knowledge is tracked **per topic** in DynamoDB (`topics.{topic} = mastery 0..1`) plus `xp`, `streak`, and `history`.


