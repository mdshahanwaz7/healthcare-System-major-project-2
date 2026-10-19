"""
RAG Module V2 package initialization.
Loads the medical pipeline only when requested.
"""
import sys
from pathlib import Path

ROOT_DIR = str(Path(__file__).resolve().parent.parent)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from rag_module.config.rag_config import RAGConfig, DEFAULT_CONFIG


def __getattr__(name: str):
    if name == "MedicalRAGPipeline":
        from rag_module.rag_pipeline import MedicalRAGPipeline
        return MedicalRAGPipeline
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ["RAGConfig", "DEFAULT_CONFIG", "MedicalRAGPipeline"]
