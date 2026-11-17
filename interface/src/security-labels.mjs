// Libellés des décisions de sécurité réelles (serveur et worker), partagés par la transparence et le chantier.
export const securityReasons = {
  passage_quarantine: 'Passage écarté : instruction détectée dans un document',
  memory_quarantine: 'Note de mémoire écartée : instruction détectée',
  tool_output_quarantine: 'Sortie d’outil écartée par le second rempart',
  handoff_rejected: 'Transfert entre agents refusé (intégrité)',
  tool_call: 'Appel d’outil refusé',
  model_call: 'Appel au modèle refusé',
  budget: 'Budget de l’analyse dépassé',
  citation_check: 'Affirmations sans preuve exacte rejetées',
  policy: 'Politique de sécurité appliquée',
  csrf_invalid: 'Requête sans jeton CSRF refusée',
  rate_limited: 'Trop de demandes rapprochées',
};
export const reasonLabel = value => securityReasons[String(value || '').split(':')[0]] || String(value || '');
export const signalLabels = {
  instruction_override: 'remplacement de consignes', role_spoofing: 'usurpation de rôle', secret_exfiltration: 'demande de secret',
  tool_execution: 'exécution d’outil', url_exfiltration: 'lien d’exfiltration', memory_poisoning: 'empoisonnement de mémoire',
  hidden_instruction: 'texte caché', encoded_payload: 'contenu encodé', invisible_characters: 'caractères invisibles', statistical_classifier: 'classifieur statistique',
};
