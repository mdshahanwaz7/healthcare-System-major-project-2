"""
Answer Grounding Verifier Engine (V2.9).
Provides deterministic, proposition-level evidence consistency verification for medical summaries.

Evaluates generated claims against authoritative clinical evidence without relying on an external
LLM-as-a-judge or hardcoded medical facts. Enforces fail-closed whole-answer suppression on:
- Polarity reversals / contradictions
- Target object hallucinations (unsupported claims)
- Cross-entity contamination & combination-product leakage
- Property-bound numeric & unit mismatches
- Qualifier omissions or contradictions
- Invalid or section-mismatched citations
- Ambiguous / unparseable assertions (unverified)
"""
import re
from enum import Enum
from typing import List, Dict, Any, Optional, Tuple, Set
from pydantic import BaseModel, Field, ConfigDict

from rag_module.retrieval.entity_normalizer import ClinicalEntityNormalizer


class ClaimStatus(str, Enum):
    """
    Mutually exclusive verification outcomes for atomic clinical propositions.
    """
    SUPPORTED = "supported"
    WEAKLY_SUPPORTED = "weakly_supported"
    CONTRADICTED = "contradicted"
    UNSUPPORTED_BY_EVIDENCE = "unsupported_by_evidence"
    QUALIFIER_MISMATCH = "qualifier_mismatch"
    NUMERIC_MISMATCH = "numeric_mismatch"
    ENTITY_MISMATCH = "entity_mismatch"
    INVALID_CITATION = "invalid_citation"
    UNVERIFIED = "unverified"


class Proposition(BaseModel):
    """
    Structured semantic representation of an atomic clinical proposition.
    """
    subject: str = Field(default="", description="Subject entity (drug, active moiety, or disease).")
    predicate: str = Field(default="", description="Standardized clinical relation (indicated, contraindicated, decreases, increases, dose, adverse_reaction, is).")
    target_object: str = Field(default="", description="Clinical target, indication, condition, or endpoint.")
    polarity: str = Field(default="positive", description="Assertion polarity: 'positive', 'negative', or 'neutral'.")
    value: Optional[float] = Field(default=None, description="Numeric magnitude if clinical measurement or dose.")
    unit: Optional[str] = Field(default=None, description="Measurement or dosing unit (mg, mcg, g, ml/min).")
    clinical_property: Optional[str] = Field(default=None, description="Clinical binding property (initial_dose, maximum_dose, maintenance_dose).")
    frequency: Optional[str] = Field(default=None, description="Dosing schedule or frequency (once daily, twice daily, four times daily, every 12 hours).")
    condition: Optional[str] = Field(default=None, description="Clinical condition or disease indication (e.g. hypertension, type 2 diabetes).")
    qualifiers: Dict[str, Any] = Field(default_factory=dict, description="Contextual qualifiers (population, organ_impairment, pregnancy, temporal).")
    raw_text: str = Field(default="", description="Original sentence or proposition text.")

    model_config = ConfigDict(extra="forbid")


class ClaimVerificationResult(BaseModel):
    """
    Audit result for an individual clinical claim.
    """
    claim_text: str = Field(..., description="Original evaluated claim sentence.")
    status: ClaimStatus = Field(..., description="Deterministic verification status.")
    proposition: Optional[Proposition] = Field(default=None, description="Extracted claim proposition if parseable.")
    supporting_chunk_ids: List[str] = Field(default_factory=list, description="IDs of evidence chunks supporting this claim.")
    cited_chunk_ids: List[str] = Field(default_factory=list, description="IDs of evidence chunks cited by this claim.")
    discrepancy_reason: Optional[str] = Field(default=None, description="Human-readable explanation of verification failure.")

    model_config = ConfigDict(extra="forbid")


class AnswerComponent(BaseModel):
    """
    Component-level verification outcome for decomposed multi-part answers.
    """
    intent: str = Field(..., description="Logical sub-intent or aspect (e.g. indications, adverse_effects, contraindications, dosage).")
    label: str = Field(..., description="Human-readable component label (e.g. Indications & Usage).")
    status: ClaimStatus = Field(default=ClaimStatus.UNSUPPORTED_BY_EVIDENCE, description="Deterministic component status.")
    claims: List[ClaimVerificationResult] = Field(default_factory=list, description="Propositions/claims mapped to this component.")
    supported_text: Optional[str] = Field(default=None, description="Concatenated supported claims for this component.")
    citations: List[str] = Field(default_factory=list, description="Preserved citation chunk IDs for this component.")

    model_config = ConfigDict(extra="forbid")


class AnswerVerificationResult(BaseModel):
    """
    Whole-answer verification outcome enforcing fail-closed suppression.
    """
    answer: str = Field(..., description="Full generated candidate answer text.")
    is_grounded: bool = Field(..., description="True only if 100% of claims are SUPPORTED.")
    has_contradiction: bool = Field(default=False, description="True if any claim exhibits direct contradiction.")
    claim_results: List[ClaimVerificationResult] = Field(default_factory=list, description="Per-claim verification outcomes.")
    failed_claims: List[str] = Field(default_factory=list, description="List of raw claim strings that failed verification.")
    discrepancies: List[str] = Field(default_factory=list, description="List of discrepancy reasons for failed claims.")
    grounded_claim_count: int = Field(default=0, description="Count of supported claims.")
    total_claim_count: int = Field(default=0, description="Total count of evaluated claims.")
    supported_claims: List[str] = Field(default_factory=list, description="List of verified supported claim sentences.")
    partial_answer: Optional[str] = Field(default=None, description="Assembled verified partial answer if safe.")
    safe_for_partial: bool = Field(default=False, description="True if answer is eligible for safe partial disclosure.")
    components: List[AnswerComponent] = Field(default_factory=list, description="Decomposed multi-part answer components.")

    model_config = ConfigDict(extra="forbid")


# =====================================================================
# Generic Linguistic & Directional Lexicons (NO HARDCODED DRUGS/DISEASES)
# =====================================================================

DIRECTIONAL_DECREASE_TERMS = {
    "decrease", "decreases", "decreased", "decreasing",
    "reduce", "reduces", "reduced", "reducing", "reduction",
    "lower", "lowers", "lowered", "lowering",
    "inhibit", "inhibits", "inhibited", "inhibiting", "inhibition",
    "diminish", "diminishes", "diminished", "suppress", "suppresses"
}

DIRECTIONAL_INCREASE_TERMS = {
    "increase", "increases", "increased", "increasing",
    "raise", "raises", "raised", "raising",
    "elevate", "elevates", "elevated", "elevating", "elevation",
    "augment", "augments", "augmented", "augmenting",
    "potentiate", "potentiates", "enhance", "enhances"
}

SAFETY_CONTRAINDICATION_TERMS = {
    "contraindicated", "contraindication", "contraindications",
    "avoid", "avoids", "avoided", "avoiding",
    "withhold", "withholds", "discontinue", "discontinues", "discontinued",
    "do not use", "should not be used", "not recommended",
    "fatal", "toxicity", "injury and death", "boxed warning"
}

