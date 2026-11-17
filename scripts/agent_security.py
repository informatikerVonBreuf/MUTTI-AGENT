"""Contrôles de sécurité du worker Folio, appliqués côté Python en plus des contrôles du serveur Node.

- Politique et identité injectées par le serveur (job["policy"]) : jamais acceptées du modèle.
- Autorisation des outils par rôle, budgets d'appels, profondeur de délégation, échéance, quotas de tokens et de coût.
- Enveloppes inter-agents signées HMAC-SHA256 : ordre strict (anti-rejeu), matrice des transitions, niveau de confiance.
- Garde d'écriture de l'état LangGraph : chaque rôle n'écrit que ses propres clés, avec des types attendus.
- Filtrage des sorties d'outils (passages) par règles déterministes après normalisation.
Ces contrôles réduisent les risques ; ils ne remplacent ni un conteneur ni une isolation du système.
"""
import hashlib
import hmac
import json
import re
import time
import unicodedata

ROLE_TOOLS = {"planner": {"delegate_task"}, "researcher": {"retrieve_passages"},
              "verifier": {"inspect_evidence"}, "writer": {"compose_summary"}}
TRANSITIONS = {("server", "planner"), ("server", "researcher"), ("planner", "researcher"), ("researcher", "verifier"),
               ("verifier", "writer"), ("verifier", "server"), ("writer", "server")}
EMITTED_TRUST = {"server": "trusted_instruction", "planner": "model_plan", "researcher": "untrusted_evidence",
                 "verifier": "verified_evidence", "writer": "verified_summary"}
ACCEPTED_TRUST = {"planner": {"trusted_instruction"}, "researcher": {"trusted_instruction", "model_plan"},
                  "verifier": {"untrusted_evidence"}, "writer": {"verified_evidence"}, "server": {"verified_evidence", "verified_summary"}}
STATE_KEYS = {"planner": {"axes"}, "researcher": {"claims", "passages"}, "verifier": {"approved"}, "writer": {"result"}}
FIELDS = ("run_id", "from_role", "to_role", "seq", "payload_hash", "trust_level", "ts")
LIMITS = {"tool_budget": 12, "model_calls": 6, "delegation_depth": 1, "max_tokens": 400_000, "max_cost_usd": 1.0, "deadline_ms": 180_000}


class SecurityError(Exception):
    def __init__(self, code, reason=""):
        super().__init__(code)
        self.code = code
        self.reason = reason


def canonical(value):
    """JSON canonique identique à canonical() côté Node (clés triées, sans espaces, UTF-8)."""
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def payload_hash(payload):
    return hashlib.sha256(canonical(payload).encode("utf-8")).hexdigest()


