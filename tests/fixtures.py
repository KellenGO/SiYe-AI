from siye_ai.research_documents import public_url

def component(state="missing", text="", entries=None, reason=""):
    return {"state": state, "text": text, "entries": entries or [], "reason": reason, "truncated": False}

def material(item):
    source = item["result"]
    return {"key": item["key"], "platform": source["platform"], "title": source["title"],
            "url": public_url(source["url"]), "snippet": source.get("snippet") or "",
            "body": component(), "comments": component(),
            "subtitles": component("missing" if source.get("content_type") in {"video", "zvideo"} else "not_applicable")}
