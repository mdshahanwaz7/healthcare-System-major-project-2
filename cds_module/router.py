"""
FastAPI Router for Clinical Decision Support (CDS) Coordination Layer.
Exposes POST /cds/evaluate and POST /cds/screen-prescription.
"""
import logging
from fastapi import APIRouter, HTTPException, Depends, status
from cds_module.models import (
    CDSEvaluateRequest,
    CDSEvaluateResponse,
    PrescriptionScreenRequest,
    PrescriptionScreenResponse
)
from cds_module.orchestrator import CDSOrchestrator, get_cds_orchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cds", tags=["Clinical Decision Support"])


@router.post(
    "/evaluate",
    response_model=CDSEvaluateResponse,
    summary="Evaluate Clinical Query with Request-Scoped Patient Context",
    description="""
    Orchestrates evidence-grounded medical RAG and deterministic drug safety rules.
    - Evaluates clinician or patient clinical inquiries.
    - Screens active and candidate medications against deterministic DrugBank interaction rules.
    - Enforces fail-closed evidence grounding and acute emergency diversion.
    - Accepts sanitized, request-scoped patient clinical context (strictly no PII).
    - Stateless: Patient data is never stored in the global RAG corpus.
    """
)
def evaluate_clinical_query(
    request: CDSEvaluateRequest,
    orchestrator: CDSOrchestrator = Depends(get_cds_orchestrator)
):
    try:
        return orchestrator.evaluate(request)
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve)
        )
    except Exception as e:
        logger.exception("CDS evaluation failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"CDS evaluation pipeline encountered an internal error: {str(e)}"
        )


@router.post(
    "/screen-prescription",
    response_model=PrescriptionScreenResponse,
    summary="Deterministic Drug-Drug & Allergy Screening",
    description="""
    Screens candidate medications against active allergies and DrugBank interaction rulebase.
    Deterministic, rule-based clinical safety verification.
    """
)
def screen_prescription(
    request: PrescriptionScreenRequest,
    orchestrator: CDSOrchestrator = Depends(get_cds_orchestrator)
):
    try:
        return orchestrator.screen_prescription(request)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Prescription screening encountered an internal error: {str(e)}"
        )