class Policy:
    """Budgets et identité fixés par le serveur. Les valeurs reçues ne peuvent qu'abaisser les plafonds."""

    def __init__(self, raw=None, clock=time.monotonic):
        raw = raw if isinstance(raw, dict) else {}
        def bounded(key, cast=int):
            value = raw.get(key, LIMITS[key])
            if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
                raise SecurityError("POLICY_INVALID", key)
            return min(cast(value), LIMITS[key])
        self.run_id = raw.get("runId") if isinstance(raw.get("runId"), str) else "local"
        self.user_ref = raw.get("userRef") if isinstance(raw.get("userRef"), str) else "anonymous"
        self.tool_budget = bounded("tool_budget")
        self.model_calls = bounded("model_calls")
        self.delegation_depth = bounded("delegation_depth")
        self.max_tokens = bounded("max_tokens")
        self.max_cost_usd = bounded("max_cost_usd", float)
        self.clock = clock
        self.deadline = clock() + bounded("deadline_ms") / 1000
        self.used_tools = 0
        self.used_models = 0
        self.tokens = 0
        self.cost = 0.0

    def check_deadline(self):
        if self.clock() > self.deadline:
            raise SecurityError("BUDGET_EXHAUSTED", "deadline")

    def authorize_tool(self, role, tool, args, scope=None, depth=0):
        """Équivalent Python de authorizeToolCall (serveur) : rôle, outil, arguments, périmètre, budget, profondeur."""
        self.check_deadline()
        if tool not in ROLE_TOOLS.get(role, set()):
            raise SecurityError("TOOL_DENIED", role + ":" + tool)
        if self.used_tools >= self.tool_budget:
            raise SecurityError("BUDGET_EXHAUSTED", "tools")
        if depth > self.delegation_depth:
            raise SecurityError("DELEGATION_DENIED", "depth")
        if not isinstance(args, dict):
            raise SecurityError("TOOL_DENIED", "args")
        allowed = {"delegate_task": {"target", "task"}, "retrieve_passages": {"query"},
                   "inspect_evidence": {"evidenceIds"}, "compose_summary": {"verifiedEvidenceIds"}}[tool]
        if set(args) - allowed:
            raise SecurityError("TOOL_DENIED", "unexpected_argument")
        if tool == "delegate_task" and args.get("target") not in {"researcher", "verifier", "writer"}:
            raise SecurityError("DELEGATION_DENIED", "target")
        if tool == "retrieve_passages" and (not isinstance(args.get("query"), str) or not 1 <= len(args["query"].strip()) <= 4000):
            raise SecurityError("TOOL_DENIED", "query")
        if tool in ("inspect_evidence", "compose_summary"):
            ids = args.get("evidenceIds", args.get("verifiedEvidenceIds"))
            if not isinstance(ids, list) or (scope is not None and any(i not in scope for i in ids)):
                raise SecurityError("TOOL_DENIED", "evidence_scope")
        self.used_tools += 1

    def authorize_model(self, role):
        self.check_deadline()
        if role not in ROLE_TOOLS:
            raise SecurityError("TOOL_DENIED", "model_role")
        if self.used_models >= self.model_calls:
            raise SecurityError("BUDGET_EXHAUSTED", "model_calls")
        self.used_models += 1

    def record_usage(self, usage):
        if not isinstance(usage, dict):
            return
        self.tokens += sum(int(usage.get(k) or 0) for k in ("inputTokens", "outputTokens", "thoughtTokens"))
        cost = usage.get("costUsd")
        if isinstance(cost, (int, float)) and not isinstance(cost, bool):
            self.cost += float(cost)
        if self.tokens > self.max_tokens:
            raise SecurityError("BUDGET_EXHAUSTED", "tokens")
        if self.cost > self.max_cost_usd:
            raise SecurityError("BUDGET_EXHAUSTED", "cost")


class EnvelopeChannel:
    """Canal signé d'une exécution. La clé vient du serveur (stdin) et n'est jamais exposée au modèle."""

    def __init__(self, key_hex, run_id, clock=time.time):
        if not isinstance(key_hex, str) or not re.fullmatch(r"[0-9a-f]{64}", key_hex):
            raise SecurityError("INTEGRITY_VIOLATION", "key")
        self.key = bytes.fromhex(key_hex)
        self.run_id = run_id
        self.last_seq = 0       # dernier numéro signé ou ouvert
        self.holder = None      # rôle qui détient la main et peut signer le transfert suivant
        self.in_transit = None  # transfert signé ici, pas encore ouvert par son destinataire
        self.clock = clock

    def _sign(self, envelope):
        return hmac.new(self.key, canonical({k: envelope[k] for k in FIELDS}).encode("utf-8"), hashlib.sha256).hexdigest()

    def open(self, envelope, to_role, payload):
        if not isinstance(envelope, dict) or any(k not in envelope for k in FIELDS) or not isinstance(envelope.get("sig"), str):
            raise SecurityError("INTEGRITY_VIOLATION", "malformed")
        if not hmac.compare_digest(self._sign(envelope), envelope["sig"]):
            raise SecurityError("INTEGRITY_VIOLATION", "bad_signature")
        if envelope["run_id"] != self.run_id:
            raise SecurityError("INTEGRITY_VIOLATION", "foreign_run")
        if self.in_transit is None:
            # Seul le transfert d'ouverture du serveur peut arriver sans avoir été signé ici.
            if envelope["seq"] != self.last_seq + 1:
                raise SecurityError("INTEGRITY_VIOLATION", "replay" if envelope["seq"] <= self.last_seq else "gap")
            if envelope["from_role"] != "server":
                raise SecurityError("INTEGRITY_VIOLATION", "broken_chain")
        else:
            if envelope["seq"] != self.in_transit["seq"]:
                raise SecurityError("INTEGRITY_VIOLATION", "replay" if envelope["seq"] < self.in_transit["seq"] else "gap")
            if (envelope["from_role"], envelope["to_role"]) != (self.in_transit["from_role"], self.in_transit["to_role"]):
                raise SecurityError("INTEGRITY_VIOLATION", "broken_chain")
        if envelope["to_role"] != to_role or (envelope["from_role"], envelope["to_role"]) not in TRANSITIONS:
            raise SecurityError("INTEGRITY_VIOLATION", "transition_denied")
        if envelope["trust_level"] != EMITTED_TRUST.get(envelope["from_role"]) or envelope["trust_level"] not in ACCEPTED_TRUST.get(to_role, set()):
            raise SecurityError("INTEGRITY_VIOLATION", "trust_denied")
        if payload_hash(payload) != envelope["payload_hash"]:
            raise SecurityError("INTEGRITY_VIOLATION", "payload_mismatch")
        self.last_seq = envelope["seq"]
        self.holder = to_role
        self.in_transit = None
        return envelope

    def seal(self, from_role, to_role, payload):
        if (from_role, to_role) not in TRANSITIONS:
            raise SecurityError("INTEGRITY_VIOLATION", "transition_denied")
        if from_role != self.holder:
            raise SecurityError("INTEGRITY_VIOLATION", "broken_chain")
        envelope = {"run_id": self.run_id, "from_role": from_role, "to_role": to_role, "seq": self.last_seq + 1,
                    "payload_hash": payload_hash(payload), "trust_level": EMITTED_TRUST[from_role], "ts": int(self.clock() * 1000)}
        envelope["sig"] = self._sign(envelope)
        self.last_seq = envelope["seq"]
        self.in_transit = envelope
        self.holder = None
        return envelope


