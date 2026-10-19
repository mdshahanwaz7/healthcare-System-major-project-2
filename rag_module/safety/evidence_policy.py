"""
Evidence Policy & Grounding Decision Engine (V2.8).
Evaluates retrieved EvidenceItems against deterministic quality, provenance, coverage,
and consistency policies to produce auditable grounding and abstention decisions.
"""
import time
from enum import Enum
from typing import List, Dict, Any, Optional, Set, Tuple
import re
from pydantic import BaseModel, Field, ConfigDict

from rag_module.safety.provenance_validator import ProvenanceValidator, ProvenanceStatus
from rag_module.retrieval.entity_normalizer import ClinicalEntityNormalizer


class GroundingStatus(str, Enum):
    """
    Categorical grounding evaluation outcome for retrieved clinical evidence.
    """
    GROUNDED = "grounded"
    WEAK_EVIDENCE = "weak_evidence"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    CONFLICTING_EVIDENCE = "conflicting_evidence"


class GroundingReasonCode(str, Enum):
    """
    Standardized, machine-readable reason codes explaining grounding decisions.
    """
    EVIDENCE_SUFFICIENT = "EVIDENCE_SUFFICIENT"
    NO_EVIDENCE = "NO_EVIDENCE"
    INVALID_PROVENANCE = "INVALID_PROVENANCE"
    LOW_RETRIEVAL_SCORE = "LOW_RETRIEVAL_SCORE"
    INSUFFICIENT_COVERAGE = "INSUFFICIENT_COVERAGE"
    EMPTY_CONTENT = "EMPTY_CONTENT"
    CONFLICT_DETECTED = "CONFLICT_DETECTED"
    OUT_OF_DOMAIN = "OUT_OF_DOMAIN"
    UNSUPPORTED_ENTITY = "UNSUPPORTED_ENTITY"
    PARTIAL_PROVENANCE = "PARTIAL_PROVENANCE"


class SourcePolicy(BaseModel):
    """
    Policy rules defining source-level authority and requirements.
    """
    preferred_sources: List[str] = Field(
        default_factory=lambda: [
            "DailyMed",
            "MedlinePlus",
            "ICMR",
            "MoHFW_STG",
            "RxNorm",
            "openFDA",
            "medquad_nih",
            "WHO_Guidelines"
        ],
        description="Sources recognized as authoritative."
    )
    strict_provenance_required: bool = Field(default=True, description="Require 100% complete metadata fields.")
    min_word_count: int = Field(default=5, ge=1, description="Minimum words per chunk to consider usable.")

    model_config = ConfigDict(extra="forbid")


class EvidencePolicyConfig(BaseModel):
    """
    Configuration parameters for evidence evaluation.
    NOTE: Similarity thresholds are heuristic retrieval signals, NOT clinical confidence metrics.
    """
    min_usable_chunks: int = Field(default=1, ge=1, description="Minimum usable chunks required for GROUNDED status.")
    dense_grounded_threshold: float = Field(default=0.50, description="Heuristic cosine similarity for strong dense retrieval.")
    dense_weak_threshold: float = Field(default=0.35, description="Heuristic cosine similarity floor before abstention.")
    bm25_weak_threshold: float = Field(default=3.0, description="Heuristic BM25 score floor.")
    hybrid_fused_weak_threshold: float = Field(default=0.005, description="Heuristic RRF fused score floor.")
    allow_weak_generation: bool = Field(default=True, description="Whether weak evidence allows downstream generation with caveats or blocks generation.")
    enable_conflict_detection: bool = Field(default=True, description="Enable metadata-aware evidence conflict scanning.")
    source_policy: SourcePolicy = Field(default_factory=SourcePolicy)

    model_config = ConfigDict(extra="forbid")