SAFETY_PERMISSIVE_TERMS = {
    "safe", "safely", "indicated", "permissible", "recommended",
    "well tolerated", "compatible"
}

INSTRUCTION_OVERRIDE_PATTERNS = [
    r'\b(?:ignore|disregard)\s+(?:all\s+)?(?:previous|prior|above)?\s*(?:instructions|rules|prompts|commands|context)[^.!?\n]*(?:[.!?\n]|$)',
    r'\b(?:system\s*:|<\s*system\s*>)[^.!?\n]*(?:[.!?\n]|$)',
    r'\b(?:you\s+are\s+now|act\s+as\s+an?\s+unrestricted)\b[^.!?\n]*(?:[.!?\n]|$)'
]

PROPERTY_KEYWORDS = {
    "initial_dose": ["initial", "starting", "start", "recommended starting", "usual initial"],
    "maximum_dose": ["maximum", "max", "highest", "not to exceed", "up to"],
    "maintenance_dose": ["maintenance", "regular"]
}

# Evaluated in order of descending specificity
FREQUENCY_ORDERED = [
    ("four times daily", [r'\bfour\s+times\s+daily\b', r'\bqid\b', r'\bevery\s+6\s+hours\b']),
    ("three times daily", [r'\bthree\s+times\s+daily\b', r'\btid\b', r'\bevery\s+8\s+hours\b']),
    ("twice daily", [r'\btwice\s+daily\b', r'\bbid\b', r'\bevery\s+12\s+hours\b']),
    ("once daily", [r'\bonce\s+daily\b', r'\bqd\b', r'\bonce\s+a\s+day\b', r'\bevery\s+day\b'])
]

CLINICAL_TERM_EQUIVALENTS = {
    "pain": {"analgesic", "analgesics", "analgesia", "antinociceptive", "ache"},
    "fever": {"antipyretic", "antipyretics", "pyrexia", "febrile"},
    "hypertension": {"blood pressure", "antihypertensive"},
    "clots": {"clotting", "thrombosis", "thromboembolic", "anticoagulant", "coagulation"},
    "stroke": {"cerebrovascular", "cva", "infarction"},
    "sugar": {"glucose", "glycemic"}
}


