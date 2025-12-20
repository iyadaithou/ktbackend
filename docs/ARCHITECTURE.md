# Pythagoras AI Tutor - System Architecture

> Last updated: December 2025

## Overview

Pythagoras is an **adaptive AI tutor** that asks multiple-choice questions (MCQs) to assess and improve a student's knowledge. It uses a combination of AWS services for scalability, real-time inference, and big data processing.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React/Vite)                         │
│  • Pythagoras Chat (MCQ interface)                                          │
│  • Knowledge State (spider graphs, stats)                                   │
│  • Community (peer matching)                                                │
│  • Admin Panel (KB management)                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BACKEND (Node.js/Express on Vercel)                │
│  • /api/tutor/* - MCQ generation, answer grading                           │
│  • /api/kb/* - Knowledge Base pipeline                                      │
│  • /api/community/* - Peer matching                                         │
└─────────────────────────────────────────────────────────────────────────────┘
           │              │                │                │
           ▼              ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   DynamoDB   │  │     S3       │  │  OpenSearch  │  │   Supabase   │
│ (User State) │  │ (KB Storage) │  │  (Vector DB) │  │  (Auth/User) │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   OpenAI / Bedrock   │
              │   (LLM + Embeddings) │
              └──────────────────────┘
```

---

## AWS Services Used

### 1. Amazon S3 (Simple Storage Service)
**Purpose**: Store raw documents, processed content, and Knowledge Base files.

**Bucket**: `pythagoras-demo-457631991261-20251220011041`

**Structure**:
```
pythagoras-demo-bucket/
├── kb/
│   ├── raw/           # Original uploaded files (PDF, HTML, TXT)
│   ├── cleaned/       # Extracted and cleaned text
│   └── curated/       # Chunked and ready for embedding
```

### 2. Amazon DynamoDB
**Purpose**: Fast, low-latency storage for user knowledge state and active questions.

**Tables**:

#### `pythagoras_tutor_questions`
Stores active MCQ questions (with 24h TTL).

| Attribute | Type | Description |
|-----------|------|-------------|
| `pk` | String | Primary key: `question#<question_id>` |
| `question_id` | String | Unique ID like `mcq_1766236307505_abc123` |
| `user_id` | String | Clerk user ID |
| `topic` | String | e.g., "algebra", "geometry" |
| `level` | Number | Difficulty 1-5 |
| `question` | String | The question text |
| `choices` | List | Array of {id, text} |
| `answer_id` | String | Correct answer ID (A/B/C/D) |
| `explanation` | String | Why this answer is correct |
| `ttl` | Number | Unix timestamp for auto-deletion |

#### `pythagoras_knowledge_state`
Tracks per-user learning progress.

| Attribute | Type | Description |
|-----------|------|-------------|
| `pk` | String | Primary key: `user#<clerk_user_id>` |
| `user_id` | String | Clerk user ID |
| `xp` | Number | Experience points earned |
| `streak` | Number | Consecutive correct answers |
| `topics` | Map | `{ "algebra": 0.75, "geometry": 0.5 }` mastery scores (0-1) |
| `history` | List | Last 50 answers: `[{ts, topic, correct, question_id}]` |
| `recent_questions` | List | Last 30 questions asked (with text) |
| `last_topic` | String | Most recent topic |
| `last_result` | String | "correct" or "wrong" |
| `updated_at` | String | ISO timestamp |

### 3. Amazon OpenSearch Serverless (AOSS)
**Purpose**: Vector database for semantic search (Knowledge Base retrieval).

**Collection**: `pythagoras-kb`
**Endpoint**: `https://<collection-id>.us-east-1.aoss.amazonaws.com`

**Index**: `pythagoras-kb`

**Mapping**:
```json
{
  "settings": {
    "index": {
      "knn": true,
      "knn.algo_param.ef_search": 100
    }
  },
  "mappings": {
    "properties": {
      "embedding": {
        "type": "knn_vector",
        "dimension": 1536,
        "method": {
          "name": "hnsw",
          "engine": "nmslib",
          "space_type": "cosinesimil"
        }
      },
      "content": { "type": "text" },
      "source": { "type": "keyword" },
      "scope": { "type": "keyword" },
      "chunk_index": { "type": "integer" },
      "created_at": { "type": "date" }
    }
  }
}
```

### 4. Amazon Bedrock (Optional)
**Purpose**: Foundation models for chat and embeddings.

**Models**:
- Chat: `amazon.nova-lite-v1:0` or `anthropic.claude-3-haiku-20240307-v1:0`
- Embeddings: `amazon.titan-embed-text-v1`

**Note**: Currently using OpenAI as primary due to Bedrock access restrictions.

### 5. Amazon SageMaker (Planned)
**Purpose**: Train and deploy Knowledge Tracing (KT) models on EdNet data.

See `docs/sagemaker_kt_pipeline.md` for the full plan.

---

## Knowledge Base Pipeline

The KB pipeline transforms raw documents into searchable vector embeddings.

### Stage 1: Raw (`kb/raw/`)
**What it is**: Original uploaded content in its native format.

**Sources**:
- PDF documents uploaded by admin
- HTML pages crawled from URLs
- Plain text files

**Example files**:
```
kb/raw/1734567890123_document.pdf
kb/raw/crawl_example.com_about.html
kb/raw/manual_notes.txt
```

### Stage 2: Cleaned (`kb/cleaned/`)
**What it is**: Extracted plain text with basic cleanup.

**Processing**:
1. **PDF**: Extract text using `pdf-parse`
2. **HTML**: Strip tags, extract main content using `cheerio`
3. **Text**: Normalize whitespace, remove special characters

**Example transformation**:
```
Raw HTML:
<html><body><h1>Math Tutorial</h1><p>Algebra is...</p></body></html>

Cleaned:
Math Tutorial

Algebra is...
```

### Stage 3: Curated (`kb/curated/`)
**What it is**: Text split into chunks optimized for embedding.

**Processing**:
1. Split text into ~500 character chunks with 50 char overlap
2. Each chunk becomes a separate document
3. Metadata preserved (source file, chunk index)

**Example**:
```json
{
  "source": "document.pdf",
  "chunk_index": 0,
  "content": "Algebra is a branch of mathematics dealing with symbols..."
}
```

### Stage 4: Indexed (OpenSearch)
**What it is**: Vector embeddings stored in OpenSearch for semantic search.

**Processing**:
1. Each curated chunk is embedded using OpenAI `text-embedding-3-small` (1536 dimensions)
2. Embedding + metadata stored in OpenSearch index
3. kNN (k-Nearest Neighbors) search enabled

**Query flow**:
```
User asks: "quadratic equations"
    │
    ▼
Generate embedding for "quadratic equations"
    │
    ▼
kNN search in OpenSearch (find 4 most similar chunks)
    │
    ▼
Return relevant context to LLM for MCQ generation
```

---

## What is OpenSearch?

**OpenSearch** is an open-source search and analytics engine (fork of Elasticsearch). 

**OpenSearch Serverless (AOSS)** is AWS's managed, auto-scaling version that:
- Handles infrastructure automatically
- Scales based on demand
- Supports **vector search (kNN)** for AI/ML use cases

### Why we use it:
1. **Semantic Search**: Find content by meaning, not just keywords
2. **kNN Vectors**: Store 1536-dimensional embeddings from OpenAI
3. **Fast Retrieval**: Sub-second queries even with millions of documents
4. **Serverless**: No servers to manage, pay per use

### How it works:
```
1. Document → Embedding Model → 1536-dim vector
2. Vector stored in OpenSearch index
3. Query → Embedding Model → Query vector
4. kNN search finds closest vectors (cosine similarity)
5. Return matching documents
```

---

## Database Schemas

### Supabase (PostgreSQL)

#### `users` table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  role TEXT DEFAULT 'student',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### `global_profiles` table
```sql
CREATE TABLE global_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  bio TEXT,
  interests TEXT[],
  education_level TEXT,
  preferred_subjects TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### `knowledge_state` table (mirror from DynamoDB)
```sql
CREATE TABLE knowledge_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  xp INTEGER DEFAULT 0,
  streak INTEGER DEFAULT 0,
  accuracy NUMERIC(5,2),
  topics_mastery JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### DynamoDB (see AWS Services section above)

---

## API Endpoints

### Tutor API (`/api/tutor`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/mcq` | Generate a new MCQ for a topic |
| POST | `/answer` | Submit answer, get feedback |
| GET | `/state` | Get user's knowledge state |
| GET | `/diag` | Debug endpoint for AWS config |

### Knowledge Base API (`/api/kb`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/upload-url` | Get signed S3 upload URL |
| POST | `/crawl` | Crawl URLs and save to Raw |
| POST | `/pipeline/run` | Process Raw → Cleaned → Curated → Index |
| POST | `/list` | List files in a stage (raw/cleaned/curated) |
| POST | `/query` | Search the KB with a query |
| GET | `/diag` | Debug endpoint for KB config |

### Community API (`/api/community`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/peers` | Find similar users by knowledge state |

---

## RAG (Retrieval Augmented Generation)

When generating an MCQ, we use RAG to provide relevant context:

```
1. User asks for "algebra" question
2. Backend queries OpenSearch KB for "algebra" related content
3. Top 3-4 chunks returned as context
4. Context + topic sent to LLM
5. LLM generates MCQ informed by KB content
```

**Prompt structure**:
```
You are Pythagoras, an adaptive math tutor.

CONTEXT FROM KNOWLEDGE BASE:
[chunk 1 content]
[chunk 2 content]

Generate an MCQ about: algebra
Difficulty: 2/5
Avoid these recent questions: [list]

Return JSON: {question, choices, answerId, explanation}
```

---

## Authentication Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Clerk   │────▶│ Frontend │────▶│ Backend  │────▶│ Supabase │
│  (Auth)  │     │  (JWT)   │     │ (Verify) │     │  (Data)  │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
```

1. User signs in via Clerk
2. Clerk issues JWT token
3. Frontend sends JWT in Authorization header
4. Backend verifies JWT with Clerk SDK
5. Backend uses Clerk user ID for DynamoDB/Supabase queries

---

## Environment Variables

### Backend (Vercel)

```env
# Clerk
CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_...

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...

# DynamoDB
DDB_QUESTIONS_TABLE=pythagoras_tutor_questions
DDB_KNOWLEDGE_TABLE=pythagoras_knowledge_state

# S3
S3_KB_BUCKET=pythagoras-demo-457631991261-20251220011041

# OpenSearch
OPENSEARCH_ENDPOINT=https://xxx.us-east-1.aoss.amazonaws.com

# LLM
TUTOR_PROVIDER=openai
OPENAI_API_KEY=sk-...

# Embeddings
EMBEDDINGS_PROVIDER=openai
```

---

## Deployment

### Frontend
- **Platform**: Vercel
- **Repository**: `github.com/iyadaithou/ktfrontend`
- **URL**: `https://pythagoras.team`

### Backend
- **Platform**: Vercel (Serverless Functions)
- **Repository**: `github.com/iyadaithou/ktbackend`
- **URL**: `https://ktbackend-dun.vercel.app`

---

## Future: SageMaker KT Pipeline

See `docs/sagemaker_kt_pipeline.md` for the plan to:
1. Ingest EdNet dataset into S3
2. Train Knowledge Tracing model (DKT/SAKT)
3. Deploy real-time SageMaker endpoint
4. Get per-topic mastery predictions

---

## File Structure

### Frontend (`ktfrontend/`)
```
src/
├── features/
│   ├── aichat/pythagoras-ai.jsx    # MCQ chat interface
│   └── Admin/
│       ├── KnowledgeBaseAdmin.jsx  # KB pipeline UI
│       └── PythagorasAIAdmin.jsx   # AI settings
├── pages/
│   ├── knowledge-state.jsx         # Spider graphs, stats
│   ├── community.jsx               # Peer matching
│   └── dashboard.jsx               # Main dashboard
└── api/client/apiClient.js         # API client
```

### Backend (`ktbackend/`)
```
src/
├── routes/
│   ├── tutor.js                    # MCQ generation
│   ├── knowledge_base.js           # KB pipeline
│   └── community.js                # Peer matching
├── services/
│   ├── tutorDynamoStore.js         # DynamoDB operations
│   ├── openSearchClient.js         # OpenSearch operations
│   ├── openaiTutor.js              # OpenAI MCQ generation
│   ├── openaiEmbeddings.js         # OpenAI embeddings
│   ├── bedrockTutor.js             # Bedrock MCQ (backup)
│   └── s3Client.js                 # S3 operations
└── docs/
    ├── ARCHITECTURE.md             # This file
    ├── sagemaker_kt_pipeline.md    # KT model plan
    └── ednet_ingestion.md          # EdNet data plan
```

---

## Glossary

| Term | Definition |
|------|------------|
| **MCQ** | Multiple Choice Question |
| **KT** | Knowledge Tracing - predicting student mastery |
| **RAG** | Retrieval Augmented Generation |
| **kNN** | k-Nearest Neighbors (vector similarity search) |
| **AOSS** | Amazon OpenSearch Serverless |
| **DynamoDB** | AWS NoSQL database |
| **Embedding** | 1536-dim vector representation of text |
| **Mastery** | 0-1 score indicating topic proficiency |
| **XP** | Experience points (10 for correct, 2 for wrong) |
| **Streak** | Consecutive correct answers |

