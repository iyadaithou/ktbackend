# SageMaker Knowledge Tracing (KT) Pipeline

## Overview

This document outlines the architecture for training and deploying a Knowledge Tracing model using AWS SageMaker, with EdNet as the primary training dataset.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   EdNet     │────▶│  S3 Raw     │────▶│  Glue/EMR   │────▶│  S3 Clean   │
│  Dataset    │     │  Bucket     │     │  Processing │     │  Parquet    │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                                                   │
                                                                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Frontend   │◀────│  API        │◀────│  SageMaker  │◀────│  Training   │
│  Spider     │     │  Gateway    │     │  Endpoint   │     │  Job        │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

## 1. Data Ingestion (EdNet)

### EdNet Dataset
- **Source**: https://github.com/riiid/ednet
- **Size**: ~130M interactions from 780K students
- **Fields**: 
  - `user_id`: Student identifier
  - `content_id`: Question/content identifier  
  - `task_container_id`: Bundle of questions
  - `timestamp`: When answered
  - `answered_correctly`: 0 or 1
  - `prior_question_elapsed_time`: Time taken
  - `prior_question_had_explanation`: If they saw explanation

### S3 Structure
```
s3://pythagoras-kt-data/
├── raw/
│   └── ednet/
│       ├── train.csv
│       └── questions.csv
├── processed/
│   └── ednet/
│       ├── sequences.parquet    # User answer sequences
│       └── skills.parquet       # Skill/topic mappings
├── models/
│   └── dkt/
│       └── model.tar.gz         # Trained model artifacts
└── inference/
    └── batch/                   # Batch inference results
```

## 2. Data Processing (Glue/EMR)

### Glue Job: `ednet-preprocessor`
```python
# Pseudocode for Glue ETL job
def process_ednet():
    # 1. Load raw CSVs
    raw_df = spark.read.csv("s3://pythagoras-kt-data/raw/ednet/")
    
    # 2. Create user sequences (sorted by timestamp)
    sequences = raw_df.groupBy("user_id").agg(
        collect_list(struct("content_id", "answered_correctly", "timestamp"))
    )
    
    # 3. Map content_id to skill/topic
    skills = questions_df.select("content_id", "tags")  # tags = skill IDs
    
    # 4. Write processed data
    sequences.write.parquet("s3://pythagoras-kt-data/processed/ednet/sequences.parquet")
    skills.write.parquet("s3://pythagoras-kt-data/processed/ednet/skills.parquet")
```

## 3. Model Training (SageMaker)

### Model Architecture: Deep Knowledge Tracing (DKT)
- **Type**: LSTM-based sequence model
- **Input**: Sequence of (skill_id, correct) tuples
- **Output**: Probability of answering next question correctly per skill

### Training Script: `train_dkt.py`
```python
import torch
import torch.nn as nn

class DKTModel(nn.Module):
    def __init__(self, num_skills, hidden_dim=128, num_layers=2):
        super().__init__()
        self.embedding = nn.Embedding(num_skills * 2, hidden_dim)  # skill + correctness
        self.lstm = nn.LSTM(hidden_dim, hidden_dim, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_dim, num_skills)
        
    def forward(self, x):
        # x: (batch, seq_len) - encoded as skill_id * 2 + correct
        embedded = self.embedding(x)
        lstm_out, _ = self.lstm(embedded)
        output = torch.sigmoid(self.fc(lstm_out))
        return output  # (batch, seq_len, num_skills) - mastery probabilities

# SageMaker training entry point
def train(args):
    model = DKTModel(num_skills=args.num_skills)
    # ... training loop
    torch.save(model.state_dict(), "/opt/ml/model/model.pth")
```

### SageMaker Training Job
```bash
aws sagemaker create-training-job \
  --training-job-name pythagoras-dkt-v1 \
  --algorithm-specification TrainingImage=763104351884.dkr.ecr.us-east-1.amazonaws.com/pytorch-training:1.13.1-gpu-py39 \
  --role-arn arn:aws:iam::457631991261:role/SageMakerExecutionRole \
  --input-data-config '[{
    "ChannelName": "training",
    "DataSource": {
      "S3DataSource": {
        "S3Uri": "s3://pythagoras-kt-data/processed/ednet/",
        "S3DataType": "S3Prefix"
      }
    }
  }]' \
  --output-data-config '{"S3OutputPath": "s3://pythagoras-kt-data/models/dkt/"}' \
  --resource-config '{"InstanceType": "ml.g4dn.xlarge", "InstanceCount": 1, "VolumeSizeInGB": 50}'
```

