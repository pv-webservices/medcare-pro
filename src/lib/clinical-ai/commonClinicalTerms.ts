/**
 * Common outpatient symptom, condition and examination words. A long
 * misspelling may take one extra edit only when it lands on one of these and
 * no other term here is as close (diareaha -> diarrhea). The full English
 * dictionary is too full of rare words (diarial, darogha) to decide that.
 * Drug names are deliberately absent: the assistant never respells them.
 */
export const COMMON_CLINICAL_TERMS: ReadonlySet<string> = new Set([
  "abdomen", "abdominal", "abscess", "acidity", "allergic", "allergy",
  "anaemia", "anaemic", "anemia", "anemic", "anxiety", "appetite",
  "arthritis", "asthma", "backache", "bacterial", "bleeding", "bloating",
  "breathlessness", "bronchitis", "burning", "cardiac", "cellulitis",
  "chikungunya", "cholesterol", "congestion", "conjunctivitis",
  "constipation", "convulsion", "convulsions", "cramps", "dehydration",
  "dengue", "depression", "dermatitis", "diabetes", "diabetic", "diarrhea",
  "diarrhoea", "discharge", "dizziness", "dysentery", "dysmenorrhea",
  "dysmenorrhoea", "dysuria", "eczema", "epilepsy", "examination",
  "fatigue", "fever", "flatulence", "fracture", "fungal", "gastritis",
  "gastroenteritis", "giddiness", "haematuria", "haemoglobin", "headache",
  "heartburn", "hematuria", "hemoglobin", "hoarseness", "hypertension",
  "hyperthyroidism", "hypotension", "hypothyroidism", "indigestion",
  "infection", "inflammation", "injury", "insomnia", "investigation",
  "itching", "jaundice", "lactation", "laryngitis", "malaria",
  "menstrual", "menstruation", "micturition", "migraine", "nausea",
  "numbness", "obesity", "osteoarthritis", "otitis", "palpitation",
  "palpitations", "paralysis", "pharyngitis", "phlegm", "platelets",
  "pneumonia", "pregnancy", "pressure", "pruritus", "psoriasis",
  "pulmonary", "respiratory", "rheumatoid", "seizure", "seizures",
  "sinusitis", "sneezing", "sprain", "sputum", "stiffness", "stroke",
  "swelling", "temperature", "tenderness", "tingling", "tonsillitis",
  "tremor", "triglycerides", "tuberculosis", "typhoid", "ulcer",
  "urination", "urticaria", "vertigo", "viral", "vomiting", "weakness",
  "wheezing",
]);