class GroundingDecision(BaseModel):
    """
    Auditable grounding and abstention contract produced by EvidencePolicyEngine.
    """
    status: GroundingStatus = Field(..., description="Grounding outcome classification.")
    generation_allowed: bool = Field(..., description="True if evidence is sufficient and safe for downstream generation.")
    evidence_count: int = Field(..., ge=0, description="Total number of evidence items presented.")
    usable_evidence_count: int = Field(..., ge=0, description="Number of evidence items meeting validity and quality filters.")
    accepted_chunk_ids: List[str] = Field(default_factory=list, description="Exact chunk IDs that passed provenance and quality validation.")
    provenance_valid: bool = Field(..., description="True if all top usable evidence items have valid provenance.")
    top_evidence_rank: Optional[int] = Field(default=None, description="Rank of highest-scoring usable evidence item.")
    evidence_sources: List[str] = Field(default_factory=list, description="Unique source IDs present in usable evidence.")
    evidence_documents: List[str] = Field(default_factory=list, description="Unique document IDs present in usable evidence.")
    evidence_sections: List[str] = Field(default_factory=list, description="Unique clinical section names present in usable evidence.")
    reason_codes: List[GroundingReasonCode] = Field(default_factory=list, description="Machine-readable decision reason codes.")
    warnings: List[str] = Field(default_factory=list, description="Explanatory warnings for human clinicians/auditors.")
    conflict_detected: bool = Field(default=False, description="True if potential evidence contradiction was detected.")
    conflict_summary: Optional[str] = Field(default=None, description="Summary of conflict signals if detected.")
    policy_latency_ms: float = Field(default=0.0, ge=0.0, description="Latency of evidence policy evaluation in ms.")

    model_config = ConfigDict(extra="forbid")


# Specific clinical contradiction marker pairs (condition-scoped to avoid false positives between Indications and Contraindications sections)
CONTRADICTION_PAIRS = [
    (r'\b(contraindicated\s+in\s+pregnancy|unsafe\s+in\s+pregnancy|fetal\s+toxicity|pregnancy\s+category\s+x)\b', r'\b(safe\s+in\s+pregnancy|recommended\s+in\s+pregnancy|no\s+fetal\s+risk)\b'),
    (r'\b(contraindicated\s+in\s+renal\s+failure|unsafe\s+in\s+renal\s+impairment)\b', r'\b(safe\s+in\s+renal\s+failure|indicated\s+in\s+severe\s+renal\s+impairment)\b'),
    (r'\b(fatal\s+toxicity|life-threatening\s+hazard)\b', r'\b(completely\s+harmless|no\s+adverse\s+effects|zero\s+risk)\b')
]


COMMON_STOPWORDS = {
    "what", "is", "the", "of", "and", "in", "to", "for", "a", "an", "how", "do", "i", "can",
    "are", "with", "on", "by", "at", "from", "it", "or", "as", "be", "this", "that", "which",
    "should", "have", "has", "had", "does", "about", "tell", "me", "there", "according",
    "during", "generally", "someone", "anyone", "explain", "warn", "warned", "warning",
    "know", "when", "why", "where", "who", "please", "could", "would", "been", "also",
    "into", "onto", "than", "then", "over", "under", "between", "among", "through",
    "before", "after", "while", "will", "were", "being", "more", "most", "other",
    "some", "such", "only", "own", "same", "very",
    "like", "seek", "seeking", "sought", "attention", "relevant", "important", "importance",
    "maximum", "minimum", "highest", "lowest", "many", "much", "daily", "day", "days",
    "week", "weeks", "month", "months", "year", "years", "time", "times",
    "take", "takes", "took", "taken", "taking", "call", "calling", "visit", "go", "get",
    "need", "needs", "needed", "want", "wants", "help", "information", "info", "details", "detail",
    "occur", "occurs", "occurred", "occurring"
}

