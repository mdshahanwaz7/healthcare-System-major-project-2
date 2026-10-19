"""
RAG Pipeline Orchestrator (V2).
Connects Safety Guardrails, Hybrid Retrieval (FAISS + BM25), Cross-Encoder Reranking,
Context Construction, Citation Attribution, and LLM Generation.
"""
import re
from typing import Dict, Any, Optional, List, Set
from pathlib import Path

from rag_module.config.rag_config import DEFAULT_CONFIG, RAGConfig
from rag_module.retrieval.dense_retriever import DenseRetriever
from rag_module.retrieval.bm25_retriever import BM25Retriever
from rag_module.retrieval.hybrid_retriever import HybridRetriever
from rag_module.retrieval.query_analyzer import QueryAnalyzer, QueryAnalysis, RetrievalBudget, ClinicalIntent
from rag_module.reranking.cross_encoder_reranker import CrossEncoderReranker
from rag_module.context.context_builder import ContextBuilder
from rag_module.safety.guardrails import SafetyGuardrails
from rag_module.safety.evidence_policy import EvidencePolicyEngine, GroundingReasonCode
from rag_module.safety.grounding_verifier import AnswerGroundingVerifier, ClaimStatus
from rag_module.generation.generator_v2 import MedicalGenerator


class MedicalRAGPipeline:
    """
    Production-grade Healthcare RAG Pipeline Orchestrator.
    """
    def __init__(
        self,
        config: Optional[RAGConfig] = None,
        dense_retriever: Optional[DenseRetriever] = None,
        bm25_retriever: Optional[BM25Retriever] = None,
        reranker: Optional[CrossEncoderReranker] = None,
        generator: Optional[MedicalGenerator] = None,
        evidence_policy: Optional[EvidencePolicyEngine] = None,
        verifier: Optional[AnswerGroundingVerifier] = None,
        query_analyzer: Optional[QueryAnalyzer] = None
    ):
        self.config = config or DEFAULT_CONFIG
        
        # 1. Initialize Safety Layer & Evidence Policy
        self.guardrails = SafetyGuardrails(self.config)
        self.evidence_policy = evidence_policy or EvidencePolicyEngine()
        self.query_analyzer = query_analyzer or QueryAnalyzer()
        
        # 2. Initialize Retrievers
        self.dense_retriever = dense_retriever
        self.bm25_retriever = bm25_retriever
        
        # Lazy load retrievers if not provided
        if self.dense_retriever is None and self.config.FAISS_INDEX_PATH.exists():
            self.dense_retriever = DenseRetriever(config=self.config)
            
        if self.bm25_retriever is None and self.config.BM25_INDEX_PATH.exists():
            self.bm25_retriever = BM25Retriever.load(self.config.BM25_INDEX_PATH)
        elif self.bm25_retriever is None and self.dense_retriever is not None:
            # Build in-memory BM25 from metadata
            self.bm25_retriever = BM25Retriever()
            self.bm25_retriever.fit(self.dense_retriever.metadata)

        # 3. Hybrid Retriever
        if self.dense_retriever is not None and self.bm25_retriever is not None:
            self.hybrid_retriever = HybridRetriever(
                dense_retriever=self.dense_retriever,
                bm25_retriever=self.bm25_retriever,
                config=self.config
            )
        else:
            self.hybrid_retriever = None

        # 4. Reranker
        self.reranker = reranker or CrossEncoderReranker(
            model_name=self.config.RERANKER_MODEL_NAME,
            use_reranker=self.config.USE_RERANKER
        )

        # 5. Context Builder
        self.context_builder = ContextBuilder(
            max_context_tokens=self.config.MAX_CONTEXT_TOKENS,
            max_chunks=self.config.FINAL_TOP_K
        )

        # 6. Generator
        self.generator = generator or MedicalGenerator.get_instance()

        # 7. Grounding Verifier (V2.9)
        self.grounding_verifier = verifier or AnswerGroundingVerifier()

    def _select_section_diverse_chunks(
        self,
        scored_chunks: List[Dict[str, Any]],
        target_sections: List[str],
        final_k: int
    ) -> List[Dict[str, Any]]:
        """
        Selects candidate passages ensuring that multi-part clinical target sections
        (e.g., Indications, Contraindications, Adverse Reactions, Dosage) are represented
        in context without sacrificing cross-encoder relevance quality.
        """
        if not scored_chunks:
            return []

        selected: List[Dict[str, Any]] = []
        selected_ids: Set[str] = set()

        # Step 1: For each target clinical section, pick the top-scoring candidate matching that section
        for target_sec in target_sections:
            target_lower = target_sec.lower()
            for chunk in scored_chunks:
                cid = str(chunk.get("chunk_id", ""))
                sec = str(chunk.get("section", "")).lower()
                if cid not in selected_ids and (target_lower in sec or sec in target_lower):
                    selected.append(chunk)
                    selected_ids.add(cid)
                    break
            if len(selected) >= final_k:
                break

        # Step 2: Fill remaining slots with the highest-scoring candidate chunks
        for chunk in scored_chunks:
            cid = str(chunk.get("chunk_id", ""))
            if cid not in selected_ids:
                selected.append(chunk)
                selected_ids.add(cid)
            if len(selected) >= final_k:
                break

        # Step 3: Sort back descending by rerank_score (or original order)
        selected.sort(key=lambda x: x.get("rerank_score", 0.0), reverse=True)
        return selected

    def query(
        self,
        user_query: str,
        mode: str = "hybrid",  # "dense", "bm25", "hybrid", "hybrid_rerank"
        top_k: Optional[int] = None,
        generate_answer: bool = True,
        verify_answer: bool = True,
        audience: Optional[str] = "doctor",
        patient_context: Optional[Dict[str, Any]] = None,
        clinician_context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Executes end-to-end RAG query processing.
        Returns:
            dict containing: {
                "question": str,
                "answer": str,
                "is_emergency": bool,
                "abstained": bool,
                "sources": List[dict],
                "retrieved_chunks_count": int,
                "pipeline_mode": str,
                "query_analysis": dict
            }
        """
        # Step 1: Emergency Triage Check
        emergency_alert = self.guardrails.check_emergency(user_query)
        if emergency_alert:
            return {
                "question": user_query,
                "answer": emergency_alert,
                "is_emergency": True,
                "abstained": False,
                "grounding_status": "emergency_diverted",
                "sources": [],
                "retrieved_chunks_count": 0,
                "pipeline_mode": "emergency_triage"
            }

        # Step 1.5: Prompt Injection Early Blocking
        if self.guardrails.detect_injection(user_query):
            return {
                "question": user_query,
                "answer": "Security Alert: Request blocked. This system cannot process prompts attempting to override or inspect system instructions.",
                "is_emergency": False,
                "abstained": True,
                "grounding_status": "prompt_injection_blocked",
                "sources": [],
                "retrieved_chunks_count": 0,
                "pipeline_mode": "prompt_injection_blocked"
            }

        # Step 2: Input Sanitization
        sanitized_query = self.guardrails.sanitize_input(user_query)
        if not sanitized_query:
            return {
                "question": user_query,
                "answer": "Query cannot be empty or invalid.",
                "is_emergency": False,
                "abstained": True,
                "sources": [],
                "retrieved_chunks_count": 0,
                "pipeline_mode": "validation_error"
            }

        # Step 2.5: Dynamic Query Understanding & Retrieval Budgeting
        query_analysis = self.query_analyzer.analyze(sanitized_query)
        budget = query_analysis.retrieval_budget

        dense_k = budget.dense_k
        bm25_k = budget.bm25_k
        target_final_k = top_k or budget.final_top_k

        # If query has canonical entities distinct from raw mentions, construct retrieval query
        # that includes canonical generic names so BM25 and dense retrieval find canonical monographs
        retrieval_query = sanitized_query
        canonical_terms = []
        for ent in query_analysis.resolved_entities:
            c_name = ent.get("canonical_name")
            if c_name and c_name.lower() not in sanitized_query.lower():
                canonical_terms.append(c_name)
        if canonical_terms:
            retrieval_query = f"{sanitized_query} {' '.join(canonical_terms)}"

        # Step 3: Retrieval Stage
        candidate_chunks = []
        if mode == "dense" and self.dense_retriever:
            dense_results = self.dense_retriever.search(retrieval_query, top_k=dense_k)
            candidate_chunks = [dict(self.dense_retriever.metadata[idx], dense_score=score) for idx, score in dense_results]
        elif mode == "bm25" and self.bm25_retriever:
            bm25_results = self.bm25_retriever.search(retrieval_query, top_k=bm25_k)
            candidate_chunks = [dict(self.bm25_retriever.metadata[idx], bm25_score=score) for idx, score in bm25_results]
        elif self.hybrid_retriever:
            candidate_chunks = self.hybrid_retriever.search(
                retrieval_query,
                dense_k=dense_k,
                bm25_k=bm25_k,
                final_k=max(dense_k, bm25_k, target_final_k * 3)
            )
        elif self.dense_retriever:
            dense_results = self.dense_retriever.search(retrieval_query, top_k=target_final_k)
            candidate_chunks = [dict(self.dense_retriever.metadata[idx], dense_score=score) for idx, score in dense_results]

        # Step 3.5: Targeted section recall for resolved entities
        # Semantic retrieval can miss a relevant label section even when that
        # section exists in the active index. For multi-section questions,
        # supplement candidates from the same index metadata before reranking.
        section_targets = [
            str(section).strip().casefold()
            for section in (getattr(budget, "target_sections", None) or [])
            if str(section).strip()
        ]
        resolved_for_recall = (
            getattr(query_analysis, "resolved_entities", None) or []
        )

        if section_targets and resolved_for_recall:
            recall_entity_names = set()

            for entity in resolved_for_recall:
                for field in (
                    "raw_term", "canonical_name", "matched_monograph", "name"
                ):
                    value = (
                        entity.get(field)
                        if isinstance(entity, dict)
                        else getattr(entity, field, None)
                    )
                    if isinstance(value, str) and value.strip():
                        recall_entity_names.add(value.strip().casefold())

            metadata_records = []

            # Use the metadata attached to the active retriever/index.
            for retriever in (self.dense_retriever, self.bm25_retriever):
                if retriever is None:
                    continue

                records = getattr(retriever, "metadata", None)

                if isinstance(records, dict):
                    records = list(records.values())

                if isinstance(records, (list, tuple)) and records:
                    metadata_records = records
                    break

            def _title_matches_recall_entity(title):
                title_lower = str(title or "").casefold()
                return any(
                    re.search(
                        r"(?<!\w)" + re.escape(entity_name) + r"(?!\w)",
                        title_lower,
                    )
                    for entity_name in recall_entity_names
                )

            def _section_is_requested(section):
                section_lower = str(section or "").casefold()

                for target in section_targets:
                    # Keep a specific contraindications section when requested.
                    if (
                        "contraind" in target
                        and "contraind" in section_lower
                    ):
                        return True

                    # Match terminology used by medication labels.
                    if (
                        ("adverse" in target or "side effect" in target)
                        and (
                            "adverse reaction" in section_lower
                            or "side effect" in section_lower
                        )
                    ):
                        return True

                    # Warning and precaution labels are related, but remain
                    # distinct evidence sections in the selected context.
                    if (
                        ("warning" in target or "precaution" in target)
                        and (
                            "warning" in section_lower
                            or "precaution" in section_lower
                        )
                    ):
                        return True

                    if (
                        target in section_lower
                        or section_lower in target
                    ):
                        return True

                return False

            existing_ids = {
                str(candidate.get("chunk_id") or candidate.get("id"))
                for candidate in candidate_chunks
                if candidate.get("chunk_id") or candidate.get("id")
            }

            for record in metadata_records:
                if not isinstance(record, dict):
                    continue

                # Restrict this supplemental path to the resolved medication's
                # own monograph; don't mix evidence from another medication.
                if str(record.get("document_type") or "").casefold() != "drug_monograph":
                    continue

                if not _title_matches_recall_entity(record.get("title")):
                    continue

                if not _section_is_requested(record.get("section")):
                    continue

                chunk_id = str(record.get("chunk_id") or record.get("id") or "")
                if not chunk_id or chunk_id in existing_ids:
                    continue

                candidate_chunks.append(dict(record))
                existing_ids.add(chunk_id)

        # Step 4: Second-Stage Reranking & Dynamic Section Selection
        if mode in ["hybrid_rerank", "hybrid"] and self.reranker and candidate_chunks:
            scored_candidates = self.reranker.rerank(
                retrieval_query,
                candidate_chunks,
                top_k=len(candidate_chunks)
            )
        else:
            scored_candidates = candidate_chunks

        # Entity-isolation screening:
        # If the query identified a single target drug/entity and is not a multi-entity comparison,
        # prioritize chunks belonging to that target entity to prevent cross-entity distractor contamination.
        # Entity-safe evidence filtering.
        # Do not use every raw query candidate as an entity: words such as
        # "contraindications" and "warnings" can match unrelated drug monographs.
        resolved_entities = getattr(query_analysis, "resolved_entities", None) or []
        target_entity_names = set()

        for res_ent in resolved_entities:
            for field in ("raw_term", "canonical_name", "matched_monograph", "name"):
                value = (
                    res_ent.get(field)
                    if isinstance(res_ent, dict)
                    else getattr(res_ent, field, None)
                )
                if isinstance(value, str) and value.strip():
                    target_entity_names.add(value.strip().casefold())

        if target_entity_names and ClinicalIntent.COMPARISON not in query_analysis.intents:
            monograph_section_suffix = re.compile(
                r"\s[-?]\s*(?:contraindications?|adverse reactions?|"
                r"side effects?|boxed warnings?|warnings?(?:\s*&\s*precautions)?|"
                r"precautions?|dosage(?:\s+and\s+administration)?|"
                r"clinical pharmacology|drug interactions?|overdosage)\s*$",
                re.IGNORECASE,
            )

            def is_drug_monograph(candidate):
                document_type = str(candidate.get("document_type") or "").casefold()
                title = str(candidate.get("title") or "")
                return (
                    document_type == "drug_monograph"
                    or bool(monograph_section_suffix.search(title))
                )

            def mentions_resolved_entity(candidate):
                title = str(candidate.get("title") or "")
                text = str(candidate.get("text") or "")

                # For drug monographs, match against the title so a passing
                # mention of another medicine inside the body cannot qualify it.
                searchable = title if is_drug_monograph(candidate) else f"{title}\n{text}"
                searchable = searchable.casefold()

                return any(
                    re.search(
                        r"(?<!\w)" + re.escape(name) + r"(?!\w)",
                        searchable,
                    )
                    for name in target_entity_names
                )

            entity_matching = [
                candidate for candidate in scored_candidates
                if mentions_resolved_entity(candidate)
            ]

            if entity_matching:
                matching_keys = {
                    str(candidate.get("chunk_id") or candidate.get("id") or id(candidate))
                    for candidate in entity_matching
                }

                # Keep matching evidence and general sources, but do not fill
                # the remaining ranking slots with another drug's monograph.
                general_candidates = [
                    candidate for candidate in scored_candidates
                    if str(candidate.get("chunk_id") or candidate.get("id") or id(candidate))
                       not in matching_keys
                    and not is_drug_monograph(candidate)
                ]
                scored_candidates = entity_matching + general_candidates
            else:
                # If no matching entity evidence exists, retain general sources
                # for normal grounding checks but exclude unmatching drug labels.
                scored_candidates = [
                    candidate for candidate in scored_candidates
                    if not is_drug_monograph(candidate)
                ]

        # Apply section diversity if multi-part query requires distinct clinical aspects
        if budget.require_section_diversity and budget.target_sections and len(scored_candidates) > target_final_k:
            final_chunks = self._select_section_diverse_chunks(
                scored_chunks=scored_candidates,
                target_sections=budget.target_sections,
                final_k=target_final_k
            )
        else:
            final_chunks = scored_candidates[:target_final_k]

        # Step 5: Abstention Gate & Evidence Policy Evaluation
        should_abstain, abstention_msg = self.guardrails.check_abstention(final_chunks)
        grounding_decision = self.evidence_policy.evaluate_evidence(sanitized_query, final_chunks, retrieval_mode=mode)

        if should_abstain or not grounding_decision.generation_allowed:
            if not grounding_decision.generation_allowed:
                if GroundingReasonCode.UNSUPPORTED_ENTITY in grounding_decision.reason_codes:
                    msg = "I am not able to find verified medical evidence regarding the requested subject in authoritative clinical guidelines."
                elif GroundingReasonCode.OUT_OF_DOMAIN in grounding_decision.reason_codes:
                    msg = "This query appears to be outside the supported medical domain. I cannot provide guidance."
                else:
                    msg = "I am not able to find sufficient verified medical evidence to answer this question."
            else:
                msg = abstention_msg

            return {
                "question": sanitized_query,
                "answer": self.guardrails.append_disclaimer(msg),
                "is_emergency": False,
                "abstained": True,
                "sources": [],
                "retrieved_chunks_count": len(final_chunks),
                "pipeline_mode": mode,
                "query_analysis": query_analysis.model_dump()
            }

        # Filter to accepted chunks if any were rejected by policy
        accepted_chunks = [c for c in final_chunks if c.get("chunk_id") in (grounding_decision.accepted_chunk_ids or set())] or final_chunks

        # Step 6: Context & Citation Construction
        context_str, citations = self.context_builder.build_context(accepted_chunks)

        # Step 7: Generation & Post-Generation Verification
        abstained = False
        verification_result = None
        if generate_answer:
            try:
                raw_answer = self.generator.generate(sanitized_query, context_str, audience=audience)
            except TypeError:
                raw_answer = self.generator.generate(sanitized_query, context_str)
            # Normalize mojibake in generated answer before clinical verification.
            if isinstance(raw_answer, str):
                superscript_two = chr(0x00B2)
                bad_suffix = chr(0x00C2) + superscript_two
                bad_suffix_double = (
                    chr(0x00C3) + chr(0x201A) + chr(0x00C2) + superscript_two
                )
                raw_answer = raw_answer.replace(
                    "m" + bad_suffix_double, "m" + superscript_two
                )
                raw_answer = raw_answer.replace(
                    "m" + bad_suffix, "m" + superscript_two
                )

            if verify_answer:
                verification_result = self.grounding_verifier.verify_answer(
                    answer=raw_answer,
                    evidence_chunks=accepted_chunks,
                    citations=[str(c.get("chunk_id")) for c in accepted_chunks if isinstance(c, dict) and "chunk_id" in c],
                    target_intents=query_analysis.intents
                )
                if verification_result.is_grounded:
                    final_answer = self.guardrails.append_disclaimer(raw_answer)
                    abstained = False
                elif verification_result.safe_for_partial and verification_result.partial_answer:
                    # Partial answer support (Section 15): Deliver verified components, transparently note unverified parts
                    final_answer = self.guardrails.append_disclaimer(verification_result.partial_answer)
                    abstained = False
                elif ClinicalIntent.DOSAGE in query_analysis.intents:
                    # High-risk numeric fallback: controlled evidence rendering from verified Dosage & Administration section
                    dosage_chunks = [
                        c for c in accepted_chunks
                        if "dosage" in str(c.get("section", "")).lower() or "dosage" in str(c.get("title", "")).lower()
                    ]
                    if dosage_chunks:
                        top_dosage_chunk = dosage_chunks[0]
                        dosage_text = str(top_dosage_chunk.get("text", "")).strip()
                        if dosage_text:
                            rendered_candidate = f"According to verified clinical guidelines for {top_dosage_chunk.get('title', 'this medication')}:\n{dosage_text}"
                            rendered_ver = self.grounding_verifier.verify_answer(
                                answer=rendered_candidate,
                                evidence_chunks=accepted_chunks,
                                citations=[str(top_dosage_chunk.get("chunk_id"))]
                            )
                            if rendered_ver.is_grounded or rendered_ver.safe_for_partial:
                                final_answer = self.guardrails.append_disclaimer(rendered_candidate)
                                verification_result = rendered_ver
                                abstained = False
                            else:
                                fail_reason = verification_result.discrepancies[0] if verification_result.discrepancies else "Numeric dosage could not be verified."
                                suppression_msg = (
                                    "I am not able to verify the clinical accuracy of the generated answer against authoritative guidelines "
                                    f"({fail_reason}). As a patient safety precaution, this answer has been withheld."
                                )
                                final_answer = self.guardrails.append_disclaimer(suppression_msg)
                                abstained = True
                        else:
                            fail_reason = verification_result.discrepancies[0] if verification_result.discrepancies else "Generated assertions could not be deterministically verified against accepted clinical evidence."
                            suppression_msg = (
                                "I am not able to verify the clinical accuracy of the generated answer against authoritative guidelines "
                                f"({fail_reason}). As a patient safety precaution, this answer has been withheld."
                            )
                            final_answer = self.guardrails.append_disclaimer(suppression_msg)
                            abstained = True
                    else:
                        fail_reason = verification_result.discrepancies[0] if verification_result.discrepancies else "Generated assertions could not be deterministically verified against accepted clinical evidence."
                        suppression_msg = (
                            "I am not able to verify the clinical accuracy of the generated answer against authoritative guidelines "
                            f"({fail_reason}). As a patient safety precaution, this answer has been withheld."
                        )
                        final_answer = self.guardrails.append_disclaimer(suppression_msg)
                        abstained = True
                else:
                    fail_reason = verification_result.discrepancies[0] if verification_result.discrepancies else "Generated assertions could not be deterministically verified against accepted clinical evidence."
                    suppression_msg = (
                        "I am not able to verify the clinical accuracy of the generated answer against authoritative guidelines "
                        f"({fail_reason}). As a patient safety precaution, this answer has been withheld."
                    )
                    final_answer = self.guardrails.append_disclaimer(suppression_msg)
                    abstained = True
            else:
                final_answer = self.guardrails.append_disclaimer(raw_answer)
                abstained = False
        else:
            final_answer = "Context retrieved successfully."
            abstained = False

        # Final display normalization; verification decisions are unchanged.
        def _normalize_answer_display(value):
            if not isinstance(value, str):
                return value

            # Repair common mojibake forms of the square-metre symbol.
            value = value.replace("m\u00c2\u00b2", "m\u00b2")
            value = value.replace(
                "m\u00c3\u201a\u00c2\u00b2", "m\u00b2"
            )

            # Put the warning on its own line and remove context separators.
            value = value.replace(
                ". Major safety warning:",
                ".\n\nMajor safety warning:",
            )
            value = value.replace(" ---", "")
            return value.strip()

        final_answer = _normalize_answer_display(final_answer)

        if verification_result is not None and verification_result.partial_answer:
            verification_result.partial_answer = _normalize_answer_display(
                verification_result.partial_answer
            )

        # FINAL RESPONSE UNIT NORMALIZATION (post-verification)
        # Correct display text only; do not modify verifier decisions.
        def _normalize_response_units(value):
            if not isinstance(value, str):
                return value

            superscript_two = chr(0x00B2)
            bad_suffixes = (
                chr(0x00C2) + superscript_two,
                chr(0x00C3) + chr(0x201A) + chr(0x00C2) + superscript_two,
            )

            for bad_suffix in bad_suffixes:
                value = value.replace(
                    "m" + bad_suffix, "m" + superscript_two
                )

            return value

        final_answer = _normalize_response_units(final_answer)

        if verification_result is not None:
            partial = getattr(verification_result, "partial_answer", None)
            if isinstance(partial, str):
                verification_result.partial_answer = _normalize_response_units(
                    partial
                )

        res = {
            "question": sanitized_query,
            "answer": final_answer,
            "is_emergency": False,
            "abstained": abstained,
            "sources": citations if not abstained else [],
            "retrieved_chunks_count": len(accepted_chunks),
            "pipeline_mode": mode,
            "query_analysis": query_analysis.model_dump()
        }
        if verification_result is not None:
            res["verification"] = {
                "is_grounded": verification_result.is_grounded,
                "verified": verification_result.is_grounded,  # Canonical alias mapping (is_grounded == verified)
                "has_contradiction": verification_result.has_contradiction,
                "candidate_answer": verification_result.answer,
                "grounded_claim_count": verification_result.grounded_claim_count,
                "total_claim_count": verification_result.total_claim_count,
                "failed_claims": verification_result.failed_claims,
                "discrepancies": verification_result.discrepancies,
                "claim_results": [c.model_dump() for c in verification_result.claim_results],
                "safe_for_partial": verification_result.safe_for_partial,
                "partial_answer": verification_result.partial_answer,
                "components": [c.model_dump() for c in verification_result.components]
            }
            # Internal diagnostic provenance retained even when user-facing output is withheld
            res["internal_provenance"] = {
                "query": sanitized_query,
                "retrieved_chunk_ids": [str(c.get("chunk_id")) for c in final_chunks if isinstance(c, dict) and "chunk_id" in c],
                "accepted_chunk_ids": [str(c.get("chunk_id")) for c in accepted_chunks if isinstance(c, dict) and "chunk_id" in c],
                "candidate_answer": verification_result.answer,
                "claim_statuses": {c.claim_text: c.status.value for c in verification_result.claim_results},
                "failed_claims": verification_result.failed_claims,
                "discrepancies": verification_result.discrepancies,
                "final_decision": "GROUNDED" if verification_result.is_grounded else ("PARTIAL_GROUNDED" if verification_result.safe_for_partial else "ABSTAINED_UNVERIFIED"),
                "evidence_chunks": accepted_chunks
            }
        return res
