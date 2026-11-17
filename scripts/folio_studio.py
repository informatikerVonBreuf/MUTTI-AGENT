"""Point d'entrée LangGraph Studio pour le graphe de résumé thématique de Folio.

`langgraph dev` (voir langgraph.json à la racine) charge `graph` pour l'afficher et le déboguer.
Hors de l'application, le serveur Node n'est pas là pour fournir la recherche ni le modèle :
- la recherche utilise ici un score lexical simple sur data/rag-data/markdown (pas le BM25 de Node) ;
- le modèle est déterministe et hors ligne par défaut (FOLIO_STUDIO_MODEL=offline) ;
  FOLIO_STUDIO_MODEL=gemini appelle Gemini directement avec GOOGLE_API_KEY (appels facturés).
Le graphe, ses nœuds, ses bornes et ses contrôles de citations sont ceux du worker.
"""
import hashlib
import os
import re
from pathlib import Path

from scripts import folio_worker as worker

CORPUS = Path(__file__).resolve().parent.parent / "data" / "rag-data" / "markdown"
_PARAGRAPHS = None


def _paragraphs():
    global _PARAGRAPHS
    if _PARAGRAPHS is None:
        _PARAGRAPHS = []
        for file in sorted(CORPUS.glob("*/*.md")):
            text = file.read_text(encoding="utf-8", errors="ignore")
            year = (re.search(r"20\d{2}", file.stem) or [""])[0]
            for block in re.split(r"\n\s*\n", text):
                block = block.strip()
                if 80 <= len(block) <= 1800:
                    _PARAGRAPHS.append({"documentId": file.parent.name + "/" + file.stem, "name": file.stem, "year": year, "text": block})
    return _PARAGRAPHS


def local_retrieve(query):
    terms = {t for t in re.findall(r"[a-z0-9]{3,}", query.lower())}
    scored = []
    for paragraph in _paragraphs():
        words = re.findall(r"[a-z0-9]{3,}", paragraph["text"].lower())
        score = sum(1 for word in words if word in terms)
        if score:
            scored.append((score, paragraph))
    scored.sort(key=lambda item: -item[0])
    passages = []
    for _, paragraph in scored[:4]:
        identifier = "evidence-" + hashlib.sha256((paragraph["documentId"] + paragraph["text"]).encode()).hexdigest()[:20]
        passages.append({**paragraph, "id": identifier, "page": None, "trust": "untrusted_document_data"})
    return {"passages": passages, "memoryData": []}


def offline_model(system, payload, schema, agent):
    fields = schema.get("properties", {})
    if "axes" in fields:
        return {"axes": [payload.get("question", "Question")[:200]]}
    if "approvedIndices" in fields:
        return {"approvedIndices": list(range(len(payload.get("claims", []))))}
    if "selectedIndices" in fields:
        return {"selectedIndices": list(range(len(payload.get("approvedClaims", []))))}
    claims = []
    for passage in payload.get("documentData", [])[:2]:
        sentence = re.search(r"[^.!?\n]{20,220}[.!?]", passage["text"])
        quote = sentence.group(0).strip() if sentence else passage["text"][:160].strip()
        claims.append({"claim": "[Studio hors ligne] " + quote, "evidenceId": passage["id"], "quote": quote, "sourceYear": str(passage.get("year", ""))})
    return {"claims": claims}


worker.HANDLERS["retrieve"] = local_retrieve
if os.environ.get("FOLIO_STUDIO_MODEL", "offline") == "offline":
    worker.HANDLERS["model"] = offline_model

graph = worker.build_graph({})
