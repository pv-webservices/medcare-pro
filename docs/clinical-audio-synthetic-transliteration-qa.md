# Synthetic Sarvam transliteration QA

Input: मुझे तीन दिन से बुखार है

Output: Mane teen din se bhukhar hai

Synthetic text only. POST /transliterate, target en-IN, international numerals, spoken_form false. Source transcript unchanged.

Transport passed. `Mane` differs from the intended `Mujhe`; this result establishes endpoint integration, not perfect clinical transcription or transliteration accuracy. Original evidence remains authoritative and unsupported/failed derived segments remain visible in the original script.
