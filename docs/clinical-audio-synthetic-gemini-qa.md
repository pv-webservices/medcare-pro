# Synthetic Gemini fallback QA — AI-2A.3

Two live attempts were made with the same locally generated two-voice Windows speech WAV. The second attempt was separately authorized by the user after the first exhausted the original one-attempt limit. No patient audio, application recording or public audio URL was used. Uploaded Files artifacts were explicitly deleted after both attempts.

Both calls returned successful HTTP responses but initially failed strict application normalization. The second captured response established that `store:false` may omit the interaction ID and that this endpoint emits `spk:0`/`spk:1`, alongside the documented underscore speaker format. The parser now accepts both bounded speaker formats and an absent ID without inventing either. Offline normalization of that captured response passes: seven segments, two speakers, word offsets from 100 ms to 23,300 ms. A regression test covers this observed contract. No third provider call was made.

Synthetic source included fever for three days, denial of chest pain, Metformin 500 mg once daily, left knee pain and HbA1c 7.2. The returned text retained the medication dose, frequency, laterality and numeric result, but garbled the Romanized Hindi denial and other Hindi words (for example `Chest pain that he high`). This is clinically material ambiguity in a negation anchor. The synthetic voice pronunciation is also an imperfect language fixture. Consequently this sample is **not clinical-quality acceptance** and must not be represented as production approval. Further separately authorized synthetic acceptance with an appropriate multilingual fixture remains required.

Raw capture and normalized text remain in dedicated synthetic-only local temporary artifacts; they are excluded from source control, generic logs, audits and AiRun. No production credentials, environment, database or processor governance settings were changed.

| Clinical anchor | Captured evidence | Review |
| --- | --- | --- |
| Symptom duration | `three days` | Preserved; surrounding Hindi garbled |
| Chest-pain negation | `Chest pain that he high` | FAIL: negation ambiguous |
| Medication/dose | `Metformin 500 mg` | Preserved |
| Frequency | `once daily` | Preserved |
| Laterality | `Left knee` | Preserved |
| Numeric result | `7.2%` | Numeric value preserved; surrounding result wording incomplete |
