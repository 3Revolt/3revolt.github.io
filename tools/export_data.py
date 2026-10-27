"""
Generiše js/cv-data.js iz Python projekta (Multipage): cv_data.py + tabele chatbota.
Tako CV podaci ostaju na jednom mjestu - mijenjaš ih u cv_data.py, pa pokreneš:

    python tools/export_data.py ../Multipage
"""
import json
import sys
from pathlib import Path

SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else "../Multipage").resolve()
sys.path.insert(0, str(SOURCE))

import cv_data as cv  # noqa: E402
import chatbot_engine as engine  # noqa: E402


def jobs():
    out = []
    for job in cv.JOBS:
        item = dict(job)
        item["start"] = list(job["start"])
        item["end"] = list(job["end"]) if job["end"] else None
        out.append(item)
    return out


data = {
    "personal": cv.PERSONAL,
    "softSkills": cv.SOFT_SKILLS,
    "skillCategories": cv.SKILL_CATEGORIES,
    "projects": cv.PROJECTS,
    "education": cv.EDUCATION,
    "languages": cv.LANGUAGES,
    "jobs": jobs(),
}

chatbot = {
    "techSubstitutions": [[pattern, replacement] for pattern, replacement in engine._TECH_SUBSTITUTIONS],
    "stopwords": sorted(engine.STOPWORDS),
    "langWords": {lang: sorted(words) for lang, words in engine._LANG_WORDS.items()},
    "knowledge": engine.KNOWLEDGE,
    "unlistedTech": engine.UNLISTED_TECH,
    "intents": engine.INTENTS,
    "jobAspects": engine.JOB_ASPECTS,
    "followUp": engine.FOLLOW_UP,
    "projectAliases": engine.PROJECT_ALIASES,
}

target = Path(__file__).resolve().parent.parent / "js" / "cv-data.js"
target.write_text(
    "// AUTOMATSKI GENERISANO iz Multipage/cv_data.py i chatbot_engine.py - ne mijenjati ručno.\n"
    "// Ponovo generiši: python tools/export_data.py ../Multipage\n"
    f"window.CV_DATA = {json.dumps(data, ensure_ascii=False, indent=1)};\n"
    f"window.CHATBOT_DATA = {json.dumps(chatbot, ensure_ascii=False)};\n",
    encoding="utf-8",
)
print(f"OK -> {target} ({target.stat().st_size // 1024} KB)")