def guard_state_write(role, update):
    """Un nœud n'écrit que ses clés d'état ; le contenu non fiable ne peut pas réécrire un autre rôle."""
    if not isinstance(update, dict):
        raise SecurityError("STATE_WRITE_DENIED", "type")
    extra = set(update) - STATE_KEYS.get(role, set()) - {"envelope"}
    if extra:
        raise SecurityError("STATE_WRITE_DENIED", ",".join(sorted(extra))[:80])
    expected = {"axes": list, "claims": list, "passages": list, "approved": list, "result": dict, "envelope": dict}
    for key, value in update.items():
        if not isinstance(value, expected[key]):
            raise SecurityError("STATE_WRITE_DENIED", key)
    return update


# Règles de second rempart pour les sorties d'outils (le serveur applique déjà règles et classifieur).
_INVISIBLE = re.compile("[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]")
_RULES = [
    ("instruction_override", re.compile(r"(?:ignore|disregard|forget|override|bypass|oublie|ignorez|ignora|olvida|ignoriere|vergiss|ignorar)\b.{0,80}\b(?:previous|prior|above|system|developer|instructions?|rules?|consignes?|regles?|instrucciones|anweisungen|istruzioni)", re.S)),
    ("role_spoofing", re.compile(r"</?(?:system|developer|assistant|tool)>|\[/?(?:inst|system)\]|<\|im_(?:start|end)\|>|\byou are now\b|\btu es (?:desormais|maintenant)\b")),
    ("secret_exfiltration", re.compile(r"(?:send|upload|transmit|leak|reveal|print|envoie|revele|divulgue|affiche)\w*.{0,100}(?:api.?key|secret|token|password|mot de passe|credential|system prompt|\.env)", re.S)),
    ("tool_execution", re.compile(r"(?:run|execute|exec|lance|executer?|call|invoke)\w*.{0,60}(?:subprocess|powershell|bash|shell|terminal|curl\s|wget\s|os\.system|delegate_task|retrieve_passages|compose_summary)", re.S)),
    ("url_exfiltration", re.compile(r"!\[[^\]]{0,80}\]\(\s*https?://|https?://[^\s)]+[?&][a-z_]{1,20}=\{")),
]


def normalize(text):
    value = unicodedata.normalize("NFKC", str(text))
    value = _INVISIBLE.sub("", value)
    value = "".join(c for c in unicodedata.normalize("NFD", value) if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", value.lower())


def screen_tool_output(text):
    value = normalize(text)
    return [name for name, pattern in _RULES if pattern.search(value)]


URL_PATTERN = re.compile(r"https?://|www\.|!\[[^\]]*\]\(|\]\(\s*https?:", re.I)


def validate_model_output(data, schema):
    """Après le modèle : objet JSON, champs du schéma seulement, pas de lien sortant ni d'instruction."""
    if not isinstance(data, dict):
        raise SecurityError("OUTPUT_REJECTED", "type")
    allowed = set((schema or {}).get("properties", {}))
    if allowed and set(data) - allowed:
        raise SecurityError("OUTPUT_REJECTED", "unexpected_field")
    text = canonical(data)
    if screen_tool_output(text):
        raise SecurityError("OUTPUT_REJECTED", "instruction_in_output")
    return data