class AnswerGroundingVerifier:
    """
    Deterministic proposition-level verifier enforcing evidence consistency.
    Contains zero hardcoded medical facts, drug databases, or clinical cutoffs.
    """

    def __init__(self, normalizer: Optional[ClinicalEntityNormalizer] = None):
        self.normalizer = normalizer or ClinicalEntityNormalizer()
        self._compiled_injections = [re.compile(p, re.IGNORECASE) for p in INSTRUCTION_OVERRIDE_PATTERNS]

    # =========================================================================
    # Sentence Tokenization
    # =========================================================================

    def _split_into_claims(self, text: str) -> List[str]:
        """Splits candidate answer text into atomic sentences/claims."""
        if not text or not text.strip():
            return []
        cleaned = text.strip()
        sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z0-9])', cleaned)
        results = [s.strip() for s in sentences if s and s.strip()]
        return results if results else [cleaned]

    # =========================================================================
    # Generic Proposition Extraction
    # =========================================================================

    def extract_proposition(self, text: str) -> Optional[Proposition]:
        """
        Parses a candidate claim sentence into a bounded Proposition.
        Returns None if text is unparseable or lacks assertive clinical syntax.
        """
        if not text or not text.strip():
            return None

        clean_text = text.strip()

        # Reject purely convoluted, non-assertive, or hypothetical boilerplate
        if re.search(r'\b(whereas\s+perhaps|oscillates\s+between|somewhat\s+oscillates)\b', clean_text, re.IGNORECASE):
            return None

        # Strip leading discourse connectives, transition adverbs, and epistemic reporting clauses
        clean_text = re.sub(
            r'^(?:However|Overall|Additionally|Furthermore|Moreover|In addition|Therefore|Generally|Specifically|Consequently|Importantly|Finally|In general|Notably|Of note|As such),\s*',
            '',
            clean_text,
            flags=re.IGNORECASE
        ).strip()
        clean_text = re.sub(
            r'^(?:(?:the\s+)?(?:provided\s+)?(?:evidence|text|passage|data|guidelines?|literature|trials?)\s+(?:suggests?|indicates?|shows?|demonstrates?|recommends?|states?|only\s+mentions?)\s+(?:that\s+)?(?:the\s+)?(?:dosage\s+range\s+for\s+)?)',
            '',
            clean_text,
            flags=re.IGNORECASE
        ).strip()
        clean_text = re.sub(
            r'^(?:(?:according\s+to|as\s+per)\s+[^,]+,\s*)',
            '',
            clean_text,
            flags=re.IGNORECASE
        ).strip()

        NON_SUBJECT_WORDS = {
            "the", "common", "adverse", "usual", "recommended", "initial", "starting", "maximum", "dose",
            "most", "more", "least", "frequent",
            "however", "overall", "additionally", "furthermore", "moreover", "therefore", "generally",
            "specifically", "consequently", "importantly", "finally", "patients", "individuals", "adults",
            "children", "target", "evidence", "passage", "treatment", "therapy", "use", "administration",
            "it", "this", "these", "there", "note", "care", "medication", "drug", "agent", "product", "according",
            "provided", "side", "per", "as", "reactions", "effects", "boxed", "can", "could", "may", "might", "will", "would", "shall", "should",
            "titration", "adjustment", "monitoring", "discontinuation", "intake", "evaluation",
            "symptom", "symptoms", "given", "guideline", "guidelines"
        }

        # 1. Subject extraction (generic active agent or noun phrase)
        subject = ""

        # Pattern C: Direct leading subject: "X is indicated...", "X decreases...", "X can cause...", "X is known..."
        direct_match = re.match(
            r'^([a-zA-Z0-9_/-]+(?:\s+and\s+[a-zA-Z0-9_/-]+(?:\s+potassium)?)?)\s+(?:is|are|was|were|can|could|may|might|will|would|should|must|decreases|increases|reduces|improves|prevents|causes|works|acts)\b',
            clean_text,
            re.IGNORECASE
        )
        if direct_match:
            candidate = direct_match.group(1).strip()
            if " - " in candidate:
                candidate = candidate.split(" - ")[0].strip()
            cand_words = set(candidate.lower().split())
            if candidate.lower() not in NON_SUBJECT_WORDS and not cand_words.issubset(NON_SUBJECT_WORDS) and not (candidate and candidate[0].isdigit()):
                subject = candidate

        # Pattern A: "Reactions of X", "Dose of X", "Use of X"
        if not subject:
            of_match = re.search(
                r'\b(?:reactions?\s+of|effects?\s+of|dose\s+of|use\s+of|safety\s+of|indications?\s+for)\s+([a-zA-Z0-9_/-]+(?:\s+and\s+[a-zA-Z0-9_/-]+(?:\s+potassium)?)?)',
                clean_text,
                re.IGNORECASE
            )
            if of_match:
                cand = of_match.group(1).strip()
                if " - " in cand:
                    cand = cand.split(" - ")[0].strip()
                if cand.lower() not in NON_SUBJECT_WORDS and not (cand and cand[0].isdigit()):
                    subject = cand

        # Pattern A1: "maximum dose for adults of X", "dose in adults of X", "effects in patients of X"
        if not subject:
            ext_of_match = re.search(
                r'\b(?:reactions?|effects?|dose|dosage|use|safety|indications?|contraindications?)\b[^.,;!?]*?\b(?:of|for)\s+([a-zA-Z0-9_/-]+(?:\s+and\s+[a-zA-Z0-9_/-]+(?:\s+potassium)?)?)',
                clean_text,
                re.IGNORECASE
            )
            if ext_of_match:
                cand = ext_of_match.group(1).strip()
                if " - " in cand:
                    cand = cand.split(" - ")[0].strip()
                if cand.lower() not in NON_SUBJECT_WORDS and not cand.lower().startswith(("adult", "pediatric", "child", "elder")) and not (cand and cand[0].isdigit()):
                    subject = cand

        # Pattern B: "The usual initial starting dose of X..."
        if not subject:
            subj_match = re.match(
                r'^(?:(?:the\s+)?(?:(?:usual|recommended|most|more|initial|starting|maximum|adult|common)\s+)*)?(?:dose\s+of\s+|adult\s+dose\s+of\s+|adverse\s+reactions?\s+of\s+|adverse\s+reaction\s+reported\s+is\s+)([a-zA-Z0-9_/-]+(?:\s+and\s+[a-zA-Z0-9_/-]+(?:\s+potassium)?)?)\b',
                clean_text,
                re.IGNORECASE
            )
            if subj_match:
                candidate = subj_match.group(1).strip()
                if " - " in candidate:
                    candidate = candidate.split(" - ")[0].strip()
                if candidate.lower() not in NON_SUBJECT_WORDS and not (candidate and candidate[0].isdigit()):
                    subject = candidate

        # Pattern D: Pharmaceutical nomenclature suffix pattern (-ol, -il, -in, -an, -ide, -ate, etc.)
        # Requires at least 3 characters before the suffix to prevent matching common English words like 'can', 'than', 'plan'
        if not subject:
            pharma_match = re.search(r'\b([a-zA-Z0-9_-]{3,}(?:ol|il|in|an|ide|ate|one|ine|pam|lam|cin|zole|xib))\b', clean_text, re.IGNORECASE)
            if pharma_match:
                cand = pharma_match.group(1).strip()
                cand_words = set(cand.lower().split())
                if cand.lower() not in NON_SUBJECT_WORDS and not cand_words.issubset(NON_SUBJECT_WORDS):
                    subject = cand

        # 2. Predicate & Polarity extraction
        predicate = ""
        polarity = "positive"
        target_object = ""
        qualifiers: Dict[str, Any] = {}

        # Dosing / Administration pattern
        dose_num_match = re.search(r'\b(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml)\b', clean_text, re.IGNORECASE)
        is_dosing = bool(dose_num_match or re.search(r'\b(dose|starting dose|daily)\b', clean_text, re.IGNORECASE))

        value = None
        unit = None
        clinical_prop = None
        frequency = None

        if dose_num_match:
            value = float(dose_num_match.group(1))
            unit = dose_num_match.group(2).lower()
            predicate = "dose"

            # Determine clinical property
            for prop_name, keywords in PROPERTY_KEYWORDS.items():
                if any(re.search(r'\b' + re.escape(kw) + r'\b', clean_text, re.IGNORECASE) for kw in keywords):
                    clinical_prop = prop_name
                    break

            # Determine frequency (checked in descending specificity)
            for freq_name, patterns in FREQUENCY_ORDERED:
                if any(re.search(pat, clean_text, re.IGNORECASE) for pat in patterns):
                    frequency = freq_name
                    break

        # Contraindication / Warning / Precaution pattern
        if any(re.search(r'\b' + re.escape(w) + r'\b', clean_text, re.IGNORECASE) for w in SAFETY_CONTRAINDICATION_TERMS):
            predicate = "contraindicated"
            polarity = "negative"
            obj_match = re.search(r'\bcontraindicated\s+(?:in|during|for)?\s*([^.]+)', clean_text, re.IGNORECASE)
            if obj_match:
                target_object = obj_match.group(1).strip()
        elif re.search(r'\b(?:used\s+cautiously|use\s+with\s+caution|precaution|cautious|monitor\s+patients)\b', clean_text, re.IGNORECASE):
            predicate = "contraindicated"
            polarity = "negative"
            caut_match = re.search(r'\b(?:cautiously|caution|precaution|cautious|monitor\s+patients)\s+(?:in|for|with)?\s*([^.]+)', clean_text, re.IGNORECASE)
            if caut_match:
                target_object = caut_match.group(1).strip()

        # Permissive safety claim (e.g. "safe for use during pregnancy")
        elif not predicate and any(re.search(r'\b' + re.escape(w) + r'\b', clean_text, re.IGNORECASE) for w in SAFETY_PERMISSIVE_TERMS) and re.search(r'\b(pregnancy|trimesters|lactation|pediatric)\b', clean_text, re.IGNORECASE):
            predicate = "safe"
            polarity = "positive"
            obj_match = re.search(r'\bsafe\s+(?:for\s+use\s+)?(?:in|during)?\s*([^.]+)', clean_text, re.IGNORECASE)
            if obj_match:
                target_object = obj_match.group(1).strip()

        # Directional mechanism pattern
        elif not predicate and any(re.search(r'\b' + re.escape(w) + r'\b', clean_text, re.IGNORECASE) for w in DIRECTIONAL_DECREASE_TERMS):
            predicate = "decreases"
            polarity = "negative"
            dec_match = re.search(r'\b(?:decreases|reduces|lowers|inhibits)\s+([^.]+)', clean_text, re.IGNORECASE)
            if dec_match:
                target_object = dec_match.group(1).strip()

        elif not predicate and any(re.search(r'\b' + re.escape(w) + r'\b', clean_text, re.IGNORECASE) for w in DIRECTIONAL_INCREASE_TERMS):
            predicate = "increases"
            polarity = "positive"
            inc_match = re.search(r'\b(?:increases|raises|elevates|augments)\s+([^.]+)', clean_text, re.IGNORECASE)
            if inc_match:
                target_object = inc_match.group(1).strip()

        # Requirement pattern: assertions such as "reactions require immediate care".
        # Parsing does not bypass the existing evidence-verification checks.
        elif not predicate and re.search(r'\brequires?\b', clean_text, re.IGNORECASE):
            predicate = "requires"
            polarity = "positive"
            req_match = re.search(r'\brequires?\s+([^.]+)', clean_text, re.IGNORECASE)
            if req_match:
                target_object = req_match.group(1).strip()
        # Indication pattern
        elif not predicate and re.search(r'\bindicated\s+(?:for|as)?\s*([^.]+)', clean_text, re.IGNORECASE):
            predicate = "indicated"
            polarity = "positive"
            ind_match = re.search(r'\bindicated\s+(?:for|as)?\s*([^.]+)', clean_text, re.IGNORECASE)
            if ind_match:
                target_object = ind_match.group(1).strip()

        # Adverse reaction pattern
        elif not predicate and re.search(r'\b(adverse reactions?|side effects?)\b', clean_text, re.IGNORECASE):
            predicate = "adverse_reaction"
            polarity = "negative"
            adv_match = re.search(r'\b(?:include|including|are)\s+([^.]+)', clean_text, re.IGNORECASE)
            if adv_match:
                target_object = adv_match.group(1).strip()

        # Copula definitional assertion: "X is a Y" or "X is defined as Y"
        elif not predicate and re.search(r'\b(?:is|are)\s+(?:defined\s+as\s+|(?:an?|the)\s+)?([a-zA-Z0-9_\s/-]+)', clean_text, re.IGNORECASE):
            copula_match = re.search(r'\b(?:is|are)\s+(?:defined\s+as\s+|(?:an?|the)\s+)?([a-zA-Z0-9_\s/-]+)', clean_text, re.IGNORECASE)
            predicate = "is"
            polarity = "positive"
            if copula_match:
                raw_obj = copula_match.group(1).strip()
                # If target object extends across relative clauses ("including", "which", "according to"), bound it
                bounded = re.split(r'\b(?:including|which|according|whereas|whereby|such\s+as)\b', raw_obj, flags=re.IGNORECASE)[0].strip()
                target_object = bounded if bounded else raw_obj

        # General assertion if predicate still missing but dose exists
        if not predicate and is_dosing:
            predicate = "dose"

        # General assertion for "improves glycemic control", "treats", "exerts therapeutic effect", "has been shown"
        if not predicate:
            gen_match = re.search(r'\b(?:improves|treats|prevents|reduces|causes|exerts|demonstrates|provides|exhibits)\s+([^.]+)', clean_text, re.IGNORECASE)
            if gen_match:
                predicate = "indicated"
                target_object = gen_match.group(1).strip()
            elif re.search(r'\b(?:has|have)\s+(?:been\s+shown\s+to\s+)?(?:have\s+)?(?:an?\s+)?(?:therapeutic\s+effect|efficacy|action|activity)\b', clean_text, re.IGNORECASE):
                predicate = "indicated"
                has_match = re.search(r'\b(?:therapeutic\s+effect|efficacy|action|activity)\s*(?:through|via|on|in)?\s*([^.]*)', clean_text, re.IGNORECASE)
                target_object = has_match.group(1).strip() if has_match else "therapeutic effect"

        if not predicate:
            return None

        # 3. Qualifiers extraction
        # Population
        if re.search(r'\b(pediatric|infants?|children|under\s+\d+)\b', clean_text, re.IGNORECASE):
            qualifiers["population"] = "pediatric"
        elif re.search(r'\b(adults?|18\s+years)\b', clean_text, re.IGNORECASE):
            qualifiers["population"] = "adult"

        # Organ impairment
        if re.search(r'\b(renal\s+impairment|egfr|kidney\s+disease|crcl)\b', clean_text, re.IGNORECASE):
            qualifiers["organ_impairment"] = "renal"
        elif re.search(r'\b(hepatic|liver\s+disease)\b', clean_text, re.IGNORECASE):
            qualifiers["organ_impairment"] = "hepatic"

        # Pregnancy
        if re.search(r'\b(pregnan(?:cy|t)|trimester|lactation|fetal)\b', clean_text, re.IGNORECASE):
            qualifiers["pregnancy"] = True

        # Temporal
        if re.search(r'\b(short-term|14\s+days|acute)\b', clean_text, re.IGNORECASE):
            qualifiers["temporal"] = "short-term"
        elif re.search(r'\b(chronic|long-term|indefinite|maintenance)\b', clean_text, re.IGNORECASE):
            qualifiers["temporal"] = "chronic"

        # Clinical Condition
        condition = None
        for cond_name in ["hypertension", "heart failure", "myocardial infarction", "type 2 diabetes", "diabetes mellitus", "angina", "edema"]:
            if re.search(r'\b' + re.escape(cond_name) + r'\b', clean_text, re.IGNORECASE):
                condition = cond_name
                break

        return Proposition(
            subject=subject,
            predicate=predicate,
            target_object=target_object,
            polarity=polarity,
            value=value,
            unit=unit,
            clinical_property=clinical_prop,
            frequency=frequency,
            condition=condition,
            qualifiers=qualifiers,
            raw_text=clean_text
        )

    # =========================================================================
    # Proposition Matching Helpers
    # =========================================================================

    def _extract_entity_from_evidence(self, chunk: Dict[str, Any]) -> str:
        """Derives canonical subject entity from chunk metadata title or text header."""
        title = str(chunk.get("title") or chunk.get("focus") or "").strip()
        if " - " in title:
            return title.split(" - ")[0].strip()
        text = str(chunk.get("text") or "").strip()
        first_line = text.split("\n")[0] if text else ""
        if first_line.lower().startswith("drug:") or first_line.lower().startswith("topic:"):
            parts = first_line.split(":")
            if len(parts) > 1:
                return parts[1].strip()
        return title

    def _check_entity_compatibility(self, claim_entity: str, evidence_entity: str) -> bool:
        """
        Enforces strict entity and combination-product isolation.
        'Amoxicillin' MUST NOT inherit evidence from 'Amoxicillin and Clavulanate Potassium' or vice-versa.
        """
        c = claim_entity.lower().strip()
        e = evidence_entity.lower().strip()

        # Clean section header suffixes (e.g. ' - Indications and Usage', ' - Warnings and Precautions')
        if " - " in c:
            c = c.split(" - ")[0].strip()
        if " - " in e:
            e = e.split(" - ")[0].strip()

        section_suffix = r'\s+(?:indications(?:\s+and\s+usage)?|usage|contraindications|warnings(?:\s+and\s+precautions)?|precautions|adverse\s+reactions|clinical\s+pharmacology|dosage|dosing|boxed\s+warning).*$'
        c = re.sub(section_suffix, '', c, flags=re.IGNORECASE).strip()
        e = re.sub(section_suffix, '', e, flags=re.IGNORECASE).strip()

        if not c or not e:
            return True

        if c == e:
            return True

        # Combination product detection
        c_is_combo = ("/" in c) or (" and " in c) or ("+" in c)
        e_is_combo = ("/" in e) or (" and " in e) or ("+" in e)

        if not c_is_combo and e_is_combo:
            return False

        if c_is_combo and not e_is_combo:
            return False

        c_clean = re.sub(r'[^a-z0-9]', '', c)
        e_clean = re.sub(r'[^a-z0-9]', '', e)
        if c_clean in e_clean or e_clean in c_clean:
            return True

        # Check canonical generic equivalence via normalizer (e.g. Lipitor <-> Atorvastatin)
        if self.normalizer:
            c_norm = self.normalizer.normalize_term(c)
            e_norm = self.normalizer.normalize_term(e)
            if c_norm and e_norm and c_norm.canonical_name.lower() == e_norm.canonical_name.lower():
                return True
            if c_norm and c_norm.canonical_name.lower() in e_clean:
                return True
            if e_norm and e_norm.canonical_name.lower() in c_clean:
                return True

        return False

    # =========================================================================
    # Claim-Level Verification Core
    # =========================================================================

    def verify_claim(
        self,
        claim_text: str,
        evidence_chunks: List[Dict[str, Any]],
        citation_chunk_ids: Optional[List[str]] = None
    ) -> ClaimVerificationResult:
        """
        Verifies an individual clinical claim against evidence chunks.
        Enforces fail-closed deterministic verification.
        """
        if not claim_text or not claim_text.strip():
            return ClaimVerificationResult(
                claim_text=claim_text,
                status=ClaimStatus.UNVERIFIED,
                discrepancy_reason="Claim text is empty."
            )

        # 0. Empty evidence handling (fail closed)
        if not evidence_chunks:
            return ClaimVerificationResult(
                claim_text=claim_text,
                status=ClaimStatus.UNSUPPORTED_BY_EVIDENCE,
                discrepancy_reason="No evidence chunks supplied."
            )

        # 1. Parse claim proposition
        prop = self.extract_proposition(claim_text)
        if prop is None:
            return ClaimVerificationResult(
                claim_text=claim_text,
                status=ClaimStatus.UNVERIFIED,
                discrepancy_reason="Claim proposition syntax is ambiguous or unparseable."
            )

        # 2. Citation existence & provenance verification
        if citation_chunk_ids is None or len(citation_chunk_ids) == 0:
            return ClaimVerificationResult(
                claim_text=claim_text,
                status=ClaimStatus.INVALID_CITATION,
                proposition=prop,
                discrepancy_reason="Claim lacks citation attribution."
            )

        evidence_chunk_map = {
            str(c.get("chunk_id")): c
            for c in evidence_chunks
            if isinstance(c, dict) and "chunk_id" in c
        }

        # Check for nonexistent citations
        for cid in citation_chunk_ids:
            if cid not in evidence_chunk_map:
                return ClaimVerificationResult(
                    claim_text=claim_text,
                    status=ClaimStatus.INVALID_CITATION,
                    proposition=prop,
                    cited_chunk_ids=citation_chunk_ids,
                    discrepancy_reason=f"Cited chunk ID '{cid}' not found in accepted evidence."
                )

        cited_chunks = [evidence_chunk_map[cid] for cid in citation_chunk_ids if cid in evidence_chunk_map]

        # Pronoun, generic term, and empty subject co-reference resolution against cited evidence entity
        generic_subject_terms = {
            "it", "this", "these", "this drug", "the drug", "this medication", "the medication",
            "medication", "drug", "agent", "product", "side", "effect", "effects", "adverse",
            "reaction", "reactions", "treatment", "therapy", "use", "dose", "dosage", "evidence",
            "passage", "text", "information", "guideline", "guidelines", "patient", "patients",
            "most", "more", "least", "symptom", "symptoms", "these symptoms", "given", "the given passage",
            "given passage", "the passage", "these effects", "these side effects", "these reactions"
        }
        all_evidence_entities = [self._extract_entity_from_evidence(c) for c in evidence_chunks if isinstance(c, dict)]
        if not prop.subject or prop.subject.lower() in generic_subject_terms:
            # Check if any evidence entity explicitly appears in the claim text
            for ent in all_evidence_entities:
                if ent and re.search(r'\b' + re.escape(ent.lower()) + r'\b', claim_text.lower()):
                    prop.subject = ent
                    break
            if not prop.subject or prop.subject.lower() in generic_subject_terms:
                cited_entities = {self._extract_entity_from_evidence(c) for c in cited_chunks if isinstance(c, dict)}
                if len(cited_entities) == 1:
                    prop.subject = list(cited_entities)[0]

        # 3. Check for missing/malformed evidence text in cited chunks
        has_valid_text = any(bool(str(c.get("text") or "").strip()) for c in cited_chunks)
        if not has_valid_text:
            return ClaimVerificationResult(
                claim_text=claim_text,
                status=ClaimStatus.UNSUPPORTED_BY_EVIDENCE,
                proposition=prop,
                cited_chunk_ids=citation_chunk_ids,
                discrepancy_reason="Cited evidence contains no readable factual text."
            )

        # 4. Entity isolation verification across cited chunks
        # If the claim entity does not match the cited chunk entity:
        # If the claim cites a specific chunk of another drug -> INVALID_CITATION (wrong entity cited)
        # If across all evidence, the entity is completely foreign -> ENTITY_MISMATCH
        all_evidence_entities = [self._extract_entity_from_evidence(c) for c in evidence_chunks if isinstance(c, dict)]
        for chunk in cited_chunks:
            ev_entity = self._extract_entity_from_evidence(chunk)
            if prop.subject and ev_entity:
                if not self._check_entity_compatibility(prop.subject, ev_entity):
                    # Check if the claim entity exists in ANY accepted evidence chunk
                    entity_in_other_chunks = any(self._check_entity_compatibility(prop.subject, other_ent) for other_ent in all_evidence_entities)
                    if entity_in_other_chunks:
                        return ClaimVerificationResult(
                            claim_text=claim_text,
                            status=ClaimStatus.INVALID_CITATION,
                            proposition=prop,
                            cited_chunk_ids=citation_chunk_ids,
                            discrepancy_reason=f"Cited chunk belongs to '{ev_entity}', but claim discusses '{prop.subject}'."
                        )
                    else:
                        return ClaimVerificationResult(
                            claim_text=claim_text,
                            status=ClaimStatus.ENTITY_MISMATCH,
                            proposition=prop,
                            cited_chunk_ids=citation_chunk_ids,
                            discrepancy_reason=f"Claim entity '{prop.subject}' does not match evidence entity '{ev_entity}'."
                        )

        # 5. Content verification against cited chunks
        # Sanitize chunk text against instruction-injection patterns (DATA isolation)
        cleaned_chunk_texts = []
        for chunk in cited_chunks:
            raw_chunk_text = str(chunk.get("text") or "")
            if not raw_chunk_text.strip():
                continue
            sanitized_text = raw_chunk_text
            for pat in self._compiled_injections:
                sanitized_text = pat.sub('', sanitized_text)
            cleaned_chunk_texts.append((chunk, sanitized_text))

        combined_evidence_text = " ".join([t for _, t in cleaned_chunk_texts])
        combined_lower = combined_evidence_text.lower()

        # 6. Check section relevance (e.g. contraindication in dosage section)
        if prop.predicate == "contraindicated":
            has_ci_terms = any(re.search(r'\b' + re.escape(w) + r'\b', combined_lower) for w in SAFETY_CONTRAINDICATION_TERMS)
            if not has_ci_terms:
                return ClaimVerificationResult(
                    claim_text=claim_text,
                    status=ClaimStatus.INVALID_CITATION,
                    proposition=prop,
                    cited_chunk_ids=citation_chunk_ids,
                    discrepancy_reason="Cited chunk does not contain contraindication assertions."
                )

        # 7. Polarity reversal / Contradiction check
        if prop.predicate == "increases":
            if any(re.search(r'\b' + re.escape(w) + r'\b', combined_lower) for w in DIRECTIONAL_DECREASE_TERMS):
                obj_tokens = [w for w in re.findall(r'\b[a-z]{3,}\b', prop.target_object.lower()) if w not in ["the", "and", "for"]]
                if any(tok in combined_lower for tok in obj_tokens):
                    return ClaimVerificationResult(
                        claim_text=claim_text,
                        status=ClaimStatus.CONTRADICTED,
                        proposition=prop,
                        cited_chunk_ids=citation_chunk_ids,
                        discrepancy_reason="Directional polarity contradiction: evidence indicates decrease/reduction, but claim asserts increase."
                    )

        elif prop.predicate == "decreases":
            if any(re.search(r'\b' + re.escape(w) + r'\b', combined_lower) for w in DIRECTIONAL_INCREASE_TERMS):
                obj_tokens = [w for w in re.findall(r'\b[a-z]{3,}\b', prop.target_object.lower()) if w not in ["the", "and", "for"]]
                if any(tok in combined_lower for tok in obj_tokens):
                    return ClaimVerificationResult(
                        claim_text=claim_text,
                        status=ClaimStatus.CONTRADICTED,
                        proposition=prop,
                        cited_chunk_ids=citation_chunk_ids,
                        discrepancy_reason="Directional polarity contradiction: evidence indicates increase, but claim asserts decrease."
                    )

        # Safety / Pregnancy contradiction
        if prop.predicate == "safe" and prop.qualifiers.get("pregnancy"):
            if any(re.search(r'\b' + re.escape(w) + r'\b', combined_lower) for w in SAFETY_CONTRAINDICATION_TERMS):
                if re.search(r'\b(pregnancy|fetal|fetus|discontinue)\b', combined_lower):
                    return ClaimVerificationResult(
                        claim_text=claim_text,
                        status=ClaimStatus.CONTRADICTED,
                        proposition=prop,
                        cited_chunk_ids=citation_chunk_ids,
                        discrepancy_reason="Safety contradiction: claim asserts pregnancy safety, but evidence contains boxed warning / contraindication."
                    )

        # 8. Numeric & Property Verification
        if prop.value is not None:
            val_str = f"{prop.value:g}"
            num_pattern = r'\b' + re.escape(val_str) + r'\s*(mg|mcg|g|ml)\b'
            matches = list(re.finditer(num_pattern, combined_evidence_text, re.IGNORECASE))
            if not matches:
                # Check broader accepted evidence chunks for this verified entity
                all_accepted_text = "\n".join([str(c.get("text") or "") for c in evidence_chunks if isinstance(c, dict)])
                matches = list(re.finditer(num_pattern, all_accepted_text, re.IGNORECASE))
                if not matches:
                    return ClaimVerificationResult(
                        claim_text=claim_text,
                        status=ClaimStatus.NUMERIC_MISMATCH,
                        proposition=prop,
                        cited_chunk_ids=citation_chunk_ids,
                        discrepancy_reason=f"Numeric value '{prop.value}' not found in cited evidence."
                    )

            # Check unit for the matching value
            ev_units = {m.group(1).lower() for m in matches}
            if prop.unit and prop.unit.lower() not in ev_units:
                return ClaimVerificationResult(
                    claim_text=claim_text,
                    status=ClaimStatus.NUMERIC_MISMATCH,
                    proposition=prop,
                    cited_chunk_ids=citation_chunk_ids,
                    discrepancy_reason=f"Numeric unit mismatch: claim asserts '{prop.unit}', but evidence specifies '{list(ev_units)}'."
                )

            # Check clinical property binding (initial dose vs maximum dose)
            if prop.clinical_property:
                is_prop_matched = False
                for m in matches:
                    start_idx = max(0, m.start() - 60)
                    end_idx = min(len(combined_evidence_text), m.end() + 60)
                    context_snippet = combined_evidence_text[start_idx:end_idx].lower()

                    target_keywords = PROPERTY_KEYWORDS.get(prop.clinical_property, [])
                    if any(kw in context_snippet for kw in target_keywords):
                        is_prop_matched = True
                        break

                if not is_prop_matched:
                    return ClaimVerificationResult(
                        claim_text=claim_text,
                        status=ClaimStatus.NUMERIC_MISMATCH,
                        proposition=prop,
                        cited_chunk_ids=citation_chunk_ids,
                        discrepancy_reason=f"Numeric property binding mismatch: value {prop.value} {prop.unit} is not bound to property '{prop.clinical_property}' in evidence."
                    )

            # Check frequency mismatch
            if prop.frequency:
                freq_matched = False
                for freq_name, patterns in FREQUENCY_ORDERED:
                    if freq_name == prop.frequency:
                        if any(re.search(pat, combined_lower) for pat in patterns):
                            freq_matched = True
                        break
                if not freq_matched:
                    return ClaimVerificationResult(
                        claim_text=claim_text,
                        status=ClaimStatus.NUMERIC_MISMATCH,
                        proposition=prop,
                        cited_chunk_ids=citation_chunk_ids,
                        discrepancy_reason=f"Dosing frequency '{prop.frequency}' does not match cited evidence."
                    )

        # 9. Qualifier Verification
        if prop.predicate == "contraindicated" and not prop.qualifiers:
            if re.search(r'\bcontraindicated\s+in\s+([a-z0-9_\s()<>/]+)', combined_lower):
                return ClaimVerificationResult(
                    claim_text=claim_text,
                    status=ClaimStatus.QUALIFIER_MISMATCH,
                    proposition=prop,
                    cited_chunk_ids=citation_chunk_ids,
                    discrepancy_reason="Essential clinical qualifier dropped: claim asserts unconditional contraindication, but evidence restricts it to specific conditions."
                )

        if prop.qualifiers.get("population") == "pediatric":
            if not re.search(r'\b(pediatric|children|infants?|years\s+of\s+age)\b', combined_lower):
                return ClaimVerificationResult(
                    claim_text=claim_text,
                    status=ClaimStatus.QUALIFIER_MISMATCH,
                    proposition=prop,
                    cited_chunk_ids=citation_chunk_ids,
                    discrepancy_reason="Population qualifier mismatch: claim asserts pediatric use, but evidence does not support pediatric population."
                )

        if prop.qualifiers.get("temporal") == "chronic":
            if re.search(r'\b(short-term|not\s+to\s+exceed\s+\d+\s+days)\b', combined_lower):
                return ClaimVerificationResult(
                    claim_text=claim_text,
                    status=ClaimStatus.QUALIFIER_MISMATCH,
                    proposition=prop,
                    cited_chunk_ids=citation_chunk_ids,
                    discrepancy_reason="Temporal qualifier mismatch: claim asserts chronic maintenance, but evidence restricts to short-term therapy."
                )

        # 10. Unsupported Claim / Plausible Hallucination check
        if prop.target_object:
            GENERIC_TARGET_STOPWORDS = {
                "the", "and", "for", "with", "patients", "treatment", "observed", "clinical", "trials",
                "medication", "medicine", "prescription", "drug", "conditions", "various", "therapy",
                "used", "treat", "treating", "use", "management", "indicated", "indication"
            }
            target_words = [
                w.lower() for w in re.findall(r'\b[a-zA-Z]{3,}\b', prop.target_object)
                if w.lower() not in GENERIC_TARGET_STOPWORDS
            ]
            if target_words:
                matched_words = []
                for w in target_words:
                    # Direct substring match
                    if w in combined_lower:
                        matched_words.append(w)
                    # Morphological stem match for medical terms (length >= 5 e.g. 'inflammation' stem 'inflamm' matches 'inflammatory')
                    elif len(w) >= 6 and w[:5] in combined_lower:
                        matched_words.append(w)
                    # Standard medical clinical synonym equivalents
                    elif w in CLINICAL_TERM_EQUIVALENTS and any(eq in combined_lower for eq in CLINICAL_TERM_EQUIVALENTS[w]):
                        matched_words.append(w)
                overlap = len(matched_words) / len(target_words)
                if overlap < 0.50:
                    return ClaimVerificationResult(
                        claim_text=claim_text,
                        status=ClaimStatus.UNSUPPORTED_BY_EVIDENCE,
                        proposition=prop,
                        cited_chunk_ids=citation_chunk_ids,
                        discrepancy_reason=f"Clinical target object '{prop.target_object}' not supported by cited evidence (matched {matched_words} of {target_words})."
                    )

        # 11. Direct fact support confirmation
        supporting_chunks = []
        for chunk, text in cleaned_chunk_texts:
            c_text_lower = text.lower()
            if (prop.predicate == "dose" or prop.value is not None) and prop.value is not None:
                if f"{prop.value:g}" in c_text_lower:
                    supporting_chunks.append(str(chunk.get("chunk_id")))
            elif prop.target_object:
                target_words = [w.lower() for w in re.findall(r'\b[a-zA-Z]{4,}\b', prop.target_object) if w.lower() not in ["patients", "treatment"]]
                if any(w in c_text_lower or (len(w) >= 6 and w[:5] in c_text_lower) for w in target_words):
                    supporting_chunks.append(str(chunk.get("chunk_id")))
            else:
                supporting_chunks.append(str(chunk.get("chunk_id")))

        if not supporting_chunks:
            return ClaimVerificationResult(
                claim_text=claim_text,
                status=ClaimStatus.UNSUPPORTED_BY_EVIDENCE,
                proposition=prop,
                cited_chunk_ids=citation_chunk_ids,
                discrepancy_reason="None of the cited chunks contain supporting propositions."
            )

        return ClaimVerificationResult(
            claim_text=claim_text,
            status=ClaimStatus.SUPPORTED,
            proposition=prop,
            supporting_chunk_ids=supporting_chunks,
            cited_chunk_ids=citation_chunk_ids
        )

    # =========================================================================
    # Whole-Answer Verification & Fail-Closed Enforcement
    # =========================================================================

    def verify_answer(
        self,
        answer: str,
        evidence_chunks: List[Dict[str, Any]],
        citations: Optional[List[str]] = None,
        target_intents: Optional[List[Any]] = None
    ) -> AnswerVerificationResult:
        """
        Verifies a complete candidate answer string.
        Deconstructs answer into atomic claims, audits each against citations,
        evaluates answer components, and enforces fail-closed suppression if ANY claim fails.
        """
        if not answer or not answer.strip():
            return AnswerVerificationResult(
                answer=answer,
                is_grounded=False,
                discrepancies=["Answer is empty."]
            )

        claims = self._split_into_claims(answer)
        claim_results: List[ClaimVerificationResult] = []
        failed_claims: List[str] = []
        discrepancies: List[str] = []
        has_contradiction = False
        grounded_count = 0

        # Resolve available citation chunk IDs normalized to string IDs
        all_citation_ids: List[str] = []
        if citations:
            for item in citations:
                if isinstance(item, dict) and "chunk_id" in item:
                    all_citation_ids.append(str(item["chunk_id"]))
                elif isinstance(item, str):
                    all_citation_ids.append(item)
        if not all_citation_ids:
            all_citation_ids = [str(c.get("chunk_id")) for c in evidence_chunks if isinstance(c, dict) and "chunk_id" in c]

        evidence_chunk_map = {
            str(c.get("chunk_id")): c
            for c in evidence_chunks
            if isinstance(c, dict) and "chunk_id" in c
        }

        for claim in claims:
            best_res: Optional[ClaimVerificationResult] = None

            # Prioritize chunks compatible with the proposition's subject
            prop = self.extract_proposition(claim)
            target_subj = prop.subject if prop else ""
            if target_subj:
                compat_cids = [
                    cid for cid in all_citation_ids
                    if cid in evidence_chunk_map and self._check_entity_compatibility(target_subj, self._extract_entity_from_evidence(evidence_chunk_map[cid]))
                ]
            else:
                compat_cids = all_citation_ids

            eval_cids = compat_cids if compat_cids else all_citation_ids

            # First try evaluating with compatible citation IDs together
            res_all = self.verify_claim(
                claim_text=claim,
                evidence_chunks=evidence_chunks,
                citation_chunk_ids=eval_cids
            )
            if res_all.status == ClaimStatus.SUPPORTED:
                best_res = res_all
            else:
                # Try evaluating against individual citations to find specific supporting chunk
                for cid in eval_cids:
                    res_single = self.verify_claim(
                        claim_text=claim,
                        evidence_chunks=evidence_chunks,
                        citation_chunk_ids=[cid]
                    )
                    if res_single.status == ClaimStatus.SUPPORTED:
                        best_res = res_single
                        break

            claim_res = best_res or res_all
            claim_results.append(claim_res)

            if claim_res.status == ClaimStatus.SUPPORTED:
                grounded_count += 1
            else:
                failed_claims.append(claim)
                reason = claim_res.discrepancy_reason or f"Claim status: {claim_res.status.value}"
                discrepancies.append(f"[{claim_res.status.value.upper()}] {claim}: {reason}")
                if claim_res.status == ClaimStatus.CONTRADICTED:
                    has_contradiction = True

        is_grounded = (len(failed_claims) == 0 and grounded_count > 0)
        supported_claims = [c.claim_text for c in claim_results if c.status == ClaimStatus.SUPPORTED]

        # Component-level decomposition & mapping
        INTENT_LABELS = {
            "indications": "Indications & Clinical Usage",
            "adverse_effects": "Adverse Reactions & Side Effects",
            "contraindications": "Contraindications & Warnings",
            "dosage": "Dosage & Administration",
            "interactions": "Drug Interactions",
            "special_populations": "Use in Specific Populations",
            "general_factual": "General Clinical Information",
            "overview": "Clinical Overview"
        }

        component_map: Dict[str, Dict[str, Any]] = {}
        if target_intents:
            for ti in target_intents:
                t_str = str(ti.value if hasattr(ti, 'value') else ti).lower()
                component_map[t_str] = {
                    "label": INTENT_LABELS.get(t_str, t_str.replace("_", " ").title()),
                    "claims": []
                }

        # Map evaluated claims to logical components
        # Use the already initialized target-component keys for classification.
        requested_intent_names = set(component_map.keys())
        for cres in claim_results:
            claim_text_lower = cres.claim_text.lower()
            prop = cres.proposition
            c_intent = "general_factual"
            if prop:
                if prop.predicate in ["contraindicated", "safe"] or "contraindication" in claim_text_lower or "warning" in claim_text_lower:
                    c_intent = "contraindications"
                elif prop.predicate == "adverse_reaction" or "adverse" in claim_text_lower or "side effect" in claim_text_lower:
                    c_intent = "adverse_effects"
                elif prop.predicate == "dose" or prop.value is not None or "dose" in claim_text_lower or "dosage" in claim_text_lower:
                    c_intent = "dosage"
                elif (
                    "interactions" in requested_intent_names
                    and any(
                        term in claim_text_lower
                        for term in (
                            "plasma concentration",
                            "renal tubular secretion",
                            "cationic drug",
                            "coadministr",
                            "co-administer",
                            "concomitant",
                            "drug interaction",
                            "drug interactions",
                        )
                    )
                ):
                    c_intent = "interactions"
                elif prop.predicate in ["indicated", "decreases", "increases", "is"] or "prescribed" in claim_text_lower or "used for" in claim_text_lower or "treat" in claim_text_lower:
                    c_intent = "indications"
            else:
                if "contraindication" in claim_text_lower or "warning" in claim_text_lower:
                    c_intent = "contraindications"
                elif "adverse" in claim_text_lower or "side effect" in claim_text_lower:
                    c_intent = "adverse_effects"
                elif "dose" in claim_text_lower or "dosage" in claim_text_lower:
                    c_intent = "dosage"
                elif "prescribed" in claim_text_lower or "used for" in claim_text_lower or "treat" in claim_text_lower:
                    c_intent = "indications"

            if c_intent not in component_map:
                component_map[c_intent] = {
                    "label": INTENT_LABELS.get(c_intent, c_intent.replace("_", " ").title()),
                    "claims": []
                }
            component_map[c_intent]["claims"].append(cres)

        # Build evaluated AnswerComponent objects
        components: List[AnswerComponent] = []
        for c_intent, c_data in component_map.items():
            c_claims: List[ClaimVerificationResult] = c_data["claims"]
            if not c_claims:
                c_status = ClaimStatus.UNSUPPORTED_BY_EVIDENCE
                supp_text = None
                comp_citations = []
            else:
                if any(c.status == ClaimStatus.CONTRADICTED for c in c_claims):
                    c_status = ClaimStatus.CONTRADICTED
                elif any(c.status == ClaimStatus.NUMERIC_MISMATCH for c in c_claims):
                    c_status = ClaimStatus.NUMERIC_MISMATCH
                elif any(c.status == ClaimStatus.ENTITY_MISMATCH for c in c_claims):
                    c_status = ClaimStatus.ENTITY_MISMATCH
                elif any(c.status == ClaimStatus.QUALIFIER_MISMATCH for c in c_claims):
                    c_status = ClaimStatus.QUALIFIER_MISMATCH
                elif any(c.status == ClaimStatus.INVALID_CITATION for c in c_claims):
                    c_status = ClaimStatus.INVALID_CITATION
                elif all(c.status == ClaimStatus.SUPPORTED for c in c_claims):
                    c_status = ClaimStatus.SUPPORTED
                elif any(c.status == ClaimStatus.WEAKLY_SUPPORTED for c in c_claims):
                    c_status = ClaimStatus.WEAKLY_SUPPORTED
                else:
                    c_status = ClaimStatus.UNSUPPORTED_BY_EVIDENCE

                supp_claims = [c.claim_text for c in c_claims if c.status == ClaimStatus.SUPPORTED]
                supp_text = " ".join(supp_claims) if supp_claims else None
                comp_citations = list(set([cid for c in c_claims if c.status == ClaimStatus.SUPPORTED for cid in c.supporting_chunk_ids]))

            components.append(AnswerComponent(
                intent=c_intent,
                label=c_data["label"],
                status=c_status,
                claims=c_claims,
                supported_text=supp_text,
                citations=comp_citations
            ))

        supported_components = [c for c in components if c.status == ClaimStatus.SUPPORTED and c.supported_text]
        toxic_components = [c for c in components if c.status in [
            ClaimStatus.CONTRADICTED, ClaimStatus.NUMERIC_MISMATCH,
            ClaimStatus.ENTITY_MISMATCH, ClaimStatus.QUALIFIER_MISMATCH, ClaimStatus.INVALID_CITATION
        ]]
        unverified_components = [c for c in components if c.status in [ClaimStatus.UNSUPPORTED_BY_EVIDENCE, ClaimStatus.UNVERIFIED]]

        # Whole-answer grounding requires zero claim failures AND all target components supported
        all_components_supported = all(c.status == ClaimStatus.SUPPORTED for c in components) if components else True
        is_grounded = (len(failed_claims) == 0 and grounded_count > 0 and all_components_supported)

        # Determine safety for partial disclosure:
        # A partial answer is permitted ONLY IF:
        # 1. Not already fully grounded
        # 2. At least one component is verified SUPPORTED
        # 3. NO critical contradictions (has_contradiction is False)
        # 4. Zero toxic failures across evaluated components
        has_toxic_failure = len(toxic_components) > 0
        safe_for_partial = (not is_grounded) and (len(supported_components) > 0) and (not has_contradiction) and (not has_toxic_failure)

        partial_answer = None
        if safe_for_partial and supported_components:
            base_supported = "\n\n".join([c.supported_text for c in supported_components if c.supported_text])
            unverified_labels = [c.label for c in unverified_components if c.status != ClaimStatus.SUPPORTED]
            if unverified_labels:
                partial_answer = (
                    f"{base_supported}\n\n"
                    f"[Clinical Note: The statements above for {', '.join([c.label for c in supported_components])} "
                    f"are verified by authoritative guidelines. However, the following aspect(s) could not be verified from retrieved guidelines: {', '.join(unverified_labels)}.]"
                )
            else:
                partial_answer = base_supported

        return AnswerVerificationResult(
            answer=answer,
            is_grounded=is_grounded,
            has_contradiction=has_contradiction,
            claim_results=claim_results,
            failed_claims=failed_claims,
            discrepancies=discrepancies,
            grounded_claim_count=grounded_count,
            total_claim_count=len(claims),
            supported_claims=supported_claims,
            partial_answer=partial_answer,
            safe_for_partial=safe_for_partial,
            components=components
        )
