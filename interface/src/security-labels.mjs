// Libellés des décisions de sécurité réelles (serveur et worker), partagés par la transparence, le RAG en étapes,
// le chantier des agents et la page Sécurité.
export const securityReasons = {
  input_guard: 'Filtre d’entrée',
  passage_quarantine: 'Passage écarté : instruction détectée dans un document',
  memory_quarantine: 'Note de mémoire écartée : instruction détectée',
  output_guard: 'Contrôle de sortie',
  corpus_integrity: 'Rapport modifié depuis sa vérification : écarté',
  correction: 'Correction déterministe',
  tool_output_quarantine: 'Donnée d’outil écartée par le second filtre',
  tool_denied: 'Outil ou argument hors contrat refusé',
  market_tickers_ignored: 'Ticker hors liste ou hors thème ignoré',
  handoff_rejected: 'Transfert entre agents refusé (intégrité)',
  tool_call: 'Appel d’outil refusé',
  model_call: 'Appel au modèle refusé',
  budget: 'Budget de l’analyse dépassé',
  citation_check: 'Affirmations sans preuve exacte rejetées',
  policy: 'Politique de sécurité appliquée',
  csrf_invalid: 'Requête sans jeton CSRF refusée',
  rate_limited: 'Trop de demandes rapprochées',
  human_check: 'Vérification anti-robot échouée',
  corpus_verified: 'Corpus vérifié au démarrage',
};
export const reasonLabel = value => securityReasons[String(value || '').split(':')[0]] || String(value || '');
export const signalLabels = {
  instruction_override: 'remplacement de consignes', role_spoofing: 'usurpation de rôle', secret_exfiltration: 'demande de secret',
  tool_execution: 'exécution d’outil', url_exfiltration: 'lien d’exfiltration', memory_poisoning: 'empoisonnement de mémoire',
  hidden_instruction: 'texte caché', encoded_payload: 'contenu encodé', invisible_characters: 'caractères invisibles', statistical_classifier: 'classifieur statistique',
  jailbreak: 'jailbreak', system_prompt_extraction: 'extraction des consignes', secret_request: 'demande de secret', exfiltration_request: 'envoi vers l’extérieur',
  fragmented_instruction: 'instruction fragmentée', process_override: 'consigne contre les vérifications', corpus_altered: 'rapport modifié', pii_email: 'courriel masqué', pii_phone: 'téléphone masqué', pii_iban: 'IBAN masqué', pii_card: 'carte masquée',
  malformed: 'donnée malformée',
};
// Motifs du filtre d'entrée.
export const inputReasons = {
  prompt_injection: 'injection d’instructions', jailbreak: 'jailbreak', system_prompt_extraction: 'extraction des consignes', secret_request: 'demande de secret',
  exfiltration_request: 'envoi vers l’extérieur', encoded_payload: 'contenu encodé', fragmented_instruction: 'instruction fragmentée', out_of_scope: 'hors du périmètre', too_long: 'trop longue',
  indirect_injection: 'injection indirecte',
};
// Motifs du contrôle de sortie : retrait d'une affirmation ou rejet de toute la sortie.
export const outputReasons = {
  unknown_evidence: 'passage cité inconnu', quote_not_found: 'citation introuvable dans le passage', quote_too_short: 'citation trop courte',
  period_mismatch: 'année du passage différente', number_mismatch: 'montant absent de la citation', company_drift: 'entreprise hors question',
  unsafe_url: 'lien', unsafe_contact: 'coordonnées', duplicate_claim: 'doublon', too_long: 'trop longue', invalid_shape: 'forme invalide', suspicious_text: 'texte suspect (classifieur)',
  canary_leak: 'fuite du jeton témoin', prompt_echo: 'consignes recopiées', secret_pattern: 'secret', instruction_in_output: 'instruction dans la sortie', unsafe_markup: 'balisage actif (image, script)',
  too_many_claims: 'trop d’affirmations', invalid_output: 'sortie hors contrat',
};
export const anyReasonLabel = code => outputReasons[code] || inputReasons[code] || signalLabels[code] || securityReasons[code] || code;
// Menaces nommées sur la page Sécurité.
export const threatLabels = {
  corpus_poisoning: 'empoisonnement du corpus', document_tampering: 'rapport modifié', prompt_injection: 'injection directe', jailbreak: 'jailbreak',
  system_prompt_extraction: 'extraction des consignes', secret_request: 'vol de secret', exfiltration_request: 'exfiltration', data_leakage: 'fuite de données',
  context_flooding: 'saturation du contexte', indirect_injection: 'injection indirecte', memory_poisoning: 'empoisonnement de mémoire',
  instruction_data_confusion: 'confusion consignes / données', hallucination: 'hallucination', drift: 'dérive', exfiltration: 'exfiltration',
  secret_leak: 'fuite de secret', system_prompt_leak: 'fuite des consignes', output_tampering: 'sortie altérée', canary_leak: 'fuite du jeton témoin',
};