## 4. Model Deployment (Real-time Endpoint)

### Create Endpoint
```bash
# Create model
aws sagemaker create-model \
  --model-name pythagoras-dkt \
  --primary-container Image=763104351884.dkr.ecr.us-east-1.amazonaws.com/pytorch-inference:1.13.1-gpu-py39,ModelDataUrl=s3://pythagoras-kt-data/models/dkt/model.tar.gz

# Create endpoint config
aws sagemaker create-endpoint-config \
  --endpoint-config-name pythagoras-dkt-config \
  --production-variants VariantName=AllTraffic,ModelName=pythagoras-dkt,InstanceType=ml.g4dn.xlarge,InitialInstanceCount=1

# Create endpoint
aws sagemaker create-endpoint \
  --endpoint-name pythagoras-dkt-endpoint \
  --endpoint-config-name pythagoras-dkt-config
```

### Inference Request Format
```json
// Request
{
  "user_sequence": [
    {"skill_id": 42, "correct": 1},
    {"skill_id": 15, "correct": 0},
    {"skill_id": 42, "correct": 1}
  ]
}

// Response
{
  "mastery": {
    "42": 0.78,   // 78% mastery on skill 42 (algebra)
    "15": 0.34,   // 34% mastery on skill 15 (fractions)
    "23": 0.50,   // 50% mastery on skill 23 (geometry) - predicted
    ...
  },
  "next_skill_recommendation": 15,
  "predicted_accuracy": 0.45
}
```

## 5. Backend Integration

### Environment Variables
```bash
SAGEMAKER_KT_ENDPOINT=pythagoras-dkt-endpoint
SAGEMAKER_KT_ENABLED=true
```

### API Endpoint: `GET /api/kt/mastery`
```javascript
// Returns full mastery vector from SageMaker model
const mastery = await invokeSageMakerEndpoint(userSequence);
return { mastery, recommendation: mastery.next_skill_recommendation };
```

### Integration with Tutor
```javascript
// In tutor.js - enhance MCQ generation with KT mastery
const ktMastery = await getKTMastery(userId);  // From SageMaker
const topic = selectWeakestTopic(ktMastery);   // Focus on low mastery
const mcq = await generateMcq({ topic, mastery: ktMastery[topic] });
```

## 6. Frontend Visualization

### Spider Graph Enhancement
The Knowledge State page already has a spider/radar chart. When SageMaker is enabled:
- **Current**: Uses simple Bayesian mastery from DynamoDB
- **With SageMaker**: Uses DKT model predictions for more accurate mastery

### Data Flow
```
User answers question
       ↓
DynamoDB updated (history)
       ↓
SageMaker invoked with full sequence
       ↓
Returns mastery vector for all skills
       ↓
Frontend displays spider graph
```

## 7. Implementation Phases

### Phase 1: Current (Implemented ✅)
- Simple Bayesian mastery tracking in DynamoDB
- Per-topic accuracy calculation
- Spider graph visualization

### Phase 2: EdNet Ingestion (TODO)
- Download EdNet dataset to S3
- Create Glue job for preprocessing
- Generate skill mappings

### Phase 3: Model Training (TODO)
- Implement DKT training script
- Run SageMaker training job
- Evaluate model performance

### Phase 4: Deployment (TODO)
- Deploy SageMaker endpoint
- Add backend integration
- Update frontend to use KT predictions

## 8. Cost Estimates

| Component | Estimated Monthly Cost |
|-----------|----------------------|
| S3 Storage (10GB) | ~$0.23 |
| Glue ETL (10 DPU-hours/month) | ~$4.40 |
| SageMaker Training (10 hrs/month) | ~$7.50 |
| SageMaker Endpoint (ml.g4dn.xlarge) | ~$380/month |
| **Total** | **~$392/month** |

### Cost Optimization
- Use Serverless Inference for low traffic
- Use Spot instances for training
- Batch inference instead of real-time for non-critical updates

## 9. Skill/Topic Mapping

### EdNet Skills → Pythagoras Topics
```json
{
  "skill_mappings": {
    "1": "algebra",
    "2": "arithmetic",
    "3": "geometry",
    "4": "probability",
    "5": "calculus",
    "6": "statistics",
    "7": "trigonometry",
    "8": "linear_algebra"
  }
}
```

## 10. Monitoring & Alerts

### CloudWatch Metrics
- `SageMaker/Endpoint/Invocations`
- `SageMaker/Endpoint/ModelLatency`
- `SageMaker/Endpoint/OverheadLatency`

### Alerts
- Endpoint latency > 500ms
- Error rate > 1%
- Model drift detection