GENERAL_CLINICAL_TERMS = {
    "dosage", "dose", "doses", "dosing", "contraindication", "contraindications", "contraindicated",
    "precaution", "precautions", "warning", "warnings", "interaction", "interactions", "interact",
    "side", "effect", "effects", "adverse", "reaction", "reactions", "treatment", "therapy",
    "management", "guideline", "guidelines", "protocol", "protocols", "recommendation", "recommendations",
    "recommended", "recommends", "recommend", "approved", "prescribe", "prescribed", "prescribing",
    "indication", "indications", "usage", "use", "uses", "used", "using",
    "standard", "initial", "start", "starting", "titration", "titrate", "maintenance",
    "population", "populations", "patient", "patients", "adult", "adults", "pediatric",
    "child", "children", "elderly", "acute", "chronic", "severe", "mild", "moderate",
    "failure", "heart", "renal", "kidney", "hepatic", "liver", "hypertension", "diabetes",
    "infection", "infections", "impairment", "disease", "condition", "blood", "pressure",
    "taking", "give", "given", "administer", "administered", "administering", "administration",
    "safe", "safety", "concerning", "harmful", "overview", "diagnosis", "symptoms", "causes",
    "prevention", "clinical", "medical", "fever", "pain", "headache", "nausea", "vomiting",
    "dizziness", "fatigue", "cough", "rash", "swelling", "edema", "diarrhea", "constipation",
    "syndrome", "drug", "drugs",
    "medicine", "medicines", "medication", "medications", "pill", "pills", "tablet", "tablets",
    "capsule", "capsules", "test", "tests", "testing", "care", "health", "target", "targets",
    "fasting", "level", "levels", "glucose", "icmr", "mohfw", "dailymed", "fda", "stg",
    "pharmacology", "pharmacological", "pharmacokinetics", "pharmacodynamic", "pharmacodynamics",
    "mechanism", "mechanisms", "action", "actions",
    "absorption", "kinetics", "metabolism", "excretion", "clearance", "plasma", "serum",
    "concentration", "concentrations", "mg", "ml", "oral", "intravenous", "injection",
    "maximum", "max", "minimum", "min", "daily", "schedule", "routine", "emergency", "urgent", "attention",
    "alone", "cause", "causes", "causing", "consider", "considering", "know", "hypoglycemia", "elevate", "elevation",
    "reduce", "reduction", "increase", "increases", "increased", "lowering", "lower", "high", "low"
}



