"""Offline RAG practice using the JSON files in ./context.

This teaches retrieval and prompt augmentation without making an API call.
The generated prompt is what you would pass to an LLM for the "G" in RAG.
"""

import json
import re
from pathlib import Path


CONTEXT_DIR = Path(__file__).resolve().parent / "context"
TOP_K = 3

# These common words add little value to this simple word-matching search.
STOP_WORDS = {
    "a", "an", "and", "are", "about", "at", "be", "for", "from",
    "in", "is", "it", "me", "of", "on", "or", "the", "to", "what",
    "when", "where", "who", "with", "you",
}

def words(text: str) -> set[str]:
    """Split text into lowercase for better searching"""
    return {
        word
        for word in re.findall(r"[a-z0-9]+", text.casefold())
        if word not in STOP_WORDS
    }

def records_from_json(path: Path) -> list[dict]: # repeat for self writing
    """Read either JSON list, or an API styled object containing 'value'."""
    with path.open(encoding="utf-8") as file:
        data = json.load(file)
        
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get('value"'), list):
        return data["value"]
    raise ValueError(f"Expected a list of records in {path.name}")

def make_documents() -> list[dict[str,str]]:
    """Turn each email or event record into a searchable document"""
    documents = []
    
    sources = {
        "messages.json": (
            "message",
            (
                "subject",
                "bodyPreview",
                "from_name",
                "from_address",
                "receivedDateTime",
                "sentDateTime",
                "folder",
            ),
        ),
        "events.json": (
            "event",
            (
                "subject",
                "bodyPreview",
                "start_utc",
                "end_utc",
                "location",
                "showAs",
            ),
        ),
    }

    for filename, (kind, fields) in sources.items():
        path = CONTEXT_DIR / filename
        if not path.is_file():
            continue

        for record in records_from_json(path):
            # Keep only useful text and metadata; IDs and large nested payloads
            # would take space without helping this beginner search.
            content = [
                f"{field}: {record[field]}"
                for field in fields
                if record.get(field) not in (None, "")
            ]
            if content:
                documents.append(
                    {
                        "source": f"{filename} ({kind})",
                        "text": "\n".join(content),
                    }
                )

    if not documents:
        raise FileNotFoundError(
            f"No email or event records found in {CONTEXT_DIR}"
        )
    return documents


def retrieve(question: str, documents: list[dict[str, str]]) -> list[dict]:
    """Return up to TOP_K records with the most words in common with the query.

    This is deliberately simple. Production RAG commonly uses embeddings and
    a vector store to find related wording, not just identical words.
    """
    query_words = words(question)
    if not query_words:
        return []

    scored = []
    for document in documents:
        matched_words = query_words & words(document["text"])
        if matched_words:
            scored.append(
                {
                    **document,
                    "score": len(matched_words),
                    "matched_words": sorted(matched_words),
                }
            )

    return sorted(
        scored,
        key=lambda item: (-item["score"], item["source"], item["text"]),
    )[:TOP_K]


def build_prompt(question: str, retrieved: list[dict]) -> str:
    """Put the retrieved evidence and question together for an LLM."""
    evidence = "\n\n".join(
        f"[{index}. Source: {item['source']}]\n{item['text']}"
        for index, item in enumerate(retrieved, start=1)
    )
    return (
        "Answer using only the supplied email/calendar evidence. "
        "If it does not contain the answer, say you do not know.\n\n"
        f"Retrieved evidence:\n{evidence or '(No matching records found)'}\n\n"
        f"Question: {question}"
    )


def main() -> None:
    documents = make_documents()
    print(f"Loaded {len(documents)} searchable records.")
    question = input("Ask about your email or calendar: ")

    # Retrieval: choose a few records instead of sending every JSON file.
    retrieved = retrieve(question, documents)
    print(f"\nRetrieved {len(retrieved)} record(s):")
    for item in retrieved:
        print(
            f"- score {item['score']} | {item['source']} "
            f"| matched: {', '.join(item['matched_words'])}"
        )

    # Augmentation: include those records with the original question.
    # Generation is intentionally not called: inspect this prompt and practice
    # answering from its evidence, or later pass it to a chat model.
    print("\n--- Prompt an LLM would receive ---\n")
    print(build_prompt(question, retrieved))


if __name__ == "__main__":
    main()
