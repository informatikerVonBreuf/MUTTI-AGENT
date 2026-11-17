"""Middleware LangChain v1 autour de chaque appel modèle du worker Folio.

Chaque appel passe par un agent `create_agent` sans aucun outil, dont le modèle est un pont vers le
serveur Node (qui détient la clé Gemini). La pile de middleware :
- PIIMiddleware : adresses e-mail, cartes bancaires et adresses IP masquées en entrée et en sortie ;
  URL masquées en sortie (exfiltration par lien) ;
- ModelCallLimitMiddleware : un seul appel modèle par invocation, aucune boucle ;
- FolioGuardMiddleware (maison) : before_model vérifie que les données portent leur provenance et
  qu'aucune instruction n'y subsiste ; after_model valide la sortie (JSON, champs attendus, pas d'instruction).
La recherche documentaire n'est pas pilotée par le modèle : le contrôle des sorties d'outils
(équivalent de wrap_tool_call) est appliqué par l'exécuteur du worker, voir folio_worker.retrieve.
HumanInTheLoopMiddleware sera requis pour toute future action sensible ; aucune n'existe aujourd'hui.
"""
import contextvars
import json

from scripts.agent_security import SecurityError, screen_tool_output, validate_model_output

MIDDLEWARE_STACK = ["PIIMiddleware(email,credit_card,ip: entrée et sortie)", "PIIMiddleware(url: sortie)",
                    "ModelCallLimitMiddleware(run_limit=1)", "FolioGuardMiddleware(before_model, after_model)"]


def untrusted_items(payload):
    """Textes non fiables d'une charge utile : passages, notes de mémoire, historique, éléments d'autres agents."""
    for key in ("documentData", "memoryData"):
        for item in payload.get(key) or []:
            if isinstance(item, dict):
                yield item.get("text", "")
    for item in payload.get("history") or []:
        if isinstance(item, dict):
            yield item.get("content", "")
    for key in ("claims", "approvedClaims"):
        for item in payload.get(key) or []:
            if isinstance(item, dict):
                yield item.get("quote", "")


def build_agent_call(bridge):
    """Renvoie call(system, payload, schema, agent) passant par create_agent, ou None si LangChain est absent."""
    # Le worker ne tokenise jamais localement : on n'importe pas `transformers` (dépendance facultative de
    # langchain_core), lourde à charger et inutile ici. Cela réduit aussi le code natif chargé dans le worker.
    import sys
    if "transformers" not in sys.modules:
        sys.modules["transformers"] = None
    try:
        from langchain.agents import create_agent
        from langchain.agents.middleware import AgentMiddleware, ModelCallLimitMiddleware, PIIMiddleware
        from langchain_core.language_models.chat_models import BaseChatModel
        from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
        from langchain_core.outputs import ChatGeneration, ChatResult
    except ImportError:
        return None

    # Contexte de l'appel en cours (rôle, schéma, consigne) : l'agent et sa pile de middleware sont compilés
    # une seule fois par processus, au lieu d'un graphe reconstruit à chaque appel (≈ 1,9 s mesurées).
    current = contextvars.ContextVar("folio_model_call")

    class BridgeChatModel(BaseChatModel):
        """Modèle-pont : la génération est faite par le serveur, avec sa clé et ses contrôles."""

        @property
        def _llm_type(self):
            return "folio-node-bridge"

        def bind_tools(self, tools, **kwargs):
            if tools:
                raise SecurityError("TOOL_DENIED", "model_tools")
            return self

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            call = current.get()
            human = [m for m in messages if isinstance(m, HumanMessage)]
            if len(human) != 1:
                raise SecurityError("OUTPUT_REJECTED", "conversation_shape")
            try:
                payload = json.loads(human[0].content)
            except (TypeError, ValueError):
                raise SecurityError("OUTPUT_REJECTED", "payload_json") from None
            result = bridge(call["system"], payload, call["schema"], call["agent"])
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content=json.dumps(result, ensure_ascii=False)))])

    class FolioGuardMiddleware(AgentMiddleware):
        def before_model(self, state, runtime):
            human = [m for m in state["messages"] if isinstance(m, HumanMessage)]
            payload = json.loads(human[-1].content)
            for item in payload.get("documentData") or []:
                if isinstance(item, dict) and item.get("instructionAuthority", "none") != "none":
                    raise SecurityError("OUTPUT_REJECTED", "provenance_missing")
            for text in untrusted_items(payload):
                if screen_tool_output(text):
                    raise SecurityError("OUTPUT_REJECTED", "instruction_in_data")
            return None

        def after_model(self, state, runtime):
            content = state["messages"][-1].content
            try:
                data = json.loads(content)
            except (TypeError, ValueError):
                raise SecurityError("OUTPUT_REJECTED", "json") from None
            validate_model_output(data, current.get()["schema"])
            return None

    agent_graph = create_agent(model=BridgeChatModel(), tools=[], name="folio_model_call", middleware=[
        PIIMiddleware("email", strategy="redact", apply_to_input=True, apply_to_output=True),
        PIIMiddleware("credit_card", strategy="redact", apply_to_input=True, apply_to_output=True),
        PIIMiddleware("ip", strategy="redact", apply_to_input=True, apply_to_output=True),
        PIIMiddleware("url", strategy="redact", apply_to_input=False, apply_to_output=True),
        ModelCallLimitMiddleware(run_limit=1, exit_behavior="error"),
        FolioGuardMiddleware(),
    ])

    def call(system, payload, schema, agent):
        token = current.set({"system": system, "schema": schema, "agent": agent})
        try:
            output = agent_graph.invoke({"messages": [SystemMessage(content=system), HumanMessage(content=json.dumps(payload, ensure_ascii=False))]})
        finally:
            current.reset(token)
        try:
            data = json.loads(output["messages"][-1].content)
        except (TypeError, ValueError, KeyError, IndexError):
            raise SecurityError("OUTPUT_REJECTED", "json") from None
        return validate_model_output(data, schema)

    return call