class EvidencePolicyEngine:
    """
    Deterministic policy evaluator that assesses retrieved evidence and determines
    whether downstream answer generation should be authorized or safely blocked.
    """
    def __init__(
        self,
        config: Optional[EvidencePolicyConfig] = None,
        normalizer: Optional[ClinicalEntityNormalizer] = None
    ):
        self.config = config or EvidencePolicyConfig()
        self.normalizer = normalizer or ClinicalEntityNormalizer()
        self.contradiction_regexes = [
            (re.compile(p1, re.IGNORECASE), re.compile(p2, re.IGNORECASE))
            for p1, p2 in CONTRADICTION_PAIRS
        ]

    def evaluate_evidence(
        self,
        query: str,
        evidence_items: List[Any],
        retrieval_mode: str = "hybrid"
    ) -> GroundingDecision:
        """
        Evaluates a list of EvidenceItem objects and returns an auditable GroundingDecision.
        """
        start_time = time.perf_counter()
        warnings: List[str] = []
        reason_codes: List[GroundingReasonCode] = []

        # 1. Zero evidence check
        if not evidence_items:
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            return GroundingDecision(
                status=GroundingStatus.INSUFFICIENT_EVIDENCE,
                generation_allowed=False,
                evidence_count=0,
                usable_evidence_count=0,
                provenance_valid=False,
                top_evidence_rank=None,
                evidence_sources=[],
                evidence_documents=[],
                evidence_sections=[],
                reason_codes=[GroundingReasonCode.NO_EVIDENCE],
                warnings=["No relevant evidence chunks were retrieved from the knowledge base."],
                conflict_detected=False,
                conflict_summary=None,
                policy_latency_ms=round(elapsed_ms, 3)
            )

        # 2. Provenance and Quality Screening for each item
        usable_items = []
        sources_set: Set[str] = set()
        docs_set: Set[str] = set()
        sections_set: Set[str] = set()
        all_provenance_valid = True

        for item in evidence_items:
            prov_res = ProvenanceValidator.validate_evidence_item(item)
            if not prov_res.is_valid:
                all_provenance_valid = False
                if prov_res.status == ProvenanceStatus.PARTIALLY_IDENTIFIED:
                    warnings.append(f"Chunk '{prov_res.chunk_id}' has partial provenance: missing {prov_res.missing_fields}")
                else:
                    warnings.append(f"Chunk '{prov_res.chunk_id}' has invalid provenance: missing {prov_res.missing_fields}")
                    continue  # Skip completely invalid chunks

            # Check text length
            text_val = str(getattr(item, "text", "") if hasattr(item, "text") else item.get("text", "")).strip()
            word_count = len(text_val.split())
            if word_count < self.config.source_policy.min_word_count:
                warnings.append(f"Chunk has insufficient text content ({word_count} words).")
                continue

            usable_items.append(item)
            src = str(getattr(item, "source_id", "") if hasattr(item, "source_id") else item.get("source_id", ""))
            doc = str(getattr(item, "document_id", "") if hasattr(item, "document_id") else item.get("document_id", ""))
            sec = str(getattr(item, "section", "") if hasattr(item, "section") else item.get("section", ""))

            if src:
                sources_set.add(src)
            if doc:
                docs_set.add(doc)
            if sec:
                sections_set.add(sec)

        # 3. Handle case where all items failed provenance or quality
        if not usable_items:
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            return GroundingDecision(
                status=GroundingStatus.INSUFFICIENT_EVIDENCE,
                generation_allowed=False,
                evidence_count=len(evidence_items),
                usable_evidence_count=0,
                provenance_valid=False,
                top_evidence_rank=None,
                evidence_sources=list(sources_set),
                evidence_documents=list(docs_set),
                evidence_sections=list(sections_set),
                reason_codes=[GroundingReasonCode.INVALID_PROVENANCE, GroundingReasonCode.INSUFFICIENT_COVERAGE],
                warnings=warnings + ["All retrieved candidate chunks failed provenance or quality validation."],
                conflict_detected=False,
                conflict_summary=None,
                policy_latency_ms=round(elapsed_ms, 3)
            )

        top_item = usable_items[0]
        top_rank = int(getattr(top_item, "rank", 1) if hasattr(top_item, "rank") else top_item.get("rank", 1))

        # 4. Lexical Grounding & Clinical Subject Entity Verification
        # Distinguishes target clinical subject (e.g. 'cardioregulin', 'metformin')
        # from generic medical vocabulary (e.g. 'dosage', 'heart', 'failure').
        query_words = [
            w for w in re.findall(r'\b[a-zA-Z0-9_-]+\b', query.lower())
            if len(w) >= 3 and w not in COMMON_STOPWORDS
        ]

        # Identify candidate subject entity tokens (tokens not in generic clinical stoplist)
        subject_tokens = [
            w for w in query_words
            if w not in GENERAL_CLINICAL_TERMS and len(w) >= 4
        ]

        combined_top_text = " ".join([
            f"{getattr(it, 'title', '')} {getattr(it, 'section', '')} {getattr(it, 'text', '')}".lower()
            if hasattr(it, 'text') else f"{it.get('title', '')} {it.get('section', '')} {it.get('text', '')}".lower()
            for it in usable_items[:10]
        ])

        # If user queried a specific named subject entity, verify it appears in retrieved evidence
        is_unsupported_entity = False
        missing_entity = None
        if subject_tokens:
            unmatched_tokens = []
            matched_tokens = []
            for tok in subject_tokens:
                clean_tok = re.sub(r'(s|es|ing|ed|al|ic|ical|in|ine)$', '', tok)
                matched = (
                    re.search(r'\b' + re.escape(tok) + r'\b', combined_top_text) is not None or
                    (len(clean_tok) >= 4 and re.search(r'\b' + re.escape(clean_tok) + r'(?:s|es|ing|ed|al|ic|ical|in|ine)?\b', combined_top_text) is not None)
                )
                if not matched and self.normalizer:
                    norm = self.normalizer.normalize_term(tok)
                    if norm:
                        canon = norm.canonical_name.lower()
                        if (
                            re.search(r'\b' + re.escape(canon) + r'\b', combined_top_text) is not None or
                            (len(canon) >= 4 and re.search(r'\b' + re.escape(canon[:4]) + r'\b', combined_top_text) is not None)
                        ):
                            matched = True
                if matched:
                    matched_tokens.append(tok)
                else:
                    unmatched_tokens.append(tok)

            # An entity is unsupported if NONE of the candidate subject tokens matched in verified evidence (e.g. 'imaginaryzol')
            if len(matched_tokens) == 0:
                is_unsupported_entity = True
                missing_entity = unmatched_tokens[0] if unmatched_tokens else "unknown"

        overlap_ratio = 1.0
        if query_words:
            matched_words = 0
            for w in query_words:
                clean_w = re.sub(r'(s|es|ing|ed)$', '', w)
                matched = (
                    re.search(r'\b' + re.escape(w) + r'\b', combined_top_text) is not None or
                    (len(clean_w) >= 3 and re.search(r'\b' + re.escape(clean_w) + r'\b', combined_top_text) is not None)
                )
                if not matched and self.normalizer:
                    norm = self.normalizer.normalize_term(w)
                    if norm and re.search(r'\b' + re.escape(norm.canonical_name.lower()) + r'\b', combined_top_text) is not None:
                        matched = True
                if matched:
                    matched_words += 1
            overlap_ratio = matched_words / len(query_words)

        # 5. Heuristic Retrieval Score Evaluation
        mode_lower = retrieval_mode.lower()
        top_score = float(getattr(top_item, "score", 0.0) if hasattr(top_item, "score") else top_item.get("score", 0.0))
        dense_score = getattr(top_item, "dense_score", None) if hasattr(top_item, "dense_score") else top_item.get("dense_score")
        bm25_score = getattr(top_item, "bm25_score", None) if hasattr(top_item, "bm25_score") else top_item.get("bm25_score")
        if dense_score is None and top_score >= 0.5:
            dense_score = top_score

        # Out of domain check:
        # A query is out of domain if substantive query word overlap is extremely low (< 35%),
        # or if subject tokens exist and either none matched or fewer than 35% of them matched with no clinical intent.
        # Detect clinical intent from the unfiltered query too. The substantive
        # overlap list excludes some defining medical terms such as hypoglycemia.
        raw_query_words = set(re.findall(r"\b[a-zA-Z][a-zA-Z'-]{2,}\b", query.lower()))
        explicit_clinical_cues = {
            "clinical", "clinician", "medical", "patient", "patients",
            "diabetes", "diabetic", "hypoglycemia", "hypoglycemic", "glucose",
            "insulin", "symptom", "symptoms", "sign", "signs", "assessment",
            "triage", "medication", "medications",
            "medicine", "medicines", "drug", "drugs", "contraindication",
            "contraindications", "dosage", "dose", "hypertension", "renal",
            "kidney", "hepatic", "liver", "blood", "pressure", "adverse",
            "reaction", "reactions", "treatment", "diagnosis", "diagnostic",
            "warning", "warnings", "emergency", "stroke", "seizure", "fever"
        }
        has_clinical_intent = (
            any(w in GENERAL_CLINICAL_TERMS for w in query_words)
            or bool(raw_query_words.intersection(explicit_clinical_cues))
        )
        subject_match_ratio = (len(matched_tokens) / len(subject_tokens)) if subject_tokens else 1.0
        is_out_of_domain = bool(
            query_words and (
                (overlap_ratio < 0.35 and not has_clinical_intent) or
                (not has_clinical_intent and subject_match_ratio < 0.5)
            )
        )

        is_strong = False
        is_weak = False
        is_unsupported = is_out_of_domain or is_unsupported_entity

        if not is_unsupported:
            if mode_lower == "dense":
                score_to_check = dense_score if dense_score is not None else top_score
                if score_to_check >= self.config.dense_grounded_threshold and overlap_ratio >= 0.50:
                    is_strong = True
                elif score_to_check >= self.config.dense_weak_threshold:
                    is_weak = True
                else:
                    is_unsupported = True

            elif mode_lower == "bm25":
                score_to_check = bm25_score if bm25_score is not None else top_score
                if score_to_check >= 10.0 and overlap_ratio >= 0.50:
                    is_strong = True
                elif score_to_check >= self.config.bm25_weak_threshold:
                    is_weak = True
                else:
                    is_unsupported = True

            else:  # hybrid or hybrid_rerank
                has_bm25_hit = bm25_score is not None and bm25_score > 0.0
                has_strong_dense = dense_score is not None and dense_score >= self.config.dense_grounded_threshold

                if has_strong_dense and (has_bm25_hit or overlap_ratio >= 0.50):
                    is_strong = True
                elif has_strong_dense or (dense_score is not None and dense_score >= self.config.dense_weak_threshold):
                    is_weak = True
                elif has_bm25_hit and overlap_ratio >= 0.35:
                    is_weak = True
                else:
                    is_unsupported = True

        # 6. Evidence Conflict Analysis
        conflict_detected = False
        conflict_summary = None
        if self.config.enable_conflict_detection and len(usable_items) >= 2:
            conflict_detected, conflict_summary = self._scan_evidence_conflicts(usable_items)

        # 7. Synthesize Final Grounding Decision
        if conflict_detected:
            final_status = GroundingStatus.CONFLICTING_EVIDENCE
            generation_allowed = False
            reason_codes.append(GroundingReasonCode.CONFLICT_DETECTED)
            warnings.append(f"Contradictory evidence signals detected: {conflict_summary}")

        elif is_unsupported_entity or is_unsupported:
            final_status = GroundingStatus.INSUFFICIENT_EVIDENCE
            generation_allowed = False
            if is_out_of_domain:
                reason_codes.append(GroundingReasonCode.OUT_OF_DOMAIN)
                warnings.append(f"Substantive query term overlap ({overlap_ratio:.0%}) is below domain threshold; query appears out-of-domain.")
            if is_unsupported_entity:
                reason_codes.append(GroundingReasonCode.UNSUPPORTED_ENTITY)
                warnings.append(f"Primary query subject entity '{missing_entity}' was not found in verified evidence passages.")
            if not is_out_of_domain and not is_unsupported_entity:
                reason_codes.append(GroundingReasonCode.LOW_RETRIEVAL_SCORE)
                warnings.append("Top retrieved evidence score is below minimum relevance floor.")

        elif is_weak:
            final_status = GroundingStatus.WEAK_EVIDENCE
            generation_allowed = self.config.allow_weak_generation
            reason_codes.append(GroundingReasonCode.LOW_RETRIEVAL_SCORE)
            if generation_allowed:
                warnings.append("Evidence retrieval scores are marginal; downstream generation should express appropriate clinical caveats.")
            else:
                warnings.append("Evidence retrieval scores are marginal; downstream generation blocked under strict policy.")

        else:  # is_strong
            if len(usable_items) >= self.config.min_usable_chunks:
                final_status = GroundingStatus.GROUNDED
                generation_allowed = True
                reason_codes.append(GroundingReasonCode.EVIDENCE_SUFFICIENT)
            else:
                final_status = GroundingStatus.WEAK_EVIDENCE
                generation_allowed = self.config.allow_weak_generation
                reason_codes.append(GroundingReasonCode.INSUFFICIENT_COVERAGE)
                warnings.append("Usable chunk count is limited.")


        if not all_provenance_valid and final_status == GroundingStatus.GROUNDED:
            reason_codes.append(GroundingReasonCode.PARTIAL_PROVENANCE)

        if generation_allowed:
            accepted_ids = [
                str(getattr(it, "chunk_id", "") if hasattr(it, "chunk_id") else it.get("chunk_id", ""))
                for it in usable_items
                if str(getattr(it, "chunk_id", "") if hasattr(it, "chunk_id") else it.get("chunk_id", ""))
            ]
        else:
            accepted_ids = []

        elapsed_ms = (time.perf_counter() - start_time) * 1000.0

        return GroundingDecision(
            status=final_status,
            generation_allowed=generation_allowed,
            evidence_count=len(evidence_items),
            usable_evidence_count=len(usable_items),
            accepted_chunk_ids=accepted_ids,
            provenance_valid=all_provenance_valid,
            top_evidence_rank=top_rank,
            evidence_sources=sorted(list(sources_set)),
            evidence_documents=sorted(list(docs_set)),
            evidence_sections=sorted(list(sections_set)),
            reason_codes=reason_codes,
            warnings=warnings,
            conflict_detected=conflict_detected,
            conflict_summary=conflict_summary,
            policy_latency_ms=round(elapsed_ms, 3)
        )


    def _scan_evidence_conflicts(self, items: List[Any]) -> Tuple[bool, Optional[str]]:
        """
        Scans for contradictory assertions between chunks sharing the same entity or clinical topic.
        """
        # Compare top 3 chunks pairwise
        sample_items = items[:3]
        for i in range(len(sample_items)):
            item_i = sample_items[i]
            text_i = str(getattr(item_i, "text", "") if hasattr(item_i, "text") else item_i.get("text", ""))
            sec_i = str(getattr(item_i, "section", "") if hasattr(item_i, "section") else item_i.get("section", ""))
            doc_i = str(getattr(item_i, "document_id", "") if hasattr(item_i, "document_id") else item_i.get("document_id", ""))
            title_i = str(getattr(item_i, "title", "") if hasattr(item_i, "title") else item_i.get("title", "")).lower()

            for j in range(i + 1, len(sample_items)):
                item_j = sample_items[j]
                text_j = str(getattr(item_j, "text", "") if hasattr(item_j, "text") else item_j.get("text", ""))
                sec_j = str(getattr(item_j, "section", "") if hasattr(item_j, "section") else item_j.get("section", ""))
                doc_j = str(getattr(item_j, "document_id", "") if hasattr(item_j, "document_id") else item_j.get("document_id", ""))
                title_j = str(getattr(item_j, "title", "") if hasattr(item_j, "title") else item_j.get("title", "")).lower()

                # Extract primary subject entity to prevent false positive cross-drug conflict flags
                drug_i = title_i.split("-")[0].strip() if "-" in title_i else title_i
                drug_j = title_j.split("-")[0].strip() if "-" in title_j else title_j

                # Only check for clinical conflict if chunks reference the same document or drug entity
                is_same_entity = (doc_i == doc_j) or (drug_i and drug_j and (drug_i in drug_j or drug_j in drug_i))

                if is_same_entity:
                    for reg_a, reg_b in self.contradiction_regexes:
                        if (reg_a.search(text_i) and reg_b.search(text_j)) or (reg_b.search(text_i) and reg_a.search(text_j)):
                            return True, f"Conflict detected for '{drug_i}' between Chunk {i+1} ('{sec_i}') and Chunk {j+1} ('{sec_j}') regarding clinical assertions."

        return False, None

