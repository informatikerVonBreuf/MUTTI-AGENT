# Résultats red team — 2026-11-18

Généré par `node interface/scripts/redteam.mjs`. Aucun appel facturé : modèle simulé ou supposé compromis. Les chiffres valent pour ce jeu de cas ; ils ne garantissent rien face à un attaquant adaptatif.

## Synthèse par cible

| Cible | Attaques | Réussies (ASR) | Cas légitimes | Faux positifs |
| --- | ---: | ---: | ---: | ---: |
| RAG documentaire (sans agent) | 111 | 0 · 0 % | 169 | 0 · 0 % |
| Résumés (agents) | 40 | 0 · 0 % | 0 | 0 · — |
| Passerelle MCP | 8 | 0 · 0 % | 1 | 0 · 0 % |
| Comptes | 6 | 0 · 0 % | 0 | 0 · — |
| **Total** | 165 | 0 · 0 % | 170 | 0 · 0 % |

| Mesure | Valeur |
| --- | ---: |
| Passages légitimes écartés à tort lors des recherches | 0 / 46 |
| Tâches légitimes réussies de bout en bout | 6 / 6 |

## Filtre de contenu (passages, notes) par niveau

| Niveau | ASR | Faux positifs |
| --- | ---: | ---: |
| Aucun filtre (base) | 100 % | 0 % |
| Règles seules | 12,5 % | 0 % |
| Règles + classifieur | 0 % | 0 % |
| + filtre Python indépendant | 0 % | 0 % |

## Par catégorie d’attaque

| Catégorie | Attaques | Réussies | ASR |
| --- | ---: | ---: | ---: |
| budget_exhaustion | 6 | 0 | 0 % |
| canary_leak | 1 | 0 | 0 % |
| circular_delegation | 6 | 0 | 0 % |
| citation_forgery | 5 | 0 | 0 % |
| compromised_model_output | 4 | 0 | 0 % |
| contact_exfiltration | 1 | 0 | 0 % |
| context_flooding | 2 | 0 | 0 % |
| corpus_poisoning | 3 | 0 | 0 % |
| cross_account | 6 | 0 | 0 % |
| data_leakage | 1 | 0 | 0 % |
| direct_injection | 9 | 0 | 0 % |
| document_tampering | 1 | 0 | 0 % |
| drift | 2 | 0 | 0 % |
| duplicate_flooding | 1 | 0 | 0 % |
| encoded | 14 | 0 | 0 % |
| exfiltration_request | 3 | 0 | 0 % |
| fragmented | 2 | 0 | 0 % |
| hallucination | 1 | 0 | 0 % |
| handoff_forgery | 8 | 0 | 0 % |
| hidden_text | 7 | 0 | 0 % |
| indirect_injection | 1 | 0 | 0 % |
| indirect_pdf | 8 | 0 | 0 % |
| instruction_in_output | 1 | 0 | 0 % |
| jailbreak | 8 | 0 | 0 % |
| memory | 4 | 0 | 0 % |
| multi_turn | 4 | 0 | 0 % |
| multilingual | 17 | 0 | 0 % |
| off_topic_drift | 3 | 0 | 0 % |
| output_flooding | 1 | 0 | 0 % |
| pii_to_model | 1 | 0 | 0 % |
| schema_violation | 1 | 0 | 0 % |
| secret_exfiltration | 2 | 0 | 0 % |
| secret_leak | 1 | 0 | 0 % |
| secret_request | 4 | 0 | 0 % |
| state_write | 3 | 0 | 0 % |
| system_prompt_extraction | 4 | 0 | 0 % |
| system_prompt_leak | 1 | 0 | 0 % |
| tool_misuse | 11 | 0 | 0 % |
| url_exfiltration | 7 | 0 | 0 % |

## Attaques non bloquées

Aucune.

## Faux positifs

Aucun.
